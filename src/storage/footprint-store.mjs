import {ValidationError} from '../shared/trip-validation.mjs';
import {validateStoredVisit} from '../footprints/validation.mjs';
import {conflict,corrupt,missing,validId,validRevision} from './errors.mjs';

const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const cityCode=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const invalid=(field='form')=>new ValidationError({[field]:'足迹数据无效'});

function cleanContent(content,now) {
  try {
    if(!content||typeof content!=='object'||Array.isArray(content)||!iso(now))throw invalid();
    const checked=validateStoredVisit({id:'validation',revision:1,...content,createdAt:now,updatedAt:now});
    const {id,revision,createdAt,updatedAt,...clean}=checked;return clean;
  } catch(error) {if(error?.code==='VALIDATION')throw error;throw invalid();}
}

export function createFootprintStore(database) {
  const {db}=database;
  function fromRow(row) {
    if(!row)return null;
    try {return validateStoredVisit({id:row.id,revision:row.revision,cityCode:row.city_code,cityName:row.city_name,provinceCode:row.province_code,provinceName:row.province_name,datePrecision:row.date_precision,dateStart:row.date_start,dateEnd:row.date_end,source:row.source,linkedTripId:row.linked_trip_id,tripNameSnapshot:row.trip_name_snapshot,note:row.note,createdAt:row.created_at,updatedAt:row.updated_at});}
    catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  function get(id) {if(!validId(id))throw invalid();return fromRow(db.prepare('SELECT * FROM footprint_visits WHERE id=?').get(id));}
  function list() {return db.prepare('SELECT * FROM footprint_visits ORDER BY date_start DESC,updated_at DESC,id').all().map(fromRow);}
  function listByTrip(tripId) {if(!validId(tripId))throw invalid('tripId');return db.prepare('SELECT * FROM footprint_visits WHERE linked_trip_id=? ORDER BY date_start DESC,updated_at DESC,id').all(tripId).map(fromRow);}
  function put(id,content,{expectedRevision,now}={}) {
    if(!validId(id)||!validRevision(expectedRevision)||!iso(now))throw invalid();
    const clean=cleanContent(content,now);
    return database.transaction(()=>{
      const old=get(id);
      if((old?.revision??0)!==expectedRevision)throw conflict();
      if(old&&(old.source!==clean.source||old.linkedTripId!==clean.linkedTripId||(old.source==='trip'&&old.cityCode!==clean.cityCode)))throw conflict();
      const values=[clean.cityCode,clean.cityName,clean.provinceCode,clean.provinceName,clean.datePrecision,clean.dateStart,clean.dateEnd,clean.source,clean.linkedTripId,clean.tripNameSnapshot,clean.note];
      try {
        if(old) {
          const result=db.prepare('UPDATE footprint_visits SET revision=?,city_code=?,city_name=?,province_code=?,province_name=?,date_precision=?,date_start=?,date_end=?,source=?,linked_trip_id=?,trip_name_snapshot=?,note=?,updated_at=? WHERE id=? AND revision=?').run(expectedRevision+1,...values,now,id,expectedRevision);
          if(result.changes!==1)throw conflict();
        } else db.prepare('INSERT INTO footprint_visits VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,1,...values,now,now);
      }catch(error){if(['CONFLICT','VALIDATION','STORAGE_CORRUPT'].includes(error?.code))throw error;throw conflict();}
      return get(id);
    });
  }
  function remove(id,expectedRevision) {
    if(!validId(id)||!validRevision(expectedRevision))throw invalid();
    return database.transaction(()=>{const old=get(id);if(!old)throw missing();if(old.revision!==expectedRevision)throw conflict();const result=db.prepare('DELETE FROM footprint_visits WHERE id=? AND revision=?').run(id,expectedRevision);if(result.changes!==1)throw conflict();return true;});
  }
  function detachTrip(tripId,{now}={}) {
    if(!validId(tripId)||!iso(now))throw invalid();
    return database.transaction(()=>{const rows=listByTrip(tripId);const update=db.prepare("UPDATE footprint_visits SET revision=revision+1,source='detached',linked_trip_id=NULL,updated_at=? WHERE id=? AND revision=?");for(const row of rows){const result=update.run(now,row.id,row.revision);if(result.changes!==1)throw conflict();}return rows.map(row=>get(row.id));});
  }
  function suppressionFromRow(row) {
    if(!row)return null;
    if(!validId(row.trip_id)||!cityCode(row.city_code)||!validId(row.operation_id)||!iso(row.created_at))throw corrupt();
    return {tripId:row.trip_id,cityCode:row.city_code,operationId:row.operation_id,createdAt:row.created_at};
  }
  function getSuppression(tripId,code) {if(!validId(tripId)||!cityCode(code))throw invalid();return suppressionFromRow(db.prepare('SELECT * FROM footprint_suppressions WHERE trip_id=? AND city_code=?').get(tripId,code));}
  function listSuppressions() {return db.prepare('SELECT * FROM footprint_suppressions ORDER BY created_at,trip_id,city_code').all().map(suppressionFromRow);}
  function putSuppression({tripId,cityCode:code,operationId,now}={}) {
    if(!validId(tripId)||!cityCode(code)||!validId(operationId)||!iso(now))throw invalid();
    return database.transaction(()=>{if(getSuppression(tripId,code))throw conflict();try{db.prepare('INSERT INTO footprint_suppressions VALUES(?,?,?,?)').run(tripId,code,now,operationId);}catch(error){if(error?.code==='CONFLICT')throw error;throw conflict();}return getSuppression(tripId,code);});
  }
  function removeSuppression(tripId,code) {if(!validId(tripId)||!cityCode(code))throw invalid();return database.transaction(()=>db.prepare('DELETE FROM footprint_suppressions WHERE trip_id=? AND city_code=?').run(tripId,code).changes===1);}
  return {get,list,listByTrip,put,remove,detachTrip,getSuppression,listSuppressions,putSuppression,removeSuppression};
}
