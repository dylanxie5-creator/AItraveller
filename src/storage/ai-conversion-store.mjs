import {ValidationError} from '../shared/trip-validation.mjs';
import {corrupt,validId,validRevision} from './errors.mjs';

const invalid=(field='form')=>new ValidationError({[field]:'请检查攻略转换记录'});
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function cloneJson(value) {
  const seen=new Set();
  function copy(item) {
    if(item===null||typeof item==='string'||typeof item==='boolean')return item;
    if(typeof item==='number'&&Number.isFinite(item))return item;
    if(Array.isArray(item)) {
      if(Object.getPrototypeOf(item)!==Array.prototype||Reflect.ownKeys(item).length!==item.length+1)throw invalid();
      return Array.from({length:item.length},(_,index)=>{const descriptor=Object.getOwnPropertyDescriptor(item,String(index));if(!descriptor||!Object.hasOwn(descriptor,'value'))throw invalid();return copy(descriptor.value);});
    }
    if(!isRecord(item)||seen.has(item))throw invalid();seen.add(item);const result={};
    for(const key of Reflect.ownKeys(item)){const descriptor=Object.getOwnPropertyDescriptor(item,key);if(typeof key!=='string'||!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw invalid();result[key]=copy(descriptor.value);}
    seen.delete(item);return result;
  }
  return copy(value);
}
function clean(value,{stored=false}={}) {
  const fields=['planId','planRevision','tripId','status','snapshot'];
  try {
    const item=cloneJson(value);
    if(!isRecord(item)||Reflect.ownKeys(item).some(key=>typeof key!=='string'||!fields.includes(key))||fields.some(key=>!Object.hasOwn(item,key))||
      !validId(item.planId)||!validRevision(item.planRevision)||item.planRevision<1||!validId(item.tripId)||!['created','deleted'].includes(item.status)||!isRecord(item.snapshot))throw invalid();
    return item;
  }catch(error){if(stored)throw corrupt();throw error;}
}

export function createAiConversionStore(database) {
  const {db}=database;
  function fromRow(row) {
    if(!row)return null;
    let value;try{value=clean(JSON.parse(row.payload),{stored:true});}catch{throw corrupt();}
    if(value.planId!==row.plan_id||value.tripId!==row.trip_id||value.status!==row.status)throw corrupt();return value;
  }
  function getByPlan(planId) {if(!validId(planId))throw invalid('planId');return fromRow(db.prepare('SELECT plan_id,trip_id,status,payload FROM ai_conversions WHERE plan_id=?').get(planId));}
  function getByTrip(tripId) {if(!validId(tripId))throw invalid('tripId');return fromRow(db.prepare('SELECT plan_id,trip_id,status,payload FROM ai_conversions WHERE trip_id=?').get(tripId));}
  function insert(conversion) {
    const value=clean(conversion);if(value.status!=='created')throw invalid('status');
    return database.transaction(()=>{db.prepare('INSERT INTO ai_conversions(plan_id,trip_id,status,payload) VALUES(?,?,?,?)').run(value.planId,value.tripId,value.status,JSON.stringify(value));return getByPlan(value.planId);});
  }
  function markDeleted(tripId) {
    if(!validId(tripId))throw invalid('tripId');return database.transaction(()=>{
      const current=getByTrip(tripId);if(!current||current.status==='deleted')return current;
      const value={...current,status:'deleted'};const result=db.prepare('UPDATE ai_conversions SET status=?,payload=? WHERE trip_id=? AND status=?').run('deleted',JSON.stringify(value),tripId,'created');
      if(result.changes!==1)throw corrupt();return getByTrip(tripId);
    });
  }
  return {getByPlan,getByTrip,insert,markDeleted};
}
