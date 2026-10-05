import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {openDatabase,prepareDatabase} from '../src/storage/database.mjs';
import {applyAiSchema} from '../src/storage/ai-schema.mjs';
import {createTravelService} from '../src/services/travel-service.mjs';
import {input} from './helpers/fixtures.mjs';

function fixture(t,{version=1}={}) {
  const dir=mkdtempSync(join(tmpdir(),'travel-migration-'));const path=join(dir,'travel.sqlite');
  const handles=[];t.after(()=>{for(const handle of handles){if(handle instanceof DatabaseSync){if(handle.isOpen)handle.close();}else handle.close();}rmSync(dir,{recursive:true,force:true});});
  const db=new DatabaseSync(path);
  db.exec(`CREATE TABLE metadata(version INTEGER NOT NULL); INSERT INTO metadata VALUES(${version});
    CREATE TABLE trips(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE trip_cities(trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(trip_id,position));
    CREATE TABLE drafts(key TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,session_id TEXT NOT NULL,target_trip_id TEXT NOT NULL,base_trip_revision INTEGER NOT NULL,step TEXT NOT NULL,payload TEXT);
    CREATE TABLE save_receipts(operation_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL);
    `);
  // Build real legacy service records, including a retriable save receipt.
  let nested=false;const database={db,transaction(fn){if(nested)return fn();db.exec('BEGIN IMMEDIATE');nested=true;try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}finally{nested=false;}}};
  const service=createTravelService({database,now:()=> '2026-10-02T12:00:00.000Z'});
  const slot=service.saveDraft('new',{expectedRevision:0,sessionId:'session-b',targetTripId:'trip-1',baseTripRevision:0,step:'confirm',input:input()});
  const command={operationId:'op-1',expectedTripRevision:0,input:input(),draft:{key:'new',sessionId:slot.sessionId,revision:slot.revision}};
  service.saveTrip('trip-1',command);
  service.saveDraft('edit:trip-1',{expectedRevision:0,sessionId:'session-a',targetTripId:'trip-1',baseTripRevision:1,step:'route',input:{...input(),name:'未提交的新名称'}});
  db.close();return {dir,path,command,keep(handle){handles.push(handle);return handle;}};
}
const oldTables=['metadata','trips','trip_cities','drafts','save_receipts'];
function snapshot(db) {return oldTables.map(name=>db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all());}
function bytes(path) {return readFileSync(path);}

