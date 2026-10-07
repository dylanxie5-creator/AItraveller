import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiPlanService} from '../src/services/ai-plan-service.mjs';
import {normalizeAiInput} from '../src/ai/validation.mjs';
import {getCityByCode} from '../src/domain/city-catalog.mjs';
import {makeAiContext} from './helpers/ai-context.mjs';
import {aiInput,planContent,sources} from './helpers/ai-fixtures.mjs';

const generated=c=>{const request=normalizeAiInput(aiInput(),getCityByCode);return c.planStore.insertGenerated({content:planContent(request),sources:sources(),provider:'deepseek',model:'fixture-model'});};
const copy=value=>structuredClone(value);

test('manual edit increments revision without external calls and preserves generated evidence',async t=>{
  const c=await makeAiContext(t),saved=generated(c),edited=copy(saved.content);edited.cautions=['人工确认营业时间'];
  const changed=c.plans.update(saved.id,{expectedRevision:1,content:edited});
  assert.equal(changed.revision,2);assert.deepEqual(changed.content.cautions,['人工确认营业时间']);assert.deepEqual(changed.original,saved.original);assert.deepEqual(changed.sources,saved.sources);
  assert.throws(()=>c.plans.update(saved.id,{expectedRevision:1,content:edited}),e=>e.code==='CONFLICT');assert.deepEqual(c.networkCalls,{search:0,model:0});
});

test('historical guide names remain readable while a new edit obeys the current city catalog',async t=>{
  const c=await makeAiContext(t),saved=generated(c),resolver=code=>code==='320100'?null:getCityByCode(code);
  const plans=createAiPlanService({database:c.database,planStore:c.planStore,conversionStore:c.conversionStore,tripStore:c.tripStore,resolveCity:resolver,now:()=>new Date(),createId:()=> 'unused'});
  assert.equal(plans.get(saved.id).content.trip.cities[0].cityName,'南京市');
  assert.throws(()=>plans.update(saved.id,{expectedRevision:1,content:copy(saved.content)}),e=>e.code==='VALIDATION');assert.equal(c.planStore.get(saved.id).revision,1);
});

test('first conversion creates one revision-one trip without touching drafts or existing trips',async t=>{
  const c=await makeAiContext(t),saved=generated(c);c.tripStore.put('existing-trip',saved.content.trip,{expectedRevision:0,now:'2026-10-05T04:00:00.000Z'});
  c.travel.saveDraft('new',{expectedRevision:0,sessionId:'draft-session',targetTripId:'draft-trip',baseTripRevision:0,step:'basic',input:{name:'尚未完成'}});const draft=copy(c.travel.getDraft('new'));
  const converted=c.plans.convert(saved.id,{expectedRevision:1}),trip=c.travel.getTrip(converted.tripId);
  assert.equal(converted.status,'created');assert.equal(converted.planRevision,1);assert.equal(trip.revision,1);assert.deepEqual(c.travel.getDraft('new'),draft);assert.equal(c.travel.getTrip('existing-trip').revision,1);assert.equal(c.travel.listTrips().length,2);
});

test('repeated conversion and a lost response return the original frozen receipt',async t=>{
  const c=await makeAiContext(t),saved=generated(c),first=c.plans.convert(saved.id,{expectedRevision:1}),second=c.plans.convert(saved.id,{expectedRevision:1});
  assert.deepEqual(second,first);assert.equal(c.travel.listTrips().length,1);assert.deepEqual(c.plans.forTrip(first.tripId),first);
});

test('editing after conversion changes only the guide, never the trip or conversion snapshot',async t=>{
  const c=await makeAiContext(t),saved=generated(c),conversion=c.plans.convert(saved.id,{expectedRevision:1}),edited=copy(saved.content);edited.trip.name='后来修改的攻略';
  c.plans.update(saved.id,{expectedRevision:1,content:edited});
  assert.equal(c.plans.get(saved.id).content.trip.name,'后来修改的攻略');assert.equal(c.travel.getTrip(conversion.tripId).name,'江南小旅行');assert.equal(c.plans.forTrip(conversion.tripId).snapshot.trip.name,'江南小旅行');
});

test('repeated conversion after deletion never resurrects a trip',async t=>{
  const c=await makeAiContext(t),saved=generated(c),conversion=c.plans.convert(saved.id,{expectedRevision:1});
  c.travel.deleteTrip(conversion.tripId,1);const repeated=c.plans.convert(saved.id,{expectedRevision:1});
  assert.equal(repeated.tripId,conversion.tripId);assert.equal(repeated.status,'deleted');assert.equal(c.travel.listTrips().length,0);assert.equal(c.plans.get(saved.id).id,saved.id);
});

test('conversion association failure rolls back the new trip and leaves the guide untouched',async t=>{
  const c=await makeAiContext(t),saved=generated(c);c.database.db.exec("CREATE TRIGGER reject_conversion BEFORE INSERT ON ai_conversions BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>c.plans.convert(saved.id,{expectedRevision:1}));assert.equal(c.travel.listTrips().length,0);assert.equal(c.plans.get(saved.id).revision,1);assert.equal(c.conversionStore.getByPlan(saved.id),null);
});

test('conversion deletion-mark failure rolls back trip deletion and created status',async t=>{
  const c=await makeAiContext(t),saved=generated(c),conversion=c.plans.convert(saved.id,{expectedRevision:1});
  c.database.db.exec("CREATE TRIGGER reject_conversion_delete BEFORE UPDATE OF status ON ai_conversions WHEN NEW.status='deleted' BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>c.travel.deleteTrip(conversion.tripId,1));assert.equal(c.travel.getTrip(conversion.tripId).revision,1);assert.equal(c.plans.forTrip(conversion.tripId).status,'created');
});

test('server-generated trip id collision fails without overwriting an existing trip',async t=>{
  const c=await makeAiContext(t),saved=generated(c);c.tripStore.put('occupied',saved.content.trip,{expectedRevision:0,now:'2026-10-05T04:00:00.000Z'});
  const plans=createAiPlanService({database:c.database,planStore:c.planStore,conversionStore:c.conversionStore,tripStore:c.tripStore,resolveCity:getCityByCode,now:()=>new Date(),createId:()=> 'occupied'});
  assert.throws(()=>plans.convert(saved.id,{expectedRevision:1}),e=>e.code==='CONFLICT');assert.equal(c.travel.getTrip('occupied').revision,1);assert.equal(c.conversionStore.getByPlan(saved.id),null);
});

test('production conversion generates its own random UUID when no test id factory is injected',async t=>{
  const c=await makeAiContext(t),saved=generated(c),plans=createAiPlanService({database:c.database,planStore:c.planStore,conversionStore:c.conversionStore,tripStore:c.tripStore,resolveCity:getCityByCode,now:()=>new Date()});
  const conversion=plans.convert(saved.id,{expectedRevision:1});assert.match(conversion.tripId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);assert.equal(c.travel.getTrip(conversion.tripId).revision,1);
});
