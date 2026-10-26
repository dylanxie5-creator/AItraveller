import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHttpApp} from '../src/server/http-app.mjs';
import {createArchiveService} from '../src/services/archive-service.mjs';
import {setupArchive} from './helpers/database.mjs';
import {request} from './helpers/http-client.mjs';

async function app(t) {
  const state=setupArchive(t),archives=createArchiveService({database:state.database,today:()=> '2026-10-26',now:()=> '2026-10-26T12:00:00.000Z'}),server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const current={service:state.service,expenses:state.expenses,footprints:state.footprints,archives};let writes=0;const runtime={current:()=>current,coordinator:{runWrite(fn){writes++;return fn();}}};
  server.on('request',createHttpApp({runtime,...current,allowedHosts:[`127.0.0.1:${port}`,`localhost:${port}`]}));t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {url:`http://127.0.0.1:${port}`,writes};
}

test('archive GET endpoints return sanitized completed reports without write coordination',async t=>{
  const c=await app(t),total=await request(c.url,{path:'/api/archive'}),single=await request(c.url,{path:'/api/archive/trips/trip-completed'});
  assert.equal(total.status,200);assert.equal(single.status,200);assert.equal(total.json.data.summary.tripCount,1);assert.equal(single.json.data.trip.name,'已结束行程');
  assert.equal(total.headers['cache-control'],'no-store');assert.equal(total.headers['access-control-allow-origin'],undefined);assert.equal(c.writes,0);
  const text=single.text;for(const forbidden of ['trip-completed','expense-archive','visit-archive','plan-archive','apiKey','keyCipher','securityCipher','C:\\','SELECT '])assert.equal(text.includes(forbidden),false,forbidden);
});

test('archive HTTP rejects non-completed missing malformed methods and untrusted hosts safely',async t=>{
  const c=await app(t);
  const today=await request(c.url,{path:'/api/archive/trips/trip-today'});assert.equal(today.status,409);assert.deepEqual(today.json.error,{code:'ARCHIVE_NOT_COMPLETED',message:'行程结束后才能生成档案'});
  assert.equal((await request(c.url,{path:'/api/archive/trips/missing'})).status,404);
  for(const path of ['/api/archive/trips/a%2Fb','/api/archive/trips/%252e%252e','/api/archive/trips/too.long'])assert.equal((await request(c.url,{path})).status,404,path);
  assert.equal((await request(c.url,{path:'/api/archive',method:'POST',body:{}})).status,404);
  assert.equal((await request(c.url,{path:'/api/archive',headers:{Host:'evil.test'}})).status,403);
});
