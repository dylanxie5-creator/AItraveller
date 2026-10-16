import {createHash} from 'node:crypto';
import {createCategoryCatalog} from '../expenses/categories.mjs';
import {computeExpenseSummary,presentExpenses} from '../expenses/statistics.mjs';
import {normalizeExpenseInput} from '../expenses/validation.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {createExpenseCategoryStore} from '../storage/expense-category-store.mjs';
import {createExpenseOperationStore} from '../storage/expense-operation-store.mjs';
import {createExpenseStore} from '../storage/expense-store.mjs';
import {conflict,missing,validId,validRevision} from '../storage/errors.mjs';
import {createTripStore} from '../storage/trip-store.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const invalid=()=>new ValidationError({form:'操作请求无效'});
const validCustomId=value=>typeof value==='string'&&/^custom:[a-zA-Z0-9_-]{1,70}$/.test(value);

export function createExpenseService({database,today,now=()=>new Date().toISOString()}) {
  void today;
  const trips=createTripStore(database),expenses=createExpenseStore(database),categories=createExpenseCategoryStore(database),operations=createExpenseOperationStore(database);
  const getTrip=id=>{if(!validId(id))throw invalid();const trip=trips.get(id);if(!trip)throw missing();return trip;};
  const catalogFor=tripId=>createCategoryCatalog(categories.list(tripId));
  const requireEnvelope=(tripId,id,command,kind)=>{
    const validEntity=kind==='expense'?validId(id):validCustomId(id);
    if(!validId(tripId)||!validEntity||!command||typeof command!=='object'||Array.isArray(command)||!validId(command.operationId)||!validRevision(command.expectedRevision))throw invalid();
  };
  const replay=(tripId,id,kind,command,requestHash)=>{
    const old=operations.find(command.operationId);if(!old)return null;
    if(old.tripId!==tripId||old.entityType!==kind||old.entityId!==id||old.requestHash!==requestHash)throw conflict();
    return old.response;
  };
  const record=(tripId,id,kind,operationId,requestHash,response)=>operations.insert({operationId,tripId,entityType:kind,entityId:id,requestHash,response}).response;

  function listCategories(tripId) {
    getTrip(tripId);const catalog=catalogFor(tripId),counts=new Map();
    for(const item of expenses.list(tripId))counts.set(item.categoryId,(counts.get(item.categoryId)??0)+1);
    return catalog.list.map(item=>({...item,usageCount:counts.get(item.id)??0,inUse:(counts.get(item.id)??0)>0}));
  }
  function getOverview(tripId) {
    const trip=getTrip(tripId),catalog=catalogFor(tripId),stored=expenses.list(tripId);
    return {trip,categories:listCategories(tripId),summary:computeExpenseSummary({trip,expenses:stored,catalog}),expenses:presentExpenses({trip,expenses:stored,catalog})};
  }
  function getExpense(tripId,id) {getTrip(tripId);if(!validId(id))throw invalid();const item=expenses.get(tripId,id);if(!item)throw missing();return item;}
  function saveExpense(tripId,id,command) {
    requireEnvelope(tripId,id,command,'expense');
    const requestHash=digest({action:'save',tripId,id,expectedRevision:command.expectedRevision,input:command.input});
    return database.transaction(()=>{
      getTrip(tripId);const prior=replay(tripId,id,'expense',command,requestHash);if(prior)return prior;
      const previous=expenses.get(tripId,id);if((previous?.revision??0)!==command.expectedRevision)throw conflict();
      const trip=getTrip(tripId),content=normalizeExpenseInput(command.input,{trip,catalog:catalogFor(tripId),previous});
      const saved=expenses.put(tripId,id,content,{expectedRevision:command.expectedRevision,now:now()});
      return record(tripId,id,'expense',command.operationId,requestHash,saved);
    });
  }
  function deleteExpense(tripId,id,command) {
    requireEnvelope(tripId,id,command,'expense');
    const requestHash=digest({action:'delete',tripId,id,expectedRevision:command.expectedRevision});
    return database.transaction(()=>{
      getTrip(tripId);const prior=replay(tripId,id,'expense',command,requestHash);if(prior)return prior;
      expenses.remove(tripId,id,command.expectedRevision);const response={deleted:true,id};
      return record(tripId,id,'expense',command.operationId,requestHash,response);
    });
  }
  function saveCategory(tripId,id,command) {
    requireEnvelope(tripId,id,command,'category');
    const requestHash=digest({action:'save',tripId,id,expectedRevision:command.expectedRevision,name:command.name});
    return database.transaction(()=>{
      getTrip(tripId);const prior=replay(tripId,id,'category',command,requestHash);if(prior)return prior;
      const saved=categories.put(tripId,id,command.name,{expectedRevision:command.expectedRevision,now:now()});
      return record(tripId,id,'category',command.operationId,requestHash,saved);
    });
  }
  function deleteCategory(tripId,id,command) {
    requireEnvelope(tripId,id,command,'category');
    const requestHash=digest({action:'delete',tripId,id,expectedRevision:command.expectedRevision});
    return database.transaction(()=>{
      getTrip(tripId);const prior=replay(tripId,id,'category',command,requestHash);if(prior)return prior;
      categories.remove(tripId,id,command.expectedRevision);const response={deleted:true,id};
      return record(tripId,id,'category',command.operationId,requestHash,response);
    });
  }
  function getGlobalOverview() {
    let totalCents=0,count=0;
    for(const trip of trips.list())for(const item of expenses.list(trip.id)){totalCents+=item.amountCents;count++;if(!Number.isSafeInteger(totalCents))throw new RangeError('花销总额超出安全范围');}
    return {hasExpenses:count>0,totalCents};
  }
  return {getOverview,getExpense,saveExpense,deleteExpense,listCategories,saveCategory,deleteCategory,getGlobalOverview};
}
