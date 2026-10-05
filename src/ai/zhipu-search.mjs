import {ValidationError} from '../shared/trip-validation.mjs';
import {AiError} from './errors.mjs';
import {validateApiKey} from './provider-config.mjs';
import {zhipuSearchEndpoint} from './provider-registry.mjs';
import {normalizeSearchResults} from './sources.mjs';

export function createZhipuSearch({transport,now=()=>new Date()}) {
  return {async search({query,key,priorSources=[],signal}){
    if(typeof query!=='string'||!query.trim()||[...query.trim()].length>70||/[\u0000-\u001f\u007f-\u009f]/u.test(query))throw new ValidationError({query:'搜索词需为 1–70 字，且不含控制字符'});
    validateApiKey(key);
    if(!Array.isArray(priorSources)||priorSources.length>15)throw new ValidationError({sources:'来源列表无效'});
    const prior=priorSources.map(source=>({...source}));let raw;
    try{raw=await transport.postJson({provider:'zhipu',kind:'search',url:zhipuSearchEndpoint,headers:{Authorization:`Bearer ${key}`},body:{search_query:query.trim(),search_engine:'search_std',search_intent:false,count:5,content_size:'medium'},timeoutMs:30000,maxBytes:1048576,signal});}
    catch(error){
      if(error instanceof AiError&&['AI_ENDPOINT_BLOCKED','AI_TIMEOUT','AI_CANCELLED','AI_AUTH','AI_RATE_LIMIT','AI_RESPONSE','AI_NETWORK'].includes(error.code)){
        // Dependency messages are not an error reporting boundary: return local text only.
        const messages={AI_ENDPOINT_BLOCKED:'搜索接口地址不安全',AI_TIMEOUT:'搜索超时，请手动重试',AI_CANCELLED:'搜索已取消',AI_AUTH:'搜索密钥无效，请检查配置',AI_RATE_LIMIT:'搜索请求受限，请稍后手动重试',AI_RESPONSE:'搜索平台响应无效',AI_NETWORK:'无法连接搜索平台'};
        throw new AiError(error.code,messages[error.code]);
      }
      throw new AiError('AI_NETWORK','无法连接搜索平台');
    }
    return normalizeSearchResults(raw,{retrievedAt:now().toISOString(),priorSources:prior});
  }};
}
