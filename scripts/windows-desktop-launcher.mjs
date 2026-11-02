import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolveEdgeExecutable,runWindowsApp} from '../src/desktop/windows-app-launcher.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const allowedCodes=new Set([
  'ALREADY_RUNNING','EDGE_NOT_FOUND','EDGE_START_FAILED','EDGE_EXIT_FAILED',
  'SERVER_START_FAILED','SERVER_STOPPED','SERVER_STOP_FAILED','LAUNCHER_FAILED','INVALID_PORT'
]);

export async function writeLauncherLog(path,record) {
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,`${JSON.stringify(record)}\n`,'utf8');
}

function stableCode(error) {
  if(error?.code==='EADDRINUSE'||error?.code==='DATABASE_IN_USE')return 'ALREADY_RUNNING';
  return allowedCodes.has(error?.code)?error.code:'LAUNCHER_FAILED';
}

function parsePort(value) {
  if(value===undefined||value==='')return 3210;
  if(!/^\d+$/.test(value))throw Object.assign(new Error('INVALID_PORT'),{code:'INVALID_PORT'});
  const port=Number(value);
  if(!Number.isInteger(port)||port<1||port>65535)throw Object.assign(new Error('INVALID_PORT'),{code:'INVALID_PORT'});
  return port;
}

export async function runDesktopEntry({
  runWindowsAppImpl=runWindowsApp,
  env=process.env,
  writeLog,
  signal,
  resolveEdgeImpl=resolveEdgeExecutable,
  now=()=>new Date(),
  root=projectRoot
}={}) {
  const runtime=resolve(root,'runtime');
  const logPath=resolve(runtime,'launcher.log');
  const emit=writeLog??(record=>writeLauncherLog(logPath,record));
  const record=(stage,code)=>emit({timestamp:now().toISOString(),stage,code});
  try {
    const port=parsePort(env.TRAVEL_PORT);
    const dbPath=resolve(root,env.TRAVEL_DB_PATH||'runtime/travel.sqlite');
    const profileDirectory=resolve(root,env.TRAVEL_EDGE_PROFILE||'runtime/edge-app-profile');
    const edgePath=resolveEdgeImpl({env});
    await record('starting','STARTING');
    const result=await runWindowsAppImpl({edgePath,port,dbPath,profileDirectory,signal});
    if(result.edgeExitCode!==0&&result.edgeExitCode!==null) {
      await record('failed','EDGE_EXIT_FAILED');
      return 1;
    }
    await record('stopped','OK');
    return 0;
  }catch(error) {
    const code=stableCode(error);
    try{await record('failed',code);}catch{}
    return code==='ALREADY_RUNNING'?2:1;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  process.exitCode=await runDesktopEntry({signal:controller.signal});
  process.removeListener('SIGINT',stop);
  process.removeListener('SIGTERM',stop);
}
