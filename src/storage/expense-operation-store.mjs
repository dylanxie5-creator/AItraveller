import {ValidationError} from '../shared/trip-validation.mjs';
import {conflict,corrupt,validId} from './errors.mjs';

const validCategoryId=value=>typeof value==='string'&&/^custom:[a-zA-Z0-9_-]{1,70}$/.test(value);
const invalid=()=>new ValidationError({form:'操作身份无效'});
const clone=value=>JSON.parse(JSON.stringify(value));

export function createExpenseOperationStore(database) {
  const {db}=database;
  function fromRow(row) {
    if(!row)return null;
    try {
      const response=JSON.parse(row.response);
      const validEntity=row.entity_type==='expense'?validId(row.entity_id):row.entity_type==='category'&&validCategoryId(row.entity_id);
      if(!validId(row.operation_id)||!validId(row.trip_id)||!validEntity||typeof row.request_hash!=='string'||!row.request_hash||!response||typeof response!=='object'||Array.isArray(response))throw corrupt();
      return {operationId:row.operation_id,tripId:row.trip_id,entityType:row.entity_type,entityId:row.entity_id,requestHash:row.request_hash,response:clone(response)};
    }catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  function find(operationId) {if(!validId(operationId))throw invalid();return fromRow(db.prepare('SELECT * FROM expense_operation_receipts WHERE operation_id=?').get(operationId));}
  function insert(value) {
    if(!value||!validId(value.operationId)||!validId(value.tripId)||!['expense','category'].includes(value.entityType)||
      !(value.entityType==='expense'?validId(value.entityId):validCategoryId(value.entityId))||typeof value.requestHash!=='string'||!value.requestHash||
      !value.response||typeof value.response!=='object'||Array.isArray(value.response))throw invalid();
    const response=clone(value.response);
    return database.transaction(()=>{
      const old=find(value.operationId);
      if(old){if(old.tripId!==value.tripId||old.entityType!==value.entityType||old.entityId!==value.entityId||old.requestHash!==value.requestHash)throw conflict();return old;}
      const foreign=db.prepare('SELECT trip_id FROM expense_operation_receipts WHERE entity_type=? AND entity_id=? LIMIT 1').get(value.entityType,value.entityId);
      if(foreign&&foreign.trip_id!==value.tripId)throw conflict();
      try {db.prepare('INSERT INTO expense_operation_receipts VALUES(?,?,?,?,?,?)').run(value.operationId,value.tripId,value.entityType,value.entityId,value.requestHash,JSON.stringify(response));}
      catch(error){if(error?.code==='CONFLICT'||error?.code==='VALIDATION'||error?.code==='STORAGE_CORRUPT')throw error;throw conflict();}
      return find(value.operationId);
    });
  }
  return {find,insert};
}
