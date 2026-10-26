import {todayDateOnly} from '../shared/date.mjs';
import {buildTravelArchive,buildTripArchive,isCompletedTrip} from '../reports/archive-model.mjs';
import {createTripStore} from '../storage/trip-store.mjs';
import {createExpenseService} from './expense-service.mjs';
import {createFootprintStore} from '../storage/footprint-store.mjs';
import {createAiPlanStore} from '../storage/ai-plan-store.mjs';
import {createAiConversionStore} from '../storage/ai-conversion-store.mjs';
import {corrupt,missing,StoreError,validId} from '../storage/errors.mjs';

function createArchiveStores(database) {return {trips:createTripStore(database),expenses:createExpenseService({database}),footprints:createFootprintStore(database),plans:createAiPlanStore(database),conversions:createAiConversionStore(database)};}
const timestamp=now=>{const value=now(),text=value instanceof Date?value.toISOString():value;if(typeof text!=='string'||!Number.isFinite(Date.parse(text)))throw new TypeError('档案生成时间无效');return text;};

export function createArchiveService({database,today=todayDateOnly,now=()=>new Date().toISOString(),storeFactory=createArchiveStores}={}) {
  if(!database?.transaction||typeof storeFactory!=='function')throw new TypeError('档案服务配置无效');
  const {trips,expenses,footprints,plans,conversions}=storeFactory(database);
  function one(trip,cutoffDate,generatedAt) {
    const conversion=conversions.getByTrip(trip.id);let guide=null;
    if(conversion?.status==='created') {
      const plan=plans.get(conversion.planId);if(!plan)throw corrupt();
      guide={provider:plan.provider,model:plan.model,edited:plan.edited,createdAt:plan.createdAt,updatedAt:plan.updatedAt,content:plan.content,conversionSnapshot:conversion.snapshot,original:plan.original,sources:plan.sources};
    }
    return buildTripArchive({trip,expenseOverview:expenses.getOverview(trip.id),visits:footprints.listByTrip(trip.id),guide,generatedAt,cutoffDate,databaseVersion:4});
  }
  function context() {const cutoffDate=today(),generatedAt=timestamp(now);return {cutoffDate,generatedAt};}
  return {
    getTripArchive(id) {
      if(!validId(id))throw missing();const {cutoffDate,generatedAt}=context();
      return database.transaction(()=>{const trip=trips.get(id);if(!trip)throw missing();if(!isCompletedTrip(trip,cutoffDate))throw new StoreError('ARCHIVE_NOT_COMPLETED','行程结束后才能生成档案');return one(trip,cutoffDate,generatedAt);});
    },
    getTravelArchive() {
      const {cutoffDate,generatedAt}=context();return database.transaction(()=>{const reports=trips.list().filter(trip=>isCompletedTrip(trip,cutoffDate)).map(trip=>one(trip,cutoffDate,generatedAt));return buildTravelArchive({tripArchives:reports,allVisits:footprints.list(),generatedAt,cutoffDate,databaseVersion:4});});
    },
  };
}
