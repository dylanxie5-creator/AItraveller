import {DatabaseSync} from 'node:sqlite';
import {StoreError,corrupt} from './errors.mjs';
const schema=`
CREATE TABLE metadata(version INTEGER NOT NULL);
INSERT INTO metadata VALUES(1);
CREATE TABLE trips(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE trip_cities(trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(trip_id,position));
CREATE TABLE drafts(key TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,session_id TEXT NOT NULL,target_trip_id TEXT NOT NULL,base_trip_revision INTEGER NOT NULL,step TEXT NOT NULL,payload TEXT);
CREATE TABLE save_receipts(operation_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL);
`;
export function openDatabase(path) {
  let db;
  try {
    db=new DatabaseSync(path,{timeout:1000});
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if(!tables.length) {db.exec('BEGIN IMMEDIATE');try{db.exec(schema);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
    else {
      if(!tables.some(t=>t.name==='metadata')) throw corrupt();
      const rows=db.prepare('SELECT version FROM metadata').all();
      if(rows.length!==1||!Number.isSafeInteger(rows[0].version)) throw corrupt();
      if(rows[0].version!==1) throw new StoreError('STORAGE_VERSION','此数据版本暂不支持，请勿覆盖');
      if(['trips','trip_cities','drafts','save_receipts'].some(name=>!tables.some(t=>t.name===name))) throw corrupt();
      if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok') throw corrupt();
    }
    db.exec('PRAGMA foreign_keys=ON');
    if(db.prepare('PRAGMA foreign_key_check').all().length) throw corrupt();
  } catch(error) {try{db?.close();}catch{} throw error instanceof StoreError?error:corrupt();}
  let closed=false;let inTransaction=false;
  return {db,transaction(fn){
    if(inTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');inTransaction=true;
    try {const result=fn();db.exec('COMMIT');return result;} catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{inTransaction=false;}
  },close(){if(!closed){db.close();closed=true;}}};
}
