import {ValidationError} from '../shared/trip-validation.mjs';

const invalid=()=>new ValidationError({endpoint:'请使用该平台官方支持的完整 HTTPS 接口地址'});
const modelEndpoints={
  deepseek:{hosts:['api.deepseek.com'],paths:['/chat/completions','/v1/chat/completions']},
  zhipu:{hosts:['open.bigmodel.cn'],paths:['/api/paas/v4/chat/completions']},
  mimo:{hosts:['api.xiaomimimo.com'],paths:['/v1/chat/completions']},
  kimi:{hosts:['api.moonshot.cn','api.moonshot.ai'],paths:['/v1/chat/completions']},
  qwen:{hosts:['dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','dashscope-us.aliyuncs.com','cn-hongkong.dashscope.aliyuncs.com'],paths:['/compatible-mode/v1/chat/completions']}
};
const workspaceRegions=new Set(['cn-beijing','ap-southeast-1','eu-central-1','ap-northeast-1','cn-hongkong','us-east-1']);
function qwenWorkspace(host) {
  const match=/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z0-9-]+)\.maas\.aliyuncs\.com$/.exec(host);
  return !!match&&match[1]!=='trial'&&!match[1].startsWith('xn--')&&workspaceRegions.has(match[2]);
}
export const zhipuSearchEndpoint='https://open.bigmodel.cn/api/paas/v4/web_search';

/** Validate the original spelling as well as the URL parser's normalized result. */
export function validateEndpoint(provider,value,kind='model') {
  if(typeof value!=='string'||value.length>2048||/[^\x21-\x7e]|[%\\?#]/u.test(value))throw invalid();
  const spelling=/^https:\/\/([^/]+)(\/.*)$/.exec(value);
  let url;try{url=new URL(value);}catch{throw invalid();}
  if(!spelling||![url.hostname,`${url.hostname}:443`].includes(spelling[1].toLowerCase())||url.protocol!=='https:'||url.username||url.password||url.hash||url.search||(url.port&&url.port!=='443')||url.hostname.endsWith('.')||spelling[2]!==url.pathname)throw invalid();
  if(kind==='search'){
    if(provider!=='zhipu'||url.href!==zhipuSearchEndpoint)throw invalid();
  }else if(kind==='model'){
    const entry=Object.hasOwn(modelEndpoints,provider)&&modelEndpoints[provider];
    if(!entry||!entry.paths.includes(url.pathname)||!(entry.hosts.includes(url.hostname)||(provider==='qwen'&&qwenWorkspace(url.hostname))))throw invalid();
  }else throw invalid();
  return url;
}
