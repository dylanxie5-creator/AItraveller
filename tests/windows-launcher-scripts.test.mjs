import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  runDesktopEntry,
  writeLauncherLog
} from '../scripts/windows-desktop-launcher.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const wrapper=join(projectRoot,'scripts','launch-windows.ps1');
const installer=join(projectRoot,'scripts','install-desktop-shortcut.ps1');

function encodedPowerShell(script) {
  return Buffer.from(`[Console]::OutputEncoding=[Text.Encoding]::UTF8;${script}`,'utf16le').toString('base64');
}

function powershell(script) {
  return spawnSync('powershell.exe',['-NoProfile','-EncodedCommand',encodedPowerShell(script)],{encoding:'utf8'});
}

function psLiteral(value) {return `'${String(value).replaceAll("'","''")}'`;}

test('desktop entry derives production paths from its own module location',async()=>{
  const calls=[],logs=[];
  const code=await runDesktopEntry({
    env:{},
    resolveEdgeImpl:()=> 'C:\\Edge\\msedge.exe',
    runWindowsAppImpl:async options=>{calls.push(options);return {edgeExitCode:0};},
    writeLog:async record=>logs.push(record),
    now:()=>new Date('2026-11-02T08:00:00.000Z')
  });
  assert.equal(code,0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].port,3210);
  assert.equal(calls[0].dbPath,join(projectRoot,'runtime','travel.sqlite'));
  assert.equal(calls[0].profileDirectory,join(projectRoot,'runtime','edge-app-profile'));
  assert.equal(calls[0].edgePath,'C:\\Edge\\msedge.exe');
  assert.deepEqual(logs,[
    {timestamp:'2026-11-02T08:00:00.000Z',stage:'starting',code:'STARTING'},
    {timestamp:'2026-11-02T08:00:00.000Z',stage:'stopped',code:'OK'}
  ]);
});

test('desktop entry honors isolated QA path and port overrides',async()=>{
  let captured;
  const code=await runDesktopEntry({
    env:{TRAVEL_PORT:'3221',TRAVEL_DB_PATH:'runtime/qa 数据.sqlite',TRAVEL_EDGE_PROFILE:'runtime/qa edge profile'},
    resolveEdgeImpl:()=> 'C:\\Edge\\msedge.exe',
    runWindowsAppImpl:async options=>{captured=options;return {edgeExitCode:0};},
    writeLog:async()=>{}
  });
  assert.equal(code,0);
  assert.equal(captured.port,3221);
  assert.equal(captured.dbPath,join(projectRoot,'runtime','qa 数据.sqlite'));
  assert.equal(captured.profileDirectory,join(projectRoot,'runtime','qa edge profile'));
});

for(const sourceCode of ['EADDRINUSE','DATABASE_IN_USE']) {
  test(`desktop entry maps ${sourceCode} without logging raw failure details`,async()=>{
    const logs=[];
    const error=new Error('SECRET api-key and private database path');error.code=sourceCode;
    const code=await runDesktopEntry({
      env:{},resolveEdgeImpl:()=> 'C:\\Edge\\msedge.exe',
      runWindowsAppImpl:async()=>{throw error;},
      writeLog:async record=>logs.push(record),
      now:()=>new Date('2026-11-02T08:00:00.000Z')
    });
    assert.equal(code,2);
    assert.equal(logs.at(-1).code,'ALREADY_RUNNING');
    assert.equal(JSON.stringify(logs).includes('SECRET'),false);
    assert.equal(JSON.stringify(logs).includes('private database'),false);
  });
}

test('desktop entry rejects an invalid port before starting Edge',async()=>{
  let launches=0;const logs=[];
  const code=await runDesktopEntry({
    env:{TRAVEL_PORT:'70000'},resolveEdgeImpl:()=> 'C:\\Edge\\msedge.exe',
    runWindowsAppImpl:async()=>{launches++;return {edgeExitCode:0};},
    writeLog:async record=>logs.push(record)
  });
  assert.equal(code,1);
  assert.equal(launches,0);
  assert.equal(logs.at(-1).code,'INVALID_PORT');
});

test('launcher log overwrites the previous bounded record',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'travel-launcher-log-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'runtime','launcher.log');
  await writeLauncherLog(path,{timestamp:'first',stage:'starting',code:'STARTING'});
  await writeLauncherLog(path,{timestamp:'second',stage:'failed',code:'EDGE_NOT_FOUND'});
  const text=readFileSync(path,'utf8');
  assert.equal(text,'{"timestamp":"second","stage":"failed","code":"EDGE_NOT_FOUND"}\n');
  assert.equal(text.includes('first'),false);
});

test('PowerShell launcher and shortcut installer parse with zero errors',()=>{
  const command=`$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile(${psLiteral(wrapper)},[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1};$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile(${psLiteral(installer)},[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}`;
  const result=powershell(command);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});

test('PowerShell launcher stops at missing Node preflight without opening Edge',()=>{
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',wrapper,'-NodePath','Z:\\missing\\node.exe','-NoPopup'],{encoding:'utf8'});
  assert.equal(result.status,10,`${result.stdout}\n${result.stderr}`);
});

test('shortcut installer creates an inspectable idempotent desktop link',t=>{
  const directory=mkdtempSync(join(tmpdir(),'旅行 launcher shortcut-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const shortcut=join(directory,'智游足迹.lnk');
  for(let attempt=0;attempt<2;attempt++) {
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',installer,'-ProjectRoot',projectRoot,'-ShortcutPath',shortcut],{encoding:'utf8'});
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  }
  const inspect=powershell(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${psLiteral(shortcut)});[pscustomobject]@{TargetPath=$s.TargetPath;Arguments=$s.Arguments;WorkingDirectory=$s.WorkingDirectory;IconLocation=$s.IconLocation}|ConvertTo-Json -Compress`);
  assert.equal(inspect.status,0,inspect.stderr);
  const details=JSON.parse(inspect.stdout.trim());
  assert.match(details.TargetPath,/WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(details.Arguments,`-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${wrapper}"`);
  assert.equal(details.WorkingDirectory,projectRoot);
  assert.match(details.IconLocation,/Microsoft\\Edge\\Application\\msedge\.exe,0$/i);
});
