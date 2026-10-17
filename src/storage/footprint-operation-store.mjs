import {ValidationError} from '../shared/trip-validation.mjs';
import {conflict,corrupt,validId} from './errors.mjs';

const actions=new Set(['save','delete','suppress','restore']);
const invalid=()=>new ValidationError({form:'操作身份无效'});
function clone(value) {try{const json=JSON.stringify(value);if(!json||json.length>65536)throw invalid();return JSON.parse(json);}catch(error){if(error?.code==='VALIDATION')throw error;throw invalid();}}
function validText(value,max=200) {return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}

export function createFootprintOperationStore(database) {
  const {db}=database;
  function fromRow(row) {
    if(!row)return null;
    try {const response=JSON.parse(row.response);if(!validId(row.operation_id)||!actions.has(row.action)||!validText(row.scope_key)||!validText(row.request_hash,128)||!response||typeof response!=='object'||Array.isArray(response))throw corrupt();return {operationId:row.operation_id,action:row.action,scopeKey:row.scope_key,requestHash:row.request_hash,response:clone(response)};}
    catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  function find(operationId) {if(!validId(operationId))throw invalid();return fromRow(db.prepare('SELECT * FROM footprint_operation_receipts WHERE operation_id=?').get(operationId));}
  function insert(value) {
    if(!value||!validId(value.operationId)||!actions.has(value.action)||!validText(value.scopeKey)||!validText(value.requestHash,128)||!value.response||typeof value.response!=='object'||Array.isArray(value.response))throw invalid();
    const response=clone(value.response);
    return database.transaction(()=>{const old=find(value.operationId);if(old){if(old.action!==value.action||old.scopeKey!==value.scopeKey||old.requestHash!==value.requestHash)throw conflict();return old;}try{db.prepare('INSERT INTO footprint_operation_receipts VALUES(?,?,?,?,?)').run(value.operationId,value.action,value.scopeKey,value.requestHash,JSON.stringify(response));}catch{throw conflict();}return find(value.operationId);});
  }
  return {find,insert};
}
