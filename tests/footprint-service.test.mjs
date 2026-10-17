import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,prepare} from './helpers/database.mjs';
import {createFootprintService} from '../src/services/footprint-service.mjs';
import {createFootprintStore} from '../src/storage/footprint-store.mjs';
import {createTravelService} from '../src/services/travel-service.mjs';

const NOW='2026-10-20T12:00:00.000Z';
const command=(operationId='visit-op',expectedRevision=0,input={cityCode:'320100',datePrecision:'year',dateStart:'2025',note:'补录'})=>({operationId,expectedRevision,input});
function context(t) {const value=setup(t),service=createTravelService({database:value.database,today:()=> '2026-10-20',now:()=>NOW});return {...value,service,footprints:createFootprintService({database:value.database,today:()=> '2026-10-20',now:()=>NOW})};}

test('manual visits create edit delete and replay exact operation responses',t=>{
  const c=context(t),created=c.footprints.saveVisit('manual-1',command());assert.equal(created.source,'manual');assert.equal(created.cityName,'南京市');
  assert.deepEqual(c.footprints.saveVisit('manual-1',command()),created);
  assert.throws(()=>c.footprints.saveVisit('manual-1',command('visit-op',0,{...command().input,note:'changed'})),error=>error.code==='CONFLICT');
  const edited=c.footprints.saveVisit('manual-1',command('edit-op',1,{cityCode:'330100',datePrecision:'month',dateStart:'2024-08',note:'杭州'}));assert.equal(edited.revision,2);assert.equal(edited.cityName,'杭州市');
  const deletion={operationId:'delete-op',expectedRevision:2};assert.deepEqual(c.footprints.deleteVisit('manual-1',deletion),{deleted:true,id:'manual-1'});assert.deepEqual(c.footprints.deleteVisit('manual-1',deletion),{deleted:true,id:'manual-1'});
});

test('linked auto visits allow note edit only and require explicit suppression instead of ordinary delete',t=>{
  const c=context(t);c.service.saveTrip('trip-1',prepare(c.service));c.footprints.syncAll();const auto=c.footprints.getManagement().visits[0];
  const edited=c.footprints.saveVisit(auto.id,command('auto-note',auto.revision,{note:'值得再去'}));assert.equal(edited.note,'值得再去');assert.equal(edited.cityCode,auto.cityCode);
  assert.throws(()=>c.footprints.saveVisit(auto.id,command('auto-mutate',edited.revision,{cityCode:'330100',note:'改城'})),error=>error.code==='VALIDATION');
  assert.throws(()=>c.footprints.deleteVisit(auto.id,{operationId:'auto-delete',expectedRevision:edited.revision}),error=>error.code==='AUTO_VISIT_REQUIRES_SUPPRESSION');
  const suppressed=c.footprints.suppress('trip-1',auto.cityCode,{operationId:'suppress-op'});assert.equal(suppressed.suppressed,true);assert.equal(c.footprints.getManagement().visits.length,1);
  assert.deepEqual(c.footprints.suppress('trip-1',auto.cityCode,{operationId:'suppress-op'}),suppressed);
  const restored=c.footprints.restore('trip-1',auto.cityCode,{operationId:'restore-op'});assert.equal(restored.restored,true);assert.ok(restored.visit);
  assert.deepEqual(c.footprints.restore('trip-1',auto.cityCode,{operationId:'restore-op'}),restored);
});

test('detached visit note edits and deletion remain independent after trip deletion',t=>{
  const c=context(t),trip=c.service.saveTrip('trip-1',prepare(c.service));c.footprints.syncAll();c.service.deleteTrip('trip-1',trip.revision);const detached=c.footprints.getManagement().visits[0];assert.equal(detached.source,'detached');
  const edited=c.footprints.saveVisit(detached.id,command('detach-note',detached.revision,{note:'保留回忆'}));assert.equal(edited.note,'保留回忆');assert.equal(edited.source,'detached');
  assert.deepEqual(c.footprints.deleteVisit(detached.id,{operationId:'detach-delete',expectedRevision:edited.revision}),{deleted:true,id:detached.id});
});

test('overview province city and management projections keep repeat visits and exclude whole-trip expenses',t=>{
  const c=context(t);c.service.saveTrip('trip-1',prepare(c.service));c.service.saveTrip('trip-2',prepare(c.service,'trip-2'));
  const expense=(operationId,amountYuan,cityCode)=>({operationId,expectedRevision:0,input:{amountYuan,categoryId:'default:food',cityCode,spentDate:'2026-10-10',note:''}});
  c.expenses.saveExpense('trip-1','e-1',expense('e-op-1','10.00','320100'));c.expenses.saveExpense('trip-1','e-all',expense('e-op-all','99.00',null));c.expenses.saveExpense('trip-2','e-2',expense('e-op-2','20.00','320100'));
  c.footprints.syncAll();const overview=c.footprints.getOverview(),city=c.footprints.getCity('320100');
  assert.deepEqual(overview.summary,{provinceCount:1,cityCount:2,visitCount:4});assert.equal(city.visitCount,2);assert.equal(city.totalCents,3000);assert.equal(city.tripExpenses.length,2);
  assert.equal(c.footprints.getProvince('320000').cityCount,2);assert.equal(c.footprints.getManagement().suppressions.length,0);
  assert.throws(()=>c.footprints.getCity('999999'),error=>error.code==='NOT_FOUND');
});

test('changed payloads conflict for suppression and restore operation ids',t=>{
  const c=context(t);c.service.saveTrip('trip-1',prepare(c.service));c.footprints.syncAll();
  c.footprints.suppress('trip-1','320100',{operationId:'same-op'});
  assert.throws(()=>c.footprints.suppress('trip-1','320500',{operationId:'same-op'}),error=>error.code==='CONFLICT');
});

test('production defaults supply the server calendar for manual validation',t=>{
  const c=setup(t),service=createFootprintService({database:c.database,now:()=>NOW});
  const saved=service.saveVisit('old-visit',command('default-today',0,{cityCode:'320100',datePrecision:'year',dateStart:'2020',note:''}));assert.equal(saved.dateStart,'2020');
});
