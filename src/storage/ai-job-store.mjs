import {randomUUID} from 'node:crypto';
import {providerIds,configRecord} from '../ai/provider-config.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {conflict,corrupt,missing,validId,validRevision} from './errors.mjs';

const activeStates=['queued','searching','generating'];
const terminalStates=['succeeded','failed','interrupted'];
const invalid=(field='form')=>new ValidationError({[field]:'请检查任务内容'});
const iso=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value));
const clone=value=>JSON.parse(JSON.stringify(value));
function cleanInput(value) {
  const input=configRecord(value,['name','startDate','endDate','travelerCount','budgetYuan','cityCodes','preferences'],'input');
  if(typeof input.name!=='string'||typeof input.startDate!=='string'||typeof input.endDate!=='string'||!Number.isSafeInteger(input.travelerCount)||
    !Array.isArray(input.cityCodes)||Object.getPrototypeOf(input.cityCodes)!==Array.prototype||input.cityCodes.some(code=>typeof code!=='string')||
    (input.budgetYuan!==undefined&&typeof input.budgetYuan!=='string')||(input.preferences!==undefined&&typeof input.preferences!=='string'))throw invalid('input');
  return clone(input);
}
function cleanSources(value) {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>15)throw invalid('sources');
  const ids=new Set();return value.map(source=>{
    const row=configRecord(source,['sourceId','title','url','summary','publishedAt','retrievedAt'],'sources');
    if(typeof row.sourceId!=='string'||!/^s[1-9]\d*$/u.test(row.sourceId)||ids.has(row.sourceId)||typeof row.title!=='string'||typeof row.url!=='string'||typeof row.summary!=='string'||
      !(row.publishedAt===null||typeof row.publishedAt==='string')||!iso(row.retrievedAt))throw invalid('sources');
    try{new URL(row.url);}catch{throw invalid('sources');}ids.add(row.sourceId);return {...row};
  });
}
function cleanError(value) {
  const row=configRecord(value,['code','message','fields'],'error');
  if(typeof row.code!=='string'||!/^[-A-Z0-9_]{1,80}$/u.test(row.code)||typeof row.message!=='string'||!row.message||[...row.message].length>300)throw invalid('error');
  if(row.fields!==undefined&&(row.fields===null||typeof row.fields!=='object'||Array.isArray(row.fields)))throw invalid('error');
  return clone(row);
}
const at=now=>{const value=now(),text=value instanceof Date?value.toISOString():value;if(!iso(text))throw invalid();return text;};

