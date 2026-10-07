import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {startServer} from '../src/start.mjs';
import {AiError} from '../src/ai/errors.mjs';
import {normalizeAiInput} from '../src/ai/validation.mjs';
import {getCityByCode} from '../src/domain/city-catalog.mjs';
import {makeAiContext,aiCommand} from './helpers/ai-context.mjs';
import {aiInput,planContent,sources} from './helpers/ai-fixtures.mjs';
import {request} from './helpers/http-client.mjs';

const endpoint='https://api.deepseek.com/chat/completions';
function submitAndDropResponse(url,path,body) {
  const origin=new URL(url),data=JSON.stringify(body);
  return new Promise((resolve,reject)=>{const call=http.request({hostname:origin.hostname,port:origin.port,path,method:'POST',headers:{Origin:origin.origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},response=>{response.destroy();resolve();});call.on('error',reject);call.end(data);});
}
async function launch(t,options={}) {
  const c=await makeAiContext(t,options),running=await startServer({dbPath:c.path,port:0,aiFactory:()=>({settings:c.settingsStore,jobs:c.jobs,plans:c.plans})});
  return {c,running};
}
const generated=c=>{const input=normalizeAiInput(aiInput(),getCityByCode);return c.planStore.insertGenerated({content:planContent(input),sources:sources(),provider:'deepseek',model:'fixture-model'});};

test('all readonly AI endpoints expose saved state without invoking a provider or changing trip responses',async t=>{
  const c=await makeAiContext(t),job=c.jobStore.create(aiCommand(1,aiInput(),'read-job'),'read-hash',{settingsRevision:1,provider:'deepseek',model:'deepseek-flash',endpoint}),plan=generated(c),conversion=c.plans.convert(plan.id,{expectedRevision:1});
  const cipher=JSON.parse(c.database.db.prepare('SELECT payload FROM ai_settings WHERE id=1').get().payload).providers.deepseek.keyCipher;
  const running=await startServer({dbPath:c.path,port:0,aiFactory:()=>({settings:c.settingsStore,jobs:c.jobs,plans:c.plans})});
  try {
    for(const path of ['/api/ai/settings','/api/ai/jobs',`/api/ai/jobs/${job.id}`,'/api/ai/plans',`/api/ai/plans/${plan.id}`,`/api/ai/trips/${conversion.tripId}/guide`])assert.equal((await request(running.url,{path})).status,200,path);
    const settings=await request(running.url,{path:'/api/ai/settings'});for(const secret of ['apiKey','keyCipher','FAKE-MODEL-KEY','FAKE-SEARCH-KEY',cipher])assert.equal(settings.text.includes(secret),false,secret);
    const trip=await request(running.url,{path:`/api/trips/${conversion.tripId}`});assert.equal(trip.status,200);assert.equal(Object.hasOwn(trip.json.data,'guide'),false);assert.equal(Object.hasOwn(trip.json.data,'snapshot'),false);
    assert.deepEqual(c.networkCalls,{search:0,model:0});
  }finally{await running.close();}
});

test('settings jobs plans editing conversion and guide snapshot are wired through HTTP',async t=>{
  const {c,running}=await launch(t);
  try {
    const settings=await request(running.url,{method:'PUT',path:'/api/ai/settings',body:{expectedRevision:1,providers:{deepseek:{model:'deepseek-flash-v2',endpoint,keyAction:'replace',apiKey:'NEW-FAKE-KEY'}},search:{keyMode:'separate',keyAction:'retain'}}});
    assert.equal(settings.status,200);assert.equal(settings.json.data.revision,2);assert.equal(settings.text.includes('NEW-FAKE-KEY'),false);
    const accepted=await request(running.url,{method:'POST',path:'/api/ai/jobs',body:aiCommand(2,aiInput(),'http-job')});assert.equal(accepted.status,202);assert.equal(accepted.json.data.state,'queued');
    await c.jobs.settled();const job=(await request(running.url,{path:`/api/ai/jobs/${accepted.json.data.id}`})).json.data;assert.equal(job.state,'succeeded');assert.equal((await request(running.url,{path:'/api/ai/jobs'})).json.data.length,1);
    const plan=(await request(running.url,{path:`/api/ai/plans/${job.planId}`})).json.data;assert.equal((await request(running.url,{path:'/api/ai/plans'})).json.data.length,1);
    const content=structuredClone(plan.content);content.cautions=['人工复核'];const edited=await request(running.url,{method:'PUT',path:`/api/ai/plans/${plan.id}`,body:{expectedRevision:1,content}});assert.equal(edited.status,200);assert.equal(edited.json.data.revision,2);
    const converted=await request(running.url,{method:'POST',path:`/api/ai/plans/${plan.id}/convert`,body:{expectedRevision:2}});assert.equal(converted.status,200);assert.equal(converted.json.data.status,'created');
    const guide=await request(running.url,{path:`/api/ai/trips/${converted.json.data.tripId}/guide`});assert.equal(guide.status,200);assert.deepEqual(guide.json.data.snapshot.cautions,['人工复核']);assert.deepEqual(c.networkCalls,{search:2,model:1});
  }finally{await running.close();}
});

test('lost job response and settings change still return the original receipt without another paid call',async t=>{
  const {c,running}=await launch(t);const command=aiCommand(1,aiInput(),'lost-http-job');
  try {
    await submitAndDropResponse(running.url,'/api/ai/jobs',command);await c.jobs.settled();const first=c.jobs.list()[0],calls={...c.networkCalls};assert.ok(first);
    assert.equal((await request(running.url,{method:'PUT',path:'/api/ai/settings',body:{expectedRevision:1,providers:{deepseek:{model:'changed-model',endpoint,keyAction:'replace',apiKey:'REPLACED'}},search:{keyMode:'separate',keyAction:'retain'}}})).status,200);
    const repeated=await request(running.url,{method:'POST',path:'/api/ai/jobs',body:command});assert.equal(repeated.status,202);assert.equal(repeated.json.data.id,first.id);assert.deepEqual(c.networkCalls,calls);
  }finally{await running.close();}
});

test('AI API maps validation conflicts missing records and unavailable providers to safe status codes',async t=>{
  const {c,running}=await launch(t);
  try {
    const invalid=await request(running.url,{method:'POST',path:'/api/ai/jobs',body:{}});assert.equal(invalid.status,422);assert.ok(invalid.json.error.fields);
    const command=aiCommand(1,aiInput({cityCount:1}),'conflict-http');assert.equal((await request(running.url,{method:'POST',path:'/api/ai/jobs',body:command})).status,202);await c.jobs.settled();
    assert.equal((await request(running.url,{method:'POST',path:'/api/ai/jobs',body:aiCommand(1,aiInput({cityCount:2}),'conflict-http')})).status,409);
    for(const path of ['/api/ai/jobs/missing','/api/ai/plans/missing','/api/ai/trips/missing/guide','/api/ai/unknown'])assert.equal((await request(running.url,{path})).status,404,path);
    const unavailable=await request(running.url,{method:'POST',path:'/api/ai/jobs',body:{...aiCommand(1,aiInput(),'no-key'),provider:'qwen'}});assert.equal(unavailable.status,503);assert.equal(unavailable.text.includes('FAKE'),false);assert.equal(unavailable.text.includes('undefined'),false);
  }finally{await running.close();}
});

test('raw provider failures are stored and returned only as controlled local errors',async t=>{
  const {c,running}=await launch(t,{modelImpl:async()=>{throw new Error('RAW_PROVIDER_SECRET_AND_STACK');}});
  try {
    const accepted=await request(running.url,{method:'POST',path:'/api/ai/jobs',body:aiCommand(1,aiInput({cityCount:1}),'raw-failure')});await c.jobs.settled();
    const saved=await request(running.url,{path:`/api/ai/jobs/${accepted.json.data.id}`});assert.equal(saved.status,200);assert.equal(saved.json.data.state,'failed');assert.equal(saved.text.includes('RAW_PROVIDER_SECRET_AND_STACK'),false);assert.equal(saved.text.includes('stack'),false);
  }finally{await running.close();}
});

test('an active generation never blocks ordinary overview or trip reads',async t=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const {c,running}=await launch(t,{searchImpl:async()=>{entered();await gate;return [{sourceId:'s1',title:'资料',url:'https://example.com/1',summary:'摘要',publishedAt:null,retrievedAt:'2026-10-05T04:00:00.000Z'}];}});
  try {
    assert.equal((await request(running.url,{method:'POST',path:'/api/ai/jobs',body:aiCommand(1,aiInput({cityCount:1}),'slow-job')})).status,202);await started;
    const quick=Promise.all([request(running.url,{path:'/api/overview'}),request(running.url,{path:'/api/trips'})]);let timer;const responses=await Promise.race([quick,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('ordinary reads blocked')),1000);})]).finally(()=>clearTimeout(timer));
    assert.deepEqual(responses.map(value=>value.status),[200,200]);release();await c.jobs.settled();
  }finally{release?.();await running.close();}
});

