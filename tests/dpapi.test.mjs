import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createDpapiProtector} from '../src/platform/dpapi.mjs';

const fake='FAKE-QA-KEY-ONLY-测试';
test('real CurrentUser encryption survives a separate helper instance',async()=>{
  const cipher=await createDpapiProtector().protect(fake);
  assert.ok(cipher.length>fake.length);assert.ok(!cipher.includes(fake));assert.ok(!Buffer.from(cipher,'base64').includes(Buffer.from(fake)));
  assert.equal(await createDpapiProtector().unprotect(cipher),fake);
});
test('helper arguments and environment contain no credential body',async()=>{
  const calls=[];const protector=createDpapiProtector({spawnImpl(command,args,options){calls.push({command,args,options});return spawn(command,args,options);}});
  const cipher=await protector.protect(fake);assert.equal(await protector.unprotect(cipher),fake);
  const serialized=JSON.stringify(calls);assert.ok(!serialized.includes(fake));assert.ok(!serialized.includes(cipher));
  assert.ok(calls.every(call=>call.options.windowsHide===true&&call.args.includes('-File')&&!call.args.includes('-Command')));
});
test('invalid or damaged ciphertext fails safely without plaintext fallback',async()=>{
  const protector=createDpapiProtector();
  for(const cipher of ['',fake,'AAAA', 'a'.repeat(65537)])await assert.rejects(protector.unprotect(cipher),error=>error.code==='AI_CREDENTIALS_UNAVAILABLE'&&!JSON.stringify(error).includes(fake)&&!error.cause);
});
test('missing system helper produces a controlled error rather than echoing its input',async()=>{
  const protector=createDpapiProtector({spawnImpl:()=>spawn('nonexistent-travel-dpapi-helper.exe',[],{windowsHide:true,stdio:['pipe','pipe','pipe']})});
  await assert.rejects(protector.protect(fake),error=>error.code==='AI_CREDENTIALS_UNAVAILABLE'&&!String(error).includes(fake));
});
test('a failed helper leaking sensitive diagnostics is not reflected in errors',async()=>{
  const protector=createDpapiProtector({spawnImpl:()=>spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('FAKE-QA-KEY-ONLY');process.exit(1);});"],{windowsHide:true,stdio:['pipe','pipe','pipe']})});
  await assert.rejects(protector.protect(fake),error=>error.code==='AI_CREDENTIALS_UNAVAILABLE'&&!String(error).includes('FAKE-QA-KEY-ONLY'));
});
