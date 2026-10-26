import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createTravelService} from '../../src/services/travel-service.mjs';
import {createExpenseService} from '../../src/services/expense-service.mjs';
import {createFootprintService} from '../../src/services/footprint-service.mjs';
import {createTripStore} from '../../src/storage/trip-store.mjs';
import {createFootprintStore} from '../../src/storage/footprint-store.mjs';
import {createAiPlanStore} from '../../src/storage/ai-plan-store.mjs';
import {createAiConversionStore} from '../../src/storage/ai-conversion-store.mjs';
import {normalizeTripInput} from '../../src/shared/trip-validation.mjs';
import {getCityByCode} from '../../src/domain/city-catalog.mjs';
import {planContent,sources} from './ai-fixtures.mjs';
import {input} from './fixtures.mjs';
export function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'travel-web-test-'));
  const path=join(dir,'travel.sqlite'); const database=openDatabase(path);
  t.after(()=>{database.close();rmSync(dir,{recursive:true,force:true});});
  const service=createTravelService({database,today:()=> '2026-10-02',now:()=> '2026-10-02T12:00:00.000Z'});
  const expenses=createExpenseService({database,today:()=> '2026-10-02',now:()=> '2026-10-02T12:00:00.000Z'});
  const footprints=createFootprintService({database,today:()=> '2026-10-02',now:()=> '2026-10-02T12:00:00.000Z'});
  return {dir,path,database,service,expenses,footprints};
}
export function prepare(service,id='trip-1',key='new',baseTripRevision=0) {
  const prior=service.getDraft(key);
  const slot=service.saveDraft(key,{expectedRevision:prior.revision,sessionId:'session-'+id+'-'+prior.revision,targetTripId:id,baseTripRevision,step:'confirm',input:input()});
  return {operationId:'operation-'+id+'-'+baseTripRevision+'-'+slot.revision,expectedTripRevision:baseTripRevision,input:input(),draft:{key,sessionId:slot.sessionId,revision:slot.revision}};
}

export function setupArchive(t) {
  const state=setup(t),trips=createTripStore(state.database),visits=createFootprintStore(state.database);
  const saveTrip=(id,name,startDate,endDate)=>trips.put(id,normalizeTripInput({...input(),name,startDate,endDate,cities:[{cityCode:'320100',arrivalDate:startDate,departureDate:endDate}]},getCityByCode),{expectedRevision:0,now:'2026-10-01T00:00:00.000Z'});
  const completed=saveTrip('trip-completed','已结束行程','2026-10-10','2026-10-13');saveTrip('trip-today','当天结束','2026-10-20','2026-10-26');saveTrip('trip-future','未来行程','2026-11-01','2026-11-03');
  state.expenses.saveExpense(completed.id,'expense-archive',{operationId:'expense-archive-op',expectedRevision:0,input:{amountYuan:'88.80',categoryId:'default:transport',cityCode:'320100',spentDate:'2026-10-10',note:'高铁'}});
  visits.put('visit-archive',{cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'trip_range',dateStart:'2026-10-10',dateEnd:'2026-10-13',source:'trip',linkedTripId:completed.id,tripNameSnapshot:completed.name,note:'自动足迹'},{expectedRevision:0,now:'2026-10-14T00:00:00.000Z'});
  const plans=createAiPlanStore(state.database,{now:()=>new Date('2026-10-01T00:00:00.000Z'),createId:()=> 'plan-archive'}),conversions=createAiConversionStore(state.database),request={name:completed.name,startDate:completed.startDate,endDate:completed.endDate,travelerCount:completed.travelerCount,budgetCents:completed.budgetCents,cities:completed.cities};
  const original=planContent(request),plan=plans.insertGenerated({content:original,sources:sources(),provider:'deepseek',model:'deepseek-chat'});conversions.insert({planId:plan.id,planRevision:plan.revision,tripId:completed.id,status:'created',snapshot:{...original,cautions:['转换时快照']}});plans.update(plan.id,{expectedRevision:1,content:{...original,cautions:['当前攻略']}});
  return {...state,completed,tripStore:trips,visitStore:visits,planStore:plans,conversionStore:conversions};
}