test('synchronous open refuses v1 without changing bytes',t=>{
  const {path}=fixture(t);const before=bytes(path);
  assert.throws(()=>openDatabase(path),e=>e.code==='STORAGE_MIGRATION_REQUIRED');assert.deepEqual(bytes(path),before);
});
test('native verified backup remains v1 and migration preserves all existing records',async t=>{
  const {path,dir,keep,command}=fixture(t);const raw=new DatabaseSync(path);const original=snapshot(raw);raw.close();
  const database=keep(await prepareDatabase(path));
  const files=readdirSync(join(dir,'backups'));assert.equal(files.length,1);assert.match(files[0],/^pre-ai-v1-.*\.sqlite$/);
  const saved=new DatabaseSync(join(dir,'backups',files[0]),{readOnly:true});
  try {assert.deepEqual(snapshot(saved),original);assert.equal(saved.prepare('PRAGMA quick_check').get().quick_check,'ok');}finally{saved.close();}
  assert.equal(database.db.prepare('SELECT version FROM metadata').get().version,2);
  assert.deepEqual(snapshot(database.db).slice(1),original.slice(1));
  const service=createTravelService({database});assert.equal(service.getTrip('trip-1').cities[1].cityName,'苏州市');
  assert.equal(service.getDraft('edit:trip-1').input.name,'未提交的新名称');assert.equal(service.getDraft('new').state,'closed');
  assert.equal(service.saveTrip('trip-1',command).revision,1);assert.equal(service.listTrips().length,1);
  database.close();const reopened=openDatabase(path);reopened.close();
});
test('fresh v2 tables enforce one active job, unique operation and conversion identities',t=>{
  const {path,keep}=fixture(t);rmSync(path);const database=keep(openDatabase(path));const db=database.db;
  assert.equal(db.prepare('SELECT version FROM metadata').get().version,2);
  db.exec(`INSERT INTO ai_settings VALUES(1,0,'{}'); INSERT INTO ai_plans VALUES('plan-1',1,'{}');
    INSERT INTO ai_jobs VALUES('job-1','op-1','hash','queued','{}')`);
  assert.throws(()=>db.exec("INSERT INTO ai_settings VALUES(2,0,'{}')"));
  assert.throws(()=>db.exec("INSERT INTO ai_jobs VALUES('job-2','op-2','hash','searching','{}')"));
  assert.throws(()=>db.exec("INSERT INTO ai_jobs VALUES('job-3','op-1','hash','done','{}')"));
  db.exec("UPDATE ai_jobs SET state='done'; INSERT INTO ai_jobs VALUES('job-2','op-2','hash','generating','{}'); INSERT INTO ai_conversions VALUES('plan-1','trip-1','saved','{}')");
  assert.throws(()=>db.exec("INSERT INTO ai_conversions VALUES('plan-1','trip-2','saved','{}')"));
  assert.throws(()=>db.exec("INSERT INTO ai_conversions VALUES('plan-2','trip-1','saved','{}')"));
  db.exec("DELETE FROM trips WHERE id='trip-1'");assert.equal(db.prepare('SELECT count(*) AS n FROM ai_plans').get().n,1);
});
for(const mode of ['throws','invalid','wrong-version','changed-source']) test(`backup ${mode} refuses migration without modifying source`,async t=>{
  const {path}=fixture(t);const before=bytes(path);
  const backupImpl=async(db,target)=>{
    if(mode==='throws')throw new Error('injected backup failure');
    if(mode==='invalid'){writeFileSync(target,'bad backup');return;}
    await backup(db,target);
    const other=new DatabaseSync(mode==='changed-source'?path:target);
    other.exec(mode==='changed-source'?"UPDATE trips SET revision=8":"UPDATE metadata SET version=3");other.close();
  };
  await assert.rejects(prepareDatabase(path,{backupImpl}),e=>e.code==='STORAGE_BACKUP_FAILED');
  if(mode==='changed-source') {const db=new DatabaseSync(path);assert.equal(db.prepare('SELECT version FROM metadata').get().version,1);assert.equal(db.prepare('SELECT revision FROM trips').get().revision,8);db.close();}
  else assert.deepEqual(bytes(path),before);
});
test('partial DDL failure rolls back schema and preserves original bytes',async t=>{
  const {path}=fixture(t);const before=bytes(path);
  await assert.rejects(prepareDatabase(path,{applyMigration(db){applyAiSchema(db);throw new Error('injected DDL failure');}}),e=>e.code==='STORAGE_MIGRATION_FAILED');
  assert.deepEqual(bytes(path),before);
});
for(const mode of ['version-3','unversioned','view-only','corrupt','missing-column'])test(`${mode} database is rejected untouched without a backup`,async t=>{
  const {path,dir}=fixture(t,{version:mode==='version-3'?3:1});
  if(mode==='corrupt')writeFileSync(path,'not sqlite');
  else if(mode!=='version-3') {const db=new DatabaseSync(path);
    if(mode==='unversioned')db.exec('DROP TABLE metadata');
    if(mode==='missing-column')db.exec('ALTER TABLE trips DROP COLUMN revision');
    if(mode==='view-only')db.exec('DROP TABLE trip_cities; DROP TABLE trips; DROP TABLE drafts; DROP TABLE save_receipts; DROP TABLE metadata; CREATE VIEW evidence AS SELECT 1');
    db.close();}
  const before=bytes(path);await assert.rejects(prepareDatabase(path),e=>e.code===(mode==='version-3'?'STORAGE_VERSION':'STORAGE_CORRUPT'));
  assert.deepEqual(bytes(path),before);assert.ok(!readdirSync(dir).includes('backups'));
});
test('v2 missing or weakened active-job index is rejected untouched',t=>{
  const {path}=fixture(t);rmSync(path);const db=openDatabase(path);db.db.exec('DROP INDEX ai_one_active_job; CREATE INDEX ai_one_active_job ON ai_jobs(state)');db.close();
  const before=bytes(path);assert.throws(()=>openDatabase(path),e=>e.code==='STORAGE_CORRUPT');assert.deepEqual(bytes(path),before);
});
test('read-only v1 refusal does not checkpoint or delete a crashed writer WAL',t=>{
  const {path}=fixture(t);const code=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(path)});db.exec("PRAGMA journal_mode=WAL;UPDATE trips SET revision=8");process.exit(0);`;
  const writer=spawnSync(process.execPath,['--input-type=module','-e',code],{windowsHide:true});assert.equal(writer.status,0);
  const before=bytes(path),wal=bytes(path+'-wal');assert.throws(()=>openDatabase(path),e=>e.code==='STORAGE_MIGRATION_REQUIRED');
  assert.deepEqual(bytes(path),before);assert.deepEqual(bytes(path+'-wal'),wal);
});
test('native backup includes committed WAL data, not only main-file bytes',async t=>{
  const {path,dir,keep}=fixture(t);const writer=keep(new DatabaseSync(path));writer.exec('PRAGMA journal_mode=WAL;UPDATE trips SET revision=8');
  const database=keep(await prepareDatabase(path));assert.equal(database.db.prepare('SELECT revision FROM trips').get().revision,8);
  const saved=keep(new DatabaseSync(join(dir,'backups',readdirSync(join(dir,'backups'))[0]),{readOnly:true}));
  assert.equal(saved.prepare('SELECT version FROM metadata').get().version,1);assert.equal(saved.prepare('SELECT revision FROM trips').get().revision,8);
});
test('failed backup artifacts are labeled partial, never as verified sqlite backups',async t=>{
  const {path,dir}=fixture(t);await assert.rejects(prepareDatabase(path,{backupImpl:async(db,target)=>writeFileSync(target,'incomplete')}));
  const files=readdirSync(join(dir,'backups'));assert.equal(files.length,1);assert.match(files[0],/\.partial$/);
});
