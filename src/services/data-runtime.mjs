import {DatabaseSync} from 'node:sqlite';
import {constants,copyFileSync,existsSync,renameSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {prepareDatabase,validateDatabase} from '../storage/database.mjs';
import {databaseFingerprint} from '../storage/migration-backup.mjs';
import {createDataBackupStore} from '../storage/data-backup-store.mjs';
import {createDpapiProtector} from '../platform/dpapi.mjs';
import {createTravelService} from './travel-service.mjs';
import {createExpenseService} from './expense-service.mjs';
import {createFootprintService} from './footprint-service.mjs';
import {createMapSettingsStore} from '../storage/map-settings-store.mjs';
import {createAmapProxy} from '../server/amap-proxy.mjs';
import {createMutationCoordinator} from './mutation-coordinator.mjs';
import {StoreError} from '../storage/errors.mjs';

const nativeFiles={constants,copyFileSync,existsSync,renameSync,rmSync};
const clean=(files,path)=>{try{files.rmSync(path,{force:true});}catch{}};
const restoreFailure=()=>new StoreError('DATA_RESTORE_FAILED','无法恢复数据，原数据已保留');

export function createDataRuntime({dbPath,aiFactory,protectorFactory=createDpapiProtector,backupStoreFactory=createDataBackupStore,fileOps={}}={}) {
  if(typeof dbPath!=='string'||typeof aiFactory!=='function')throw new TypeError('Data runtime configuration is invalid');
  const files={...nativeFiles,...fileOps},coordinator=createMutationCoordinator();let active=null,started=false,closing,signal,lastBackupWarning=null;
  const backups=backupStoreFactory({dbPath,getDatabase:()=>{
    if(!active?.database)throw new StoreError('STORAGE_FAILED','本机数据服务尚未启动');
    return active.database;
  }});

  async function openContext() {
    const database=await prepareDatabase(dbPath,{signal});let ai;
    try {
      ai=await aiFactory({database,signal});ai.jobs.recover();
      const footprints=createFootprintService({database});footprints.syncAll();
      const protector=protectorFactory(),mapSettings=createMapSettingsStore(database,{protector});
      return {
        database,service:createTravelService({database}),expenses:createExpenseService({database}),footprints,
        mapSettings,amapProxy:createAmapProxy({settingsStore:mapSettings}),
        ai,backups,coordinator,
      };
    } catch(error) {try{await ai?.jobs?.shutdown?.();}finally{database.close();}throw error;}
  }
  function verify(path,expectedFingerprint) {
    let db;
    try {
      db=new DatabaseSync(path,{readOnly:true,timeout:1000});
      if(validateDatabase(db)!==4||databaseFingerprint(db)!==expectedFingerprint)throw new Error('backup changed');
    } catch {throw new StoreError('DATA_BACKUP_INVALID','备份文件已损坏或不完整');}
    finally{try{db?.close();}catch{}}
  }
  async function ensureAutomaticBackup() {
    try {const result=await backups.ensureAutomatic();lastBackupWarning=null;return result;}
    catch {lastBackupWarning={code:'DATA_BACKUP_FAILED',message:'自动备份暂未完成，请在数据安全页面重试'};return null;}
  }
  async function restoreOriginal(rollback,moved) {
    clean(files,dbPath);clean(files,`${dbPath}-wal`);clean(files,`${dbPath}-shm`);
    for(const suffix of moved.slice().reverse())if(files.existsSync(`${rollback}${suffix}`))files.renameSync(`${rollback}${suffix}`,`${dbPath}${suffix}`);
    active=await openContext();
  }
  return {
    coordinator,
    async start({signal:nextSignal}={}) {
      if(started)return active;signal=nextSignal;active=await openContext();started=true;await ensureAutomaticBackup();return active;
    },
    current() {if(!started||!active)throw new StoreError('STORAGE_FAILED','本机数据服务尚未启动');return active;},
    ensureAutomaticBackup,
    backupWarning:()=>lastBackupWarning,
    async restore(backupId) {
      const selected=backups.resolve(backupId),stage=`${dbPath}.restore-${randomUUID()}.partial`,rollback=`${dbPath}.rollback-${randomUUID()}`;
      try {files.copyFileSync(selected.path,stage,files.constants.COPYFILE_EXCL);verify(stage,selected.record.fingerprint);}
      catch(error){clean(files,stage);throw error?.code?error:new StoreError('DATA_BACKUP_INVALID','备份文件已损坏或不完整');}
      try {
        return await coordinator.runRestore(async()=>{
          verify(stage,selected.record.fingerprint);
          const safetyBackup=await backups.create('pre-restore',{note:'恢复前自动保留'});
          await active.ai?.jobs?.shutdown?.();active.database.close();active=null;
          const moved=[];
          try {
            for(const suffix of ['','-wal','-shm'])if(files.existsSync(`${dbPath}${suffix}`)){files.renameSync(`${dbPath}${suffix}`,`${rollback}${suffix}`);moved.push(suffix);}
            files.renameSync(stage,dbPath);active=await openContext();
            for(const suffix of moved)clean(files,`${rollback}${suffix}`);
            return {restoredFrom:selected.record.id,safetyBackup};
          } catch {
            try{await restoreOriginal(rollback,moved);}
            catch{throw new StoreError('DATA_RESTORE_ROLLBACK_FAILED','恢复未完成，请重新启动网站后检查数据');}
            throw restoreFailure();
          }
        });
      } finally {clean(files,stage);}
    },
    async close() {
      if(closing)return closing;
      closing=(async()=>{if(active){try{await active.ai?.jobs?.shutdown?.();}finally{active.database.close();active=null;}}started=false;})();
      return closing;
    },
  };
}
