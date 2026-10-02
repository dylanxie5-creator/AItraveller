export class HttpError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
export function guardRequest(req,allowedHosts) {
  if(!allowedHosts.includes(req.headers.host))throw new HttpError(403,'FORBIDDEN','请求来源不受信任');
  if(!['GET','HEAD'].includes(req.method)) {
    if(req.headers.origin!==`http://${req.headers.host}`)throw new HttpError(403,'FORBIDDEN','请从本机网页操作');
    if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpError(415,'CONTENT_TYPE','请使用有效的网页请求');
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
