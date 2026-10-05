import {spawn} from 'node:child_process';
import {existsSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StoreError} from '../storage/errors.mjs';

const unavailable=()=>new StoreError('DATABASE_LOCK_UNAVAILABLE','无法保护数据库，请检查本机 PowerShell 和文件权限');
export function canonicalDatabasePath(path) {
  const absolute=resolve(path);
  const canonical=existsSync(absolute)?realpathSync(absolute):join(realpathSync(dirname(absolute)),basename(absolute));
  // Hard-link aliases cannot safely share a sidecar lock name.
  if(existsSync(canonical)&&statSync(canonical).nlink>1)throw unavailable();
  return process.platform==='win32'?canonical.toLowerCase():canonical;
}
export async function acquireDatabaseLock(path,{spawnImpl=spawn}={}) {
  if(process.platform!=='win32')throw unavailable();
  let child;
  try {
    const canonical=canonicalDatabasePath(path);
    child=spawnImpl('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./database-lock.ps1',import.meta.url)),'-LockPath',canonical+'.owner.lock'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  }catch{throw unavailable();}
  let intentional=false,ready=false,ended=false,releasePromise;
  let resolveLost,resolveExit;
  const lost=new Promise(resolve=>{resolveLost=resolve;});const exited=new Promise(resolve=>{resolveExit=resolve;});
  child.stdin.on('error',()=>{});child.stderr.resume();
  const finish=()=>{if(ended)return;ended=true;resolveExit();if(ready&&!intentional)resolveLost();};
  child.once('exit',finish);child.once('error',finish);
  async function release() {
    if(releasePromise)return releasePromise;intentional=true;
    releasePromise=(async()=>{
      if(ended)return;
      child.stdin.end();const timer=setTimeout(()=>child.kill(),3000);
      try{await exited;}finally{clearTimeout(timer);}
    })();return releasePromise;
  }
  try {
    await new Promise((resolveReady,reject)=>{
      let output='';const timer=setTimeout(()=>reject(unavailable()),10000);
      const fail=()=>{clearTimeout(timer);reject(unavailable());};
      const data=chunk=>{
        output+=chunk.toString();if(output.length>1024){fail();return;}
        if(!output.includes('\n'))return;
        clearTimeout(timer);const signal=output.trim();
        if(signal==='READY'&&!ended){ready=true;resolveReady();}
        else reject(signal==='BUSY'?new StoreError('DATABASE_IN_USE','此数据库已由另一个网站进程使用，请先关闭原进程'):unavailable());
      };
      child.stdout.on('data',data);child.once('exit',fail);child.once('error',fail);
      exited.then(()=>{child.stdout.off('data',data);child.off('exit',fail);child.off('error',fail);});
    });
    return {release,lost};
  }catch(error){await release();throw error;}
}
