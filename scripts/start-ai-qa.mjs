import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startServer} from '../src/start.mjs';
import {createAiSettingsStore} from '../src/storage/ai-settings-store.mjs';
import {createAiJobStore} from '../src/storage/ai-job-store.mjs';
import {createAiPlanStore} from '../src/storage/ai-plan-store.mjs';
import {createAiConversionStore} from '../src/storage/ai-conversion-store.mjs';
import {createTripStore} from '../src/storage/trip-store.mjs';
import {createAiJobService} from '../src/services/ai-job-service.mjs';
import {createAiPlanService} from '../src/services/ai-plan-service.mjs';
import {createDpapiProtector} from '../src/platform/dpapi.mjs';
import {getCityByCode} from '../src/domain/city-catalog.mjs';

function mockPlan(request) {
  const start=Date.parse(request.startDate+'T00:00:00Z'),days=Math.round((Date.parse(request.endDate+'T00:00:00Z')-start)/86400000)+1;
  const date=index=>new Date(start+index*86400000).toISOString().slice(0,10);
  const boundaries=Array.from({length:request.cities.length-1},(_,index)=>Math.max(index,Math.floor((index+1)*(days-1)/request.cities.length)));
  const cities=request.cities.map((city,index)=>({...city,arrivalDate:date(index===0?0:boundaries[index-1]),departureDate:date(index===request.cities.length-1?days-1:boundaries[index]),order:index}));
  return {trip:{name:request.name,startDate:request.startDate,endDate:request.endDate,travelerCount:request.travelerCount,budgetCents:request.budgetCents,cities},
    days:Array.from({length:days},(_,index)=>{const day=date(index),city=cities.find(item=>item.arrivalDate<=day&&day<=item.departureDate);return {date:day,activities:[{cityCode:city.cityCode,title:'模拟城市漫步',description:'这是本机验收固定内容，不来自真实模型。',sourceIds:[`s${request.cities.findIndex(item=>item.cityCode===city.cityCode)+1}`]}]};}),
    cautions:['模拟验收：出行前请核对真实开放时间。']};
}

export function createQaAi({database,protector=createDpapiProtector()}={}) {
  const settings=createAiSettingsStore(database,{protector}),jobStore=createAiJobStore(database),planStore=createAiPlanStore(database),conversionStore=createAiConversionStore(database),tripStore=createTripStore(database);
  const qaEvidence={mode:'SIMULATED_NO_EXTERNAL_TRANSPORT',searchCalls:0,modelCalls:0};
  const search={async search({query,priorSources}){qaEvidence.searchCalls++;const city=query.split(' ')[0];return [{sourceId:`s${priorSources.length+1}`,title:`${city}模拟旅游资料`,url:`https://example.com/qa/${encodeURIComponent(city)}`,summary:'固定模拟搜索摘要，仅用于本机页面验收。',publishedAt:'2026-09-01',retrievedAt:new Date().toISOString()}];}};
  const models={async generate({request}){qaEvidence.modelCalls++;return {content:JSON.stringify(mockPlan(request)),usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}};}};
  const jobs=createAiJobService({database,settingsStore:settings,jobStore,planStore,search,models,resolveCity:getCityByCode});
  const plans=createAiPlanService({database,planStore,conversionStore,tripStore,resolveCity:getCityByCode});
  return {settings,jobs,plans,qaEvidence};
}

export function parseQaArguments(argv) {
  const result={port:3211,db:null};
  for(let i=0;i<argv.length;i+=2){if(argv[i]==='--port')result.port=Number(argv[i+1]);else if(argv[i]==='--db')result.db=argv[i+1];else throw new Error('仅支持 --port 和 --db');}
  if(!Number.isInteger(result.port)||result.port<1||result.port>65535||!result.db)throw new Error('用法：node scripts/start-ai-qa.mjs --port 3211 --db runtime/qa-ai.sqlite');
  const path=resolve(result.db),production=resolve(fileURLToPath(new URL('../runtime/travel.sqlite',import.meta.url)));
  if(path.toLowerCase()===production.toLowerCase())throw new Error('QA 服务禁止连接正式 runtime/travel.sqlite');
  return {port:result.port,dbPath:path};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options=parseQaArguments(process.argv.slice(2));
    const running=await startServer({...options,aiFactory:({database})=>createQaAi({database})});
    console.log('【模拟模式】不会连接任何真实搜索或模型平台，也不会产生付费请求。');
    console.log(`AI 页面验收服务：${running.url}`);
    const stop=async()=>{await running.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }catch(error){console.error('无法启动 AI 模拟验收服务：',error.message);process.exitCode=1;}
}
