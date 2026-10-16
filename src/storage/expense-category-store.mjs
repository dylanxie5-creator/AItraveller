import {DEFAULT_EXPENSE_CATEGORIES,normalizeCategoryName} from '../expenses/categories.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {StoreError,conflict,corrupt,missing,validId,validRevision} from './errors.mjs';

const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const validCategoryId=value=>typeof value==='string'&&/^custom:[a-zA-Z0-9_-]{1,70}$/.test(value);
const invalid=(field='name')=>new ValidationError({[field]:'分类数据无效'});
const reserved=new Set(DEFAULT_EXPENSE_CATEGORIES.map(item=>normalizeCategoryName(item.name)));

export function createExpenseCategoryStore(database) {
  const {db}=database;
  const rowById=id=>db.prepare('SELECT * FROM expense_categories WHERE id=?').get(id);
  function fromRow(row) {
    if(!row)return null;
    try {
      if(!validCategoryId(row.id)||!validId(row.trip_id)||!validRevision(row.revision)||row.revision<1||typeof row.name!=='string'||!row.name||row.name!==row.name.trim()||
        row.normalized_name!==normalizeCategoryName(row.name)||reserved.has(row.normalized_name)||!iso(row.created_at)||!iso(row.updated_at))throw corrupt();
      return {id:row.id,tripId:row.trip_id,revision:row.revision,name:row.name,normalizedName:row.normalized_name,createdAt:row.created_at,updatedAt:row.updated_at};
    }catch(error){if(error?.code==='STORAGE_CORRUPT')throw error;throw corrupt();}
  }
  function get(tripId,id) {
    if(!validId(tripId)||!validCategoryId(id))throw invalid();
    return fromRow(db.prepare('SELECT * FROM expense_categories WHERE trip_id=? AND id=?').get(tripId,id));
  }
  function list(tripId) {
    if(!validId(tripId))throw invalid('tripId');
    return db.prepare('SELECT * FROM expense_categories WHERE trip_id=? ORDER BY created_at,id').all(tripId).map(fromRow);
  }
  function put(tripId,id,name,{expectedRevision,now}={}) {
    const cleanName=typeof name==='string'?name.trim():'';const normalizedName=normalizeCategoryName(cleanName);
    if(!validId(tripId)||!validCategoryId(id)||!validRevision(expectedRevision)||!iso(now)||!cleanName||!normalizedName||reserved.has(normalizedName))throw invalid();
    return database.transaction(()=>{
      const old=fromRow(rowById(id));if((old?.revision??0)!==expectedRevision||old&&old.tripId!==tripId)throw conflict();
      const duplicate=db.prepare('SELECT id FROM expense_categories WHERE trip_id=? AND normalized_name=? AND id<>?').get(tripId,normalizedName,id);if(duplicate)throw conflict();
      try {
        if(old)db.prepare('UPDATE expense_categories SET revision=?,name=?,normalized_name=?,updated_at=? WHERE id=? AND trip_id=? AND revision=?').run(expectedRevision+1,cleanName,normalizedName,now,id,tripId,expectedRevision);
        else db.prepare('INSERT INTO expense_categories VALUES(?,?,?,?,?,?,?)').run(id,tripId,1,cleanName,normalizedName,now,now);
      }catch(error){if(error?.code==='CONFLICT'||error?.code==='VALIDATION'||error?.code==='STORAGE_CORRUPT')throw error;throw conflict();}
      const saved=get(tripId,id);if(!saved)throw conflict();return saved;
    });
  }
  function usageCount(tripId,id) {
    if(!validId(tripId)||!validCategoryId(id))throw invalid();
    return db.prepare('SELECT count(*) AS n FROM expenses WHERE trip_id=? AND category_id=?').get(tripId,id).n;
  }
  function remove(tripId,id,expectedRevision) {
    if(!validId(tripId)||!validCategoryId(id)||!validRevision(expectedRevision))throw invalid();
    return database.transaction(()=>{const old=get(tripId,id);if(!old)throw missing();if(old.revision!==expectedRevision)throw conflict();
      if(usageCount(tripId,id)>0)throw new StoreError('CATEGORY_IN_USE','该分类正在使用，请先修改相关花销');
      const result=db.prepare('DELETE FROM expense_categories WHERE trip_id=? AND id=? AND revision=?').run(tripId,id,expectedRevision);if(result.changes!==1)throw conflict();return true;});
  }
  return {get,list,put,usageCount,remove};
}
