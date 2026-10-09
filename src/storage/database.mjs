import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {StoreError,corrupt} from './errors.mjs';
import {aiTables,activeJobIndex,applyAiSchema} from './ai-schema.mjs';
import {expenseTables,expenseIndexes,applyExpenseSchema} from './expense-schema.mjs';
import {createMigrationBackup,databaseFingerprint} from './migration-backup.mjs';
const schema=`
CREATE TABLE metadata(version INTEGER NOT NULL);
INSERT INTO metadata VALUES(1);
CREATE TABLE trips(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE trip_cities(trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(trip_id,position));
CREATE TABLE drafts(key TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,session_id TEXT NOT NULL,target_trip_id TEXT NOT NULL,base_trip_revision INTEGER NOT NULL,step TEXT NOT NULL,payload TEXT);
CREATE TABLE save_receipts(operation_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL);
`;
const baseColumns={
  metadata:['version'],trips:['id','revision','payload'],trip_cities:['trip_id','position','payload'],
  drafts:['key','revision','state','session_id','target_trip_id','base_trip_revision','step','payload'],
  save_receipts:['operation_id','trip_id','request_hash','response'],
};
const normalizedSql=sql=>sql.replace(/\s+/g,'').replace(/;$/,'').toLowerCase();
export function validateDatabase(db) {
  const objects=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  if(!objects.some(row=>row.type==='table'&&row.name==='metadata'))throw corrupt();
  const rows=db.prepare('SELECT version FROM metadata').all();
  if(rows.length!==1||!Number.isSafeInteger(rows[0].version))throw corrupt();
  const version=rows[0].version;
  if(version!==1&&version!==2&&version!==3)throw new StoreError('STORAGE_VERSION','此数据版本暂不支持，请勿覆盖');
  for(const [name,columns] of Object.entries(baseColumns)) {
    if(!objects.some(row=>row.type==='table'&&row.name===name))throw corrupt();
    const actual=db.prepare(`PRAGMA table_info(${name})`).all();
    if(columns.some(column=>!actual.some(row=>row.name===column)))throw corrupt();
  }
  if(version>=2)for(const [name,sql] of [...Object.entries(aiTables),['ai_one_active_job',activeJobIndex]]) {
    const object=objects.find(row=>row.name===name);
    if(!object?.sql||normalizedSql(object.sql)!==normalizedSql(sql))throw corrupt();
  }
  if(version>=3)for(const [name,sql] of [...Object.entries(expenseTables),...Object.entries(expenseIndexes)]) {
    const object=objects.find(row=>row.name===name);
    if(!object?.sql||normalizedSql(object.sql)!==normalizedSql(sql))throw corrupt();
  }
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw corrupt();
  return version;
}
export function openDatabase(path) {
  let db;
  try {
    // A writable connection can checkpoint a crashed WAL even without SQL writes.
    // Reject legacy/unknown/corrupt databases through a read-only probe first.
    if(existsSync(path)) {
      db=new DatabaseSync(path,{readOnly:true,timeout:1000});
      const existing=db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
      if(existing.length&&validateDatabase(db)!==3)throw new StoreError('STORAGE_MIGRATION_REQUIRED','旧数据需要先备份再升级，请使用正常启动入口');
      db.close();db=undefined;
    }
    db=new DatabaseSync(path,{timeout:1000});
    db.exec('PRAGMA foreign_keys=ON');
    const objects=db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    if(!objects.length) {db.exec('BEGIN IMMEDIATE');try{db.exec(schema);applyAiSchema(db);applyExpenseSchema(db);validateDatabase(db);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    else if(validateDatabase(db)!==3)throw new StoreError('STORAGE_MIGRATION_REQUIRED','旧数据需要先备份再升级，请使用正常启动入口');
  } catch(error) {try{db?.close();}catch{} throw error instanceof StoreError?error:corrupt();}
  let closed=false;let inTransaction=false;
  return {db,transaction(fn){
    if(inTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');inTransaction=true;
    try {const result=fn();db.exec('COMMIT');return result;} catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{inTransaction=false;}
  },close(){if(!closed){db.close();closed=true;}}};
}

export async function prepareDatabase(path,{backupImpl=backup,applyAiMigration=applyAiSchema,applyExpenseMigration=applyExpenseSchema,signal}={}) {
  signal?.throwIfAborted();
  try{return openDatabase(path);}catch(error){if(error.code!=='STORAGE_MIGRATION_REQUIRED')throw error;}
  const source=new DatabaseSync(path,{readOnly:true,timeout:1000});let db,transaction=false;
  try {
    const sourceVersion=validateDatabase(source);
    if(sourceVersion!==1&&sourceVersion!==2)throw corrupt();
    const saved=await createMigrationBackup(source,path,{backupImpl,validateDatabase,sourceVersion});
    signal?.throwIfAborted();db=new DatabaseSync(path,{timeout:1000});db.exec('PRAGMA foreign_keys=ON');db.exec('BEGIN IMMEDIATE');transaction=true;
    // An unrelated SQLite writer must not invalidate the verified snapshot.
    if(databaseFingerprint(db)!==saved.fingerprint)throw new StoreError('STORAGE_BACKUP_FAILED','备份后数据已变化，未进行升级，请重试');
    try {
      if(sourceVersion===1)applyAiMigration(db);
      if(validateDatabase(db)!==2)throw corrupt();
      applyExpenseMigration(db);
      if(validateDatabase(db)!==3)throw corrupt();signal?.throwIfAborted();
    }
    catch(error){if(signal?.aborted)throw signal.reason;throw new StoreError('STORAGE_MIGRATION_FAILED','数据升级失败，旧数据和备份已保留');}
    db.exec('COMMIT');transaction=false;
  }finally {if(transaction){try{db.exec('ROLLBACK');}catch{}}try{db?.close();}finally{source.close();}}
  return openDatabase(path);
}
