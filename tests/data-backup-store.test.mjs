import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDataBackupStore} from '../src/storage/data-backup-store.mjs';
import {openDatabase,validateDatabase} from '../src/storage/database.mjs';
import {setup,prepare} from './helpers/database.mjs';

const ids=[
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

function factory(database,path,{times=['2026-10-24T08:00:00.000Z'],idValues=ids,backupImpl}={}) {
  let time=0,id=0;
  return createDataBackupStore({
    dbPath:path,
    getDatabase:()=>database,
    clock:()=>new Date(times[Math.min(time++,times.length-1)]),
    createId:()=>idValues[id++],
    ...(backupImpl?{backupImpl}:{}),
  });
}

test('manual snapshot contains committed project data and persists a verified catalog record',async t=>{
  const {path,database,service}=setup(t);
  service.saveTrip('trip-1',prepare(service));
  const store=factory(database,path);

  const record=await store.create('manual',{note:'出发前'});

  assert.deepEqual(record,{
    id:ids[0],kind:'manual',createdAt:'2026-10-24T08:00:00.000Z',
    sizeBytes:record.sizeBytes,note:'出发前',fingerprint:record.fingerprint,
  });
  assert.ok(record.sizeBytes>0);assert.match(record.fingerprint,/^[a-f0-9]{64}$/);
  const resolved=store.resolve(record.id);assert.equal(resolved.path,join(path.slice(0,-'travel.sqlite'.length),'backups','data',`${record.id}.sqlite`));
  const saved=new DatabaseSync(resolved.path,{readOnly:true});
  try {
    assert.equal(validateDatabase(saved),4);
    assert.equal(saved.prepare("SELECT count(*) AS n FROM trips WHERE id='trip-1'").get().n,1);
    assert.equal(saved.prepare('PRAGMA quick_check').get().quick_check,'ok');
  } finally {saved.close();}
  const reopened=factory(database,path,{idValues:[ids[1]]});
  assert.deepEqual(reopened.list(),[record]);
});

test('catalog orders newest first and rejects overlong or unsupported metadata before writing',async t=>{
  const {path,database}=setup(t);
  const store=factory(database,path,{times:['2026-10-24T08:00:00.000Z','2026-10-24T09:00:00.000Z']});
  const first=await store.create('manual',{note:'较早'});
  const second=await store.create('pre-restore',{note:''});
  assert.deepEqual(store.list().map(item=>item.id),[second.id,first.id]);
  await assert.rejects(store.create('manual',{note:'旅'.repeat(81)}),error=>error.code==='VALIDATION');
  await assert.rejects(store.create('other',{note:''}),error=>error.code==='VALIDATION');
  assert.equal(store.list().length,2);
});

test('foreign imports and failed snapshots leave no managed partial artifacts',async t=>{
  const {dir,path,database}=setup(t);const foreign=join(dir,'foreign.sqlite');
  const raw=new DatabaseSync(foreign);raw.exec('CREATE TABLE unrelated(value TEXT)');raw.close();
  const failed=factory(database,path,{backupImpl:async(_db,target)=>{writeFileSync(target,'not sqlite');}});

  await assert.rejects(failed.create('manual',{note:''}),error=>error.code==='DATA_BACKUP_FAILED');
  await assert.rejects(failed.importFile(foreign,{note:'外部文件'}),error=>error.code==='DATA_BACKUP_INVALID');

  const managed=join(dir,'backups','data');
  assert.ok(existsSync(foreign));
  assert.deepEqual(existsSync(managed)?readdirSync(managed):[],[]);
});

test('a valid exported file can be imported as a new manual backup',async t=>{
  const {path,database,service}=setup(t);service.saveTrip('trip-1',prepare(service));
  const store=factory(database,path);
  const original=await store.create('manual',{note:'原件'});

  const imported=await store.importFile(store.resolve(original.id).path,{note:'重新导入'});

  assert.equal(imported.id,ids[1]);assert.equal(imported.kind,'manual');assert.equal(imported.note,'重新导入');
  assert.equal(imported.fingerprint,original.fingerprint);
  assert.deepEqual(store.list().map(item=>item.id),[imported.id,original.id]);
});

test('tampered metadata or backup bytes are never listed or resolved',async t=>{
  const {dir,path,database}=setup(t);const store=factory(database,path);
  const first=await store.create('manual',{note:'元数据'});
  const metadataPath=join(dir,'backups','data',`${first.id}.json`);
  const metadata=JSON.parse(readFileSync(metadataPath,'utf8'));metadata.fingerprint='0'.repeat(64);writeFileSync(metadataPath,JSON.stringify(metadata));
  assert.deepEqual(store.list(),[]);
  assert.throws(()=>store.resolve(first.id),error=>error.code==='DATA_BACKUP_INVALID');

  const second=await store.create('manual',{note:'文件'});
  const backupPath=join(dir,'backups','data',`${second.id}.sqlite`);writeFileSync(backupPath,'broken');
  assert.deepEqual(store.list(),[]);
  assert.throws(()=>store.resolve(second.id),error=>error.code==='DATA_BACKUP_INVALID');
});

test('unknown and path-like identities cannot escape the managed directory',t=>{
  const {path,database}=setup(t);const store=factory(database,path);
  for(const id of ['missing','../travel.sqlite','%2e%2e%2ftravel.sqlite'])assert.throws(()=>store.resolve(id),error=>error.code==='NOT_FOUND');
});

test('automatic backup starts once and observes the exact 24 hour boundary',async t=>{
  const {path,database}=setup(t);let now=Date.parse('2026-10-01T00:00:00.000Z'),sequence=1;
  const store=createDataBackupStore({dbPath:path,getDatabase:()=>database,clock:()=>new Date(now),createId:()=>`${String(sequence++).padStart(8,'0')}-0000-4000-8000-000000000000`});

  const first=await store.ensureAutomatic();
  now+=86_399_000;const early=await store.ensureAutomatic();
  now+=1_000;const boundary=await store.ensureAutomatic();

  assert.equal(first.created,true);assert.equal(first.record.createdAt,'2026-10-01T00:00:00.000Z');
  assert.deepEqual(early,{created:false,record:first.record});
  assert.equal(boundary.created,true);assert.equal(boundary.record.createdAt,'2026-10-02T00:00:00.000Z');
  assert.equal(store.list().filter(item=>item.kind==='auto').length,2);
});

test('automatic rotation keeps newest fourteen autos and never touches durable or migration backups',async t=>{
  const {dir,path,database}=setup(t);let now=Date.parse('2026-10-01T00:00:00.000Z'),sequence=1;
  const store=createDataBackupStore({dbPath:path,getDatabase:()=>database,clock:()=>new Date(now),createId:()=>`${String(sequence++).padStart(8,'0')}-0000-4000-8000-000000000000`});
  const manual=await store.create('manual',{note:'长期保留'}),pre=await store.create('pre-restore',{note:'恢复前'});
  const migration=join(dir,'backups','pre-migration-v3-safe.sqlite');writeFileSync(migration,'legacy migration evidence');

  const autos=[];
  for(let day=0;day<15;day++) {now=Date.parse('2026-10-01T00:00:00.000Z')+day*86_400_000;autos.push((await store.ensureAutomatic()).record);}

  const listed=store.list();const kept=listed.filter(item=>item.kind==='auto');
  assert.equal(kept.length,14);assert.ok(!kept.some(item=>item.id===autos[0].id));assert.ok(kept.some(item=>item.id===autos[14].id));
  assert.ok(listed.some(item=>item.id===manual.id));assert.ok(listed.some(item=>item.id===pre.id));assert.ok(existsSync(migration));
  assert.ok(!existsSync(join(dir,'backups','data',`${autos[0].id}.sqlite`)));
  assert.ok(!existsSync(join(dir,'backups','data',`${autos[0].id}.json`)));
});

test('remove deletes only an exact managed backup pair',async t=>{
  const {path,database}=setup(t);const store=factory(database,path);
  const first=await store.create('manual',{note:''}),second=await store.create('manual',{note:''});
  store.remove(first.id);
  assert.deepEqual(store.list().map(item=>item.id),[second.id]);
  assert.throws(()=>store.remove('../travel.sqlite'),error=>error.code==='NOT_FOUND');
});

test('databases beside each other keep independent backup catalogs',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-backup-catalogs-'));
  const firstPath=join(dir,'primary.sqlite'),secondPath=join(dir,'qa.sqlite');
  const firstDatabase=openDatabase(firstPath),secondDatabase=openDatabase(secondPath);
  t.after(()=>{firstDatabase.close();secondDatabase.close();rmSync(dir,{recursive:true,force:true});});
  const first=factory(firstDatabase,firstPath,{idValues:[ids[0]]});
  const second=factory(secondDatabase,secondPath,{idValues:[ids[1]]});

  const firstRecord=await first.create('manual',{note:'正式数据'});
  assert.deepEqual(second.list(),[]);
  const secondRecord=await second.create('manual',{note:'验收数据'});

  assert.deepEqual(first.list().map(item=>item.id),[firstRecord.id]);
  assert.deepEqual(second.list().map(item=>item.id),[secondRecord.id]);
  assert.throws(()=>first.resolve(secondRecord.id),error=>error.code==='NOT_FOUND');
});
