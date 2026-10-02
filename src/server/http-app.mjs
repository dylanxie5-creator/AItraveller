import {guardRequest,readJson,HttpError} from './request-guards.mjs';
import {staticFile} from './static-files.mjs';
import {routeApi} from './api-router.mjs';
const statusByCode={NOT_FOUND:404,CONFLICT:409,VALIDATION:422,STORAGE_CORRUPT:503,STORAGE_VERSION:503};
export function createHttpApp({service,webRoot,sharedRoot,allowedHosts}) {
  return async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    function json(status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));}
    try {
      guardRequest(req,allowedHosts);
      const rawPath=req.url.split('?')[0];let path;
      try{path=decodeURIComponent(rawPath);}catch{throw new HttpError(404,'NOT_FOUND','页面不存在');}
      if(path.includes('..')||path.includes('\\')||path.includes('%')||path.includes('\0'))throw new HttpError(404,'NOT_FOUND','页面不存在');
      const query=new URL(req.url,`http://${req.headers.host}`).searchParams;
      if(path.startsWith('/api/')){const body=req.method==='GET'?undefined:await readJson(req);const data=routeApi(service,req.method,path,query,body);json(200,{data});return;}
      if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(404,'NOT_FOUND','页面不存在');
      const file=await staticFile(path,{webRoot,sharedRoot});if(!file)throw new HttpError(404,'NOT_FOUND','页面不存在');
      res.writeHead(200,{'Content-Type':file.type});res.end(req.method==='HEAD'?undefined:file.body);
    }catch(error){
      const status=error.status??statusByCode[error.code]??503;
      const safe=status===503&&!statusByCode[error.code]?{code:'STORAGE_FAILED',message:'本机服务暂时无法完成操作，请重试'}:{code:error.code??'STORAGE_FAILED',message:error.message, ...(error.fields?{fields:error.fields}:{})};
      json(status,{error:safe});
    }
  };
}
