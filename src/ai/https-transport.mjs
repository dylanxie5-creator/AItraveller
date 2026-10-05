import {lookup as nativeLookup} from 'node:dns/promises';
import {request as nativeRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {isIP} from 'node:net';
import {ValidationError} from '../shared/trip-validation.mjs';
import {AiError} from './errors.mjs';
import {configRecord} from './provider-config.mjs';
import {validateEndpoint} from './provider-registry.mjs';

const limit=1048576;
const invalid=()=>new ValidationError({request:'请检查网络请求配置'});
const messages={AI_ENDPOINT_BLOCKED:'接口解析到了不允许连接的地址',AI_TIMEOUT:'请求超时，请手动重试',AI_CANCELLED:'请求已取消',AI_AUTH:'平台拒绝了密钥，请检查配置',AI_RATE_LIMIT:'平台请求受限，请稍后手动重试',AI_RESPONSE:'平台返回了无法使用的响应',AI_NETWORK:'无法安全连接平台，请检查网络'};
const failure=code=>new AiError(code,messages[code]);
const ipv4Number=address=>address.split('.').reduce((n,part)=>n*256+Number(part),0);
const v4Reserved=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.31.196.0',24],['192.52.193.0',24],['192.88.99.0',24],['192.168.0.0',16],['192.175.48.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]].map(([base,bits])=>[ipv4Number(base),2**(32-bits)]);
function ipv6Number(address) {
  const halves=address.split('::');const left=halves[0]?halves[0].split(':'):[];
  const right=halves[1]?halves[1].split(':'):[];
  const groups=halves.length===1?left:[...left,...Array(8-left.length-right.length).fill('0'),...right];
  return groups.reduce((n,part)=>(n<<16n)+BigInt(`0x${part}`),0n);
}
const v6Reserved=[['2001::',23],['2001:db8::',32],['2002::',16],['2620:4f:8000::',48],['3fff::',20]].map(([base,bits])=>[ipv6Number(base)>>BigInt(128-bits),BigInt(128-bits)]);
function publicAddress(record) {
  if(!record||typeof record.address!=='string'||record.address.includes('%'))return false;
  const family=isIP(record.address);if(family!==record.family)return false;
  if(family===4){const value=ipv4Number(record.address);return !v4Reserved.some(([base,size])=>Math.floor(value/size)===Math.floor(base/size));}
  // Only ordinary global unicast; never accept mapped, NAT64 or transition ranges.
  if(family!==6||record.address.includes('.'))return false;
  const value=ipv6Number(record.address);
  return (value>>125n)===1n&&!v6Reserved.some(([base,shift])=>(value>>shift)===base);
}
function snapshotHeaders(value={}) {
  const record=configRecord(value,['Authorization','authorization','api-key','Content-Type','content-type','Accept','accept'],'headers');
  const result={};const names=new Set();
  for(const [name,content] of Object.entries(record)){
    const lower=name.toLowerCase();
    if(names.has(lower)||typeof content!=='string'||content.length>16384||/[\u0000-\u001f\u007f-\u009f]/u.test(content))throw invalid();
    names.add(lower);
    if(lower==='authorization')result.Authorization=content;
    if(lower==='api-key')result['api-key']=content;
    if(lower==='content-type'&&content.toLowerCase()!=='application/json')throw invalid();
  }
  return result;
}

export function createHttpsTransport({lookup=nativeLookup,requestImpl=nativeRequest}={}) {
  return {async postJson({provider,kind='model',url,headers,body,timeoutMs=kind==='search'?30000:120000,maxBytes=limit,signal}){
    const endpoint=validateEndpoint(provider,url,kind);
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>limit||(signal!==undefined&&!(signal instanceof AbortSignal)))throw invalid();
    const safeHeaders=snapshotHeaders(headers);let serialized;
    try{if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();serialized=JSON.stringify(body);if(!serialized||Buffer.byteLength(serialized)>limit)throw invalid();}catch{throw invalid();}
    if(signal?.aborted)throw failure('AI_CANCELLED');
    return new Promise((resolve,reject)=>{
      let done=false,req,res;const chunks=[];let bytes=0;
      const finish=(error,result)=>{
        if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        if(error){req?.destroy();res?.destroy();reject(error);}else resolve(result);
      };
      const fail=code=>finish(failure(code));
      const cancel=()=>fail('AI_CANCELLED');
      const timer=setTimeout(()=>fail('AI_TIMEOUT'),timeoutMs);
      signal?.addEventListener('abort',cancel,{once:true});
      const receive=response=>{
        if(done){response.destroy();return;}res=response;
        res.on('error',()=>fail('AI_NETWORK'));res.on('aborted',()=>fail('AI_NETWORK'));
        res.on('close',()=>{if(!res.readableEnded)fail('AI_NETWORK');});
        const status=res.statusCode;
        if(!Number.isInteger(status)||status<200||status>=300){fail(status===401||status===403?'AI_AUTH':status===429?'AI_RATE_LIMIT':'AI_RESPONSE');return;}
        const type=res.headers['content-type'];const encoding=res.headers['content-encoding'];const length=res.headers['content-length'];
        if(typeof type!=='string'||!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(type)||(encoding!==undefined&&encoding!=='identity')||(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes))){fail('AI_RESPONSE');return;}
        res.on('data',chunk=>{
          if(done)return;
          const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;
          if(bytes>maxBytes){fail('AI_RESPONSE');return;}chunks.push(buffer);
        });
        res.on('end',()=>{
          if(done)return;let result;
          try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();}catch{fail('AI_RESPONSE');return;}
          finish(null,result);
        });
      };
      (async()=>{
        let answers;try{answers=await lookup(endpoint.hostname,{all:true,verbatim:true});}catch{if(!done)fail('AI_NETWORK');return;}
        if(done)return;
        if(!Array.isArray(answers)||!answers.length||answers.length>128||!answers.every(publicAddress)){fail('AI_ENDPOINT_BLOCKED');return;}
        const selected=answers.find(record=>record.family===4)??answers[0];
        try{
          req=requestImpl({protocol:'https:',hostname:selected.address,port:443,family:selected.family,path:endpoint.pathname,method:'POST',agent:false,rejectUnauthorized:true,servername:endpoint.hostname,
            checkServerIdentity:(_hostname,cert)=>checkServerIdentity(endpoint.hostname,cert),
            headers:{...safeHeaders,Host:endpoint.host,'Content-Type':'application/json','Content-Length':Buffer.byteLength(serialized),Accept:'application/json','Accept-Encoding':'identity'}},receive);
          req.on('error',()=>fail('AI_NETWORK'));
          if(done){req.destroy();return;}req.end(serialized);
        }catch{fail('AI_NETWORK');}
      })().catch(()=>fail('AI_NETWORK'));
    });
  }};
}
