import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {acquireDatabaseLock} from '../src/platform/database-lock.mjs';
import {startServer} from '../src/start.mjs';
import {openDatabase} from '../src/storage/database.mjs';

const cleanups=new WeakMap();
function fixture(t) {const dir=mkdtempSync(join(tmpdir(),'travel-lock-'));const callbacks=[];cleanups.set(t,callbacks);t.after(async()=>{try{for(const callback of callbacks.reverse())await callback();}finally{rmSync(dir,{recursive:true,force:true});}});return join(dir,'travel.sqlite');}
function cleanup(t,callback) {cleanups.get(t).push(callback);}
function bounded(promise) {let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('event timeout')),15000);})]).finally(()=>clearTimeout(timer));}

test('real Windows helper rejects equivalent paths; stale file and intentional repeated release are safe',async t=>{
  const path=fixture(t);writeFileSync(path+'.owner.lock','stale');
  const lock=await acquireDatabaseLock(path);cleanup(t,()=>lock.release());let lost=false;lock.lost.then(()=>{lost=true;});
  await assert.rejects(acquireDatabaseLock(resolve(path).toUpperCase()),e=>e.code==='DATABASE_IN_USE');
  await assert.rejects(acquireDatabaseLock(join(path,'..','travel.sqlite')),e=>e.code==='DATABASE_IN_USE');
  await lock.release();await lock.release();assert.equal(lost,false);
  const next=await acquireDatabaseLock(path);await next.release();
});
test('unexpected helper death signals ownership loss and permits reacquisition',async t=>{
  const path=fixture(t);let helper;
  const lock=await acquireDatabaseLock(path,{spawnImpl(...args){helper=spawn(...args);return helper;}});cleanup(t,()=>lock.release());
  helper.kill();await bounded(lock.lost);await lock.release();
  const next=await acquireDatabaseLock(path);await next.release();
});
test('owner process crash closes helper stdin and releases OS lock',async t=>{
  const path=fixture(t);const module=pathToFileURL(resolve('src/platform/database-lock.mjs')).href;
  const code=`import {acquireDatabaseLock} from ${JSON.stringify(module)};await acquireDatabaseLock(${JSON.stringify(path)});console.log('READY');`;
  const owner=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  cleanup(t,async()=>{if(owner.exitCode===null&&owner.signalCode===null){const exit=once(owner,'exit');owner.kill();await bounded(exit);}});
  await bounded(new Promise((res,rej)=>{owner.stdout.on('data',data=>{if(data.toString().includes('READY'))res();});owner.once('error',rej);owner.once('exit',()=>rej(new Error('owner exited before ready')));}));
  const exited=once(owner,'exit');owner.kill();await bounded(exited);
  // Wait for the orphan helper's EOF cleanup using bounded attempts, not deleting its lock file.
  let next;for(let i=0;i<50;i++){try{next=await acquireDatabaseLock(path);break;}catch(error){if(error.code!=='DATABASE_IN_USE')throw error;}}
  assert.ok(next);await next.release();
});
test('two server ports cannot own the same database and normal close is idempotent',async t=>{
  const path=fixture(t);const first=await startServer({dbPath:path,port:0});cleanup(t,()=>first.close());
  const before=readFileSync(path);await assert.rejects(startServer({dbPath:path.toUpperCase(),port:0}),e=>e.code==='DATABASE_IN_USE');assert.deepEqual(readFileSync(path),before);
  assert.equal((await fetch(first.url+'/api/trips')).status,200);
  await first.close();await first.close();const next=await startServer({dbPath:path,port:0});await next.close();
});
test('helper death shuts down listening service and aborts its external-work signal',async t=>{
  const path=fixture(t);let helper;
  const running=await startServer({dbPath:path,port:0,lockFactory:p=>acquireDatabaseLock(p,{spawnImpl(...args){helper=spawn(...args);return helper;}})});cleanup(t,()=>running.close());
  helper.kill();await bounded(running.closed);assert.equal(running.server.listening,false);assert.equal(running.signal.aborted,true);
  await assert.rejects(fetch(running.url+'/api/trips'));
  const next=await acquireDatabaseLock(path);await next.release();
});
test('actual command-line server exits nonzero after its helper dies',async t=>{
  const path=fixture(t);
  const owner=spawn(process.execPath,['src/start.mjs'],{windowsHide:true,env:{...process.env,TRAVEL_PORT:'0',TRAVEL_DB_PATH:path},stdio:['ignore','pipe','pipe']});
  cleanup(t,async()=>{if(owner.exitCode===null&&owner.signalCode===null){const exit=once(owner,'exit');owner.kill();await bounded(exit);}});
  const exited=once(owner,'exit');
  await bounded(new Promise((res,rej)=>{owner.stdout.on('data',data=>{if(data.toString().includes('http://127.0.0.1:'))res();});owner.once('error',rej);owner.once('exit',()=>rej(new Error('server exited before ready')));}));
  const lookup=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${owner.pid}' | Where-Object Name -eq 'powershell.exe' | Select-Object -ExpandProperty ProcessId`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';lookup.stdout.on('data',data=>{output+=data;});lookup.stderr.resume();await bounded(once(lookup,'exit'));
  const helperPid=Number(output.trim());assert.ok(Number.isSafeInteger(helperPid)&&helperPid>0);process.kill(helperPid);
  const [code]=await bounded(exited);assert.equal(code,1);
  const next=await acquireDatabaseLock(path);await next.release();
});
test('database validation failure releases helper and never overwrites bad data',async t=>{
  const path=fixture(t);writeFileSync(path,'bad db');const before=readFileSync(path);
  await assert.rejects(startServer({dbPath:path,port:0}),e=>e.code==='STORAGE_CORRUPT');assert.deepEqual(readFileSync(path),before);
  const next=await acquireDatabaseLock(path);await next.release();
});
test('port binding failure releases database and helper',async t=>{
  const path=fixture(t);const occupied=createServer();await new Promise(res=>occupied.listen(0,'127.0.0.1',res));cleanup(t,()=>new Promise(res=>occupied.close(res)));
  await assert.rejects(startServer({dbPath:path,port:occupied.address().port}),e=>e.code==='EADDRINUSE');
  const next=await startServer({dbPath:path,port:0});await next.close();
});
test('ownership lost during startup cannot produce a running server',async t=>{
  const path=fixture(t);let released=0;
  await assert.rejects(startServer({dbPath:path,port:0,lockFactory:async()=>({lost:Promise.resolve(),async release(){released++;}})}),e=>e.code==='DATABASE_LOCK_LOST');
  assert.equal(released,1);
});
test('junction aliases share the real database owner lock',async t=>{
  const path=fixture(t);const real=join(dirname(path),'real');mkdirSync(real);const alias=join(dirname(path),'alias');symlinkSync(real,alias,'junction');
  const first=await startServer({dbPath:join(real,'travel.sqlite'),port:0});cleanup(t,()=>first.close());
  await assert.rejects(startServer({dbPath:join(alias,'travel.sqlite'),port:0}),e=>e.code==='DATABASE_IN_USE');await first.close();
});
for(const mode of ['backup','migration'])test(`${mode} startup failure releases the real helper`,async t=>{
  const path=fixture(t);const original=openDatabase(path);
  original.db.exec('DROP TABLE ai_settings;DROP TABLE ai_jobs;DROP TABLE ai_plans;DROP TABLE ai_conversions;UPDATE metadata SET version=1');
  if(mode==='migration')original.db.exec('CREATE VIEW ai_settings AS SELECT 1');original.close();
  if(mode==='backup')writeFileSync(join(dirname(path),'backups'),'not a directory');
  const before=readFileSync(path);
  await assert.rejects(startServer({dbPath:path,port:0}),e=>e.code===(mode==='backup'?'STORAGE_BACKUP_FAILED':'STORAGE_MIGRATION_FAILED'));
  assert.deepEqual(readFileSync(path),before);const next=await acquireDatabaseLock(path);await next.release();
});
test('helper spawn failure returns a controlled error without claiming ownership',async t=>{
  const path=fixture(t);await assert.rejects(acquireDatabaseLock(path,{spawnImpl:()=>spawn(join(dirname(path),'missing-helper.exe'),[],{windowsHide:true,stdio:['pipe','pipe','pipe']})}),e=>e.code==='DATABASE_LOCK_UNAVAILABLE');
  const next=await acquireDatabaseLock(path);await next.release();
});
