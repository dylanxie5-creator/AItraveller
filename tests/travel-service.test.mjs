import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,prepare} from './helpers/database.mjs';
import {input} from './helpers/fixtures.mjs';
import {createTravelService} from '../src/services/travel-service.mjs';
test('lost save response retries once and never recreates deleted trip',t=>{
  const {service}=setup(t); const command=prepare(service);const first=service.saveTrip('trip-1',command);
  assert.deepEqual(service.saveTrip('trip-1',command),first);assert.equal(service.listTrips().length,1);
  assert.throws(()=>service.saveTrip('trip-1',{...command,input:{...command.input,name:'changed'}}),e=>e.code==='CONFLICT');
  service.deleteTrip('trip-1',1);assert.throws(()=>service.saveTrip('trip-1',command),e=>e.code==='CONFLICT');assert.equal(service.listTrips().length,0);
});
test('stale trip revision cannot overwrite or delete newer edit',t=>{
  const {service}=setup(t);service.saveTrip('trip-1',prepare(service));
  const command=prepare(service,'trip-1','edit:trip-1',1); command.input.name='新版';const updated=service.saveTrip('trip-1',command);
  assert.equal(updated.revision,2); assert.throws(()=>service.deleteTrip('trip-1',1),e=>e.code==='CONFLICT');
  const stale=prepare(service,'trip-1','edit:trip-1',1);
  assert.throws(()=>service.saveTrip('trip-1',stale),e=>e.code==='CONFLICT');assert.equal(service.getTrip('trip-1').name,'新版');
});
test('closed draft tombstone rejects late saves and protects new session',t=>{
  const {service}=setup(t);const command=prepare(service);service.saveTrip('trip-1',command);
  const closed=service.getDraft('new');assert.equal(closed.state,'closed');
  const late={expectedRevision:closed.revision,sessionId:command.draft.sessionId,targetTripId:'trip-1',baseTripRevision:0,step:'basic',input:{name:'late'}};
  assert.throws(()=>service.saveDraft('new',late),e=>e.code==='CONFLICT');
  const next=service.saveDraft('new',{...late,sessionId:'different-session',targetTripId:'trip-2'});
  assert.throws(()=>service.discardDraft('new',command.draft),e=>e.code==='CONFLICT');assert.equal(service.getDraft('new').sessionId,next.sessionId);
});
test('partial invalid draft can recover but malformed envelope is rejected',t=>{
  const {service}=setup(t); const slot=service.saveDraft('new',{expectedRevision:0,sessionId:'session-1',targetTripId:'trip-1',baseTripRevision:0,step:'basic',input:{name:'未完成',budgetYuan:'bad'}});
  assert.equal(service.getDraft('new').input.budgetYuan,'bad');
  assert.throws(()=>service.saveDraft('new',{...slot,expectedRevision:slot.revision,step:'unknown'}),e=>e.code==='VALIDATION');
  assert.equal(service.getDraft('new').revision,1);
});
test('editor keys and saved target identities cannot be redirected',t=>{
  const {service}=setup(t); const command=prepare(service);
  assert.throws(()=>service.saveTrip('different-id',command),e=>e.code==='CONFLICT');assert.equal(service.listTrips().length,0);
  assert.throws(()=>service.saveDraft('edit:missing',{expectedRevision:0,sessionId:'session',targetTripId:'missing',baseTripRevision:1,step:'basic',input:input()}),e=>e.code==='NOT_FOUND');
});
test('overview uses server day and prefers nearest upcoming trip',t=>{
  const {service}=setup(t);service.saveTrip('trip-1',prepare(service));
  assert.deepEqual(service.getOverview().counts,{total:1,upcoming:1,ongoing:0,completed:0});assert.equal(service.getOverview().recentTrip.id,'trip-1');assert.equal(service.getOverview().today,'2026-10-02');assert.deepEqual(service.getOverview().expenses,{hasExpenses:false,totalCents:0});
});
test('legacy city snapshots remain readable but unknown new codes are rejected',t=>{
  const {service,database}=setup(t);service.saveTrip('trip-1',prepare(service));
  const row=database.db.prepare('SELECT payload FROM trip_cities WHERE trip_id=? AND position=0').get('trip-1');
  const legacy={...JSON.parse(row.payload),cityCode:'999999',cityName:'历史城'};
  database.db.prepare('UPDATE trip_cities SET payload=? WHERE trip_id=? AND position=0').run(JSON.stringify(legacy),'trip-1');
  assert.equal(service.getTrip('trip-1').cities[0].cityName,'历史城');
  const command=prepare(service,'trip-2');command.input.cities[0].cityCode='999999';assert.throws(()=>service.saveTrip('trip-2',command),e=>e.code==='VALIDATION');
});

test('save and delete roll back when an injected footprint lifecycle fails',t=>{
  const fixture=setup(t);let phase='save';const lifecycle={syncTrip(){if(phase==='save')throw new Error('footprint-save');},detachTrip(){if(phase==='delete')throw new Error('footprint-detach');}};
  const service=createTravelService({database:fixture.database,today:()=> '2026-10-02',now:()=> '2026-10-02T12:00:00.000Z',footprintLifecycle:lifecycle});
  const command=prepare(service,'trip-rollback');assert.throws(()=>service.saveTrip('trip-rollback',command),/footprint-save/);assert.equal(service.listTrips().length,0);assert.equal(service.getDraft('new').state,'active');assert.equal(fixture.database.db.prepare('SELECT count(*) n FROM save_receipts').get().n,0);
  phase='ok';service.saveTrip('trip-rollback',command);phase='delete';assert.throws(()=>service.deleteTrip('trip-rollback',1),/footprint-detach/);assert.equal(service.getTrip('trip-rollback').revision,1);
});
