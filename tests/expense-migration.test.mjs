import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,prepareDatabase} from '../src/storage/database.mjs';
import {applyAiSchema} from '../src/storage/ai-schema.mjs';
import {expenseTables,expenseIndexes} from '../src/storage/expense-schema.mjs';

const baseSchema=`
CREATE TABLE metadata(version INTEGER NOT NULL); INSERT INTO metadata VALUES(1);
CREATE TABLE trips(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE trip_cities(trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(trip_id,position));
CREATE TABLE drafts(key TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,session_id TEXT NOT NULL,target_trip_id TEXT NOT NULL,base_trip_revision INTEGER NOT NULL,step TEXT NOT NULL,payload TEXT);
CREATE TABLE save_receipts(operation_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL);
`;

function temporary(t) {
  const dir=mkdtempSync(join(tmpdir(),'travel-expense-migration-'));const path=join(dir,'travel.sqlite');const handles=[];
  t.after(()=>{for(const handle of handles){if(handle instanceof DatabaseSync){if(handle.isOpen)handle.close();}else handle.close();}rmSync(dir,{recursive:true,force:true});});
  return {dir,path,keep(handle){handles.push(handle);return handle;}};
}
function createVersion(path,version) {
  const db=new DatabaseSync(path);db.exec(baseSchema);
  if(version>=2)applyAiSchema(db);
  return db;
}
function seedVersion2(t) {
  const fixture=temporary(t),db=createVersion(fixture.path,2);
  db.exec(`
    INSERT INTO trips VALUES('trip-1',1,'{"name":"保留行程"}');
    INSERT INTO drafts VALUES('new',2,'active','session-1','trip-2',0,'route','{"name":"草稿"}');
    INSERT INTO save_receipts VALUES('trip-op','trip-1','trip-hash','{"revision":1}');
    INSERT INTO ai_settings VALUES(1,7,'{"cipher":"FAKE-CIPHER"}');
    INSERT INTO ai_jobs VALUES('job-1','ai-op','ai-hash','done','{"state":"done"}');
    INSERT INTO ai_plans VALUES('plan-1',3,'{"title":"攻略"}');
    INSERT INTO ai_conversions VALUES('plan-1','trip-1','created','{"tripId":"trip-1"}');
  `);db.close();return fixture;
}
const v2Tables=['metadata','trips','trip_cities','drafts','save_receipts','ai_settings','ai_jobs','ai_plans','ai_conversions'];
function rows(db,names=v2Tables) {return Object.fromEntries(names.map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));}
function backupFiles(dir) {return readdirSync(join(dir,'backups')).filter(name=>name.endsWith('.sqlite'));}

test('fresh database is v3 with exact expense tables and indexes',t=>{
  const fixture=temporary(t),database=fixture.keep(openDatabase(fixture.path)),db=database.db;
  assert.equal(db.prepare('SELECT version FROM metadata').get().version,3);
  const objects=new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map(row=>[row.name,row.sql]));
  for(const name of Object.keys(expenseTables))assert.ok(objects.has(name),name);
  for(const name of Object.keys(expenseIndexes))assert.ok(objects.has(name),name);
});

test('v2 migrates to v3 after a verified snapshot without changing AI or trip data',async t=>{
  const fixture=seedVersion2(t),source=new DatabaseSync(fixture.path,{readOnly:true}),before=rows(source);source.close();
  const database=fixture.keep(await prepareDatabase(fixture.path));
  assert.equal(database.db.prepare('SELECT version FROM metadata').get().version,3);
  const {metadata:discardedMetadata,...preserved}=before;
  assert.deepEqual(rows(database.db,v2Tables.slice(1)),preserved);
  const files=backupFiles(fixture.dir);assert.equal(files.length,1);assert.match(files[0],/^pre-migration-v2-.*\.sqlite$/);
  const saved=fixture.keep(new DatabaseSync(join(fixture.dir,'backups',files[0]),{readOnly:true}));
  assert.equal(saved.prepare('SELECT version FROM metadata').get().version,2);assert.deepEqual(rows(saved),before);
});

test('v1 upgrades through AI and expense schemas using one original backup',async t=>{
  const fixture=temporary(t),legacy=createVersion(fixture.path,1);
  legacy.exec("INSERT INTO trips VALUES('trip-1',1,'{}')");legacy.close();
  const database=fixture.keep(await prepareDatabase(fixture.path));
  assert.equal(database.db.prepare('SELECT version FROM metadata').get().version,3);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM ai_settings').get().n,0);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM expenses').get().n,0);
  const files=backupFiles(fixture.dir);assert.equal(files.length,1);assert.match(files[0],/^pre-migration-v1-.*\.sqlite$/);
  const saved=fixture.keep(new DatabaseSync(join(fixture.dir,'backups',files[0]),{readOnly:true}));
  assert.equal(saved.prepare('SELECT version FROM metadata').get().version,1);
});

test('failed v3 ddl rolls back and preserves all v2 rows',async t=>{
  const fixture=seedVersion2(t),beforeDb=new DatabaseSync(fixture.path,{readOnly:true}),before=rows(beforeDb);beforeDb.close();
  await assert.rejects(prepareDatabase(fixture.path,{applyExpenseMigration(){throw new Error('fixture');}}),error=>error.code==='STORAGE_MIGRATION_FAILED');
  const after=new DatabaseSync(fixture.path,{readOnly:true});
  try {assert.equal(after.prepare('SELECT version FROM metadata').get().version,2);assert.deepEqual(rows(after),before);assert.equal(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='expenses'").get().n,0);}finally{after.close();}
});

test('backup failure prevents v3 ddl and leaves source bytes unchanged',async t=>{
  const fixture=seedVersion2(t),before=readFileSync(fixture.path);
  await assert.rejects(prepareDatabase(fixture.path,{backupImpl:async()=>{throw new Error('no space');}}),error=>error.code==='STORAGE_BACKUP_FAILED');
  assert.deepEqual(readFileSync(fixture.path),before);
});

test('trip deletion cascades expense category record and operation receipt',t=>{
  const fixture=temporary(t),database=fixture.keep(openDatabase(fixture.path)),db=database.db;
  db.exec(`
    INSERT INTO trips VALUES('trip-1',1,'{}');
    INSERT INTO expense_categories VALUES('custom:coffee','trip-1',1,'咖啡','咖啡','${NOW}','${NOW}');
    INSERT INTO expenses VALUES('expense-1','trip-1',1,100,'custom:coffee','320100','南京市','2026-10-10','早餐','${NOW}','${NOW}');
    INSERT INTO expense_operation_receipts VALUES('op-1','trip-1','expense','expense-1','hash','{}');
    DELETE FROM trips WHERE id='trip-1';
  `);
  for(const table of ['expense_categories','expenses','expense_operation_receipts'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,table);
});

const NOW='2026-10-09T12:00:00.000Z';
