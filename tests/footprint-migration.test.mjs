import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,prepareDatabase} from '../src/storage/database.mjs';
import {applyAiSchema} from '../src/storage/ai-schema.mjs';
import {applyExpenseSchema} from '../src/storage/expense-schema.mjs';
import {footprintTables,footprintIndexes} from '../src/storage/footprint-schema.mjs';

const baseSchema=`
CREATE TABLE metadata(version INTEGER NOT NULL); INSERT INTO metadata VALUES(1);
CREATE TABLE trips(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE trip_cities(trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(trip_id,position));
CREATE TABLE drafts(key TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,session_id TEXT NOT NULL,target_trip_id TEXT NOT NULL,base_trip_revision INTEGER NOT NULL,step TEXT NOT NULL,payload TEXT);
CREATE TABLE save_receipts(operation_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL);
`;
const NOW='2026-10-17T12:00:00.000Z';
function temporary(t) {const dir=mkdtempSync(join(tmpdir(),'travel-footprint-migration-')),path=join(dir,'travel.sqlite'),handles=[];t.after(()=>{for(const handle of handles)try{handle.close();}catch{}rmSync(dir,{recursive:true,force:true});});return {dir,path,keep(value){handles.push(value);return value;}};}
function createV3(path) {const db=new DatabaseSync(path);db.exec(baseSchema);applyAiSchema(db);applyExpenseSchema(db);return db;}
function backupFiles(dir) {return readdirSync(join(dir,'backups')).filter(name=>name.endsWith('.sqlite'));}

test('fresh v4 contains exact footprint tables and indexes',t=>{
  const fixture=temporary(t),database=fixture.keep(openDatabase(fixture.path)),db=database.db;
  assert.equal(db.prepare('SELECT version FROM metadata').get().version,4);
  const objects=new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map(row=>[row.name,row.sql]));
  for(const name of [...Object.keys(footprintTables),...Object.keys(footprintIndexes)])assert.ok(objects.has(name),name);
});

test('v3 upgrades to v4 after one verified original backup and preserves records',async t=>{
  const fixture=temporary(t),legacy=createV3(fixture.path);
  legacy.exec("INSERT INTO trips VALUES('trip-1',1,'{\"name\":\"保留\"}'); INSERT INTO expenses VALUES('expense-1','trip-1',1,100,'default:food','320100','南京市','2026-10-01','早餐','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')");legacy.close();
  const database=fixture.keep(await prepareDatabase(fixture.path));
  assert.equal(database.db.prepare('SELECT version FROM metadata').get().version,4);
  assert.equal(database.db.prepare('SELECT amount_cents FROM expenses').get().amount_cents,100);
  const files=backupFiles(fixture.dir);assert.equal(files.length,1);assert.match(files[0],/^pre-migration-v3-.*\.sqlite$/);
  const backup=fixture.keep(new DatabaseSync(join(fixture.dir,'backups',files[0]),{readOnly:true}));assert.equal(backup.prepare('SELECT version FROM metadata').get().version,3);
});

test('failed v4 ddl rolls back every footprint object and leaves v3 data',async t=>{
  const fixture=temporary(t),legacy=createV3(fixture.path);legacy.exec("INSERT INTO trips VALUES('trip-1',1,'{}')");legacy.close();
  await assert.rejects(prepareDatabase(fixture.path,{applyFootprintMigration(db){db.exec('CREATE TABLE partial_footprint(id TEXT)');throw new Error('fixture');}}),error=>error.code==='STORAGE_MIGRATION_FAILED');
  const db=new DatabaseSync(fixture.path,{readOnly:true});try{assert.equal(db.prepare('SELECT version FROM metadata').get().version,3);assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='partial_footprint'").get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM trips').get().n,1);}finally{db.close();}
});

test('backup failure leaves v3 source bytes unchanged',async t=>{
  const fixture=temporary(t),legacy=createV3(fixture.path);legacy.close();const before=readFileSync(fixture.path);
  await assert.rejects(prepareDatabase(fixture.path,{backupImpl:async()=>{throw new Error('no space');}}),error=>error.code==='STORAGE_BACKUP_FAILED');
  assert.deepEqual(readFileSync(fixture.path),before);
});

test('suppression cascades but linked visit restricts trip deletion until detached',t=>{
  const fixture=temporary(t),database=fixture.keep(openDatabase(fixture.path)),db=database.db;
  db.exec(`INSERT INTO trips VALUES('trip-1',1,'{}');
    INSERT INTO footprint_suppressions VALUES('trip-1','320500','${NOW}','op-suppress');
    INSERT INTO footprint_visits VALUES('auto-1',1,'320100','南京市','320000','江苏省','trip_range','2026-10-01','2026-10-02','trip','trip-1','金陵行','','${NOW}','${NOW}');`);
  assert.throws(()=>db.exec("DELETE FROM trips WHERE id='trip-1'"));
  db.exec("UPDATE footprint_visits SET source='detached',linked_trip_id=NULL WHERE id='auto-1'; DELETE FROM trips WHERE id='trip-1'");
  assert.equal(db.prepare('SELECT source FROM footprint_visits').get().source,'detached');
  assert.equal(db.prepare('SELECT count(*) AS n FROM footprint_suppressions').get().n,0);
});
