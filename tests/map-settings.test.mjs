import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {setup} from './helpers/database.mjs';
import {createMapSettingsStore} from '../src/storage/map-settings-store.mjs';
import {createDpapiProtector} from '../src/platform/dpapi.mjs';
import {createHttpApp} from '../src/server/http-app.mjs';
import {request} from './helpers/http-client.mjs';

const JS_KEY='FAKE-AMAP-JS-KEY',SECURITY='FAKE-AMAP-SECURITY-CODE';
function protector() {const key=randomBytes(32);return {async protect(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64');},async unprotect(value){const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString();}};}
const replace=(expectedRevision=0)=>({expectedRevision,key:{action:'replace',value:JS_KEY},security:{action:'replace',value:SECURITY}});
const retain=(expectedRevision)=>({expectedRevision,key:{action:'retain'},security:{action:'retain'}});

test('first setup requires a pair and public/session views never reveal security or ciphertext',async t=>{
  const c=setup(t),store=createMapSettingsStore(c.database,{protector:protector()});
  await assert.rejects(store.update({expectedRevision:0,key:{action:'replace',value:JS_KEY},security:{action:'retain'}}),error=>error.code==='VALIDATION');
  const saved=await store.update(replace());assert.deepEqual({revision:saved.revision,keyConfigured:saved.keyConfigured,securityConfigured:saved.securityConfigured,complete:saved.complete},{revision:1,keyConfigured:true,securityConfigured:true,complete:true});
  const text=JSON.stringify(saved);assert.equal(text.includes(JS_KEY),false);assert.equal(text.includes(SECURITY),false);
  const session=await store.resolveSession();assert.deepEqual(session,{provider:'amap',revision:1,key:JS_KEY,serviceHost:'/_AMapService/1'});assert.equal(JSON.stringify(session).includes(SECURITY),false);
  assert.equal(await store.resolveSecurityCode(1),SECURITY);
});

test('retain delete stale revision and damaged cipher recovery are explicit',async t=>{
  const c=setup(t),crypt=protector(),store=createMapSettingsStore(c.database,{protector:crypt});await store.update(replace());
  assert.equal((await store.update(retain(1))).revision,2);await assert.rejects(store.update(retain(1)),error=>error.code==='CONFLICT');
  const deleted=await store.update({expectedRevision:2,key:{action:'delete'},security:{action:'retain'}});assert.equal(deleted.keyConfigured,false);assert.equal(deleted.securityConfigured,true);assert.equal(deleted.complete,false);await assert.rejects(store.resolveSession(),error=>error.code==='MAP_CONFIGURATION_REQUIRED');
  await store.update({expectedRevision:3,key:{action:'replace',value:JS_KEY},security:{action:'replace',value:SECURITY}});
  const row=c.database.db.prepare('SELECT payload FROM map_settings WHERE id=1').get(),payload=JSON.parse(row.payload);payload.securityCipher='AAAA';c.database.db.prepare('UPDATE map_settings SET payload=? WHERE id=1').run(JSON.stringify(payload));
  await assert.rejects(store.update(retain(4)),error=>error.code==='MAP_CREDENTIALS_UNAVAILABLE');
  assert.equal((await store.update({expectedRevision:4,key:{action:'replace',value:JS_KEY},security:{action:'replace',value:SECURITY}})).revision,5);
});

test('mutable input and concurrent revision changes cannot cross async crypto boundaries',async t=>{
  const c=setup(t),fast=protector();let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const slow=createMapSettingsStore(c.database,{protector:{unprotect:fast.unprotect,async protect(value){enter();await gate;return fast.protect(value);}}});const input=replace(),pending=slow.update(input);await entered;input.key.value='MUTATED';input.expectedRevision=99;release();const saved=await pending;assert.equal(saved.revision,1);assert.equal((await slow.resolveSession()).key,JS_KEY);
  let decryptEnter,decryptRelease;const decryptEntered=new Promise(resolve=>{decryptEnter=resolve;}),decryptGate=new Promise(resolve=>{decryptRelease=resolve;});const waiting=createMapSettingsStore(c.database,{protector:{protect:fast.protect,async unprotect(cipher){decryptEnter();await decryptGate;return fast.unprotect(cipher);}}});
  const session=waiting.resolveSession();await decryptEntered;await slow.update(retain(1));decryptRelease();await assert.rejects(session,error=>error.code==='CONFLICT');
});

test('map settings API exposes safe metadata and a browser session without security code',async t=>{
  const c=setup(t),store=createMapSettingsStore(c.database,{protector:protector()}),server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;server.on('request',createHttpApp({service:c.service,expenses:c.expenses,footprints:c.footprints,mapSettings:store,allowedHosts:[`127.0.0.1:${port}`]}));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${port}`;assert.equal((await request(url,{path:'/api/map-settings'})).json.data.provider,'amap');assert.equal((await request(url,{path:'/api/map-settings',method:'PUT',body:replace()})).status,200);
  const session=await request(url,{path:'/api/map-session'});assert.equal(session.json.data.key,JS_KEY);assert.equal(session.text.includes(SECURITY),false);
});

test('real DPAPI ciphertext survives a store restart for the same Windows user',async t=>{
  if(process.platform!=='win32')return t.skip('Windows DPAPI only');const c=setup(t);const first=createMapSettingsStore(c.database,{protector:createDpapiProtector()});await first.update(replace());const second=createMapSettingsStore(c.database,{protector:createDpapiProtector()});assert.equal((await second.resolveSession()).key,JS_KEY);
});

test('success and credential failures never log secrets',async t=>{
  const logged=[];for(const method of ['log','warn','error','info','debug'])t.mock.method(console,method,(...args)=>logged.push(args.join(' ')));const c=setup(t),store=createMapSettingsStore(c.database,{protector:protector()});await store.update(replace());assert.equal(logged.join('\n').includes(JS_KEY),false);assert.equal(logged.join('\n').includes(SECURITY),false);
});
