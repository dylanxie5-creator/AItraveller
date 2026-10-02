import {conflict,corrupt,validId,validRevision} from './errors.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
const steps=['basic','route','confirm'];
export function validDraftKey(key) {return key==='new'||(typeof key==='string'&&key.startsWith('edit:')&&validId(key.slice(5)));}
export function createDraftStore(database) {
  const {db}=database;
  function get(key) {
    if(!validDraftKey(key))throw new ValidationError({form:'无效草稿入口'});
    const row=db.prepare('SELECT * FROM drafts WHERE key=?').get(key);if(!row)return {key,revision:0,state:'closed'};
    try {
      const slot={key,revision:row.revision,state:row.state,sessionId:row.session_id,targetTripId:row.target_trip_id,baseTripRevision:row.base_trip_revision,step:row.step,input:row.payload===null?null:JSON.parse(row.payload)};
      if(!validRevision(slot.revision)||slot.revision<1||!['active','closed'].includes(slot.state)||!validId(slot.sessionId)||!validId(slot.targetTripId)||!validRevision(slot.baseTripRevision)||!steps.includes(slot.step)||(key!=='new'&&key!==`edit:${slot.targetTripId}`)|| (slot.state==='active'&&(!slot.input||typeof slot.input!=='object'||Array.isArray(slot.input))))throw corrupt();
      return slot;
    }catch{throw corrupt();}
  }
  return {get,put(key,command){return database.transaction(()=>{
    if(!command||!validRevision(command.expectedRevision)||!validRevision(command.baseTripRevision)||!validId(command.sessionId)||!validId(command.targetTripId)||!steps.includes(command.step)||!command.input||typeof command.input!=='object'||Array.isArray(command.input)||!validDraftKey(key)||(key!=='new'&&key!==`edit:${command.targetTripId}`)||(key==='new'&&command.baseTripRevision!==0))throw new ValidationError({form:'无效的草稿结构'});
    const old=get(key);if(old.revision!==command.expectedRevision)throw conflict();
    if(old.state==='closed'&&old.sessionId===command.sessionId)throw conflict();
    if(old.state==='active'&&(old.sessionId!==command.sessionId||old.targetTripId!==command.targetTripId||old.baseTripRevision!==command.baseTripRevision))throw conflict();
    db.prepare("INSERT INTO drafts VALUES(?,?,'active',?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,state=excluded.state,session_id=excluded.session_id,target_trip_id=excluded.target_trip_id,base_trip_revision=excluded.base_trip_revision,step=excluded.step,payload=excluded.payload").run(key,old.revision+1,command.sessionId,command.targetTripId,command.baseTripRevision,command.step,JSON.stringify(command.input));
    return get(key);
  });},close(key,{sessionId,revision}){return database.transaction(()=>{
    const old=get(key);if(old.sessionId!==sessionId)throw conflict();if(old.state==='closed'&&(revision===old.revision||revision===old.revision-1))return old;
    if(old.revision!==revision)throw conflict();
    db.prepare("UPDATE drafts SET state='closed',payload=NULL,revision=revision+1 WHERE key=?").run(key);return get(key);
  });}};
}