export function createAiJobStore(database,{now=()=>new Date(),createId=()=>randomUUID()}={}) {
  const {db}=database;
  function fromRow(row,{internal=false}={}) {
    if(!row)return null;
    try {
      const payload=JSON.parse(row.payload),keys=['input','settingsRevision','provider','model','endpoint','searchCalls','modelCalls','sources','planId','error','createdAt','updatedAt'];
      if(!validId(row.id)||!validId(row.operation_id)||typeof row.request_hash!=='string'||![...activeStates,...terminalStates].includes(row.state)||
        !payload||typeof payload!=='object'||Array.isArray(payload)||Reflect.ownKeys(payload).some(key=>typeof key!=='string'||!keys.includes(key))||keys.some(key=>!Object.hasOwn(payload,key))||
        !validRevision(payload.settingsRevision)||payload.settingsRevision<1||!providerIds.includes(payload.provider)||typeof payload.model!=='string'||!payload.model||typeof payload.endpoint!=='string'||
        !Number.isSafeInteger(payload.searchCalls)||payload.searchCalls<0||payload.searchCalls>3||!Number.isSafeInteger(payload.modelCalls)||payload.modelCalls<0||payload.modelCalls>1||
        !(payload.planId===null||validId(payload.planId))||!(payload.error===null||typeof payload.error==='object')||!iso(payload.createdAt)||!iso(payload.updatedAt))throw corrupt();
      const result={id:row.id,operationId:row.operation_id,state:row.state,input:cleanInput(payload.input),settingsRevision:payload.settingsRevision,provider:payload.provider,model:payload.model,endpoint:payload.endpoint,
        searchCalls:payload.searchCalls,modelCalls:payload.modelCalls,sources:cleanSources(payload.sources),planId:payload.planId,error:payload.error===null?null:cleanError(payload.error),createdAt:payload.createdAt,updatedAt:payload.updatedAt};
      return internal?{...result,requestHash:row.request_hash}:result;
    }catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  const rowById=id=>db.prepare('SELECT id,operation_id,request_hash,state,payload FROM ai_jobs WHERE id=?').get(id);
  function get(id){if(!validId(id))throw invalid('jobId');return fromRow(rowById(id));}
  function list(){return db.prepare('SELECT id,operation_id,request_hash,state,payload FROM ai_jobs ORDER BY rowid DESC').all().map(row=>fromRow(row));}
  function findOperation(operationId){if(!validId(operationId))throw invalid('operationId');return fromRow(db.prepare('SELECT id,operation_id,request_hash,state,payload FROM ai_jobs WHERE operation_id=?').get(operationId),{internal:true});}
  function active(){const row=db.prepare("SELECT id,operation_id,request_hash,state,payload FROM ai_jobs WHERE state IN ('queued','searching','generating') LIMIT 1").get();return fromRow(row);}
  function create(command,requestHash,configSnapshot) {
    const envelope=configRecord(command,['operationId','settingsRevision','provider','input']);
    const config=configRecord(configSnapshot,['settingsRevision','provider','model','endpoint']);
    if(!validId(envelope.operationId)||typeof requestHash!=='string'||!requestHash||envelope.settingsRevision!==config.settingsRevision||envelope.provider!==config.provider||
      !validRevision(config.settingsRevision)||config.settingsRevision<1||!providerIds.includes(config.provider)||typeof config.model!=='string'||!config.model.trim()||typeof config.endpoint!=='string')throw invalid();
    const id=createId();if(!validId(id))throw invalid('jobId');const stamp=at(now);
    const payload={input:cleanInput(envelope.input),settingsRevision:config.settingsRevision,provider:config.provider,model:config.model.trim(),endpoint:config.endpoint,searchCalls:0,modelCalls:0,sources:[],planId:null,error:null,createdAt:stamp,updatedAt:stamp};
    return database.transaction(()=>{db.prepare('INSERT INTO ai_jobs(id,operation_id,request_hash,state,payload) VALUES(?,?,?,?,?)').run(id,envelope.operationId,requestHash,'queued',JSON.stringify(payload));
      return fromRow(rowById(id));});
  }
  function mutate(id,allowed,nextState,change) {
    if(!validId(id))throw invalid('jobId');return database.transaction(()=>{
      const row=rowById(id);if(!row)throw missing();const current=fromRow(row);
      if(!allowed.includes(current.state))throw conflict();const payload={...current};delete payload.id;delete payload.operationId;delete payload.state;
      const next=change(payload,current);next.updatedAt=at(now);
      const result=db.prepare('UPDATE ai_jobs SET state=?,payload=? WHERE id=? AND state=?').run(nextState,JSON.stringify(next),id,current.state);if(result.changes!==1)throw conflict();
      return fromRow(rowById(id));
    });
  }
  const reserveSearch=id=>mutate(id,['queued','searching'],'searching',payload=>{if(payload.searchCalls>=3)throw conflict();payload.searchCalls++;return payload;});
  const reserveModel=id=>mutate(id,['searching'],'generating',payload=>{if(payload.modelCalls>=1||!payload.sources.length)throw conflict();payload.modelCalls++;return payload;});
  const recordSources=(id,sources)=>{const clean=cleanSources(sources);return mutate(id,['searching'],'searching',payload=>{payload.sources=clean;return payload;});};
  const finish=(id,planId)=>{if(!validId(planId))throw invalid('planId');return mutate(id,['generating'],'succeeded',payload=>{payload.planId=planId;payload.error=null;return payload;});};
  const fail=(id,error)=>{const safe=cleanError(error);return mutate(id,activeStates,'failed',payload=>{payload.error=safe;return payload;});};
  function interruptActive() {
    return database.transaction(()=>{let count=0;for(const row of db.prepare("SELECT id FROM ai_jobs WHERE state IN ('queued','searching','generating')").all()){
      mutate(row.id,activeStates,'interrupted',payload=>{payload.error={code:'AI_INTERRUPTED',message:'上次运行已中断，请手动重新发起规划'};return payload;});count++;}return count;});
  }
  return {get,list,findOperation,active,create,reserveSearch,reserveModel,recordSources,finish,fail,interruptActive};
}
