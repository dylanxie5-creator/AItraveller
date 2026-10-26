import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdtempSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMutationCoordinator} from '../src/services/mutation-coordinator.mjs';
import {createDataRuntime} from '../src/services/data-runtime.mjs';
import {createAiSettingsStore} from '../src/storage/ai-settings-store.mjs';
import {startServer} from '../src/start.mjs';
import {prepare} from './helpers/database.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('mutation coordinator lets an entered write finish before exclusive restore',async()=>{
  const coordinator=createMutationCoordinator(),release=deferred(),events=[];
  const write=coordinator.runWrite(async()=>{events.push('write-start');await release.promise;events.push('write-end');return 'written';});
  await Promise.resolve();
  const restore=coordinator.runRestore(async()=>{events.push('restore-start');return 'restored';});
  await Promise.resolve();

  assert.equal(coordinator.isRestoring(),true);
  await assert.rejects(coordinator.runWrite(()=>assert.fail('late write ran')),error=>error.code==='DATA_RESTORE_IN_PROGRESS');
  await assert.rejects(coordinator.runRestore(()=>assert.fail('second restore ran')),error=>error.code==='DATA_RESTORE_IN_PROGRESS');
  assert.deepEqual(events,['write-start']);

  release.resolve();
  assert.equal(await write,'written');assert.equal(await restore,'restored');
  assert.deepEqual(events,['write-start','write-end','restore-start']);assert.equal(coordinator.isRestoring(),false);
});

test('mutation coordinator clears exclusive state after restore rejection',async()=>{
  const coordinator=createMutationCoordinator();
  await assert.rejects(coordinator.runRestore(async()=>{throw new Error('injected restore failure');}),/injected restore failure/);
  assert.equal(coordinator.isRestoring(),false);
  assert.equal(await coordinator.runWrite(()=>42),42);
});

const protector={
  async protect(value){return `cipher:${value}`;},
  async unprotect(value){if(!value.startsWith('cipher:'))throw new Error('damaged');return value.slice(7);},
};
const aiCommand=expectedRevision=>({
  expectedRevision,
  providers:expectedRevision?{}:{deepseek:{model:'deepseek-chat',endpoint:'https://api.deepseek.com/chat/completions',keyAction:'replace',apiKey:'model-key'}},
  search:{keyMode:'separate',keyAction:expectedRevision?'retain':'replace',...(expectedRevision?{}:{apiKey:'search-key'})},
});
function aiFactory({database}) {
  return {settings:createAiSettingsStore(database,{protector}),jobs:{recover(){},async shutdown(){}},plans:{}};
}
async function runtimeFixture(t,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'travel-runtime-')),path=join(dir,'travel.sqlite');
  const runtime=createDataRuntime({dbPath:path,aiFactory,protectorFactory:()=>protector,...options});
  await runtime.start();
  t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,path,runtime};
}
const expense=(operationId='expense-op')=>({operationId,expectedRevision:0,input:{amountYuan:'88.50',categoryId:'default:food',cityCode:'320100',spentDate:'2026-10-10',note:'备份中的晚餐'}});

test('data runtime restores every service and preserves replaced data in a pre-restore backup',async t=>{
  const {runtime}=await runtimeFixture(t);let current=runtime.current();
  current.service.saveTrip('trip-a',prepare(current.service,'trip-a'));
  current.expenses.saveExpense('trip-a','expense-a',expense());
  current.footprints.syncAll();
  await current.ai.settings.update(aiCommand(0));
  const manual=await current.backups.create('manual',{note:'状态 A'});

  current.service.deleteTrip('trip-a',1);
  current.service.saveTrip('trip-b',prepare(current.service,'trip-b'));
  await current.ai.settings.update(aiCommand(1));
  assert.deepEqual(current.service.listTrips().map(item=>item.id),['trip-b']);
  assert.equal(current.ai.settings.getPublic().revision,2);

  const result=await runtime.restore(manual.id);current=runtime.current();

  assert.equal(result.restoredFrom,manual.id);assert.equal(result.safetyBackup.kind,'pre-restore');
  assert.deepEqual(current.service.listTrips().map(item=>item.id),['trip-a']);
  assert.equal(current.expenses.getOverview('trip-a').expenses[0].note,'备份中的晚餐');
  assert.equal(current.footprints.getOverview().summary.visitCount,2);
  assert.equal(current.ai.settings.getPublic().revision,1);

  const safety=current.backups.resolve(result.safetyBackup.id),saved=new DatabaseSync(safety.path,{readOnly:true});
  try {assert.deepEqual(saved.prepare('SELECT id FROM trips ORDER BY id').all().map(row=>row.id),['trip-b']);assert.equal(saved.prepare('SELECT revision FROM ai_settings WHERE id=1').get().revision,2);}
  finally{saved.close();}
});

