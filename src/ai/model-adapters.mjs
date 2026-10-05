import {AiError} from './errors.mjs';
import {validateProviderConfig} from './provider-config.mjs';
import {modelRequestOptions} from './provider-registry.mjs';
import {buildPlanningMessages} from './planning-prompt.mjs';

const messages={AI_AUTH:'模型平台鉴权失败，请检查标准 API Key 和地域',AI_RATE_LIMIT:'模型请求受限，请稍后手动重试',AI_TIMEOUT:'模型请求超时，请手动重试',AI_CANCELLED:'模型请求已取消',AI_ENDPOINT_BLOCKED:'模型接口地址不安全',AI_RESPONSE:'模型接口拒绝请求或响应无效，请检查型号和接口兼容性',AI_NETWORK:'无法连接模型平台',AI_MODEL_RESPONSE:'所选模型未返回正常完成的文本攻略，请检查文本接口兼容性',AI_MODEL_TRUNCATED:'攻略达到输出上限，本次不会自动续写，请缩短行程后主动重试',AI_MODEL_JSON:'模型未返回有效的 JSON 对象，本次不会自动修复或追加调用'};
const fail=code=>new AiError(code,messages[code]);
function safeUsage(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const usage={};
  for(const field of ['prompt_tokens','completion_tokens','total_tokens']){
    const n=value[field];if(Number.isSafeInteger(n)&&n>=0&&n<=1000000000)usage[field]=n;
  }
  return Object.keys(usage).length?usage:null;
}
function readCompletion(raw) {
  const choice=raw?.choices?.[0],message=choice?.message;
  if(!raw||raw.error||!Array.isArray(raw.choices)||!choice||!message||typeof message!=='object'||Array.isArray(message))throw fail('AI_MODEL_RESPONSE');
  if(choice.finish_reason==='length')throw fail('AI_MODEL_TRUNCATED');
  if(choice.finish_reason!=='stop'||(message.role!==undefined&&message.role!=='assistant')||message.function_call||message.refusal||(message.tool_calls!=null&&(!Array.isArray(message.tool_calls)||message.tool_calls.length))||typeof message.content!=='string'||!message.content.trim()||Buffer.byteLength(message.content)>1048576)throw fail('AI_MODEL_RESPONSE');
  let parsed;try{parsed=JSON.parse(message.content);}catch{throw fail('AI_MODEL_JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw fail('AI_MODEL_JSON');
  return {content:message.content,usage:safeUsage(raw.usage)};
}

export function createModelAdapters({transport}) {
  return {async generate({provider,model,endpoint,key,request,sources,signal}){
    const config=validateProviderConfig(provider,{model,endpoint,keyAction:'replace',apiKey:key});
    const body={model:config.model,messages:buildPlanningMessages(request,sources),stream:false,...modelRequestOptions(provider,config.model)};
    const headers=provider==='mimo'?{'api-key':config.apiKey}:{Authorization:`Bearer ${config.apiKey}`};let raw;
    try{raw=await transport.postJson({provider,kind:'model',url:config.endpoint,headers,body,timeoutMs:120000,maxBytes:1048576,signal});}
    catch(error){throw fail(error instanceof AiError&&Object.hasOwn(messages,error.code)&&!error.code.startsWith('AI_MODEL_')?error.code:'AI_NETWORK');}
    return readCompletion(raw);
  }};
}
