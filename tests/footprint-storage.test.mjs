import test from 'node:test';
import assert from 'node:assert/strict';
import {createFootprintStore} from '../src/storage/footprint-store.mjs';
import {createFootprintOperationStore} from '../src/storage/footprint-operation-store.mjs';
import {setup,prepare} from './helpers/database.mjs';

const NOW='2026-10-17T12:00:00.000Z',LATER='2026-10-18T12:00:00.000Z';
const manual=(overrides={})=>({cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'year',dateStart:'2025',dateEnd:null,source:'manual',linkedTripId:null,tripNameSnapshot:null,note:'春游',...overrides});
const linked=(overrides={})=>manual({cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'trip_range',dateStart:'2026-09-01',dateEnd:'2026-09-02',source:'trip',linkedTripId:'trip-1',tripNameSnapshot:'江南旅行',note:'',...overrides});

test('manual partial dates round trip and every read is defensive and stably ordered',t=>{
  const {database}=setup(t),store=createFootprintStore(database);
  const year=store.put('visit-year',manual(),{expectedRevision:0,now:NOW});
  store.put('visit-month',manual({datePrecision:'month',dateStart:'2025-08'}),{expectedRevision:0,now:LATER});
  year.note='被篡改';assert.equal(store.get('visit-year').note,'春游');
  const listed=store.list();listed[0].note='污染';assert.equal(store.list()[0].note,'春游');
  assert.deepEqual(store.list().map(item=>item.id),['visit-month','visit-year']);
});

test('put enforces revisions linked identity uniqueness and cross-entity id ownership',t=>{
  const {database,service}=setup(t);service.saveTrip('trip-1',prepare(service));
  const store=createFootprintStore(database),saved=store.put('auto-1',linked(),{expectedRevision:0,now:NOW});assert.equal(saved.revision,1);
  assert.throws(()=>store.put('auto-2',linked(),{expectedRevision:0,now:NOW}),error=>error.code==='CONFLICT');
  assert.throws(()=>store.put('auto-1',linked({linkedTripId:'trip-2'}),{expectedRevision:1,now:LATER}),error=>error.code==='CONFLICT');
  assert.throws(()=>store.put('auto-1',linked({note:'旧版本'}),{expectedRevision:0,now:LATER}),error=>error.code==='CONFLICT');
  const edited=store.put('auto-1',linked({note:'再访'}),{expectedRevision:1,now:LATER});assert.equal(edited.revision,2);assert.equal(edited.createdAt,NOW);
});

test('remove uses optimistic revision and missing records have stable errors',t=>{
  const {database}=setup(t),store=createFootprintStore(database);store.put('visit-1',manual(),{expectedRevision:0,now:NOW});
  assert.throws(()=>store.remove('visit-1',2),error=>error.code==='CONFLICT');assert.equal(store.remove('visit-1',1),true);
  assert.throws(()=>store.remove('visit-1',1),error=>error.code==='NOT_FOUND');
});

test('suppressions are unique defensive and cascade with their trip',t=>{
  const {database,service}=setup(t);service.saveTrip('trip-1',prepare(service));const store=createFootprintStore(database);
  assert.deepEqual(store.putSuppression({tripId:'trip-1',cityCode:'320100',operationId:'op-1',now:NOW}),{tripId:'trip-1',cityCode:'320100',operationId:'op-1',createdAt:NOW});
  assert.throws(()=>store.putSuppression({tripId:'trip-1',cityCode:'320100',operationId:'op-2',now:LATER}),error=>error.code==='CONFLICT');
  const values=store.listSuppressions();values[0].cityCode='000000';assert.equal(store.getSuppression('trip-1','320100').cityCode,'320100');
  database.db.prepare("DELETE FROM trips WHERE id='trip-1'").run();assert.deepEqual(store.listSuppressions(),[]);
});

test('detachment keeps snapshots and dates while clearing the trip foreign key',t=>{
  const {database,service}=setup(t);service.saveTrip('trip-1',prepare(service));const store=createFootprintStore(database);
  store.put('auto-1',linked(),{expectedRevision:0,now:NOW});
  const detached=store.detachTrip('trip-1',{now:LATER});assert.equal(detached.length,1);
  assert.deepEqual(detached[0],{...store.get('auto-1')});assert.equal(detached[0].source,'detached');assert.equal(detached[0].linkedTripId,null);assert.equal(detached[0].tripNameSnapshot,'江南旅行');assert.equal(detached[0].dateStart,'2026-09-01');assert.equal(detached[0].revision,2);
  database.db.prepare("DELETE FROM trips WHERE id='trip-1'").run();assert.equal(store.get('auto-1').source,'detached');
});

test('malformed persisted rows are rejected rather than repaired',t=>{
  const {database}=setup(t),store=createFootprintStore(database);
  database.db.prepare('INSERT INTO footprint_visits VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('bad',1,'320100','南京市','320000','江苏省','month','2026-99',null,'manual',null,null,'',NOW,NOW);
  assert.throws(()=>store.get('bad'),error=>error.code==='STORAGE_CORRUPT');
  database.db.prepare('INSERT INTO footprint_operation_receipts VALUES(?,?,?,?,?)').run('bad-op','save','visit:bad','hash','not-json');
  assert.throws(()=>createFootprintOperationStore(database).find('bad-op'),error=>error.code==='STORAGE_CORRUPT');
});

test('operation receipts replay defensive responses and reject changed identities',t=>{
  const {database}=setup(t),store=createFootprintOperationStore(database);
  const first=store.insert({operationId:'op-1',action:'save',scopeKey:'visit:one',requestHash:'hash-1',response:{visit:{id:'visit-1',revision:1}}});
  first.response.visit.revision=99;assert.equal(store.find('op-1').response.visit.revision,1);
  assert.deepEqual(store.insert({operationId:'op-1',action:'save',scopeKey:'visit:one',requestHash:'hash-1',response:{ignored:true}}).response,{visit:{id:'visit-1',revision:1}});
  assert.throws(()=>store.insert({operationId:'op-1',action:'delete',scopeKey:'visit:one',requestHash:'hash-2',response:{ok:true}}),error=>error.code==='CONFLICT');
});