test('failed replacement reopens original data and restores exact WAL and SHM siblings',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-runtime-rollback-')),path=join(dir,'travel.sqlite'),virtual=new Set([`${path}-wal`,`${path}-shm`]);let opens=0;
  const fileOps={
    existsSync(value){return virtual.has(value)||existsSync(value);},
    renameSync(from,to){if(virtual.delete(from)){virtual.add(to);return;}renameSync(from,to);},
    rmSync(value,options){if(virtual.delete(value))return;rmSync(value,options);},
  };
  const sometimesFails=options=>{if(++opens===2)throw new Error('injected replacement open failure');return aiFactory(options);};
  const runtime=createDataRuntime({dbPath:path,aiFactory:sometimesFails,protectorFactory:()=>protector,fileOps});
  await runtime.start();t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
  let current=runtime.current();current.service.saveTrip('trip-a',prepare(current.service,'trip-a'));const backup=await current.backups.create('manual',{note:'目标 A'});
  current.service.deleteTrip('trip-a',1);current.service.saveTrip('trip-b',prepare(current.service,'trip-b'));

  await assert.rejects(runtime.restore(backup.id),error=>error.code==='DATA_RESTORE_FAILED');

  current=runtime.current();assert.deepEqual(current.service.listTrips().map(item=>item.id),['trip-b']);
  assert.equal(current.database.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.ok(virtual.has(`${path}-wal`));assert.ok(virtual.has(`${path}-shm`));
  assert.equal([...virtual].some(value=>value.includes('.rollback-')),false);
});

test('startup attempts automatic backup but remains available with a safe warning on failure',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-runtime-auto-')),path=join(dir,'travel.sqlite');let attempts=0;
  const backupStoreFactory=()=>({async ensureAutomatic(){attempts++;throw new Error(`private path ${dir}`);}});
  const runtime=createDataRuntime({dbPath:path,aiFactory,protectorFactory:()=>protector,backupStoreFactory});
  await runtime.start();t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
  assert.equal(attempts,1);assert.ok(runtime.current().database.db.prepare('SELECT 1').get());
  assert.deepEqual(runtime.backupWarning(),{code:'DATA_BACKUP_FAILED',message:'自动备份暂未完成，请在数据安全页面重试'});
  assert.equal(JSON.stringify(runtime.backupWarning()).includes(dir),false);
});

test('server keeps database ownership while its runtime restores and releases it only on close',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-runtime-lock-')),path=join(dir,'travel.sqlite');let releases=0;
  const ownership={lost:new Promise(()=>{}),async release(){releases++;}};
  const running=await startServer({dbPath:path,port:0,lockFactory:async()=>ownership,aiFactory});
  t.after(async()=>{await running.close();rmSync(dir,{recursive:true,force:true});});
  let current=running.runtime.current();current.service.saveTrip('trip-a',prepare(current.service,'trip-a'));const backup=await current.backups.create('manual',{note:''});
  current.service.deleteTrip('trip-a',1);current.service.saveTrip('trip-b',prepare(current.service,'trip-b'));
  await running.runtime.restore(backup.id);
  assert.equal(releases,0);assert.deepEqual(running.runtime.current().service.listTrips().map(item=>item.id),['trip-a']);
  await running.close();assert.equal(releases,1);
});

test('runtime close waits for an active restore and closes the replacement context',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'travel-runtime-close-restore-')),path=join(dir,'travel.sqlite');
  const shutdownEntered=deferred(),releaseShutdown=deferred();let generation=0,replacementShutdowns=0;
  const blockingAiFactory=({database})=>{
    const currentGeneration=++generation;
    return {
      settings:createAiSettingsStore(database,{protector}),plans:{},
      jobs:{recover(){},async shutdown(){
        if(currentGeneration===1){shutdownEntered.resolve();await releaseShutdown.promise;}
        else replacementShutdowns++;
      }},
    };
  };
  const runtime=createDataRuntime({dbPath:path,aiFactory:blockingAiFactory,protectorFactory:()=>protector});
  await runtime.start();t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let current=runtime.current();current.service.saveTrip('trip-a',prepare(current.service,'trip-a'));
  const backup=await current.backups.create('manual',{note:'关闭恢复竞态'});
  current.service.deleteTrip('trip-a',1);current.service.saveTrip('trip-b',prepare(current.service,'trip-b'));

  const restoring=runtime.restore(backup.id);await shutdownEntered.promise;
  let closed=false;const closing=runtime.close().then(()=>{closed=true;});
  await Promise.resolve();assert.equal(closed,false);
  releaseShutdown.resolve();await Promise.all([restoring,closing]);

  assert.equal(replacementShutdowns,1);
  assert.throws(()=>runtime.current(),error=>error.code==='STORAGE_FAILED');
});
