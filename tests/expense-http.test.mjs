import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHttpApp} from '../src/server/http-app.mjs';
import {setup,prepare} from './helpers/database.mjs';
import {request} from './helpers/http-client.mjs';

async function app(t) {
  const state=setup(t),server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  server.on('request',createHttpApp({service:state.service,expenses:state.expenses,allowedHosts:[`127.0.0.1:${port}`,`localhost:${port}`]}));
  t.after(()=>new Promise(resolve=>server.close(resolve)));state.service.saveTrip('trip-1',prepare(state.service));state.service.saveTrip('trip-2',prepare(state.service,'trip-2'));
  return {...state,url:`http://127.0.0.1:${port}`};
}
const command=(operationId='expense-op',overrides={})=>({operationId,expectedRevision:0,input:{amountYuan:'25.80',categoryId:'default:food',cityCode:'320100',spentDate:'2026-10-10',note:'午餐',...overrides}});

test('expense endpoints create list edit and delete one trip-scoped record',async t=>{
  const c=await app(t);
  const created=await request(c.url,{path:'/api/trips/trip-1/expenses/expense-1',method:'PUT',body:command()});assert.equal(created.status,200);assert.equal(created.json.data.amountCents,2580);
  assert.equal((await request(c.url,{path:'/api/trips/trip-1/expenses'})).json.data.expenses.length,1);
  assert.equal((await request(c.url,{path:'/api/trips/trip-2/expenses/expense-1'})).status,404);
  const edited=await request(c.url,{path:'/api/trips/trip-1/expenses/expense-1',method:'PUT',body:{...command('edit-op',{note:'晚餐'}),expectedRevision:1}});assert.equal(edited.json.data.revision,2);
  assert.equal((await request(c.url,{path:'/api/trips/trip-1/expenses/expense-1',method:'DELETE',body:{operationId:'delete-op',expectedRevision:2}})).status,200);
  assert.equal((await request(c.url,{path:'/api/trips/trip-1/expenses/expense-1'})).status,404);
});

test('category endpoints expose defaults and protect categories in use',async t=>{
  const c=await app(t),path='/api/trips/trip-1/expense-categories/custom:coffee';
  assert.equal((await request(c.url,{path:'/api/trips/trip-1/expense-categories'})).json.data.length,7);
  const category=await request(c.url,{path,method:'PUT',body:{operationId:'cat-op',expectedRevision:0,name:'咖啡'}});assert.equal(category.status,200);
  await request(c.url,{path:'/api/trips/trip-1/expenses/expense-1',method:'PUT',body:command('expense-cat',{categoryId:'custom:coffee'})});
  const used=await request(c.url,{path,method:'DELETE',body:{operationId:'cat-delete',expectedRevision:1}});assert.equal(used.status,409);assert.equal(used.json.error.code,'CATEGORY_IN_USE');
});

test('expense HTTP maps validation conflict missing and request guards safely',async t=>{
  const c=await app(t),path='/api/trips/trip-1/expenses/expense-1';
  assert.equal((await request(c.url,{path,method:'PUT',body:command('invalid',{amountYuan:'0'})})).status,422);
  await request(c.url,{path,method:'PUT',body:command()});
  assert.equal((await request(c.url,{path,method:'PUT',body:{...command('stale'),expectedRevision:0}})).status,409);
  assert.equal((await request(c.url,{path:'/api/trips/missing/expenses'})).status,404);
  assert.equal((await request(c.url,{path,method:'PUT',body:command('evil-origin'),headers:{Origin:'http://evil.test'}})).status,403);
  assert.equal((await request(c.url,{path,method:'PUT',body:command('wrong-type'),headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await request(c.url,{path,method:'PUT',body:'x'.repeat(65537)})).status,413);
  assert.equal((await request(c.url,{path:'/api/trips/trip-1/expenses/%252e%252e'})).status,404);
});

test('repeated HTTP commands return bounded receipts without leaking submitted notes',async t=>{
  const c=await app(t),path='/api/trips/trip-1/expenses/expense-1',body=command('repeat-op',{note:'PRIVATE_NOTE'});
  const first=await request(c.url,{path,method:'PUT',body}),second=await request(c.url,{path,method:'PUT',body});assert.deepEqual(second.json,first.json);
  const mismatch=await request(c.url,{path,method:'PUT',body:{...body,input:{...body.input,note:'ANOTHER_PRIVATE_NOTE'}}});
  assert.equal(mismatch.status,409);assert.equal(mismatch.text.includes('PRIVATE_NOTE'),false);assert.equal(mismatch.text.includes('ANOTHER_PRIVATE_NOTE'),false);assert.equal(mismatch.text.includes('SELECT'),false);
});
