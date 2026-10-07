import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAiSettingsStore} from '../../src/storage/ai-settings-store.mjs';
import {createAiJobStore} from '../../src/storage/ai-job-store.mjs';
import {createAiPlanStore} from '../../src/storage/ai-plan-store.mjs';
import {createAiJobService} from '../../src/services/ai-job-service.mjs';
import {getCityByCode} from '../../src/domain/city-catalog.mjs';
import {planContent} from './ai-fixtures.mjs';

const endpoint='https://api.deepseek.com/chat/completions';
const protector={async protect(value){return Buffer.from(`protected:${value}`).toString('base64');},async unprotect(value){const text=Buffer.from(value,'base64').toString();if(!text.startsWith('protected:'))throw new Error('damaged');return text.slice(10);}};
const providerConfig={model:'deepseek-flash',endpoint,keyAction:'replace',apiKey:'FAKE-MODEL-KEY'};

export async function makeAiContext(t,{searchImpl,modelImpl,runLater=queueMicrotask,settingsProtector=protector}={}) {
  const dir=mkdtempSync(join(tmpdir(),'travel-ai-test-')),path=join(dir,'travel.sqlite'),database=openDatabase(path);
  let second=0,jobNumber=0,planNumber=0;
  const now=()=>new Date(Date.parse('2026-10-05T05:00:00.000Z')+second++*1000);
  const settingsStore=createAiSettingsStore(database,{protector:settingsProtector});
  await settingsStore.update({expectedRevision:0,providers:{deepseek:providerConfig},search:{keyMode:'separate',keyAction:'replace',apiKey:'FAKE-SEARCH-KEY'}});
  const jobStore=createAiJobStore(database,{now,createId:()=>`job-${++jobNumber}`});
  const planStore=createAiPlanStore(database,{now,createId:()=>`plan-${++planNumber}`});
  const networkCalls={search:0,model:0};
  const search={async search(args){networkCalls.search++;if(searchImpl)return searchImpl(args,networkCalls.search);
    const sourceId=`s${args.priorSources.length+1}`,city=args.query.split(' ')[0];return [{sourceId,title:`${city}旅游资料`,url:`https://example.com/${encodeURIComponent(city)}`,summary:'可核对的检索摘要。',publishedAt:'2026-09-01',retrievedAt:'2026-10-05T04:00:00.000Z'}];}};
  const models={async generate(args){networkCalls.model++;if(modelImpl)return modelImpl(args,networkCalls.model);return {content:JSON.stringify(planContent(args.request)),usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}};}};
  const jobs=createAiJobService({database,settingsStore,jobStore,planStore,search,models,resolveCity:getCityByCode,runLater});
  t.after(async()=>{await jobs.shutdown();database.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,path,jobs,jobStore,settingsStore,planStore,database,networkCalls};
}

export const aiCommand=(settingsRevision,input,operationId='op-1')=>({operationId,settingsRevision,provider:'deepseek',input});
