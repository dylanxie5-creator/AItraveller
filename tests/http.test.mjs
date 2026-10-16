import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHttpApp} from '../src/server/http-app.mjs';
import {setup,prepare} from './helpers/database.mjs';
import {request} from './helpers/http-client.mjs';
async function app(t,options={}) {
  const state=setup(t); const server=createServer();
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  server.on('request',createHttpApp({service:state.service,expenses:state.expenses,allowedHosts:[`127.0.0.1:${port}`,`localhost:${port}`],...options}));
  t.after(()=>new Promise(r=>server.close(r)));return {...state,url:`http://127.0.0.1:${port}`};
}
test('real HTTP exposes overview cities and transactional CRUD',async t=>{
  const {service,url}=await app(t);
  assert.equal((await request(url,{path:'/api/overview'})).json.data.counts.total,0);
  assert.equal((await request(url,{path:'/api/cities?q=%E5%8D%97%E4%BA%AC'})).json.data[0].cityCode,'320100');
  const command=prepare(service);
  const saved=await request(url,{path:'/api/trips/trip-1',method:'PUT',body:command});assert.equal(saved.status,200);assert.equal(saved.json.data.revision,1);
  assert.equal((await request(url,{path:'/api/trips/trip-1'})).json.data.cities.length,2);
  assert.equal((await request(url,{path:'/api/trips/trip-1',method:'DELETE',body:{expectedTripRevision:0}})).status,409);
  assert.equal((await request(url,{path:'/api/trips/trip-1',method:'DELETE',body:{expectedTripRevision:1}})).status,200);
  assert.equal((await request(url,{path:'/api/trips/trip-1'})).status,404);
});
test('write origin host and content type guards never mutate data',async t=>{
  const {service,url}=await app(t);const command=prepare(service);
  for(const [headers,want] of [[{Origin:'http://evil.test'},403],[{Origin:''},403],[{Host:'evil.test'},403],[{'Content-Type':'text/plain'},415]]) assert.equal((await request(url,{path:'/api/trips/trip-1',method:'PUT',body:command,headers})).status,want);
  assert.equal(service.listTrips().length,0);
});
test('oversized malformed and invalid bodies return safe errors',async t=>{
  const {url,service}=await app(t);
  assert.equal((await request(url,{path:'/api/trips/trip-1',method:'PUT',body:'x'.repeat(65537)})).status,413);
  assert.equal((await request(url,{path:'/api/trips/trip-1',method:'PUT',body:'{'})).status,422);
  const command=prepare(service);command.input.budgetYuan='0';assert.equal((await request(url,{path:'/api/trips/trip-1',method:'PUT',body:command})).status,422);
  assert.equal(service.listTrips().length,0);
});
test('static allowlist blocks encoded traversal and private files',async t=>{
  const {url}=await app(t);
  for(const path of ['/runtime/travel.sqlite','/.git/config','/../runtime/travel.sqlite','/web/%2e%2e/runtime/travel.sqlite','/web/%252e%252e%252fapp.mjs','/web/..%5capp.mjs']) assert.equal((await request(url,{path})).status,404);
  const result=await request(url,{path:'/shared/date.mjs'});assert.equal(result.status,200);assert.match(result.headers['content-type'],/javascript/);assert.equal(result.headers['x-content-type-options'],'nosniff');assert.ok(result.headers['content-security-policy'].includes("frame-ancestors 'none'"));assert.equal(result.headers['access-control-allow-origin'],undefined);
});
test('static allowlist rejects symlink leaving the public root',async t=>{
  const state=setup(t);const webRoot=join(state.dir,'web');mkdirSync(webRoot);
  try{symlinkSync(state.path,join(webRoot,'app.mjs'));}catch(error){if(error.code==='EPERM'){t.skip('Windows account cannot create file symlinks; realpath boundary still enforced, file-symlink scenario pending');return;}throw error;}
  const {url}=await app(t,{webRoot});assert.equal((await request(url,{path:'/web/app.mjs'})).status,404);
});
test('storage failure response contains no database diagnostics',async t=>{
  const {database,url}=await app(t);database.db.exec("UPDATE trips SET payload='broken'");database.close();
  const result=await request(url,{path:'/api/trips'});assert.equal(result.status,503);assert.equal(result.json.error.code,'STORAGE_FAILED');assert.ok(!result.text.includes('SELECT'));
});
