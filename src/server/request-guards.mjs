import {createWriteStream,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export class HttpError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
export function guardRequest(req,allowedHosts,{contentTypes=['application/json']}={}) {
  if(!allowedHosts.includes(req.headers.host))throw new HttpError(403,'FORBIDDEN','请求来源不受信任');
  if(!['GET','HEAD'].includes(req.method)) {
    if(req.headers.origin!==`http://${req.headers.host}`)throw new HttpError(403,'FORBIDDEN','请从本机网页操作');
    if(!contentTypes.includes(req.headers['content-type']?.split(';')[0].trim().toLowerCase()))throw new HttpError(415,'CONTENT_TYPE','请使用有效的网页请求');
  }
}
export function readJson(req) {
  return new Promise((resolve,reject)=>{
    let bytes=0,over=false;const chunks=[];
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){if(!over){over=true;chunks.length=0;reject(new HttpError(413,'TOO_LARGE','填写内容过大'));}return;}if(!over)chunks.push(chunk);});
    req.on('end',()=>{if(over)return;try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();resolve(body);}catch{reject(new HttpError(422,'VALIDATION','请求内容无效'));}});
    req.on('error',()=>reject(new HttpError(422,'VALIDATION','请求未完整接收')));
  });
}

export async function streamUpload(req,{directory,maxBytes=268435456,createId=randomUUID}={}) {
  if(typeof directory!=='string'||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new TypeError('Upload configuration is invalid');
  const declared=req.headers?.['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new HttpError(413,'TOO_LARGE','备份文件超过大小限制');
  mkdirSync(directory,{recursive:true});const targetRoot=resolve(directory),actual=realpathSync(targetRoot),normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(normalize(actual)!==normalize(targetRoot))throw new HttpError(503,'STORAGE_FAILED','无法使用临时上传目录');
  const id=String(createId());if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new HttpError(503,'STORAGE_FAILED','无法接收备份文件');
  const path=join(actual,`${id}.sqlite.partial`);let bytes=0;
  const limiter=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;if(bytes>maxBytes){done(new HttpError(413,'TOO_LARGE','备份文件超过大小限制'));return;}done(null,chunk);}});
  try {await pipeline(req,limiter,createWriteStream(path,{flags:'wx',mode:0o600}));return {path,bytes};}
  catch(error){try{rmSync(path,{force:true});}catch{}if(error instanceof HttpError)throw error;throw new HttpError(422,'UPLOAD_INCOMPLETE','备份文件未完整接收');}
}
