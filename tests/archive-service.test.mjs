import test from 'node:test';
import assert from 'node:assert/strict';
import {createArchiveService} from '../src/services/archive-service.mjs';
import {createTripStore} from '../src/storage/trip-store.mjs';
import {createExpenseService} from '../src/services/expense-service.mjs';
import {createFootprintStore} from '../src/storage/footprint-store.mjs';
import {createAiPlanStore} from '../src/storage/ai-plan-store.mjs';
import {createAiConversionStore} from '../src/storage/ai-conversion-store.mjs';
import {databaseFingerprint} from '../src/storage/migration-backup.mjs';
import {setupArchive} from './helpers/database.mjs';

const service=state=>createArchiveService({database:state.database,today:()=> '2026-10-26',now:()=> '2026-10-26T12:00:00.000Z'});

test('archive service rejects missing and non-completed trips and total includes completed only',t=>{
  const state=setupArchive(t),archives=service(state);
  assert.throws(()=>archives.getTripArchive('missing'),error=>error.code==='NOT_FOUND');
  assert.throws(()=>archives.getTripArchive('trip-today'),error=>error.code==='ARCHIVE_NOT_COMPLETED');
  assert.throws(()=>archives.getTripArchive('trip-future'),error=>error.code==='ARCHIVE_NOT_COMPLETED');
  const total=archives.getTravelArchive();assert.deepEqual(total.trips.map(item=>item.trip.name),['已结束行程']);assert.equal(total.summary.tripCount,1);
});

test('archive service retains current conversion and original guide versions',t=>{
  const report=service(setupArchive(t)).getTripArchive('trip-completed');
  assert.equal(report.guide.current.cautions[0],'当前攻略');assert.equal(report.guide.conversionSnapshot.cautions[0],'转换时快照');assert.equal(report.guide.original.cautions[0],'门票及营业时间请核对官方最新公告。');
  assert.equal(report.expenses.totalCents,8880);assert.equal(report.footprints[0].cityName,'南京市');
  const text=JSON.stringify(report);for(const forbidden of ['trip-completed','expense-archive','visit-archive','plan-archive','revision','operationId','keyCipher','databasePath'])assert.equal(text.includes(forbidden),false,forbidden);
});

test('archive reads use one transaction and never change the database',t=>{
  const state=setupArchive(t),before=databaseFingerprint(state.database.db),countsBefore=state.database.db.prepare("SELECT name,(SELECT count(*) FROM trips) AS trips,(SELECT count(*) FROM expenses) AS expenses,(SELECT count(*) FROM footprint_visits) AS visits FROM sqlite_master LIMIT 1").get();
  let active=false,transactions=0,reads=0;const original=state.database.transaction.bind(state.database);state.database.transaction=fn=>{transactions++;assert.equal(active,false);active=true;try{return original(fn);}finally{active=false;}};
  const wrap=(target,names)=>Object.fromEntries(names.map(name=>[name,(...args)=>{assert.equal(active,true,`${name} outside transaction`);reads++;return target[name](...args);}]));
  const storeFactory=database=>{const trips=createTripStore(database),expenses=createExpenseService({database}),footprints=createFootprintStore(database),plans=createAiPlanStore(database),conversions=createAiConversionStore(database);return {
    trips:{...wrap(trips,['get','list'])},expenses:{...wrap(expenses,['getOverview'])},footprints:{...wrap(footprints,['list','listByTrip'])},plans:{...wrap(plans,['get'])},conversions:{...wrap(conversions,['getByTrip'])},
  };};
  const archives=createArchiveService({database:state.database,today:()=> '2026-10-26',now:()=> '2026-10-26T12:00:00.000Z',storeFactory});archives.getTripArchive('trip-completed');archives.getTravelArchive();
  assert.equal(transactions,2);assert.ok(reads>=8);assert.equal(databaseFingerprint(state.database.db),before);assert.deepEqual(state.database.db.prepare("SELECT name,(SELECT count(*) FROM trips) AS trips,(SELECT count(*) FROM expenses) AS expenses,(SELECT count(*) FROM footprint_visits) AS visits FROM sqlite_master LIMIT 1").get(),countsBefore);
});
