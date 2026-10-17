import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHttpApp} from '../src/server/http-app.mjs';
import {createFootprintService} from '../src/services/footprint-service.mjs';
import {setup,prepare} from './helpers/database.mjs';
import {request} from './helpers/http-client.mjs';

async function app(t) {const state=setup(t),footprints=createFootprintService({database:state.database,today:()=> '2026-10-20',now:()=> '2026-10-20T12:00:00.000Z'}),server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;server.on('request',createHttpApp({service:state.service,expenses:state.expenses,footprints,allowedHosts:[`127.0.0.1:${port}`,`localhost:${port}`]}));t.after(()=>new Promise(resolve=>server.close(resolve)));state.service.saveTrip('trip-1',prepare(state.service));return {...state,footprints,url:`http://127.0.0.1:${port}`};}
const saveBody={operationId:'visit-op',expectedRevision:0,input:{cityCode:'320100',datePrecision:'year',dateStart:'2025',note:'PRIVATE_NOTE'}};

test('footprint HTTP exposes sync overview province city manage and visit paths',async t=>{
  const c=await app(t);assert.equal((await request(c.url,{path:'/api/footprints/sync',method:'POST',body:{}})).status,200);
  const overview=await request(c.url,{path:'/api/footprints'});assert.equal(overview.status,200);assert.ok(overview.json.data.summary.visitCount>=2);
  assert.equal((await request(c.url,{path:'/api/footprints/provinces/320000'})).status,200);assert.equal((await request(c.url,{path:'/api/footprints/cities/320100'})).status,200);assert.equal((await request(c.url,{path:'/api/footprints/manage'})).status,200);
  const created=await request(c.url,{path:'/api/footprints/visits/manual-1',method:'PUT',body:saveBody});assert.equal(created.status,200);assert.equal((await request(c.url,{path:'/api/footprints/visits/manual-1'})).json.data.id,'manual-1');
  assert.equal((await request(c.url,{path:'/api/footprints/visits/manual-1',method:'DELETE',body:{operationId:'delete-op',expectedRevision:1}})).status,200);
});

test('suppression endpoints encode ownership and restore the eligible visit',async t=>{
  const c=await app(t);await request(c.url,{path:'/api/footprints/sync',method:'POST',body:{}});
  const suppress=await request(c.url,{path:'/api/footprints/suppressions/trip-1/320100',method:'PUT',body:{operationId:'suppress-op'}});assert.equal(suppress.status,200);assert.equal(suppress.json.data.suppressed,true);
  const restore=await request(c.url,{path:'/api/footprints/suppressions/trip-1/320100',method:'DELETE',body:{operationId:'restore-op'}});assert.equal(restore.status,200);assert.ok(restore.json.data.visit);
  assert.equal((await request(c.url,{path:'/api/footprints/suppressions/trip%252fescape/320100',method:'PUT',body:{operationId:'bad'}})).status,404);
});

test('footprint routes map validation conflict missing and request guards without leaking data',async t=>{
  const c=await app(t),path='/api/footprints/visits/manual-1';
  const invalid=await request(c.url,{path,method:'PUT',body:{...saveBody,input:{...saveBody.input,dateStart:'2027'}}});assert.equal(invalid.status,422);
  await request(c.url,{path,method:'PUT',body:saveBody});const conflict=await request(c.url,{path,method:'PUT',body:{...saveBody,input:{...saveBody.input,note:'ANOTHER_PRIVATE_NOTE'}}});assert.equal(conflict.status,409);
  assert.equal(conflict.text.includes('PRIVATE_NOTE'),false);assert.equal(conflict.text.includes('ANOTHER_PRIVATE_NOTE'),false);assert.equal(conflict.text.includes('SELECT'),false);assert.equal(conflict.text.includes('amount_cents'),false);
  assert.equal((await request(c.url,{path:'/api/footprints/visits/missing'})).status,404);
  assert.equal((await request(c.url,{path,method:'PUT',body:saveBody,headers:{Origin:'http://evil.test'}})).status,403);
  assert.equal((await request(c.url,{path,method:'PUT',body:saveBody,headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await request(c.url,{path,method:'PUT',body:'x'.repeat(65537)})).status,413);
});

test('global overview includes real footprint counts',async t=>{
  const c=await app(t);await request(c.url,{path:'/api/footprints/sync',method:'POST',body:{}});const overview=await request(c.url,{path:'/api/overview'});assert.deepEqual(overview.json.data.footprints,{provinceCount:1,cityCount:2,visitCount:2});
});
