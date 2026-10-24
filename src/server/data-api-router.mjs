import {HttpError} from './request-guards.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';

const identity='([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
const download=new RegExp(`^/api/data/backups/${identity}/download$`);
const restore=new RegExp(`^/api/data/backups/${identity}/restore$`);
const invalid=()=>new ValidationError({backup:'请检查备份操作内容'});
function exact(value,fields) {if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!fields.includes(key)))throw invalid();return value;}

export async function routeDataApi(runtime,method,path,body) {
  const current=runtime.current(),backups=current.backups;
  if(method==='GET'&&path==='/api/data/backups') {
    const records=backups.list(),pageCount=current.database.db.prepare('PRAGMA page_count').get().page_count,pageSize=current.database.db.prepare('PRAGMA page_size').get().page_size;
    return {status:200,data:{databaseSizeBytes:pageCount*pageSize,backupCount:records.length,lastAutomaticAt:records.find(item=>item.kind==='auto')?.createdAt??null,warning:runtime.backupWarning(),backups:records}};
  }
  if(method==='POST'&&path==='/api/data/backups') {
    const request=exact(body,['note']);return {status:201,data:await backups.create('manual',{note:request.note??''})};
  }
  const file=download.exec(path);
  if(method==='GET'&&file) {
    const found=backups.resolve(file[1]),stamp=found.record.createdAt.replace(/[-:]/g,'').replace('T','-').slice(0,15);
    return {status:200,download:{path:found.path,filename:`travel-backup-${stamp}.sqlite`,sizeBytes:found.record.sizeBytes}};
  }
  const replacement=restore.exec(path);
  if(method==='POST'&&replacement) {
    const request=exact(body,['confirmation']);if(request.confirmation!=='恢复数据')throw invalid();
    return {status:200,data:await runtime.restore(replacement[1])};
  }
  throw new HttpError(404,'NOT_FOUND','备份不存在');
}
