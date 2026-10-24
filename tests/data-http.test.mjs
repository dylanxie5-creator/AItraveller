import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../src/start.mjs';
import {createAiSettingsStore} from '../src/storage/ai-settings-store.mjs';
import {StoreError} from '../src/storage/errors.mjs';
import {prepare} from './helpers/database.mjs';
import {request} from './helpers/http-client.mjs';
import {streamUpload} from '../src/server/request-guards.mjs';

const protector={async protect(value){return `cipher:${value}`;},async unprotect(value){return value.slice(7);}};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function aiFactory({database}) {return {settings:createAiSettingsStore(database,{protector}),jobs:{recover(){},async shutdown(){},list(){return [];},get(){return null;},async submit(){}},plans:{list(){return [];},get(){return null;},update(){},convert(){},forTrip(){return null;}}};}
async function app(t,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'travel-data-http-')),path=join(dir,'travel.sqlite');
  const running=await startServer({dbPath:path,port:0,aiFactory,...options});
  t.after(async()=>{await running.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,path,running,url:running.url};
}

test('data API lists safe summary and creates a durable manual backup',async t=>{
  const {running,url}=await app(t);const current=running.runtime.current();
  current.service.saveTrip('trip-a',prepare(current.service,'trip-a'));
  current.database.db.prepare("INSERT INTO map_settings VALUES(1,1,?)").run(JSON.stringify({provider:'amap',keyCipher:'cipher:DO-NOT-EXPOSE',securityCipher:'cipher:DO-NOT-EXPOSE'}));

  const created=await request(url,{path:'/api/data/backups',method:'POST',body:{note:'出发前'}});
  const listed=await request(url,{path:'/api/data/backups'});

  assert.equal(created.status,201);assert.equal(created.json.data.kind,'manual');assert.equal(created.json.data.note,'出发前');
  assert.equal(listed.status,200);assert.ok(listed.json.data.databaseSizeBytes>0);assert.equal(listed.json.data.backupCount,2);
  assert.equal(listed.json.data.backups[0].id,created.json.data.id);assert.match(listed.json.data.lastAutomaticAt,/^2026-|^2027-/);
  assert.equal(listed.json.data.warning,null);
  for(const secret of ['DO-NOT-EXPOSE','keyCipher','securityCipher','apiKey'])assert.equal(listed.text.includes(secret),false);
});

test('manual backup validates notes and download streams exact SQLite bytes with safe headers',async t=>{
  const {url}=await app(t);
  const invalid=await request(url,{path:'/api/data/backups',method:'POST',body:{note:'旅'.repeat(81)}});assert.equal(invalid.status,422);
  const created=(await request(url,{path:'/api/data/backups',method:'POST',body:{note:''}})).json.data;

  const downloaded=await request(url,{path:`/api/data/backups/${created.id}/download`});

  assert.equal(downloaded.status,200);assert.equal(downloaded.headers['content-type'],'application/vnd.sqlite3');
  assert.match(downloaded.headers['content-disposition'],/^attachment; filename="travel-backup-[0-9]{8}-[0-9]{6}\.sqlite"$/);
  assert.equal(Number(downloaded.headers['content-length']),downloaded.buffer.length);assert.equal(downloaded.buffer.subarray(0,16).toString(),'SQLite format 3\0');
  assert.equal(downloaded.headers['cache-control'],'no-store');assert.equal(downloaded.text.includes('travel-data-http-'),false);
});

test('restore endpoint switches every later HTTP request to restored services',async t=>{
  const {running,url}=await app(t);let current=running.runtime.current();
  current.service.saveTrip('trip-a',prepare(current.service,'trip-a'));const backup=await current.backups.create('manual',{note:'状态 A'});
  current.service.deleteTrip('trip-a',1);current.service.saveTrip('trip-b',prepare(current.service,'trip-b'));

  const rejected=await request(url,{path:`/api/data/backups/${backup.id}/restore`,method:'POST',body:{confirmation:'错误'}});
  const restored=await request(url,{path:`/api/data/backups/${backup.id}/restore`,method:'POST',body:{confirmation:'恢复数据'}});
  const trips=await request(url,{path:'/api/trips'});

  assert.equal(rejected.status,422);assert.equal(restored.status,200);assert.equal(restored.json.data.restoredFrom,backup.id);
  assert.equal(restored.json.data.safetyBackup.kind,'pre-restore');assert.deepEqual(trips.json.data.map(item=>item.id),['trip-a']);
});

test('backup routes reject unknown unsafe and untrusted requests without revealing paths',async t=>{
  const {url}=await app(t);
  for(const path of ['/api/data/backups/11111111-1111-4111-8111-111111111111/download','/api/data/backups/not-an-id/download','/api/data/backups/%2e%2e%2ftravel.sqlite/download']) {
    const response=await request(url,{path});assert.equal(response.status,404,path);assert.equal(response.text.includes('travel-data-http-'),false);
  }
  const badOrigin=await request(url,{path:'/api/data/backups',method:'POST',body:{note:''},headers:{Origin:'http://evil.test'}});assert.equal(badOrigin.status,403);
  const badHost=await request(url,{path:'/api/data/backups',headers:{Host:'evil.test'}});assert.equal(badHost.status,403);
});

