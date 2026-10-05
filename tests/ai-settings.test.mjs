import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setup} from './helpers/database.mjs';
import {createAiSettingsStore} from '../src/storage/ai-settings-store.mjs';
import {validateProviderConfig} from '../src/ai/provider-config.mjs';
import {createDpapiProtector} from '../src/platform/dpapi.mjs';

const fake='FAKE-SETTINGS-KEY-ONLY';
const endpoints={deepseek:'https://api.deepseek.com/chat/completions',zhipu:'https://open.bigmodel.cn/api/paas/v4/chat/completions',mimo:'https://api.xiaomimimo.com/v1/chat/completions',kimi:'https://api.moonshot.cn/v1/chat/completions',qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'};
function config(provider='deepseek',overrides={}) {return {model:'qa-text-model',endpoint:endpoints[provider],keyAction:'replace',apiKey:fake,...overrides};}
function command(expectedRevision=0,providers={deepseek:config()},search={keyMode:'zhipu',keyAction:'retain'}) {return {expectedRevision,providers,search};}
// Fast real cryptography double at the slow Windows process boundary only.
function fastProtector() {const key=randomBytes(32);return {
  async protect(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');},
  async unprotect(value){const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');},
};}
function fixture(t,{protector=fastProtector(),isJobActive}={}) {const base=setup(t);let active=false;const store=createAiSettingsStore(base.database,{protector,isJobActive:isJobActive??(()=>active)});return {...base,store,protector,setActive(value){active=value;}};}
function raw(database) {return database.db.prepare('SELECT * FROM ai_settings WHERE id=1').get();}
function damage(database) {const row=raw(database),payload=JSON.parse(row.payload);payload.providers.deepseek.keyCipher='AAAA';database.db.prepare('UPDATE ai_settings SET payload=? WHERE id=1').run(JSON.stringify(payload));}

test('empty public settings show five unconfigured providers and no secrets',t=>{
  const {store}=fixture(t),settings=store.getPublic();assert.equal(settings.revision,0);assert.equal(settings.jobActive,false);
  assert.deepEqual(Object.keys(settings.providers),['deepseek','zhipu','mimo','kimi','qwen']);assert.ok(Object.values(settings.providers).every(p=>p.keyConfigured===false));assert.equal(settings.search.keyConfigured,false);
});
test('settings persist encrypted and public reads never contain plaintext or ciphertext',async t=>{
  const {database,store}=fixture(t);const saved=await store.update(command());assert.equal(saved.revision,1);assert.equal(saved.providers.deepseek.keyConfigured,true);
  const row=raw(database),cipher=JSON.parse(row.payload).providers.deepseek.keyCipher;assert.ok(!row.payload.includes(fake));assert.ok(!JSON.stringify(saved).includes(cipher));
  assert.deepEqual(await store.resolveCredentials('deepseek',1).catch(e=>e.code),'AI_KEY_REQUIRED');
  assert.equal(store.getPublic().revision,1);
});
test('all five providers retain individual model settings and use the separate search key',async t=>{
  const {store}=fixture(t);const providers=Object.fromEntries(Object.keys(endpoints).map(p=>[p,config(p,{model:p+'-qa-model',apiKey:fake+'-'+p})]));
  await store.update(command(0,providers,{keyMode:'separate',keyAction:'replace',apiKey:'FAKE-SEARCH-KEY'}));
  for(const p of Object.keys(endpoints))assert.deepEqual(await store.resolveCredentials(p,1),{model:p+'-qa-model',endpoint:endpoints[p],modelKey:fake+'-'+p,searchKey:'FAKE-SEARCH-KEY'});
});
test('blank retain preserves ciphertext and explicit delete removes configuration',async t=>{
  const {database,store}=fixture(t);await store.update(command());const cipher=JSON.parse(raw(database).payload).providers.deepseek.keyCipher;
  await store.update(command(1,{deepseek:config('deepseek',{keyAction:'retain',apiKey:''})}));assert.equal(JSON.parse(raw(database).payload).providers.deepseek.keyCipher,cipher);
  await store.update(command(2,{deepseek:config('deepseek',{keyAction:'delete',apiKey:''})}));assert.equal(store.getPublic().providers.deepseek.keyConfigured,false);assert.ok(!raw(database).payload.includes(cipher));
});
test('reused Zhipu model key controls search status and deletion invalidates reuse',async t=>{
  const {store}=fixture(t);await store.update(command(0,{zhipu:config('zhipu'),deepseek:config()}));
  assert.equal(store.getPublic().search.keyConfigured,true);assert.equal((await store.resolveCredentials('deepseek',1)).searchKey,fake);
  await store.update(command(1,{zhipu:config('zhipu',{keyAction:'delete',apiKey:''})}));assert.equal(store.getPublic().search.keyConfigured,false);
  await assert.rejects(store.resolveCredentials('deepseek',2),e=>e.code==='AI_KEY_REQUIRED');
});
test('switching search modes preserves its separate encrypted key until explicitly deleted',async t=>{
  const {store}=fixture(t);await store.update(command(0,{zhipu:config('zhipu'),deepseek:config()},{keyMode:'separate',keyAction:'replace',apiKey:'FAKE-SEARCH-KEY'}));
  await store.update(command(1,{}, {keyMode:'zhipu',keyAction:'retain'}));assert.equal((await store.resolveCredentials('deepseek',2)).searchKey,fake);
  await store.update(command(2,{}, {keyMode:'separate',keyAction:'retain',apiKey:''}));assert.equal((await store.resolveCredentials('deepseek',3)).searchKey,'FAKE-SEARCH-KEY');
  await store.update(command(3,{}, {keyMode:'separate',keyAction:'delete'}));assert.equal(store.getPublic().search.keyConfigured,false);
});
test('corrupt ciphertext survives failed retain or replace; explicit replacement and deletion recover',async t=>{
  const {database,store}=fixture(t);await store.update(command());damage(database);const before=raw(database);
  await assert.rejects(store.update(command(1,{deepseek:config('deepseek',{keyAction:'retain',apiKey:''})})),e=>e.code==='AI_CREDENTIALS_UNAVAILABLE');assert.deepEqual(raw(database),before);
  await assert.rejects(store.update(command(1,{deepseek:config('deepseek',{apiKey:''})})),e=>e.code==='VALIDATION');assert.deepEqual(raw(database),before);
  await store.update(command(1));assert.equal(store.getPublic().revision,2);damage(database);
  await store.update(command(2,{deepseek:config('deepseek',{keyAction:'delete',apiKey:''})}));assert.equal(store.getPublic().providers.deepseek.keyConfigured,false);
});
test('failed encryption does not replace an existing ciphertext or leak dependency diagnostics',async t=>{
  const protector=fastProtector();let fail=false;const {database,store}=fixture(t,{protector:{unprotect:protector.unprotect,async protect(value){if(fail)throw new Error(fake);return protector.protect(value);}}});
  await store.update(command());const before=raw(database);fail=true;
  await assert.rejects(store.update(command(1)),e=>e.code==='AI_CREDENTIALS_UNAVAILABLE'&&!String(e).includes(fake)&&!e.cause);assert.deepEqual(raw(database),before);
});
test('stale setting revisions and active jobs reject every write without mutation',async t=>{
  const {database,store,setActive}=fixture(t);await store.update(command());const before=raw(database);
  await assert.rejects(store.update(command(0)),e=>e.code==='CONFLICT');setActive(true);
  for(const action of ['retain','replace','delete'])await assert.rejects(store.update(command(1,{deepseek:config('deepseek',{keyAction:action,...(action!=='replace'?{apiKey:''}:{})})})),e=>e.code==='CONFLICT');
  assert.deepEqual(raw(database),before);assert.equal(store.getPublic().jobActive,true);
});
test('settings revision is rechecked after asynchronous encryption',async t=>{
  let entered,release;const waiting=new Promise(res=>{entered=res;}),gate=new Promise(res=>{release=res;});const fast=fastProtector();
  const {database}=fixture(t);const slow=createAiSettingsStore(database,{protector:{unprotect:fast.unprotect,async protect(value){entered();await gate;return fast.protect(value);}},isJobActive:()=>false});
  const next=createAiSettingsStore(database,{protector:fast,isJobActive:()=>false});const pending=slow.update(command());await waiting;await next.update(command());const before=raw(database);release();
  await assert.rejects(pending,e=>e.code==='CONFLICT');assert.deepEqual(raw(database),before);
});
test('job activation during encryption is rechecked inside the committing transaction',async t=>{
  let entered,release;const waiting=new Promise(res=>{entered=res;}),gate=new Promise(res=>{release=res;});const fast=fastProtector();
  const {database,store,setActive}=fixture(t,{protector:{unprotect:fast.unprotect,async protect(value){entered();await gate;return fast.protect(value);}}});
  const pending=store.update(command());await waiting;setActive(true);release();await assert.rejects(pending,e=>e.code==='CONFLICT');assert.equal(raw(database),undefined);
});
test('host changes cannot carry retained keys to a new destination',async t=>{
  const {database,store}=fixture(t);await store.update(command(0,{qwen:config('qwen')}));const before=raw(database);
  await assert.rejects(store.update(command(1,{qwen:config('qwen',{endpoint:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',keyAction:'retain',apiKey:''})})),e=>e.code==='VALIDATION');assert.deepEqual(raw(database),before);
});
test('SQL commit failure rolls back settings revision and encrypted values',async t=>{
  const {database,store}=fixture(t);await store.update(command());const before=raw(database);database.db.exec("CREATE TRIGGER fail_settings BEFORE UPDATE ON ai_settings BEGIN SELECT RAISE(ABORT,'injected'); END");
  await assert.rejects(store.update(command(1)));assert.deepEqual(raw(database),before);
});
test('real DPAPI credentials survive closing and reopening the temporary SQLite database',async t=>{
  const {database,path}=fixture(t,{protector:createDpapiProtector()});const store=createAiSettingsStore(database,{protector:createDpapiProtector(),isJobActive:()=>false});
  await store.update(command(0,{zhipu:config('zhipu')}));database.close();assert.ok(!readFileSync(path).includes(Buffer.from(fake)));
  const {openDatabase}=await import('../src/storage/database.mjs');const reopened=openDatabase(path);
  try {const next=createAiSettingsStore(reopened,{protector:createDpapiProtector(),isJobActive:()=>false});assert.equal((await next.resolveCredentials('zhipu',1)).modelKey,fake);}finally{reopened.close();}
});
test('credential resolution rejects stale snapshots and damaged ciphertext without modifying storage',async t=>{
  const {database,store}=fixture(t);await store.update(command(0,{deepseek:config(),zhipu:config('zhipu')}));
  await assert.rejects(store.resolveCredentials('deepseek',0),e=>e.code==='CONFLICT');damage(database);const before=raw(database);
  await assert.rejects(store.resolveCredentials('deepseek',1),e=>e.code==='AI_CREDENTIALS_UNAVAILABLE');assert.deepEqual(raw(database),before);
});
for(const [name,override] of [['empty model',{model:''}],['long model',{model:'x'.repeat(201)}],['model control',{model:'x\n'}],['empty replacement',{apiKey:''}],['long key',{apiKey:'x'.repeat(4097)}],['key control',{apiKey:'x\u0000'}],['HTTP endpoint',{endpoint:'http://api.deepseek.com/chat/completions'}],['URL userinfo',{endpoint:'https://user:pass@api.deepseek.com/chat/completions'}],['unknown action',{keyAction:'guess'}],['nonempty retained input',{keyAction:'retain'}]])test(`provider config rejects ${name} without echoing values`,()=>{
  assert.throws(()=>validateProviderConfig('deepseek',config('deepseek',override),{...config(),keyCipher:'stored-cipher'}),e=>e.code==='VALIDATION'&&!String(e).includes(fake));
});
test('first-time retain and unknown providers are rejected',()=>{
  assert.throws(()=>validateProviderConfig('deepseek',config('deepseek',{keyAction:'retain',apiKey:''}),null),e=>e.code==='VALIDATION');assert.throws(()=>validateProviderConfig('unknown',config(),null),e=>e.code==='VALIDATION');
});
test('malformed command envelopes and unknown fields are rejected before storage',async t=>{
  const {store,database}=fixture(t);
  for(const value of [null,[],{...command(),expectedRevision:-1},{...command(),providers:{unknown:config()}},{...command(),extra:fake},{...command(),providers:{deepseek:{...config(),extra:fake}}}])await assert.rejects(store.update(value),e=>e.code==='VALIDATION');
  assert.equal(raw(database),undefined);
});
test('stored active-job state blocks updates even without an injected activity callback',async t=>{
  const {database}=fixture(t);database.db.exec("INSERT INTO ai_jobs VALUES('job-1','op-1','hash','queued','{}')");
  const store=createAiSettingsStore(database,{protector:fastProtector()});assert.equal(store.getPublic().jobActive,true);
  await assert.rejects(store.update(command()),e=>e.code==='CONFLICT');assert.equal(raw(database),undefined);
});
test('settings changed during decryption cannot return credentials for an obsolete revision',async t=>{
  const {database,store,protector}=fixture(t);await store.update(command(0,{deepseek:config(),zhipu:config('zhipu')}));
  let entered,release;const waiting=new Promise(res=>{entered=res;}),gate=new Promise(res=>{release=res;});
  const slow=createAiSettingsStore(database,{protector:{protect:protector.protect,async unprotect(cipher){entered();await gate;return protector.unprotect(cipher);}},isJobActive:()=>false});
  const pending=slow.resolveCredentials('deepseek',1);await waiting;await store.update(command(1,{}));release();await assert.rejects(pending,e=>e.code==='CONFLICT');
});
test('mutable inputs are snapshotted before waiting for key protection',async t=>{
  let entered,release;const waiting=new Promise(res=>{entered=res;}),gate=new Promise(res=>{release=res;});const fast=fastProtector();
  const {store}=fixture(t,{protector:{unprotect:fast.unprotect,async protect(value){entered();await gate;return fast.protect(value);}}});
  const request=command(0,{deepseek:config(),zhipu:config('zhipu')});const pending=store.update(request);await waiting;
  request.providers.deepseek.model='mutated';request.providers.zhipu.apiKey='FAKE-MUTATED-KEY';request.search.keyMode='separate';request.expectedRevision=100;
  release();const saved=await pending;assert.equal(saved.providers.deepseek.model,'qa-text-model');assert.equal(saved.search.keyMode,'zhipu');assert.equal((await store.resolveCredentials('zhipu',1)).modelKey,fake);
});
test('damaged separate search cipher survives failed retain and explicit replacement recovers',async t=>{
  const {database,store}=fixture(t);await store.update(command(0,{deepseek:config()},{keyMode:'separate',keyAction:'replace',apiKey:'FAKE-SEARCH-KEY'}));
  const row=raw(database),payload=JSON.parse(row.payload);payload.search.keyCipher='AAAA';database.db.prepare('UPDATE ai_settings SET payload=? WHERE id=1').run(JSON.stringify(payload));const before=raw(database);
  await assert.rejects(store.update(command(1,{}, {keyMode:'separate',keyAction:'retain'})),e=>e.code==='AI_CREDENTIALS_UNAVAILABLE');assert.deepEqual(raw(database),before);
  await store.update(command(1,{}, {keyMode:'separate',keyAction:'replace',apiKey:'FAKE-SEARCH-RECOVERED'}));assert.equal((await store.resolveCredentials('deepseek',2)).searchKey,'FAKE-SEARCH-RECOVERED');
});
test('configuration getters never execute and exact size boundaries are not truncated',()=>{
  let invoked=false;const value=config();Object.defineProperty(value,'apiKey',{get(){invoked=true;return fake;},enumerable:true});
  assert.throws(()=>validateProviderConfig('deepseek',value,null),e=>e.code==='VALIDATION');assert.equal(invoked,false);
  const result=validateProviderConfig('deepseek',config('deepseek',{model:'模'.repeat(200),apiKey:'K'.repeat(4096)}),null);assert.equal(result.model.length,200);assert.equal(result.apiKey.length,4096);
});
test('explicitly deleting a key permits changing host without transferring a credential',async t=>{
  const {store}=fixture(t);await store.update(command(0,{qwen:config('qwen')}));
  await store.update(command(1,{qwen:config('qwen',{endpoint:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',keyAction:'delete',apiKey:''})}));
  assert.equal(store.getPublic().providers.qwen.keyConfigured,false);await assert.rejects(store.resolveCredentials('qwen',2),e=>e.code==='AI_KEY_REQUIRED');
});
test('settings success and failure emit no sensitive console diagnostics',async t=>{
  const logged=[];for(const method of ['log','warn','error','info','debug'])t.mock.method(console,method,(...args)=>{logged.push(args.map(String).join(' '));});
  const {store,database}=fixture(t);await store.update(command());damage(database);
  await assert.rejects(store.update(command(1,{deepseek:config('deepseek',{keyAction:'retain',apiKey:''})})),e=>e.code==='AI_CREDENTIALS_UNAVAILABLE');
  assert.ok(!logged.join('\n').includes(fake));
});
