import {providerIds,configRecord,validateProviderConfig,validateApiKey} from '../ai/provider-config.mjs';
import {AiError} from '../ai/errors.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {conflict,corrupt,validRevision} from './errors.mjs';
import {createDpapiProtector} from '../platform/dpapi.mjs';

const credentialsUnavailable=()=>new AiError('AI_CREDENTIALS_UNAVAILABLE','已保存的密钥无法读取，请重新配置或明确删除');
const keyRequired=()=>new AiError('AI_KEY_REQUIRED','请先配置所选模型和智谱搜索的 API Key');
const invalid=()=>new ValidationError({settings:'请检查设置内容'});
const cipherValid=value=>value===null||(typeof value==='string'&&value.length>0&&value.length<=65536);
export function createAiSettingsStore(database,{protector=createDpapiProtector(),isJobActive=()=>!!database.db.prepare("SELECT 1 FROM ai_jobs WHERE state IN ('queued','searching','generating') LIMIT 1").get()}={}) {
  const {db}=database;
  function read() {
    const row=db.prepare('SELECT revision,payload FROM ai_settings WHERE id=1').get();
    if(!row)return {revision:0,providers:{},search:{keyMode:'zhipu',keyCipher:null}};
    try {
      if(!validRevision(row.revision)||row.revision<1||row.revision>=Number.MAX_SAFE_INTEGER)throw corrupt();
      const payload=configRecord(JSON.parse(row.payload),['providers','search']);
      const providers=configRecord(payload.providers,providerIds),search=configRecord(payload.search,['keyMode','keyCipher']);
      if(!['zhipu','separate'].includes(search.keyMode)||!cipherValid(search.keyCipher))throw corrupt();
      for(const [id,entry] of Object.entries(providers)){
        const p=configRecord(entry,['model','endpoint','keyCipher']);
        if(!cipherValid(p.keyCipher))throw corrupt();
        validateProviderConfig(id,{model:p.model,endpoint:p.endpoint,keyAction:'delete'},null);
      }
      return {revision:row.revision,providers,search};
    }catch{throw corrupt();}
  }
  function publicSettings(value) {
    return {revision:value.revision,providers:Object.fromEntries(providerIds.map(id=>[id,{model:value.providers[id]?.model??'',endpoint:value.providers[id]?.endpoint??'',keyConfigured:!!value.providers[id]?.keyCipher}])),
      search:{keyMode:value.search.keyMode,keyConfigured:!!(value.search.keyMode==='zhipu'?value.providers.zhipu?.keyCipher:value.search.keyCipher)},jobActive:!!isJobActive()};
  }
  function guard(expectedRevision) {if(read().revision!==expectedRevision||isJobActive())throw conflict();}
  async function decrypt(cipher) {
    try{return validateApiKey(await protector.unprotect(cipher));}catch{throw credentialsUnavailable();}
  }
  async function changeKey(previous,action,apiKey,{allowMissing=false}={}) {
    if(action==='delete')return null;
    if(action==='retain') {if(previous)await decrypt(previous);else if(!allowMissing)throw invalid();return previous??null;}
    try {const cipher=await protector.protect(apiKey);if(!cipherValid(cipher)||cipher===null)throw credentialsUnavailable();return cipher;}catch{throw credentialsUnavailable();}
  }
  async function update(command) {
    const envelope=configRecord(command,['expectedRevision','providers','search']);
    if(!validRevision(envelope.expectedRevision)||envelope.expectedRevision>=Number.MAX_SAFE_INTEGER)throw invalid();
    const providers=configRecord(envelope.providers,providerIds),search=configRecord(envelope.search,['keyMode','keyAction','apiKey']);
    if(!['zhipu','separate'].includes(search.keyMode)||!['retain','replace','delete'].includes(search.keyAction))throw invalid();
    if(search.keyAction!=='replace'&&search.apiKey!==undefined&&search.apiKey!=='')throw invalid();
    if(search.keyMode==='zhipu'&&search.keyAction==='replace')throw invalid();
    if(search.keyAction==='replace')search.apiKey=validateApiKey(search.apiKey);
    const before=read();guard(envelope.expectedRevision);
    const normalized=Object.fromEntries(Object.entries(providers).map(([id,entry])=>[id,validateProviderConfig(id,entry,before.providers[id])]));
    const next={providers:{...before.providers},search:{...before.search,keyMode:search.keyMode}};
    for(const [id,p] of Object.entries(normalized))next.providers[id]={model:p.model,endpoint:p.endpoint,keyCipher:await changeKey(before.providers[id]?.keyCipher,p.keyAction,p.apiKey)};
    next.search.keyCipher=await changeKey(before.search.keyCipher,search.keyAction,search.apiKey,{allowMissing:search.keyMode==='zhipu'});
    return database.transaction(()=>{
      guard(envelope.expectedRevision);const revision=before.revision+1;
      db.prepare('INSERT INTO ai_settings(id,revision,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(revision,JSON.stringify(next));
      return publicSettings({revision,...next});
    });
  }
  async function resolveCredentials(provider,expectedRevision) {
    if(!providerIds.includes(provider)||!validRevision(expectedRevision))throw invalid();
    const value=read();if(value.revision!==expectedRevision)throw conflict();
    const p=value.providers[provider],searchCipher=value.search.keyMode==='zhipu'?value.providers.zhipu?.keyCipher:value.search.keyCipher;
    if(!p?.keyCipher||!searchCipher)throw keyRequired();
    const modelKey=await decrypt(p.keyCipher),searchKey=await decrypt(searchCipher);
    if(read().revision!==expectedRevision)throw conflict();
    return {model:p.model,endpoint:p.endpoint,modelKey,searchKey};
  }
  return {getPublic:()=>publicSettings(read()),update,resolveCredentials};
}