test('a downloaded backup imports through the binary endpoint as a new verified record',async t=>{
  const uploadDirectory=mkdtempSync(join(tmpdir(),'travel-upload-'));t.after(()=>rmSync(uploadDirectory,{recursive:true,force:true}));
  const {url}=await app(t,{uploadDirectory});
  const original=(await request(url,{path:'/api/data/backups',method:'POST',body:{note:'原始'}})).json.data;
  const downloaded=await request(url,{path:`/api/data/backups/${original.id}/download`});

  const imported=await request(url,{path:'/api/data/backups/import',method:'POST',body:downloaded.buffer,headers:{'Content-Type':'application/vnd.sqlite3'}});

  assert.equal(imported.status,201);assert.equal(imported.json.data.kind,'manual');assert.equal(imported.json.data.note,'导入的备份');
  assert.equal(imported.json.data.fingerprint,original.fingerprint);assert.notEqual(imported.json.data.id,original.id);
  assert.deepEqual(readdirSync(uploadDirectory),[]);
});

test('binary import rejects wrong type corrupt foreign and oversized bodies without leftovers',async t=>{
  const uploadDirectory=mkdtempSync(join(tmpdir(),'travel-upload-reject-')),smallDirectory=mkdtempSync(join(tmpdir(),'travel-upload-small-'));
  t.after(()=>{rmSync(uploadDirectory,{recursive:true,force:true});rmSync(smallDirectory,{recursive:true,force:true});});
  const {dir,url}=await app(t,{uploadDirectory});
  const foreignPath=join(dir,'foreign.sqlite'),foreign=new DatabaseSync(foreignPath);foreign.exec('CREATE TABLE unrelated(value TEXT)');foreign.close();
  const cases=[
    [{body:Buffer.from('bad'),headers:{'Content-Type':'text/plain'}},415],
    [{body:Buffer.from('bad'),headers:{'Content-Type':'application/vnd.sqlite3'}},422],
    [{body:readFileSync(foreignPath),headers:{'Content-Type':'application/vnd.sqlite3'}},422],
  ];
  for(const [options,status] of cases) {
    const response=await request(url,{path:'/api/data/backups/import',method:'POST',...options});assert.equal(response.status,status);
    assert.equal(response.text.includes(dir),false);assert.deepEqual(readdirSync(uploadDirectory),[]);
  }
  const small=await app(t,{uploadDirectory:smallDirectory,uploadLimit:32});
  const oversized=await request(small.url,{path:'/api/data/backups/import',method:'POST',body:Buffer.alloc(33),headers:{'Content-Type':'application/vnd.sqlite3'}});
  assert.equal(oversized.status,413);assert.deepEqual(readdirSync(smallDirectory),[]);
});

test('streamUpload deletes its opaque partial file when the request aborts',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'travel-upload-abort-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const requestBody=Readable.from((async function*(){yield Buffer.from('SQLite');throw new Error('client disconnected with private details');})());
  await assert.rejects(streamUpload(requestBody,{directory,maxBytes:1024,createId:()=> '11111111-1111-4111-8111-111111111111'}),error=>error.code==='UPLOAD_INCOMPLETE');
  assert.deepEqual(readdirSync(directory),[]);
});

test('HTTP writes racing with restore receive a stable busy response',async t=>{
  const {running,url}=await app(t),entered=deferred(),release=deferred();
  const restoring=running.runtime.coordinator.runRestore(async()=>{entered.resolve();await release.promise;});await entered.promise;

  const response=await request(url,{path:'/api/data/backups',method:'POST',body:{note:'不能执行'}});

  assert.equal(response.status,503);assert.deepEqual(response.json.error,{code:'DATA_RESTORE_IN_PROGRESS',message:'正在恢复数据，请稍后重试'});
  assert.equal(running.runtime.current().backups.list().some(item=>item.note==='不能执行'),false);
  release.resolve();await restoring;
});

test('restore and storage failures expose no raw diagnostics and keep original data queryable',async t=>{
  const {dir,running,url}=await app(t),current=running.runtime.current();current.service.saveTrip('trip-a',prepare(current.service,'trip-a'));
  const raw=`RAW SQLITE ${dir} apiKey=secret`;
  running.runtime.restore=async()=>{const error=new StoreError('DATA_RESTORE_FAILED',raw);error.cause=new Error(raw);throw error;};

  const restore=await request(url,{path:'/api/data/backups/11111111-1111-4111-8111-111111111111/restore',method:'POST',body:{confirmation:'恢复数据'}});
  current.backups.create=async()=>{throw new StoreError('DATA_BACKUP_FAILED',raw);};
  const create=await request(url,{path:'/api/data/backups',method:'POST',body:{note:''}});
  const trips=await request(url,{path:'/api/trips'});

  assert.equal(restore.status,503);assert.deepEqual(restore.json.error,{code:'DATA_RESTORE_FAILED',message:'无法恢复数据，原数据已保留'});
  assert.equal(create.status,503);assert.deepEqual(create.json.error,{code:'DATA_BACKUP_FAILED',message:'无法创建完整的数据备份'});
  assert.equal(restore.text.includes(raw),false);assert.equal(create.text.includes(raw),false);
  assert.deepEqual(trips.json.data.map(item=>item.id),['trip-a']);
});
