import {guardRequest,readJson,HttpError} from './request-guards.mjs';
import {staticFile} from './static-files.mjs';
import {routeApi} from './api-router.mjs';
import {routeAiApi} from './ai-api-router.mjs';
import {routeExpenseApi} from './expense-api-router.mjs';
const statusByCode={NOT_FOUND:404,CONFLICT:409,CATEGORY_IN_USE:409,VALIDATION:422,STORAGE_CORRUPT:503,STORAGE_VERSION:503};
const aiMessages={AI_CREDENTIALS_UNAVAILABLE:'已保存的密钥无法读取，请重新配置',AI_KEY_REQUIRED:'请先完成所选模型和搜索密钥配置',AI_AUTH:'平台鉴权失败，请检查 API Key',AI_RATE_LIMIT:'平台请求受限，请稍后手动重试',AI_TIMEOUT:'平台请求超时，请手动重试',AI_CANCELLED:'AI 请求已取消',AI_ENDPOINT_BLOCKED:'接口地址不安全',AI_RESPONSE:'平台响应无效',AI_SEARCH_RESPONSE:'检索资料响应无效',AI_SEARCH_EMPTY:'未检索到有效资料',AI_NETWORK:'无法连接外部平台',AI_MODEL_RESPONSE:'模型未返回可用攻略',AI_MODEL_TRUNCATED:'模型输出被截断',AI_MODEL_JSON:'模型未返回有效攻略格式'};
export function createHttpApp({service,expenses,ai,webRoot,sharedRoot,allowedHosts}) {
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
      if(path.startsWith('/api/ai/')){if(!ai)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const body=req.method==='GET'?undefined:await readJson(req);const result=await routeAiApi(ai,req.method,path,body);json(result.status,{data:result.data});return;}
      if(/^\/api\/trips\/[a-zA-Z0-9_-]{1,80}\/(?:expenses|expense-categories)(?:\/|$)/.test(path)){if(!expenses)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');const body=req.method==='GET'?undefined:await readJson(req);const result=routeExpenseApi(expenses,req.method,path,body);json(result.status,{data:result.data});return;}
      if(path.startsWith('/api/')){const body=req.method==='GET'?undefined:await readJson(req);const data=routeApi(service,req.method,path,query,body);json(200,{data});return;}
      if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(404,'NOT_FOUND','页面不存在');
      const file=await staticFile(path,{webRoot,sharedRoot});if(!file)throw new HttpError(404,'NOT_FOUND','页面不存在');
      res.writeHead(200,{'Content-Type':file.type});res.end(req.method==='HEAD'?undefined:file.body);
    }catch(error){
      const knownAi=Object.hasOwn(aiMessages,error.code),status=error.status??statusByCode[error.code]??503;
      const safe=knownAi?{code:error.code,message:aiMessages[error.code]}:status===503&&!statusByCode[error.code]?{code:'STORAGE_FAILED',message:'本机服务暂时无法完成操作，请重试'}:{code:error.code??'STORAGE_FAILED',message:error.message, ...(error.fields?{fields:error.fields}:{})};
      json(status,{error:safe});
    }
  };
}
