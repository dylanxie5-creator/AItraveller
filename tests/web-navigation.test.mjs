import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/web/app.mjs';
import {parseRoute,routeToHash} from '../src/web/router.mjs';
import {createApiClient} from '../src/web/api-client.mjs';
import {presentTrip} from '../src/domain/trip-presenter.mjs';
import {setup,prepare} from './helpers/database.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('navigation parses only known routes and safely decodes trip ids',()=>{
  assert.deepEqual(parseRoute('#/trips/trip-1/edit'),{type:'edit',id:'trip-1'});assert.deepEqual(parseRoute('#/new'),{type:'new'});assert.deepEqual(parseRoute('#/bad'),{type:'home'});
});
test('expense routes round trip only safe identities',()=>{
  const routes=[{type:'expenses',id:'trip-1'},{type:'expense-new',id:'trip-1'},{type:'expense-edit',id:'trip-1',expenseId:'expense-1'},{type:'expense-categories',id:'trip-1'}];
  for(const route of routes)assert.deepEqual(parseRoute(routeToHash(route)),route);
  assert.deepEqual(parseRoute('#/trips/bad%2Fid/expenses'),{type:'home'});
});
test('empty overview is real zero and load errors are not empty trips',async t=>{
  const {service}=setup(t),screens=[];
  const app=createApp({api:{overview:async()=>service.getOverview(),trips:async()=>{throw {code:'NETWORK',message:'加载失败'};}},render:s=>screens.push(s),navigate:()=>{},confirm:()=>false});
  await app.load({type:'home'});assert.equal(screens.at(-1).data.counts.total,0);
  await app.load({type:'trips'});assert.equal(screens.at(-1).type,'error');assert.equal(screens.at(-1).message,'加载失败');
});
test('late old route response never replaces current page',async t=>{
  const {service}=setup(t),old=deferred(),screens=[];
  let loads=0;
  const app=createApp({api:{overview:()=>loads++===0?old.promise:Promise.resolve(service.getOverview()),trips:async()=>[]},render:s=>screens.push(s),navigate:()=>{}});
  const first=app.load({type:'home'});await app.load({type:'trips'});old.resolve(service.getOverview());await first;
  assert.equal(screens.at(-1).type,'trips');
});
test('cancel delete keeps data and confirmed delete uses exact revision',async t=>{
  const {service}=setup(t);const trip=service.saveTrip('trip-1',prepare(service));const routes=[];
  const api={deleteTrip:async(id,revision)=>service.deleteTrip(id,revision)};
  const canceled=createApp({api,render:()=>{},navigate:r=>routes.push(r),confirm:()=>false});await canceled.deleteTrip(trip);assert.equal(service.listTrips().length,1);
  const yes=createApp({api,render:()=>{},navigate:r=>routes.push(r),confirm:()=>true});await yes.deleteTrip(trip);assert.equal(service.listTrips().length,0);assert.deepEqual(routes,[{type:'trips'}]);
});
test('deletion conflict preserves current trip with visible error',async()=>{
  const screens=[];const app=createApp({api:{deleteTrip:async()=>{throw {code:'CONFLICT',message:'请重新载入'};}},render:s=>screens.push(s),navigate:()=>assert.fail('must not navigate'),confirm:()=>true});
  await app.deleteTrip({id:'trip-1',name:'江南',revision:1});assert.equal(screens.at(-1).type,'delete-error');assert.equal(screens.at(-1).trip.id,'trip-1');
});
test('API client preserves error status and sends versioned delete JSON',async()=>{
  let command;
  const api=createApiClient({fetchImpl:async(url,options)=>{command={url,options};return {ok:false,status:409,json:async()=>({error:{code:'CONFLICT',message:'旧版本'}})};}});
  await assert.rejects(api.deleteTrip('trip-1',2),e=>e.status===409&&e.code==='CONFLICT');assert.deepEqual(JSON.parse(command.options.body),{expectedTripRevision:2});
});
test('presenter derives Chinese status and precise budget',t=>{
  const {service}=setup(t);const trip=service.saveTrip('trip-1',prepare(service));const view=presentTrip(trip,'2026-10-02');assert.equal(view.statusLabel,'待出发');assert.equal(view.budgetText,'¥3,200.50');assert.equal(view.routeText,'南京市 · 苏州市');
});
