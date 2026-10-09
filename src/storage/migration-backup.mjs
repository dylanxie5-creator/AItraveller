import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,realpathSync,openSync,closeSync,renameSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {StoreError} from './errors.mjs';

export function databaseFingerprint(db) {
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const records=schema.filter(row=>row.type==='table').map(({name})=>{
    const quoted='"'+name.replaceAll('"','""')+'"';
    return [name,db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).all()];
  });
  return createHash('sha256').update(JSON.stringify({schema,records})).digest('hex');
}
export async function createMigrationBackup(db,path,{backupImpl,validateDatabase,sourceVersion}) {
  let saved;
  try {
    const parent=realpathSync(dirname(resolve(path)));const directory=join(parent,'backups');
    mkdirSync(directory,{recursive:true});
    const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
    if(normalize(realpathSync(directory))!==normalize(directory))throw new Error('Backup directory redirected');
    const target=join(directory,`pre-migration-v${sourceVersion}-${randomUUID()}.sqlite`);
    const partial=target+'.partial';
    // Reserve a unique name; never overwrite an earlier backup.
    closeSync(openSync(partial,'wx',0o600));
    const before=databaseFingerprint(db);await backupImpl(db,partial);
    saved=new DatabaseSync(partial,{readOnly:true});
    if(validateDatabase(saved)!==sourceVersion||databaseFingerprint(saved)!==before)throw new Error('Backup verification failed');
    saved.close();saved=undefined;renameSync(partial,target);
    return {path:target,fingerprint:before};
  }catch {throw new StoreError('STORAGE_BACKUP_FAILED','无法生成完整备份，旧数据未升级，请检查存储空间和权限');}
  finally {saved?.close();}
}
