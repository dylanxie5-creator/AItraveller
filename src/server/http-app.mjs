import {guardRequest,readJson,streamUpload,HttpError} from './request-guards.mjs';
import {staticFile} from './static-files.mjs';
import {routeApi} from './api-router.mjs';
import {routeAiApi} from './ai-api-router.mjs';
import {routeExpenseApi} from './expense-api-router.mjs';
import {routeFootprintApi} from './footprint-api-router.mjs';
import {routeMapApi} from './map-api-router.mjs';
import {routeDataApi} from './data-api-router.mjs';
import {routeArchiveApi} from './archive-api-router.mjs';
import {createReadStream,rmSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const statusByCode={NOT_FOUND:404,CONFLICT:409,ARCHIVE_NOT_COMPLETED:409,CATEGORY_IN_USE:409,AUTO_VISIT_REQUIRES_SUPPRESSION:409,MAP_CONFIGURATION_REQUIRED:409,MAP_CREDENTIALS_UNAVAILABLE:503,VALIDATION:422,DATA_BACKUP_INVALID:422,DATA_BACKUP_FAILED:503,DATA_RESTORE_FAILED:503,DATA_RESTORE_ROLLBACK_FAILED:503,DATA_RESTORE_IN_PROGRESS:503,STORAGE_CORRUPT:503,STORAGE_VERSION:503};
const aiMessages={AI_CREDENTIALS_UNAVAILABLE:'已保存的密钥无法读取，请重新配置',AI_KEY_REQUIRED:'请先完成所选模型和搜索密钥配置',AI_AUTH:'平台鉴权失败，请检查 API Key',AI_RATE_LIMIT:'平台请求受限，请稍后手动重试',AI_TIMEOUT:'平台请求超时，请手动重试',AI_CANCELLED:'AI 请求已取消',AI_ENDPOINT_BLOCKED:'接口地址不安全',AI_RESPONSE:'平台响应无效',AI_SEARCH_RESPONSE:'检索资料响应无效',AI_SEARCH_EMPTY:'未检索到有效资料',AI_NETWORK:'无法连接外部平台',AI_MODEL_RESPONSE:'模型未返回可用攻略',AI_MODEL_TRUNCATED:'模型输出被截断',AI_MODEL_JSON:'模型未返回有效攻略格式'};
const dataMessages={DATA_BACKUP_INVALID:'备份文件已损坏或不完整',DATA_BACKUP_FAILED:'无法创建完整的数据备份',DATA_RESTORE_FAILED:'无法恢复数据，原数据已保留',DATA_RESTORE_ROLLBACK_FAILED:'恢复未完成，请重新启动网站后检查数据',DATA_RESTORE_IN_PROGRESS:'正在恢复数据，请稍后重试'};
export function createHttpApp({runtime,service,expenses,footprints,archives,mapSettings,amapProxy,ai,webRoot,sharedRoot,allowedHosts,uploadDirectory=join(tmpdir(),'travel-trace-imports'),uploadLimit=268435456}) {
  const fixed={service,expenses,footprints,archives,mapSettings,amapProxy,ai};
  return async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-eval' https://webapi.amap.com https://*.amap.com; style-src 'self' 'unsafe-inline' https://*.amap.com; img-src 'self' data: blob: https://*.amap.com; connect-src 'self' https://*.amap.com; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    function json(status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));}
    try {
      const rawPath=req.url.split('?')[0],binaryImport=req.method==='POST'&&rawPath==='/api/data/backups/import';
      guardRequest(req,allowedHosts,{contentTypes:binaryImport?['application/vnd.sqlite3']:['application/json']});
      let path;
      try{path=decodeURIComponent(rawPath);}catch{throw new HttpError(404,'NOT_FOUND','页面不存在');}
      if(path.includes('..')||path.includes('\\')||path.includes('%')||path.includes('\0'))throw new HttpError(404,'NOT_FOUND','页面不存在');
      const query=new URL(req.url,`http://${req.headers.host}`).searchParams;
      const dispatch=async()=>{
        const current=runtime?.current()??fixed,{service,expenses,footprints,archives,mapSettings,amapProxy,ai}=current;
        if(path.startsWith('/_AMapService/')){if(!amapProxy)throw new HttpError(404,'NOT_FOUND','地图接口不存在');const result=await amapProxy.handle({method:req.method,path,searchParams:query});res.writeHead(result.status,{'Content-Type':result.contentType});res.end(result.body);return;}
        if(path==='/api/data/backups/import'&&req.method==='POST'){
          if(!runtime)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const upload=await streamUpload(req,{directory:uploadDirectory,maxBytes:uploadLimit});
          try{const record=await current.backups.importFile(upload.path,{note:'导入的备份'});json(201,{data:record});return;}finally{try{rmSync(upload.path,{force:true});}catch{}}
        }
        if(path==='/api/data/backups'||path.startsWith('/api/data/backups/')){if(!runtime)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const body=req.method==='GET'?undefined:await readJson(req);const result=await routeDataApi(runtime,req.method,path,body);if(result.download){res.writeHead(result.status,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="${result.download.filename}"`,'Content-Length':result.download.sizeBytes,'Cache-Control':'no-store'});await pipeline(createReadStream(result.download.path),res);return;}json(result.status,{data:result.data});return;}
        if(path==='/api/map-settings'||path==='/api/map-session'){if(!mapSettings)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const body=req.method==='GET'?undefined:await readJson(req);const result=await routeMapApi(mapSettings,req.method,path,body);json(result.status,{data:result.data});return;}
        if(path==='/api/archive'||path.startsWith('/api/archive/')){if(!archives)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const result=routeArchiveApi(archives,req.method,path);json(result.status,{data:result.data});return;}
        if(path.startsWith('/api/ai/')){if(!ai)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const body=req.method==='GET'?undefined:await readJson(req);const result=await routeAiApi(ai,req.method,path,body);json(result.status,{data:result.data});return;}
        if(path==='/api/footprints'||path.startsWith('/api/footprints/')){if(!footprints)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const body=req.method==='GET'?undefined:await readJson(req);const result=routeFootprintApi(footprints,req.method,path,body);json(result.status,{data:result.data});return;}
        if(/^\/api\/trips\/[a-zA-Z0-9_-]{1,80}\/(?:expenses|expense-categories)(?:\/|$)/.test(path)){if(!expenses)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const body=req.method==='GET'?undefined:await readJson(req);const result=routeExpenseApi(expenses,req.method,path,body);json(result.status,{data:result.data});return;}
        if(path.startsWith('/api/')){const body=req.method==='GET'?undefined:await readJson(req);const data=routeApi(service,req.method,path,query,body);json(200,{data});return;}
        if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(404,'NOT_FOUND','页面不存在');
        const file=await staticFile(path,{webRoot,sharedRoot});if(!file)throw new HttpError(404,'NOT_FOUND','页面不存在');
        res.writeHead(200,{'Content-Type':file.type});res.end(req.method==='HEAD'?undefined:file.body);
      };
      const restoreRequest=req.method==='POST'&&/^\/api\/data\/backups\/[0-9a-fA-F-]{36}\/restore$/.test(path);
      if(runtime&&!['GET','HEAD'].includes(req.method)&&!restoreRequest)await runtime.coordinator.runWrite(dispatch);else await dispatch();
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      const knownAi=Object.hasOwn(aiMessages,error.code),knownData=Object.hasOwn(dataMessages,error.code),status=error.status??statusByCode[error.code]??503;
      const safe=knownAi?{code:error.code,message:aiMessages[error.code]}:knownData?{code:error.code,message:dataMessages[error.code]}:status===503&&!statusByCode[error.code]?{code:'STORAGE_FAILED',message:'本机服务暂时无法完成操作，请重试'}:{code:error.code??'STORAGE_FAILED',message:error.message, ...(error.fields?{fields:error.fields}:{})};
      json(status,{error:safe});
    }
  };
}
