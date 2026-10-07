import {createHash} from 'node:crypto';
import {AiError} from '../ai/errors.mjs';
import {providerIds,configRecord} from '../ai/provider-config.mjs';
import {normalizeAiInput,normalizePlanContent} from '../ai/validation.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {StoreError,conflict,validId,validRevision} from '../storage/errors.mjs';

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const messages={
  AI_SEARCH_EMPTY:'未检索到有效资料，本次没有调用规划模型',AI_AUTH:'API Key 无效，请检查配置',AI_RATE_LIMIT:'请求受限，请稍后手动重试',
  AI_TIMEOUT:'请求超时，请手动重试',AI_CANCELLED:'请求已取消',AI_ENDPOINT_BLOCKED:'接口地址不安全',AI_RESPONSE:'平台响应无效',
  AI_SEARCH_RESPONSE:'检索资料格式异常，请保留输入后重新生成',AI_NETWORK:'无法连接外部平台',AI_MODEL_RESPONSE:'模型未返回正常完成的文本攻略',
  AI_MODEL_TRUNCATED:'攻略达到输出上限，本次不会自动续写',AI_MODEL_JSON:'模型未返回有效的 JSON 对象，本次不会自动修复或追加调用'
};
function safeError(error) {
  if(error instanceof ValidationError)return {code:'VALIDATION',message:'生成结果未通过本地校验，请调整输入后手动重试',fields:canonical(error.fields??{})};
  if(error instanceof AiError&&Object.hasOwn(messages,error.code))return {code:error.code,message:messages[error.code]};
  return {code:'AI_JOB_FAILED',message:'本次规划未能保存，输入和调用次数已保留，请手动重试'};
}
function parseModelContent(result) {
  if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.content!=='string')throw new AiError('AI_MODEL_RESPONSE',messages.AI_MODEL_RESPONSE);
  try {const value=JSON.parse(result.content);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch{throw new AiError('AI_MODEL_JSON',messages.AI_MODEL_JSON);}
}

export function createAiJobService({database,settingsStore,jobStore,planStore,search,models,resolveCity,runLater=queueMicrotask}) {
  const controllers=new Map(),scheduled=new Map();let stopping=false;
  function snapshotInput(value) {
    const input=configRecord(value,['name','startDate','endDate','travelerCount','budgetYuan','cityCodes','preferences'],'input');
    if(Object.hasOwn(input,'cityCodes')) {
      const cities=input.cityCodes;
      if(!Array.isArray(cities)||Object.getPrototypeOf(cities)!==Array.prototype||Reflect.ownKeys(cities).length!==cities.length+1)throw new ValidationError({cityCodes:'请选择有效城市'});
      input.cityCodes=Array.from({length:cities.length},(_,index)=>{
        const descriptor=Object.getOwnPropertyDescriptor(cities,String(index));if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new ValidationError({cityCodes:'请选择有效城市'});return descriptor.value;
      });
    }
    return input;
  }
  function snapshotCommand(command) {
    const value=configRecord(command,['operationId','settingsRevision','provider','input'],'form');
    if(!validId(value.operationId))throw new ValidationError({operationId:'规划请求编号无效'});
    return {operationId:value.operationId,settingsRevision:value.settingsRevision,provider:value.provider,input:snapshotInput(value.input)};
  }
  function validateCommand(command) {
    if(!validRevision(command.settingsRevision)||command.settingsRevision<1||!providerIds.includes(command.provider))throw new ValidationError({form:'规划请求无效'});
    return normalizeAiInput(command.input,resolveCity);
  }
  async function execute(id,request,credentials) {
    const controller=new AbortController();controllers.set(id,controller);
    try {
      let sources=[];
      for(const city of request.cities) {
        jobStore.reserveSearch(id);
        const found=await search.search({query:`${city.cityName} 旅游攻略`,key:credentials.searchKey,priorSources:sources,signal:controller.signal});
        if(!Array.isArray(found))throw new AiError('AI_SEARCH_RESPONSE',messages.AI_SEARCH_RESPONSE);
        if(!sources.length&&!found.length)throw new AiError('AI_SEARCH_EMPTY',messages.AI_SEARCH_EMPTY);
        sources=[...sources,...found];jobStore.recordSources(id,sources);
      }
      if(!sources.length)throw new AiError('AI_SEARCH_EMPTY',messages.AI_SEARCH_EMPTY);
      const reserved=jobStore.reserveModel(id);
      const result=await models.generate({provider:reserved.provider,model:reserved.model,endpoint:reserved.endpoint,key:credentials.modelKey,request,sources,signal:controller.signal});
      const content=normalizePlanContent(parseModelContent(result),{request,sources,resolveCity});
      database.transaction(()=>{const plan=planStore.insertGenerated({content,sources,provider:reserved.provider,model:reserved.model});jobStore.finish(id,plan.id);});
    }catch(error) {
      const current=jobStore.get(id);
      if(current&&['queued','searching','generating'].includes(current.state)) {
        try{jobStore.fail(id,safeError(error));}catch(failure){if(!(failure instanceof StoreError)||failure.code!=='CONFLICT')throw failure;}
      }
    }finally{controllers.delete(id);}
  }
  function schedule(id,request,credentials) {
    let resolveDone,started=false,finished=false;
    const promise=new Promise(resolve=>{resolveDone=resolve;});
    const finish=()=>{if(finished)return;finished=true;scheduled.delete(id);resolveDone();};
    const entry={promise,get started(){return started;},cancel:finish};scheduled.set(id,entry);
    try {runLater(()=>{if(finished)return;if(stopping){finish();return;}started=true;Promise.resolve(execute(id,request,credentials)).finally(finish);});}
    catch(error){try{jobStore.fail(id,safeError(error));}finally{finish();}}
  }
  async function submit(raw) {
    if(stopping)throw new AiError('AI_CANCELLED','服务正在关闭，请稍后重新打开');
    const command=snapshotCommand(raw);
    const fingerprint=createHash('sha256').update(JSON.stringify(canonical({settingsRevision:command.settingsRevision,provider:command.provider,input:command.input}))).digest('hex');
    const existing=jobStore.findOperation(command.operationId);
    if(existing){if(existing.requestHash!==fingerprint)throw conflict();return jobStore.get(existing.id);}
    const request=validateCommand(command);
    const publicSettings=settingsStore.getPublic();
    if(publicSettings.revision!==command.settingsRevision)throw conflict();
    const configured=publicSettings.providers[command.provider];
    if(!configured?.model||!configured?.endpoint||!configured.keyConfigured)throw new AiError('AI_KEY_REQUIRED','请先配置所选模型和智谱搜索的 API Key');
    const credentials=await settingsStore.resolveCredentials(command.provider,command.settingsRevision);
    const created=database.transaction(()=>{
      const latest=settingsStore.getPublic();if(latest.revision!==command.settingsRevision||latest.jobActive)throw conflict();
      return jobStore.create(command,fingerprint,{settingsRevision:command.settingsRevision,provider:command.provider,model:credentials.model,endpoint:credentials.endpoint});
    });
    schedule(created.id,request,credentials);return created;
  }
  function recover(){return jobStore.interruptActive();}
  async function settled(){await Promise.all([...scheduled.values()].map(entry=>entry.promise));}
  async function shutdown() {
    if(stopping){await settled();return;}stopping=true;
    for(const controller of controllers.values())controller.abort();
    jobStore.interruptActive();
    for(const entry of [...scheduled.values()])if(!entry.started)entry.cancel();
    await settled();
  }
  return {submit,get:jobStore.get,list:jobStore.list,recover,settled,shutdown};
}
