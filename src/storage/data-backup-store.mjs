import {DatabaseSync,backup} from 'node:sqlite';
import {
  closeSync,copyFileSync,existsSync,mkdirSync,openSync,readFileSync,readdirSync,
  realpathSync,renameSync,rmSync,statSync,writeFileSync,
} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateDatabase} from './database.mjs';
import {databaseFingerprint} from './migration-backup.mjs';
import {StoreError} from './errors.mjs';

const kinds=new Set(['auto','manual','pre-restore']);
const identity=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=path=>{try{rmSync(path,{force:true});}catch{}};
const normalizePath=value=>process.platform==='win32'?value.toLowerCase():value;

function validation(message='备份信息无效') {return new StoreError('VALIDATION',message);}
function failure(code,message) {return new StoreError(code,message);}
function noteValue(value='') {
  if(typeof value!=='string'||Array.from(value).length>80)throw validation('备份备注不能超过 80 个字符');
  return value;
}
function kindValue(value) {if(!kinds.has(value))throw validation('备份类型无效');return value;}
function dateValue(value) {
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))throw failure('DATA_BACKUP_FAILED','无法创建数据备份');
  return date.toISOString();
}

export function createDataBackupStore({dbPath,getDatabase,backupImpl=backup,clock=()=>new Date(),createId=randomUUID}={}) {
  if(typeof dbPath!=='string'||typeof getDatabase!=='function')throw new TypeError('Backup store configuration is invalid');
  const databasePath=resolve(dbPath),root=join(dirname(databasePath),'backups','data');

  function ensureRoot() {
    const parent=realpathSync(dirname(databasePath));
    mkdirSync(root,{recursive:true});
    if(normalizePath(realpathSync(root))!==normalizePath(join(parent,'backups','data')))throw failure('DATA_BACKUP_FAILED','无法使用数据备份目录');
  }
  function paths(id) {return {sqlite:join(root,`${id}.sqlite`),metadata:join(root,`${id}.json`)};}
  function verifyFile(path) {
    let saved;
    try {
      saved=new DatabaseSync(path,{readOnly:true,timeout:1000});
      if(validateDatabase(saved)!==4)throw new Error('unsupported version');
      const fingerprint=databaseFingerprint(saved),sizeBytes=statSync(path).size;
      return {fingerprint,sizeBytes};
    } finally {try{saved?.close();}catch{}}
  }
  function parseRecord(id) {
    const target=paths(id);let record,actual;
    try {
      record=JSON.parse(readFileSync(target.metadata,'utf8'));
      if(!record||typeof record!=='object'||Array.isArray(record)||record.id!==id||!identity.test(record.id)||!kinds.has(record.kind)||typeof record.createdAt!=='string'||new Date(record.createdAt).toISOString()!==record.createdAt||typeof record.note!=='string'||Array.from(record.note).length>80||!Number.isSafeInteger(record.sizeBytes)||record.sizeBytes<=0||typeof record.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(record.fingerprint))throw new Error('invalid metadata');
      actual=verifyFile(target.sqlite);
      if(actual.sizeBytes!==record.sizeBytes||actual.fingerprint!==record.fingerprint)throw new Error('mismatch');
      return {record:{id:record.id,kind:record.kind,createdAt:record.createdAt,sizeBytes:record.sizeBytes,note:record.note,fingerprint:record.fingerprint},path:target.sqlite};
    } catch {throw failure('DATA_BACKUP_INVALID','备份文件已损坏或不完整');}
  }
  function allocate() {
    ensureRoot();
    for(let attempt=0;attempt<16;attempt++) {
      const id=String(createId());if(!identity.test(id))throw failure('DATA_BACKUP_FAILED','无法创建数据备份');
      const target=paths(id),partial=`${target.sqlite}.partial`,metadataPartial=`${target.metadata}.partial`;
      if([target.sqlite,target.metadata,partial,metadataPartial].some(existsSync))continue;
      closeSync(openSync(partial,'wx',0o600));return {id,target,partial,metadataPartial};
    }
    throw failure('DATA_BACKUP_FAILED','无法创建数据备份');
  }
  async function publish(kind,note,writer,invalidCode,at) {
    kind=kindValue(kind);note=noteValue(note);const createdAt=dateValue(at??clock());const slot=allocate();let sqlitePublished=false;
    try {
      await writer(slot.partial);
      let verified;
      try{verified=verifyFile(slot.partial);}catch{throw failure(invalidCode,invalidCode==='DATA_BACKUP_INVALID'?'选择的文件不是有效的智游足迹备份':'无法创建完整的数据备份');}
      const record={id:slot.id,kind,createdAt,sizeBytes:verified.sizeBytes,note,fingerprint:verified.fingerprint};
      writeFileSync(slot.metadataPartial,JSON.stringify(record),{encoding:'utf8',flag:'wx',mode:0o600});
      renameSync(slot.partial,slot.target.sqlite);sqlitePublished=true;
      renameSync(slot.metadataPartial,slot.target.metadata);
      return record;
    } catch(error) {
      clean(slot.partial);clean(slot.metadataPartial);if(sqlitePublished)clean(slot.target.sqlite);
      if(error instanceof StoreError)throw error;
      throw failure(invalidCode,invalidCode==='DATA_BACKUP_INVALID'?'选择的文件不是有效的智游足迹备份':'无法创建完整的数据备份');
    }
  }

  const api={
    list() {
      if(!existsSync(root))return [];
      const records=[];
      for(const name of readdirSync(root)) {
        const match=/^([0-9a-f-]{36})\.json$/i.exec(name);if(!match||!identity.test(match[1]))continue;
        try{records.push(parseRecord(match[1]).record);}catch{}
      }
      return records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    },
    create(kind,{note=''}={}) {return publish(kind,note,target=>backupImpl(getDatabase().db,target),'DATA_BACKUP_FAILED');},
    importFile(source,{note=''}={}) {
      if(typeof source!=='string')return Promise.reject(validation('备份文件无效'));
      return publish('manual',note,target=>copyFileSync(source,target),'DATA_BACKUP_INVALID');
    },
    resolve(id) {
      if(typeof id!=='string'||!identity.test(id))throw failure('NOT_FOUND','备份不存在');
      const target=paths(id);if(!existsSync(target.metadata)||!existsSync(target.sqlite))throw failure('NOT_FOUND','备份不存在');
      return parseRecord(id);
    },
    remove(id) {
      const found=api.resolve(id);const target=paths(found.record.id);
      clean(target.sqlite);clean(target.metadata);return found.record;
    },
    async ensureAutomatic() {
      const now=dateValue(clock()),latest=api.list().find(item=>item.kind==='auto');
      if(latest&&Date.parse(now)-Date.parse(latest.createdAt)<86_400_000)return {created:false,record:latest};
      const record=await publish('auto','',target=>backupImpl(getDatabase().db,target),'DATA_BACKUP_FAILED',now);
      const autos=api.list().filter(item=>item.kind==='auto');
      for(const expired of autos.slice(14))api.remove(expired.id);
      return {created:true,record};
    },
  };
  return api;
}
