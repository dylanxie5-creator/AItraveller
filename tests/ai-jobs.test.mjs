import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/storage/database.mjs';
import {createAiJobStore} from '../src/storage/ai-job-store.mjs';
import {createAiPlanStore} from '../src/storage/ai-plan-store.mjs';
import {createAiJobService} from '../src/services/ai-job-service.mjs';
import {getCityByCode} from '../src/domain/city-catalog.mjs';
import {AiError} from '../src/ai/errors.mjs';
import {aiInput,sources} from './helpers/ai-fixtures.mjs';
import {makeAiContext,aiCommand} from './helpers/ai-context.mjs';

const command=(c,options={},operationId='op-1')=>aiCommand(c.settingsStore.getPublic().revision,aiInput(options),operationId);
const activeStates=new Set(['queued','searching','generating']);

for(const cityCount of [1,2,3])test(`${cityCount} cities persist exactly ${cityCount} search reservations and one model reservation`,async t=>{
  const c=await makeAiContext(t),created=await c.jobs.submit(command(c,{cityCount,days:4}));await c.jobs.settled();
  const job=c.jobs.get(created.id);assert.equal(job.state,'succeeded');assert.equal(job.searchCalls,cityCount);assert.equal(job.modelCalls,1);
  assert.deepEqual(c.networkCalls,{search:cityCount,model:1});assert.equal(job.sources.length,cityCount);assert.ok(job.planId);assert.equal(c.planStore.list().length,1);
});
test('same accepted operation returns its receipt after settings change without decrypting or calling again',async t=>{
  const c=await makeAiContext(t),accepted=command(c,{cityCount:2});const first=await c.jobs.submit(accepted);await c.jobs.settled();
  await c.settingsStore.update({expectedRevision:1,providers:{deepseek:{model:'custom-model',endpoint:'https://api.deepseek.com/chat/completions',keyAction:'replace',apiKey:'NEW-FAKE-KEY'}},search:{keyMode:'separate',keyAction:'retain'}});
  const second=await c.jobs.submit(accepted);assert.equal(second.id,first.id);assert.deepEqual(c.networkCalls,{search:2,model:1});assert.equal(second.state,'succeeded');
});
test('same operation id with different input conflicts and preserves the first task',async t=>{
  const c=await makeAiContext(t),first=await c.jobs.submit(command(c,{cityCount:1}));await c.jobs.settled();
  await assert.rejects(c.jobs.submit(command(c,{cityCount:2},'op-1')),e=>e.code==='CONFLICT');assert.equal(c.jobs.list().length,1);assert.equal(c.jobs.get(first.id).state,'succeeded');
});
test('task hashing rejects accessors without evaluating them',async t=>{
  const c=await makeAiContext(t),input=aiInput({cityCount:1});let reads=0;
  Object.defineProperty(input,'preferences',{enumerable:true,get(){reads++;return '不应读取';}});
  await assert.rejects(c.jobs.submit(aiCommand(1,input)),e=>e.code==='VALIDATION');assert.equal(reads,0);assert.deepEqual(c.networkCalls,{search:0,model:0});
});
test('accepted task snapshots its original input before asynchronous credential reads',async t=>{
  let pause=false,entered,release;const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const protector={async protect(value){return Buffer.from(`protected:${value}`).toString('base64');},async unprotect(value){if(pause){pause=false;entered();await gate;}return Buffer.from(value,'base64').toString().slice(10);}};
  const c=await makeAiContext(t,{runLater:()=>{},settingsProtector:protector}),input=aiInput({cityCount:1});pause=true;
  const pending=c.jobs.submit(aiCommand(1,input));await waiting;input.name='被异步篡改';input.cityCodes.push('310100');release();const accepted=await pending;
  assert.equal(accepted.input.name,'江南小旅行');assert.deepEqual(accepted.input.cityCodes,['320100']);
});
test('two new operations cannot enter search together',async t=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const c=await makeAiContext(t,{searchImpl:async(args)=>{entered();await gate;return [{sourceId:'s1',title:'资料',url:'https://example.com/1',summary:'摘要',publishedAt:null,retrievedAt:'2026-10-05T04:00:00.000Z'}];}});
  const first=await c.jobs.submit(command(c,{cityCount:1},'op-one'));await started;
  await assert.rejects(c.jobs.submit(command(c,{cityCount:1},'op-two')),e=>e.code==='CONFLICT');assert.equal(c.networkCalls.search,1);assert.equal(c.jobs.list().length,1);assert.ok(activeStates.has(c.jobs.get(first.id).state));
  release();await c.jobs.settled();assert.equal(c.jobs.get(first.id).state,'succeeded');
});
test('third search failure records three possible calls, runs zero models and does not retry',async t=>{
  const c=await makeAiContext(t,{searchImpl:async(args,n)=>{if(n===3)throw new AiError('AI_NETWORK','模拟断线');return [{sourceId:`s${n}`,title:'资料',url:`https://example.com/${n}`,summary:'摘要',publishedAt:null,retrievedAt:'2026-10-05T04:00:00.000Z'}];}});
  const job=await c.jobs.submit(command(c,{cityCount:3}));await c.jobs.settled();const saved=c.jobs.get(job.id);
  assert.equal(saved.state,'failed');assert.equal(saved.searchCalls,3);assert.equal(saved.modelCalls,0);assert.deepEqual(c.networkCalls,{search:3,model:0});assert.equal(c.planStore.list().length,0);
});
test('empty first search stops after one reserved call and no model',async t=>{
  const c=await makeAiContext(t,{searchImpl:async()=>[]}),job=await c.jobs.submit(command(c,{cityCount:2}));await c.jobs.settled();
  assert.equal(c.jobs.get(job.id).state,'failed');assert.equal(c.jobs.get(job.id).error.code,'AI_SEARCH_EMPTY');assert.deepEqual(c.networkCalls,{search:1,model:0});
});
test('model failure records one model call and saves no guide',async t=>{
  const c=await makeAiContext(t,{modelImpl:async()=>{throw new AiError('AI_NETWORK','模拟断线');}}),job=await c.jobs.submit(command(c,{cityCount:2}));await c.jobs.settled();
  assert.equal(c.jobs.get(job.id).state,'failed');assert.deepEqual(c.networkCalls,{search:2,model:1});assert.equal(c.jobs.get(job.id).modelCalls,1);assert.equal(c.planStore.list().length,0);
});
test('failure after a persisted reservation remains counted and never resends',async t=>{
  const c=await makeAiContext(t,{searchImpl:async()=>{throw new AiError('AI_NETWORK','socket closed after write');}}),job=await c.jobs.submit(command(c,{cityCount:1}));await c.jobs.settled();
  assert.deepEqual(c.networkCalls,{search:1,model:0});assert.equal(c.jobs.get(job.id).searchCalls,1);assert.equal(c.jobs.get(job.id).state,'failed');
  await c.jobs.settled();assert.deepEqual(c.networkCalls,{search:1,model:0});
});
test('task input, reservations and sources survive closing and reopening SQLite',async t=>{
  const c=await makeAiContext(t),job=await c.jobs.submit(command(c,{cityCount:2}));await c.jobs.settled();const before=c.jobs.get(job.id);await c.jobs.shutdown();c.database.close();
  const reopened=openDatabase(c.path),jobs=createAiJobStore(reopened,{now:()=>new Date(),createId:()=> 'unused'});const after=jobs.get(job.id);reopened.close();
  assert.deepEqual(after,before);assert.equal(after.sources.length,2);assert.equal(after.input.name,'江南小旅行');assert.equal(after.searchCalls,2);assert.equal(after.modelCalls,1);
});
for(const state of ['queued','searching','generating'])test(`recover interrupts ${state} without external calls`,async t=>{
  const c=await makeAiContext(t,{runLater:()=>{}}),snapshot={settingsRevision:1,provider:'deepseek',model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions'};
  const job=c.jobStore.create(command(c,{cityCount:1},`op-${state}`),'hash-'+state,snapshot);
  if(state!=='queued')c.jobStore.reserveSearch(job.id);if(state==='generating'){c.jobStore.recordSources(job.id,sources());c.jobStore.reserveModel(job.id);}
  const changed=c.jobs.recover();assert.equal(changed,1);assert.equal(c.jobs.get(job.id).state,'interrupted');assert.deepEqual(c.networkCalls,{search:0,model:0});await c.jobs.settled();
});
for(const [name,modelImpl] of [
  ['invalid JSON',async()=>({content:'{"trip":',usage:null})],
  ['unknown source id',async args=>{const data=JSON.parse((await import('./helpers/ai-fixtures.mjs')).planContent?JSON.stringify((await import('./helpers/ai-fixtures.mjs')).planContent(args.request)):'{}');data.days[0].activities[0].sourceIds=['s999'];return {content:JSON.stringify(data),usage:null};}],
  ['missing date',async args=>{const {planContent}=await import('./helpers/ai-fixtures.mjs');const data=planContent(args.request);data.days.pop();return {content:JSON.stringify(data),usage:null};}]
])test(`${name} model output never becomes a successful guide`,async t=>{
  const c=await makeAiContext(t,{modelImpl}),job=await c.jobs.submit(command(c,{cityCount:1}));await c.jobs.settled();assert.equal(c.jobs.get(job.id).state,'failed');assert.equal(c.planStore.list().length,0);assert.equal(c.networkCalls.model,1);
});
test('plan insert and job success are atomic; commit failure leaves a failed task with its input',async t=>{
  const c=await makeAiContext(t);c.database.db.exec("CREATE TRIGGER fail_job_success BEFORE UPDATE OF state ON ai_jobs WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'injected'); END");
  const job=await c.jobs.submit(command(c,{cityCount:1}));await c.jobs.settled();const saved=c.jobs.get(job.id);
  assert.equal(saved.state,'failed');assert.equal(saved.input.name,'江南小旅行');assert.equal(saved.planId,null);assert.equal(c.planStore.list().length,0);assert.deepEqual(c.networkCalls,{search:1,model:1});
});
test('active-job insertion failure happens before credentials can reach network',async t=>{
  const c=await makeAiContext(t);c.database.db.exec("CREATE TRIGGER reject_job BEFORE INSERT ON ai_jobs BEGIN SELECT RAISE(ABORT,'injected'); END");
  await assert.rejects(c.jobs.submit(command(c,{cityCount:1})));assert.deepEqual(c.networkCalls,{search:0,model:0});assert.equal(c.jobs.list().length,0);
});
test('reservation persistence failure prevents the corresponding external request',async t=>{
  const c=await makeAiContext(t);c.database.db.exec("CREATE TRIGGER reject_reservation BEFORE UPDATE OF state ON ai_jobs WHEN NEW.state='searching' BEGIN SELECT RAISE(ABORT,'injected'); END");
  const job=await c.jobs.submit(command(c,{cityCount:1}));await c.jobs.settled();assert.deepEqual(c.networkCalls,{search:0,model:0});assert.equal(c.jobs.get(job.id).state,'failed');
});
test('a job accepted while settings encryption waits makes that settings update conflict',async t=>{
  let enter,release;const waiting=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const base={async protect(value){return Buffer.from('protected:'+value).toString('base64');},async unprotect(value){return Buffer.from(value,'base64').toString().slice(10);}};let pause=false;
  const c=await makeAiContext(t,{runLater:()=>{},settingsProtector:{unprotect:base.unprotect,async protect(value){if(pause){enter();await gate;}return base.protect(value);}}});pause=true;
  const update=c.settingsStore.update({expectedRevision:1,providers:{deepseek:{model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',keyAction:'replace',apiKey:'REPLACEMENT'}},search:{keyMode:'separate',keyAction:'retain'}});await waiting;
  const accepted=await c.jobs.submit(command(c,{cityCount:1}));assert.equal(accepted.state,'queued');release();await assert.rejects(update,e=>e.code==='CONFLICT');assert.equal(c.settingsStore.getPublic().revision,1);
});
test('shutdown aborts active work, waits for state persistence and never restarts it',async t=>{
  let entered;const started=new Promise(resolve=>{entered=resolve;});const c=await makeAiContext(t,{searchImpl:async({signal})=>{entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new AiError('AI_CANCELLED','cancelled')),{once:true}));}});
  const job=await c.jobs.submit(command(c,{cityCount:1}));await started;await c.jobs.shutdown();assert.ok(['failed','interrupted'].includes(c.jobs.get(job.id).state));assert.equal(c.networkCalls.search,1);await c.jobs.settled();assert.equal(c.networkCalls.search,1);
});
