import {createServer} from 'node:http';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareDatabase} from './storage/database.mjs';
import {acquireDatabaseLock,canonicalDatabasePath} from './platform/database-lock.mjs';
import {StoreError} from './storage/errors.mjs';
import {createTravelService} from './services/travel-service.mjs';
import {createAiJobService} from './services/ai-job-service.mjs';
import {createAiPlanService} from './services/ai-plan-service.mjs';
import {createAiSettingsStore} from './storage/ai-settings-store.mjs';
import {createAiJobStore} from './storage/ai-job-store.mjs';
import {createAiPlanStore} from './storage/ai-plan-store.mjs';
import {createAiConversionStore} from './storage/ai-conversion-store.mjs';
import {createTripStore} from './storage/trip-store.mjs';
import {createDpapiProtector} from './platform/dpapi.mjs';
import {createHttpsTransport} from './ai/https-transport.mjs';
import {createZhipuSearch} from './ai/zhipu-search.mjs';
import {createModelAdapters} from './ai/model-adapters.mjs';
import {getCityByCode} from './domain/city-catalog.mjs';
import {createHttpApp} from './server/http-app.mjs';
function createProductionAi({database}) {
  const settings=createAiSettingsStore(database,{protector:createDpapiProtector()}),jobStore=createAiJobStore(database),planStore=createAiPlanStore(database),conversionStore=createAiConversionStore(database),tripStore=createTripStore(database);
  const transport=createHttpsTransport(),search=createZhipuSearch({transport}),models=createModelAdapters({transport});
  const jobs=createAiJobService({database,settingsStore:settings,jobStore,planStore,search,models,resolveCity:getCityByCode});
  const plans=createAiPlanService({database,planStore,conversionStore,tripStore,resolveCity:getCityByCode});
  return {settings,jobs,plans};
}
export async function startServer({dbPath=fileURLToPath(new URL('../runtime/travel.sqlite',import.meta.url)),port=3210,host='127.0.0.1',lockFactory=acquireDatabaseLock,aiFactory=createProductionAi}={}) {
  if(host!=='127.0.0.1')throw new Error('Only loopback is supported');
  mkdirSync(dirname(dbPath),{recursive:true});dbPath=canonicalDatabasePath(dbPath);const ownership=await lockFactory(dbPath);
  const server=createServer();const controller=new AbortController();let database,ai,starting=true,ownershipLost=false,closing,resolveClosed;
  const closed=new Promise(resolve=>{resolveClosed=resolve;});
  const guard=()=>{if(ownershipLost)throw new StoreError('DATABASE_LOCK_LOST','数据库保护已失效，网站已停止，请重新启动');};
  async function close() {
    if(closing)return closing;
    controller.abort(new StoreError('SERVER_STOPPED','网站已停止'));
    closing=(async()=>{
      try {
        if(server.listening){const stopped=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await stopped;}
      }finally {try{await ai?.jobs?.shutdown?.();}finally{try{database?.close();}finally{await ownership.release();resolveClosed({ownershipLost});}}}
    })();return closing;
  }
  ownership.lost.then(()=>{
    ownershipLost=true;controller.abort(new StoreError('DATABASE_LOCK_LOST','数据库保护已失效'));
    if(!starting)void close();
  });
  try {
    guard();database=await prepareDatabase(dbPath,{signal:controller.signal});guard();ai=await aiFactory({database,signal:controller.signal});ai.jobs.recover();guard();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});guard();
    const actual=server.address().port;const app=createHttpApp({service:createTravelService({database}),ai,allowedHosts:[`127.0.0.1:${actual}`,`localhost:${actual}`]});
    server.on('request',(request,response)=>{
      if(ownershipLost||closing){response.writeHead(503);response.end();return;}
      app(request,response);
    });
    starting=false;return {server,url:`http://127.0.0.1:${actual}`,closed,signal:controller.signal,close};
  }catch(error){starting=false;await close();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const running=await startServer({port:process.env.TRAVEL_PORT?Number(process.env.TRAVEL_PORT):3210, ...(process.env.TRAVEL_DB_PATH?{dbPath:resolve(process.env.TRAVEL_DB_PATH)}:{})});
    console.log(`智游足迹已启动：${running.url}`);
    running.closed.then(({ownershipLost})=>{if(ownershipLost){console.error('数据库保护已失效，网站已安全停止');process.exitCode=1;}});
    const stop=async()=>{await running.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }catch(error){console.error('无法启动本机旅行网站：',error.code??error.name);process.exitCode=1;}
}
