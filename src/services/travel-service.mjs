import {createHash} from 'node:crypto';
import {createTripStore} from '../storage/trip-store.mjs';
import {createDraftStore} from '../storage/draft-store.mjs';
import {createAiConversionStore} from '../storage/ai-conversion-store.mjs';
import {createExpenseStore} from '../storage/expense-store.mjs';
import {conflict,missing,validId,validRevision} from '../storage/errors.mjs';
import {normalizeTripInput,ValidationError} from '../shared/trip-validation.mjs';
import {getCityByCode} from '../domain/city-catalog.mjs';
import {getTripStatus,todayDateOnly} from '../shared/date.mjs';
import {createFootprintLifecycle} from './footprint-lifecycle.mjs';
import {createFootprintStore} from '../storage/footprint-store.mjs';
import {summarizeFootprints} from '../footprints/presentation.mjs';
function canonical(value) {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export function createTravelService({database,today=todayDateOnly,now=()=>new Date().toISOString(),conversionStore=createAiConversionStore(database),footprintLifecycle=createFootprintLifecycle({database,today,now})}) {
  const trips=createTripStore(database),drafts=createDraftStore(database),expenseStore=createExpenseStore(database),footprintStore=createFootprintStore(database),{db}=database;
  const getTrip=id=>{const trip=trips.get(id);if(!trip)throw missing();return trip;};
  return {listTrips:trips.list,getTrip,getDraft:drafts.get,
    getOverview(){
      const day=today(),all=trips.list();const counts={total:all.length,upcoming:0,ongoing:0,completed:0};all.forEach(t=>counts[getTripStatus(t,day)]++);
      const order={ongoing:0,upcoming:1,completed:2};
      all.sort((a,b)=>{const sa=getTripStatus(a,day),sb=getTripStatus(b,day);return order[sa]-order[sb]||(sa==='completed'?b.endDate.localeCompare(a.endDate):a.startDate.localeCompare(b.startDate))||a.id.localeCompare(b.id);});
      let totalCents=0,expenseCount=0;for(const trip of all)for(const expense of expenseStore.list(trip.id)){totalCents+=expense.amountCents;expenseCount++;if(!Number.isSafeInteger(totalCents))throw new RangeError('花销总额超出安全范围');}
      return {today:day,counts,recentTrip:all[0]??null,expenses:{hasExpenses:expenseCount>0,totalCents},footprints:summarizeFootprints(footprintStore.list())};
    },saveDraft(key,command){if(key!=='new'&&typeof key==='string'&&key.startsWith('edit:'))getTrip(key.slice(5));return drafts.put(key,command);},
    discardDraft:drafts.close,
    saveTrip(id,command){
      if(!validId(id)||!command||!validId(command.operationId)||!validRevision(command.expectedTripRevision)||!command.draft)throw new ValidationError({form:'保存请求无效'});
      const hash=createHash('sha256').update(JSON.stringify(canonical({id,expectedTripRevision:command.expectedTripRevision,input:command.input,draft:command.draft}))).digest('hex');
      return database.transaction(()=>{
        const receipt=db.prepare('SELECT * FROM save_receipts WHERE operation_id=?').get(command.operationId);
        if(receipt){if(receipt.trip_id!==id||receipt.request_hash!==hash||!trips.get(id))throw conflict();return JSON.parse(receipt.response);}
        const slot=drafts.get(command.draft.key);
        if(slot.state!=='active'||slot.targetTripId!==id||slot.sessionId!==command.draft.sessionId||slot.revision!==command.draft.revision||slot.baseTripRevision!==command.expectedTripRevision)throw conflict();
        const content=normalizeTripInput(command.input,getCityByCode);
        const trip=trips.put(id,content,{expectedRevision:command.expectedTripRevision,now:now()});
        footprintLifecycle.syncTrip(id);
        drafts.close(slot.key,{sessionId:slot.sessionId,revision:slot.revision});
        db.prepare('INSERT INTO save_receipts VALUES(?,?,?,?)').run(command.operationId,id,hash,JSON.stringify(trip));return trip;
      });
    },deleteTrip(id,revision){return database.transaction(()=>{
      footprintLifecycle.syncTrip(id);footprintLifecycle.detachTrip(id);trips.remove(id,revision);const slot=drafts.get(`edit:${id}`);if(slot.state==='active')drafts.close(slot.key,{sessionId:slot.sessionId,revision:slot.revision});conversionStore.markDeleted(id);return true;
    });}
  };
}
