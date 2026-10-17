import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setup} from './helpers/database.mjs';
import {createTripStore} from '../src/storage/trip-store.mjs';
import {createFootprintStore} from '../src/storage/footprint-store.mjs';
import {createFootprintLifecycle} from '../src/services/footprint-lifecycle.mjs';
import {createTravelService} from '../src/services/travel-service.mjs';

const NOW='2026-10-17T12:00:00.000Z';
const city=(cityCode,cityName,arrivalDate,departureDate,order)=>({cityCode,cityName,provinceCode:'320000',provinceName:'江苏省',arrivalDate,departureDate,order});
const content=(overrides={})=>({name:'边界旅行',startDate:'2026-10-14',endDate:'2026-10-18',travelerCount:1,budgetCents:null,cities:[city('320100','南京市','2026-10-14','2026-10-16',0),city('320500','苏州市','2026-10-16','2026-10-17',1),city('320200','无锡市','2026-10-17','2026-10-18',2)],...overrides});
function context(t) {const fixture=setup(t),trips=createTripStore(fixture.database),footprints=createFootprintStore(fixture.database);trips.put('trip-1',content(),{expectedRevision:0,now:NOW});return {...fixture,trips,footprints,lifecycle:createFootprintLifecycle({database:fixture.database,today:()=> '2026-10-17',now:()=>NOW})};}

test('sync includes only cities whose departure is before server today and is repeatable',t=>{
  const c=context(t),first=c.lifecycle.syncTrip('trip-1');
  assert.deepEqual(first.map(item=>item.cityCode),['320100']);
  const expectedId='auto-'+createHash('sha256').update('trip-1\n320100').digest('hex').slice(0,32);
  assert.equal(first[0].id,expectedId);assert.equal(first[0].dateStart,'2026-10-14');assert.equal(first[0].dateEnd,'2026-10-16');
  const revision=first[0].revision;assert.equal(c.lifecycle.syncTrip('trip-1')[0].revision,revision);assert.equal(c.footprints.list().length,1);
});

test('rename and date changes update snapshots while preserving notes',t=>{
  const c=context(t);const first=c.lifecycle.syncTrip('trip-1')[0];c.footprints.put(first.id,{...first,note:'私藏小店'},{expectedRevision:first.revision,now:'2026-10-17T13:00:00.000Z'});
  const trip=c.trips.get('trip-1'),changed=content({name:'新版旅行',startDate:'2026-10-13',cities:[city('320100','南京市','2026-10-13','2026-10-15',0)]});c.trips.put('trip-1',changed,{expectedRevision:trip.revision,now:'2026-10-17T14:00:00.000Z'});
  const updated=c.lifecycle.syncTrip('trip-1')[0];assert.equal(updated.tripNameSnapshot,'新版旅行');assert.equal(updated.dateStart,'2026-10-13');assert.equal(updated.dateEnd,'2026-10-15');assert.equal(updated.note,'私藏小店');
});

test('removed or future-rolled-back cities disappear while suppressions prevent recreation until restored',t=>{
  const c=context(t);c.lifecycle.syncTrip('trip-1');
  const trip=c.trips.get('trip-1');c.trips.put('trip-1',content({cities:[city('320100','南京市','2026-10-17','2026-10-18',0)]}),{expectedRevision:trip.revision,now:NOW});assert.deepEqual(c.lifecycle.syncTrip('trip-1'),[]);
  const current=c.trips.get('trip-1');c.trips.put('trip-1',content({cities:[city('320100','南京市','2026-10-14','2026-10-16',0)]}),{expectedRevision:current.revision,now:NOW});
  c.footprints.putSuppression({tripId:'trip-1',cityCode:'320100',operationId:'suppress-1',now:NOW});assert.deepEqual(c.lifecycle.syncTrip('trip-1'),[]);
  c.footprints.removeSuppression('trip-1','320100');assert.equal(c.lifecycle.syncTrip('trip-1').length,1);
});

test('the same city in separate trips creates separate visit records',t=>{
  const c=context(t);c.trips.put('trip-2',content({name:'再次出发',startDate:'2025-01-01',endDate:'2025-01-02',cities:[city('320100','南京市','2025-01-01','2025-01-02',0)]}),{expectedRevision:0,now:NOW});
  c.lifecycle.syncAll();const visits=c.footprints.list();assert.equal(visits.length,2);assert.equal(new Set(visits.map(item=>item.linkedTripId)).size,2);
});

test('delete materializes and detaches eligible visits even before footprint sync was called',t=>{
  const fixture=setup(t),trips=createTripStore(fixture.database);trips.put('legacy-trip',content({cities:[city('320100','南京市','2026-10-14','2026-10-16',0)]}),{expectedRevision:0,now:NOW});
  const service=createTravelService({database:fixture.database,today:()=> '2026-10-17',now:()=>NOW});service.deleteTrip('legacy-trip',1);
  assert.throws(()=>service.getTrip('legacy-trip'),error=>error.code==='NOT_FOUND');const visit=createFootprintStore(fixture.database).list()[0];assert.equal(visit.source,'detached');assert.equal(visit.linkedTripId,null);assert.equal(visit.tripNameSnapshot,'边界旅行');
});

test('trip delete failure rolls back sync detachment expenses conversions and drafts together',t=>{
  const fixture=setup(t),trips=createTripStore(fixture.database);trips.put('trip-1',content({cities:[city('320100','南京市','2026-10-14','2026-10-16',0)]}),{expectedRevision:0,now:NOW});
  fixture.database.db.exec(`INSERT INTO expenses VALUES('expense-1','trip-1',1,100,'default:food','320100','南京市','2026-10-15','','${NOW}','${NOW}'); INSERT INTO ai_conversions VALUES('plan-1','trip-1','created','{"planId":"plan-1","planRevision":1,"tripId":"trip-1","status":"created","snapshot":{}}')`);
  fixture.database.db.exec("CREATE TRIGGER fail_trip_delete BEFORE DELETE ON trips BEGIN SELECT RAISE(ABORT,'fixture'); END");
  const service=createTravelService({database:fixture.database,today:()=> '2026-10-17',now:()=>NOW});
  assert.throws(()=>service.deleteTrip('trip-1',1));
  assert.equal(service.getTrip('trip-1').id,'trip-1');assert.equal(createFootprintStore(fixture.database).list().length,0);assert.equal(fixture.database.db.prepare('SELECT count(*) n FROM expenses').get().n,1);assert.equal(fixture.database.db.prepare("SELECT status FROM ai_conversions WHERE trip_id='trip-1'").get().status,'created');
});
