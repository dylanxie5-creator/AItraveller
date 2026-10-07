import {randomUUID} from 'node:crypto';
import {normalizePlanContent} from '../ai/validation.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {conflict,missing,validId,validRevision} from '../storage/errors.mjs';

const invalid=()=>new ValidationError({form:'攻略请求无效'});
const stamp=now=>{const value=now(),text=value instanceof Date?value.toISOString():value;if(typeof text!=='string'||Number.isNaN(Date.parse(text)))throw invalid();return text;};

export function createAiPlanService({database,planStore,conversionStore,tripStore,resolveCity,now=()=>new Date(),createId=()=>randomUUID()}) {
  function get(id){if(!validId(id))throw invalid();return planStore.get(id);}
  function update(id,{expectedRevision,content}={}) {
    if(!validId(id)||!validRevision(expectedRevision)||expectedRevision<1)throw invalid();const plan=planStore.get(id);if(!plan)throw missing();
    const normalized=normalizePlanContent(content,{sources:plan.sources,resolveCity});return planStore.update(id,{expectedRevision,content:normalized});
  }
  function convert(id,{expectedRevision}={}) {
    if(!validId(id)||!validRevision(expectedRevision)||expectedRevision<1)throw invalid();
    return database.transaction(()=>{
      const previous=conversionStore.getByPlan(id);if(previous)return previous;
      const plan=planStore.get(id);if(!plan)throw missing();if(plan.revision!==expectedRevision)throw conflict();
      const tripId=createId();if(!validId(tripId))throw invalid();
      tripStore.put(tripId,plan.content.trip,{expectedRevision:0,now:stamp(now)});
      return conversionStore.insert({planId:plan.id,planRevision:plan.revision,tripId,status:'created',snapshot:plan.content});
    });
  }
  return {list:planStore.list,get,update,convert,forTrip:conversionStore.getByTrip};
}
