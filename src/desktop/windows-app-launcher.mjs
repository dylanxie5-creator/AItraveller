import {existsSync as defaultExistsSync} from 'node:fs';
import {win32} from 'node:path';
import {spawn as defaultSpawn} from 'node:child_process';
import {startServer} from '../start.mjs';

export class DesktopLaunchError extends Error {
  constructor(code) {
    super(code);
    this.name='DesktopLaunchError';
    this.code=code;
  }
}

export function resolveEdgeExecutable({env=process.env,existsSync=defaultExistsSync}={}) {
  const roots=[env['ProgramFiles(x86)'],env.ProgramFiles,env.LOCALAPPDATA].filter(Boolean);
  for(const root of roots) {
    const candidate=win32.join(root,'Microsoft','Edge','Application','msedge.exe');
    if(existsSync(candidate))return candidate;
  }
  throw new DesktopLaunchError('EDGE_NOT_FOUND');
}

export function buildEdgeArguments({url,profileDirectory}) {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--disable-background-mode',
    '--disable-features=msEdgeFirstRunExperience'
  ];
}

function publicFailure(error,fallback) {
  if(error instanceof DesktopLaunchError)return error;
  if(error?.code==='EADDRINUSE'||error?.code==='DATABASE_IN_USE')return new DesktopLaunchError('ALREADY_RUNNING');
  return new DesktopLaunchError(fallback);
}

function waitForEdge(child,signal) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{
      child.removeListener('error',onError);
      child.removeListener('exit',onExit);
      signal?.removeEventListener('abort',onAbort);
    };
    const finish=action=>{
      if(settled)return;
      settled=true;cleanup();action();
    };
    const onError=()=>finish(()=>reject(new DesktopLaunchError('EDGE_START_FAILED')));
    const onExit=code=>finish(()=>resolve({edgeExitCode:Number.isInteger(code)?code:null}));
    const onAbort=()=>finish(()=>{
      try{child.kill();}catch{}
      resolve({edgeExitCode:null});
    });
    child.once('error',onError);
    child.once('exit',onExit);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)onAbort();
  });
}

export async function runWindowsApp({
  startServerImpl=startServer,
  spawnImpl=defaultSpawn,
  edgePath,
  port=3210,
  dbPath,
  profileDirectory,
  signal
}) {
  let running,result,failure;
  try {
    try {
      running=await startServerImpl({port,...(dbPath?{dbPath}:{})});
    }catch(error){throw publicFailure(error,'SERVER_START_FAILED');}
    let child;
    try {
      child=spawnImpl(edgePath,buildEdgeArguments({url:running.url,profileDirectory}),{
        shell:false,
        stdio:'ignore',
        windowsHide:true
      });
    }catch(error){throw publicFailure(error,'EDGE_START_FAILED');}
    result=await waitForEdge(child,signal);
  }catch(error){failure=publicFailure(error,'LAUNCHER_FAILED');}
  if(running) {
    try{await running.close();}
    catch(error){if(!failure)failure=publicFailure(error,'SERVER_STOP_FAILED');}
  }
  if(failure)throw failure;
  return result;
}
