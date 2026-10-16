import {isDateOnly} from '../shared/date.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {conflict,corrupt,missing,validId,validRevision} from './errors.mjs';

const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const validCategoryId=value=>typeof value==='string'&&/^(?:default|custom):[a-zA-Z0-9_-]{1,70}$/.test(value);
const invalid=(field='form')=>new ValidationError({[field]:'花销数据无效'});

function cleanContent(content) {
  if(!content||typeof content!=='object'||Array.isArray(content)||!Number.isSafeInteger(content.amountCents)||content.amountCents<=0||
    !validCategoryId(content.categoryId)||!isDateOnly(content.spentDate)||typeof content.note!=='string'||[...content.note].length>200)throw invalid();
  const noCity=content.cityCode===null&&content.cityName===null;
  const city=typeof content.cityCode==='string'&&/^\d{6}$/.test(content.cityCode)&&typeof content.cityName==='string'&&Boolean(content.cityName);
  if(!noCity&&!city)throw invalid('cityCode');
  return {amountCents:content.amountCents,categoryId:content.categoryId,cityCode:content.cityCode,cityName:content.cityName,spentDate:content.spentDate,note:content.note};
}

export function createExpenseStore(database) {
  const {db}=database;
  const rowById=id=>db.prepare('SELECT * FROM expenses WHERE id=?').get(id);
  function fromRow(row) {
    if(!row)return null;
    try {
      if(!validId(row.id)||!validId(row.trip_id)||!validRevision(row.revision)||row.revision<1||!iso(row.created_at)||!iso(row.updated_at))throw corrupt();
      const content=cleanContent({amountCents:row.amount_cents,categoryId:row.category_id,cityCode:row.city_code,cityName:row.city_name,spentDate:row.spent_date,note:row.note});
      return {id:row.id,tripId:row.trip_id,revision:row.revision,...content,createdAt:row.created_at,updatedAt:row.updated_at};
    }catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  function get(tripId,id) {
    if(!validId(tripId)||!validId(id))throw invalid();
    return fromRow(db.prepare('SELECT * FROM expenses WHERE trip_id=? AND id=?').get(tripId,id));
  }
  function list(tripId) {
    if(!validId(tripId))throw invalid('tripId');
    return db.prepare('SELECT * FROM expenses WHERE trip_id=? ORDER BY spent_date DESC,updated_at DESC,id').all(tripId).map(fromRow);
  }
  function put(tripId,id,content,{expectedRevision,now}={}) {
    if(!validId(tripId)||!validId(id)||!validRevision(expectedRevision)||!iso(now))throw invalid();
    const clean=cleanContent(content);
    return database.transaction(()=>{
      const row=rowById(id),old=fromRow(row);
      if((old?.revision??0)!==expectedRevision||old&&old.tripId!==tripId)throw conflict();
      try {
        if(old)db.prepare(`UPDATE expenses SET revision=?,amount_cents=?,category_id=?,city_code=?,city_name=?,spent_date=?,note=?,updated_at=? WHERE id=? AND trip_id=? AND revision=?`)
          .run(expectedRevision+1,clean.amountCents,clean.categoryId,clean.cityCode,clean.cityName,clean.spentDate,clean.note,now,id,tripId,expectedRevision);
        else db.prepare('INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(id,tripId,1,clean.amountCents,clean.categoryId,clean.cityCode,clean.cityName,clean.spentDate,clean.note,now,now);
      }catch(error){if(error?.code==='CONFLICT'||error?.code==='VALIDATION'||error?.code==='STORAGE_CORRUPT')throw error;throw conflict();}
      const saved=get(tripId,id);if(!saved)throw conflict();return saved;
    });
  }
  function remove(tripId,id,expectedRevision) {
    if(!validId(tripId)||!validId(id)||!validRevision(expectedRevision))throw invalid();
    return database.transaction(()=>{const old=get(tripId,id);if(!old)throw missing();if(old.revision!==expectedRevision)throw conflict();
      const result=db.prepare('DELETE FROM expenses WHERE trip_id=? AND id=? AND revision=?').run(tripId,id,expectedRevision);if(result.changes!==1)throw conflict();return true;});
  }
  return {get,list,put,remove};
}
