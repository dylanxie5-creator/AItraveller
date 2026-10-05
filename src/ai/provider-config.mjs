import {ValidationError} from '../shared/trip-validation.mjs';
import {validateEndpoint} from './provider-registry.mjs';

export const providerIds=Object.freeze(['deepseek','zhipu','mimo','kimi','qwen']);
const invalid=field=>new ValidationError({[field]:'请检查模型、接口地址和密钥配置'});
const controls=/[\u0000-\u001f\u007f-\u009f]/u;
export function configRecord(value,allowed,field='settings') {
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid(field);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!allowed.includes(key)||!Object.hasOwn(descriptors[key],'value')))throw invalid(field);
  return Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,d.value]));
}
export function validateApiKey(value) {
  if(typeof value!=='string'||!value.trim()||[...value].length>4096||controls.test(value))throw invalid('apiKey');
  return value;
}
export function validateProviderConfig(provider,config,previous) {
  if(!providerIds.includes(provider))throw invalid('provider');
  const value=configRecord(config,['model','endpoint','keyAction','apiKey'],provider);
  if(typeof value.model!=='string'||!value.model.trim()||[...value.model].length>200||controls.test(value.model))throw invalid('model');
  if(typeof value.endpoint!=='string'||value.endpoint.length>2048||controls.test(value.endpoint))throw invalid('endpoint');
  const url=validateEndpoint(provider,value.endpoint);
  if(!['retain','replace','delete'].includes(value.keyAction))throw invalid('keyAction');
  if(value.keyAction!=='replace'&&value.apiKey!==undefined&&value.apiKey!=='')throw invalid('apiKey');
  if(value.keyAction==='retain'&&!previous?.keyCipher)throw invalid('apiKey');
  if(value.keyAction==='retain'&&previous?.keyCipher){
    let old;try{old=new URL(previous.endpoint);}catch{throw invalid('endpoint');}
    if(old.hostname!==url.hostname)throw invalid('apiKey');
  }
  return {model:value.model.trim(),endpoint:url.href,keyAction:value.keyAction,...(value.keyAction==='replace'?{apiKey:validateApiKey(value.apiKey)}:{})};
}
