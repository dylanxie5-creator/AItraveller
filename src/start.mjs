import {createServer} from 'node:http';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openDatabase} from './storage/database.mjs';
import {createTravelService} from './services/travel-service.mjs';
import {createHttpApp} from './server/http-app.mjs';
export async function startServer({dbPath=fileURLToPath(new URL('../runtime/travel.sqlite',import.meta.url)),port=3210,host='127.0.0.1'}={}) {
  if(host!=='127.0.0.1')throw new Error('Only loopback is supported');
  mkdirSync(dirname(dbPath),{recursive:true});const database=openDatabase(dbPath);const server=createServer();
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}catch(error){database.close();throw error;}
  const actual=server.address().port;server.on('request',createHttpApp({service:createTravelService({database}),allowedHosts:[`127.0.0.1:${actual}`,`localhost:${actual}`]}));
  return {server,url:`http://127.0.0.1:${actual}`,async close(){await new Promise(r=>server.close(r));database.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const running=await startServer({port:process.env.TRAVEL_PORT?Number(process.env.TRAVEL_PORT):3210, ...(process.env.TRAVEL_DB_PATH?{dbPath:resolve(process.env.TRAVEL_DB_PATH)}:{})});
    console.log(`智游足迹已启动：${running.url}`);
    const stop=async()=>{await running.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }catch(error){console.error('无法启动本机旅行网站：',error.code??error.name);process.exitCode=1;}
}
