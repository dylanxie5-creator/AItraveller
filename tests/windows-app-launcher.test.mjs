import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {
  buildEdgeArguments,
  DesktopLaunchError,
  resolveEdgeExecutable,
  runWindowsApp
} from '../src/desktop/windows-app-launcher.mjs';

test('Edge path resolution checks isolated Windows install candidates in order',()=>{
  const checked=[];
  const env={
    'ProgramFiles(x86)':'C:\\Program Files (x86)',
    ProgramFiles:'D:\\Program Files',
    LOCALAPPDATA:'C:\\用户\\旅行者\\AppData\\Local'
  };
  const found=resolveEdgeExecutable({env,existsSync:path=>{
    checked.push(path);
    return path==='D:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  }});
  assert.equal(found,'D:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.deepEqual(checked,[
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'D:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ]);
});

test('Edge path resolution fails with one stable public code',()=>{
  assert.throws(
    ()=>resolveEdgeExecutable({env:{ProgramFiles:'C:\\Program Files'},existsSync:()=>false}),
    error=>error instanceof DesktopLaunchError&&error.code==='EDGE_NOT_FOUND'&&error.message==='EDGE_NOT_FOUND'
  );
});

test('Edge arguments keep the URL and Chinese profile path as separate entries',()=>{
  assert.deepEqual(buildEdgeArguments({
    url:'http://127.0.0.1:3210',
    profileDirectory:'C:\\旅行 项目\\runtime\\edge-app-profile'
  }),[
    '--app=http://127.0.0.1:3210',
    '--user-data-dir=C:\\旅行 项目\\runtime\\edge-app-profile',
    '--no-first-run',
    '--disable-background-mode',
    '--disable-features=msEdgeFirstRunExperience'
  ]);
});

function childProcess({onKill}={}) {
  const child=new EventEmitter();
  child.kill=()=>{onKill?.();return true;};
  return child;
}

test('lifecycle starts Edge without a shell then closes the server once after the window exits',async()=>{
  const events=[];let closeCount=0,spawnCall;
  const child=childProcess();
  const resultPromise=runWindowsApp({
    startServerImpl:async options=>{
      events.push(['server',options]);
      return {url:'http://127.0.0.1:4321',close:async()=>{closeCount++;events.push(['close']);}};
    },
    spawnImpl:(file,args,options)=>{
      events.push(['edge']);spawnCall={file,args,options};
      queueMicrotask(()=>child.emit('exit',0,null));
      return child;
    },
    edgePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    port:4321,
    dbPath:'C:\\旅行 项目\\runtime\\qa.sqlite',
    profileDirectory:'C:\\旅行 项目\\runtime\\edge-profile'
  });
  assert.deepEqual(await resultPromise,{edgeExitCode:0});
  assert.deepEqual(events.map(entry=>entry[0]),['server','edge','close']);
  assert.equal(closeCount,1);
  assert.equal(spawnCall.file,'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.deepEqual(spawnCall.options,{shell:false,stdio:'ignore',windowsHide:true});
  assert.deepEqual(spawnCall.args,buildEdgeArguments({url:'http://127.0.0.1:4321',profileDirectory:'C:\\旅行 项目\\runtime\\edge-profile'}));
});

test('failure to spawn Edge closes the server once and exposes no raw error',async()=>{
  let closeCount=0;
  const child=childProcess();
  const pending=runWindowsApp({
    startServerImpl:async()=>({url:'http://127.0.0.1:3210',close:async()=>{closeCount++;}}),
    spawnImpl:()=>{queueMicrotask(()=>child.emit('error',new Error('SECRET raw spawn detail')));return child;},
    edgePath:'C:\\Edge\\msedge.exe',profileDirectory:'C:\\旅行\\profile'
  });
  await assert.rejects(pending,error=>error instanceof DesktopLaunchError&&error.code==='EDGE_START_FAILED'&&error.message==='EDGE_START_FAILED'&&!JSON.stringify(error).includes('SECRET'));
  assert.equal(closeCount,1);
});

test('lifecycle closes the server once after a nonzero Edge exit',async()=>{
  let closeCount=0;
  const child=childProcess();
  const pending=runWindowsApp({
    startServerImpl:async()=>({url:'http://127.0.0.1:3210',close:async()=>{closeCount++;}}),
    spawnImpl:()=>{queueMicrotask(()=>child.emit('exit',9,null));return child;},
    edgePath:'C:\\Edge\\msedge.exe',profileDirectory:'C:\\旅行\\profile'
  });
  assert.deepEqual(await pending,{edgeExitCode:9});
  assert.equal(closeCount,1);
});

test('abort terminates the Edge child and closes the server once',async()=>{
  let closeCount=0,killCount=0;
  const controller=new AbortController();
  const child=childProcess({onKill:()=>{killCount++;queueMicrotask(()=>child.emit('exit',0,'SIGTERM'));}});
  const pending=runWindowsApp({
    startServerImpl:async()=>({url:'http://127.0.0.1:3210',close:async()=>{closeCount++;}}),
    spawnImpl:()=>{queueMicrotask(()=>controller.abort());return child;},
    edgePath:'C:\\Edge\\msedge.exe',profileDirectory:'C:\\旅行\\profile',signal:controller.signal
  });
  assert.deepEqual(await pending,{edgeExitCode:null});
  assert.equal(killCount,1);
  assert.equal(closeCount,1);
});

test('second instance failure never spawns Edge or closes an unrelated server',async()=>{
  let spawnCount=0;
  await assert.rejects(runWindowsApp({
    startServerImpl:async()=>{const error=new Error('private database path');error.code='DATABASE_IN_USE';throw error;},
    spawnImpl:()=>{spawnCount++;return childProcess();},
    edgePath:'C:\\Edge\\msedge.exe',profileDirectory:'C:\\旅行\\profile'
  }),error=>error instanceof DesktopLaunchError&&error.code==='ALREADY_RUNNING'&&error.message==='ALREADY_RUNNING');
  assert.equal(spawnCount,0);
});

test('unexpected server shutdown terminates Edge and never reports a normal lifecycle result',async()=>{
  let closeCount=0,killCount=0,resolveClosed;
  const serverController=new AbortController();
  const closed=new Promise(resolve=>{resolveClosed=resolve;});
  const child=childProcess({onKill:()=>{killCount++;queueMicrotask(()=>child.emit('exit',0,'SIGTERM'));}});
  const pending=runWindowsApp({
    startServerImpl:async()=>({
      url:'http://127.0.0.1:3210',
      signal:serverController.signal,
      closed,
      close:async()=>{closeCount++;}
    }),
    spawnImpl:()=>{
      queueMicrotask(()=>{serverController.abort();resolveClosed({ownershipLost:true});});
      setTimeout(()=>child.emit('exit',0,null),20);
      return child;
    },
    edgePath:'C:\\Edge\\msedge.exe',profileDirectory:'C:\\旅行\\profile'
  });
  await assert.rejects(pending,error=>error instanceof DesktopLaunchError&&error.code==='SERVER_STOPPED'&&error.message==='SERVER_STOPPED');
  assert.equal(killCount,1);
  assert.equal(closeCount,1);
});

test('cancellation keeps a delayed child spawn error handled until the child finishes',async()=>{
  let closeCount=0;
  const controller=new AbortController();
  const child=childProcess();
  const pending=runWindowsApp({
    startServerImpl:async()=>({url:'http://127.0.0.1:3210',close:async()=>{closeCount++;}}),
    spawnImpl:()=>{
      queueMicrotask(()=>controller.abort());
      setImmediate(()=>child.emit('error',new Error('SECRET delayed spawn failure')));
      return child;
    },
    edgePath:'Z:\\missing\\msedge.exe',profileDirectory:'C:\\旅行\\profile',signal:controller.signal
  });
  assert.deepEqual(await pending,{edgeExitCode:null});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closeCount,1);
});

test('an already cancelled launch starts neither the server nor Edge',async()=>{
  let starts=0,spawns=0;
  const controller=new AbortController();controller.abort();
  assert.deepEqual(await runWindowsApp({
    startServerImpl:async()=>{starts++;return {url:'http://127.0.0.1:3210',close:async()=>{}};},
    spawnImpl:()=>{spawns++;return childProcess();},
    edgePath:'C:\\Edge\\msedge.exe',profileDirectory:'C:\\旅行\\profile',signal:controller.signal
  }),{edgeExitCode:null});
  assert.equal(starts,0);
  assert.equal(spawns,0);
});
