import {randomUUID} from 'node:crypto';
import {providerIds} from '../ai/provider-config.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {conflict,corrupt,missing,validId,validRevision} from './errors.mjs';

const invalid=(field='form')=>new ValidationError({[field]:'请检查攻略内容'});
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function cloneJson(value,field='form') {
  const seen=new Set();
  function copy(item) {
    if(item===null||typeof item==='string'||typeof item==='boolean')return item;
    if(typeof item==='number'&&Number.isFinite(item))return item;
    if(Array.isArray(item)) {
      if(Object.getPrototypeOf(item)!==Array.prototype||Reflect.ownKeys(item).length!==item.length+1)throw invalid(field);
      return item.map(copy);
    }
    if(!isRecord(item)||seen.has(item))throw invalid(field);
    seen.add(item);const result={};
    for(const key of Reflect.ownKeys(item)) {
      const descriptor=Object.getOwnPropertyDescriptor(item,key);
      if(typeof key!=='string'||!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw invalid(field);
      result[key]=copy(descriptor.value);
    }
    seen.delete(item);return result;
  }
  return copy(value);
}
const iso=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value));
const timestamp=now=>{const value=now();const text=value instanceof Date?value.toISOString():value;if(!iso(text))throw invalid();return text;};
function validatePayload(payload,revision) {
  const fields=['original','content','sources','provider','model','createdAt','updatedAt','edited'];
  if(!isRecord(payload)||Reflect.ownKeys(payload).some(key=>typeof key!=='string'||!fields.includes(key))||fields.some(key=>!Object.hasOwn(payload,key)))throw corrupt();
  if(!isRecord(payload.original)||!isRecord(payload.content)||!providerIds.includes(payload.provider)||typeof payload.model!=='string'||!payload.model.trim()||
    !Array.isArray(payload.sources)||typeof payload.edited!=='boolean'||!iso(payload.createdAt)||!iso(payload.updatedAt)||!validRevision(revision)||revision<1)throw corrupt();
  try{return cloneJson(payload);}catch{throw corrupt();}
}

export function createAiPlanStore(database,{now=()=>new Date(),createId=()=>randomUUID()}={}) {
  const {db}=database;
  function getConversion(planId) {
    if(!validId(planId))throw invalid('planId');
    const row=db.prepare('SELECT plan_id,trip_id,status,payload FROM ai_conversions WHERE plan_id=?').get(planId);
    if(!row)return null;
    try {
      const value=cloneJson(JSON.parse(row.payload));
      const fields=['planId','planRevision','tripId','status','snapshot'];
      if(!isRecord(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!fields.includes(key))||fields.some(key=>!Object.hasOwn(value,key))||
        value.planId!==row.plan_id||value.tripId!==row.trip_id||value.status!==row.status||!validRevision(value.planRevision)||value.planRevision<1||
        !validId(value.planId)||!validId(value.tripId)||!['created','deleted'].includes(value.status)||!isRecord(value.snapshot))throw corrupt();
      return value;
    }catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  function fromRow(row) {
    if(!row)return null;
    try {
      if(!validId(row.id))throw corrupt();
      const payload=validatePayload(JSON.parse(row.payload),row.revision);
      return {id:row.id,revision:row.revision,...payload,conversion:getConversion(row.id)};
    }catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  function get(id) {
    if(!validId(id))throw invalid('planId');
    return fromRow(db.prepare('SELECT id,revision,payload FROM ai_plans WHERE id=?').get(id));
  }
  function list() {return db.prepare('SELECT id,revision,payload FROM ai_plans ORDER BY rowid DESC').all().map(fromRow);}
  function insertGenerated({content,sources,provider,model}) {
    if(!providerIds.includes(provider))throw invalid('provider');
    if(typeof model!=='string'||!model.trim()||[...model].length>200)throw invalid('model');
    if(!Array.isArray(sources))throw invalid('sources');
    const cleanContent=cloneJson(content),cleanSources=cloneJson(sources,'sources'),id=createId();
    if(!validId(id))throw invalid('planId');
    const at=timestamp(now),payload={original:cleanContent,content:cloneJson(cleanContent),sources:cleanSources,provider,model:model.trim(),createdAt:at,updatedAt:at,edited:false};
    db.prepare('INSERT INTO ai_plans(id,revision,payload) VALUES(?,?,?)').run(id,1,JSON.stringify(payload));
    return {id,revision:1,...cloneJson(payload),conversion:null};
  }
  function update(id,{expectedRevision,content}) {
    if(!validId(id)||!validRevision(expectedRevision)||expectedRevision<1)throw invalid();
    const cleanContent=cloneJson(content),at=timestamp(now);
    return database.transaction(()=>{
      const row=db.prepare('SELECT id,revision,payload FROM ai_plans WHERE id=?').get(id);if(!row)throw missing();
      const current=fromRow(row);if(current.revision!==expectedRevision)throw conflict();
      const payload={original:current.original,content:cleanContent,sources:current.sources,provider:current.provider,model:current.model,createdAt:current.createdAt,updatedAt:at,edited:true};
      const result=db.prepare('UPDATE ai_plans SET revision=?,payload=? WHERE id=? AND revision=?').run(expectedRevision+1,JSON.stringify(payload),id,expectedRevision);
      if(result.changes!==1)throw conflict();return {id,revision:expectedRevision+1,...cloneJson(payload),conversion:current.conversion};
    });
  }
  return {get,list,insertGenerated,update,getConversion};
}
