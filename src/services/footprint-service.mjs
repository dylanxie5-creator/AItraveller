import {createHash} from 'node:crypto';
import {normalizeManualVisitInput} from '../footprints/validation.mjs';
import {presentFootprintGroups,summarizeFootprints} from '../footprints/presentation.mjs';
import {getCityByCode} from '../domain/city-catalog.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {createFootprintStore} from '../storage/footprint-store.mjs';
import {createFootprintOperationStore} from '../storage/footprint-operation-store.mjs';
import {createTripStore} from '../storage/trip-store.mjs';
import {createExpenseStore} from '../storage/expense-store.mjs';
import {StoreError,conflict,missing,validId,validRevision} from '../storage/errors.mjs';
import {createFootprintLifecycle} from './footprint-lifecycle.mjs';
import {todayDateOnly} from '../shared/date.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const invalid=(field='form',message='操作请求无效')=>new ValidationError({[field]:message});
const validCity=value=>typeof value==='string'&&/^\d{6}$/.test(value);

export function createFootprintService({database,today,now=()=>new Date().toISOString()}={}) {
  const serverToday=today??todayDateOnly;
  const visits=createFootprintStore(database),operations=createFootprintOperationStore(database),trips=createTripStore(database),expenses=createExpenseStore(database),lifecycle=createFootprintLifecycle({database,today:serverToday,now});
  const replay=(operationId,action,scopeKey,requestHash)=>{const old=operations.find(operationId);if(!old)return null;if(old.action!==action||old.scopeKey!==scopeKey||old.requestHash!==requestHash)throw conflict();return old.response;};
  const record=(operationId,action,scopeKey,requestHash,response)=>operations.insert({operationId,action,scopeKey,requestHash,response}).response;
  function requireCommand(command,{revision=true}={}) {if(!command||typeof command!=='object'||Array.isArray(command)||!validId(command.operationId)||revision&&!validRevision(command.expectedRevision))throw invalid();}
  function requireTrip(id) {if(!validId(id))throw invalid();const trip=trips.get(id);if(!trip)throw missing();return trip;}
  function allExpenses() {return trips.list().flatMap(trip=>expenses.list(trip.id));}
  function getOverview() {return presentFootprintGroups({visits:visits.list(),expenses:allExpenses()});}
  function getSummary() {return summarizeFootprints(visits.list());}
  function getProvince(code) {if(!validCity(code))throw invalid('provinceCode');const item=getOverview().provinces.find(row=>row.provinceCode===code);if(!item)throw missing();return item;}
  function getCity(code) {if(!validCity(code))throw invalid('cityCode');const item=getOverview().cities.find(row=>row.cityCode===code);if(!item)throw missing();return {...item,wholeTripExpensesExcluded:true};}
  function getManagement() {return {summary:getSummary(),visits:visits.list(),suppressions:visits.listSuppressions()};}
  function getVisit(id) {if(!validId(id))throw invalid();const item=visits.get(id);if(!item)throw missing();return item;}
  function noteOnly(input) {if(!input||typeof input!=='object'||Array.isArray(input)||Reflect.ownKeys(input).some(key=>key!=='note')||typeof input.note!=='string'||[...input.note.trim()].length>200)throw invalid('note','自动或脱离足迹只允许修改备注');return input.note.trim();}
  function saveVisit(id,command) {
    if(!validId(id))throw invalid();requireCommand(command);const scopeKey=`visit:${id}`,requestHash=digest({action:'save',id,expectedRevision:command.expectedRevision,input:command.input});
    return database.transaction(()=>{const prior=replay(command.operationId,'save',scopeKey,requestHash);if(prior)return prior;const old=visits.get(id);if((old?.revision??0)!==command.expectedRevision)throw conflict();let content;
      if(old&&old.source!=='manual')content={...old,note:noteOnly(command.input)};
      else {const clean=normalizeManualVisitInput(command.input,{resolveCity:getCityByCode,today:serverToday});content={...clean,source:'manual',linkedTripId:null,tripNameSnapshot:null};}
      const saved=visits.put(id,content,{expectedRevision:command.expectedRevision,now:now()});return record(command.operationId,'save',scopeKey,requestHash,saved);
    });
  }
  function deleteVisit(id,command) {
    if(!validId(id))throw invalid();requireCommand(command);const scopeKey=`visit:${id}`,requestHash=digest({action:'delete',id,expectedRevision:command.expectedRevision});
    return database.transaction(()=>{const prior=replay(command.operationId,'delete',scopeKey,requestHash);if(prior)return prior;const old=visits.get(id);if(!old)throw missing();if(old.source==='trip')throw new StoreError('AUTO_VISIT_REQUIRES_SUPPRESSION','自动足迹请使用撤销操作');visits.remove(id,command.expectedRevision);return record(command.operationId,'delete',scopeKey,requestHash,{deleted:true,id});});
  }
  function suppress(tripId,cityCode,command) {
    requireCommand(command,{revision:false});if(!validId(tripId)||!validCity(cityCode))throw invalid();const scopeKey=`suppression:${tripId}:${cityCode}`,requestHash=digest({action:'suppress',tripId,cityCode});
    return database.transaction(()=>{const prior=replay(command.operationId,'suppress',scopeKey,requestHash);if(prior)return prior;const trip=requireTrip(tripId);if(!trip.cities.some(city=>city.cityCode===cityCode))throw missing();if(!visits.getSuppression(tripId,cityCode))visits.putSuppression({tripId,cityCode,operationId:command.operationId,now:now()});const linked=visits.listByTrip(tripId).find(item=>item.cityCode===cityCode);if(linked)visits.remove(linked.id,linked.revision);return record(command.operationId,'suppress',scopeKey,requestHash,{suppressed:true,tripId,cityCode});});
  }
  function restore(tripId,cityCode,command) {
    requireCommand(command,{revision:false});if(!validId(tripId)||!validCity(cityCode))throw invalid();const scopeKey=`suppression:${tripId}:${cityCode}`,requestHash=digest({action:'restore',tripId,cityCode});
    return database.transaction(()=>{const prior=replay(command.operationId,'restore',scopeKey,requestHash);if(prior)return prior;requireTrip(tripId);if(!visits.getSuppression(tripId,cityCode))throw missing();visits.removeSuppression(tripId,cityCode);const visit=lifecycle.syncTrip(tripId).find(item=>item.cityCode===cityCode)??null;return record(command.operationId,'restore',scopeKey,requestHash,{restored:true,tripId,cityCode,visit});});
  }
  return {syncAll:()=>{lifecycle.syncAll();return getSummary();},getSummary,getOverview,getProvince,getCity,getManagement,getVisit,saveVisit,deleteVisit,suppress,restore};
}
