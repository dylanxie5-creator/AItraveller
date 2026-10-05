import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AiError} from '../ai/errors.mjs';

const unavailable=()=>new AiError('AI_CREDENTIALS_UNAVAILABLE','密钥无法加解密，请在当前 Windows 用户下重新配置');
const base64=value=>typeof value==='string'&&value.length>0&&value.length<=65536&&value.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(value);
export function createDpapiProtector({spawnImpl=spawn}={}) {
  async function run(operation,value) {
    if(process.platform!=='win32'||typeof value!=='string'||(operation==='protect'?(!value||[...value].length>4096):!base64(value)))throw unavailable();
    return new Promise((resolve,reject)=>{
      let child,timer,done=false,size=0;const chunks=[];
      const fail=()=>{if(done)return;done=true;clearTimeout(timer);child?.kill();reject(unavailable());};
      try {
        child=spawnImpl('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./dpapi.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
        timer=setTimeout(fail,10000);child.once('error',fail);child.stdin.on('error',fail);child.stderr.resume();
        child.stdout.on('data',chunk=>{size+=chunk.length;if(size>65536)fail();else chunks.push(chunk);});
        child.once('close',code=>{
          if(done)return;clearTimeout(timer);
          try {
            if(code!==0)throw unavailable();
            const output=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if(!output||Object.keys(output).length!==1||typeof output.result!=='string'||(operation==='protect'?!base64(output.result):(!output.result||[...output.result].length>4096)))throw unavailable();
            done=true;resolve(output.result);
          }catch{fail();}
        });
        // Private pipes only: no credential in argv, environment, logs or files.
        child.stdin.end(JSON.stringify({operation,value}),'utf8');
      }catch{fail();}
    });
  }
  return {protect:plain=>run('protect',plain),unprotect:cipher=>run('unprotect',cipher)};
}