test('AI writes retain host origin JSON size and traversal protections',async t=>{
  const {running}=await launch(t);
  try {
    for(const [headers,status] of [[{Origin:'http://evil.test'},403],[{Host:'evil.test'},403],[{'Content-Type':'text/plain'},415]])assert.equal((await request(running.url,{method:'PUT',path:'/api/ai/settings',body:{x:1},headers})).status,status);
    assert.equal((await request(running.url,{method:'POST',path:'/api/ai/jobs',body:'{"data":"'+ 'x'.repeat(65537)+'"}'})).status,413);
    for(const path of ['/src/platform/dpapi.ps1','/runtime/travel.sqlite','/runtime/backups/pre-ai.sqlite','/web/%2e%2e/src/start.mjs','/.env'])assert.equal((await request(running.url,{path})).status,404,path);
  }finally{await running.close();}
});

test('known AI dependency errors never expose their supplied message or cause',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-ai-http-error-')),path=join(dir,'travel.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const unavailable=()=>{const error=new AiError('AI_NETWORK','RAW_EXTERNAL_MESSAGE');error.cause=new Error('RAW_CAUSE');throw error;};
  const jobs={recover(){},async shutdown(){},list(){return [];},get(){return null;},submit:unavailable};
  const running=await startServer({dbPath:path,port:0,aiFactory:()=>({settings:{getPublic:unavailable,update:unavailable},jobs,plans:{list(){return [];},get(){return null;},update:unavailable,convert:unavailable,forTrip(){return null;}}})});
  try {const response=await request(running.url,{path:'/api/ai/settings'});assert.equal(response.status,503);assert.equal(response.text.includes('RAW_EXTERNAL_MESSAGE'),false);assert.equal(response.text.includes('RAW_CAUSE'),false);}
  finally{await running.close();}
});

test('server shutdown waits for AI jobs before closing the database and releasing ownership',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-ai-close-')),path=join(dir,'travel.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));const events=[];let captured;
  const ownership={lost:new Promise(()=>{}),async release(){assert.throws(()=>captured.db.prepare('SELECT 1').get());events.push('release-after-db');}};
  const running=await startServer({dbPath:path,port:0,lockFactory:async()=>ownership,aiFactory:({database})=>{captured=database;return {settings:{getPublic(){return {};},update(){}},jobs:{recover(){},list(){return [];},get(){return null;},async submit(){},async shutdown(){database.db.prepare('SELECT 1').get();events.push('jobs-before-db');}},plans:{list(){return [];},get(){return null;},update(){},convert(){},forTrip(){return null;}}};}});
  await running.close();assert.deepEqual(events,['jobs-before-db','release-after-db']);
});

test('default production wiring serves empty safe settings without performing external work',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-ai-default-')),path=join(dir,'travel.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));const running=await startServer({dbPath:path,port:0});
  try {const response=await request(running.url,{path:'/api/ai/settings'});assert.equal(response.status,200);assert.equal(response.text.includes('keyCipher'),false);assert.equal(response.text.includes('apiKey'),false);}
  finally{await running.close();}
});
