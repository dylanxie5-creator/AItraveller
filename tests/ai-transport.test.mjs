import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {validateEndpoint} from '../src/ai/provider-registry.mjs';
import {createHttpsTransport} from '../src/ai/https-transport.mjs';

const url='https://open.bigmodel.cn/api/paas/v4/web_search';
const fakeKey='FAKE-transport-secret-never-a-real-key';
const input=()=>({provider:'zhipu',kind:'search',url,headers:{Authorization:`Bearer ${fakeKey}`},body:{search_query:'南京'},timeoutMs:30000});
const safe=code=>error=>{
  assert.equal(error.code,code);assert.equal(error.cause,undefined);
  assert.equal(JSON.stringify(error).includes(fakeKey),false);
  assert.equal(String(error.stack).includes(fakeKey),false);return true;
};
function network({answers=[{address:'8.8.8.8',family:4}],status=200,body='{"ok":true}',headers={'content-type':'application/json'},error,stall=false}={}) {
  const calls=[],dns=[];let response;let markReady;
  const ready=new Promise(resolve=>{markReady=resolve;});
  const lookup=async (...args)=>{dns.push(args);return answers;};
  const requestImpl=(options,callback)=>{
    const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};
    const call={options,req};calls.push(call);
    req.end=data=>{call.body=data;queueMicrotask(()=>{
      if(error){req.emit('error',error);markReady();return;}
      response=new PassThrough();response.statusCode=status;response.headers=headers;
      call.response=response;callback(response);markReady();
      if(!stall&&!response.destroyed)response.end(body);
    });};return req;
  };
  return {calls,dns,ready,lookup,requestImpl,transport:createHttpsTransport({lookup,requestImpl}),get response(){return response;}};
}

for(const [provider,endpoints] of Object.entries({
  deepseek:['https://api.deepseek.com/chat/completions','https://api.deepseek.com/v1/chat/completions'],
  zhipu:['https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  mimo:['https://api.xiaomimimo.com/v1/chat/completions'],
  kimi:['https://api.moonshot.cn/v1/chat/completions','https://api.moonshot.ai/v1/chat/completions'],
  qwen:['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions','https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions','https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions','https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',...['cn-beijing','ap-southeast-1','eu-central-1','ap-northeast-1','cn-hongkong','us-east-1'].map(region=>`https://llm-example.${region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions`)]
}))test(`${provider}: verified full model endpoints`,()=>{for(const endpoint of endpoints)assert.equal(validateEndpoint(provider,endpoint).href,endpoint);});

for(const bad of [
  'http://open.bigmodel.cn/api/paas/v4/web_search',
  'https://user:password@open.bigmodel.cn/api/paas/v4/web_search',
  'https://@open.bigmodel.cn/api/paas/v4/web_search',
  'https://:@open.bigmodel.cn/api/paas/v4/web_search',
  'https://open.bigmodel.cn:/api/paas/v4/web_search',
  'https://open.bigmodel.cn:0443/api/paas/v4/web_search',
  `${url}#fragment`,`${url}#`,`${url}?key=secret`,`${url}?`,
  'https://open.bigmodel.cn:8443/api/paas/v4/web_search',
  'https://open.bigmodel.cn.attacker.invalid/api/paas/v4/web_search',
  'https://open.bigmodel.cn./api/paas/v4/web_search',
  'https://open.bigmodel.cn/api/paas/v4/%77eb_search',
  'https://open.bigmodel.cn/ignored/../api/paas/v4/web_search',
  'https://open.bigmodel.cn/api/paas/v4/web_search/',
  'https://open.bigmodel.cn\\api/paas/v4/web_search',` ${url}`,`${url}\n`
])test(`reject endpoint spelling ${JSON.stringify(bad)}`,()=>assert.throws(()=>validateEndpoint('zhipu',bad,'search'),e=>e.code==='VALIDATION'));

test('provider/kind and workspace domains cannot broaden the whitelist',()=>{
  for(const [provider,endpoint,kind] of [
    ['mimo','https://api.xiaomimimo.com.attacker.invalid/v1/chat/completions'],
    ['mimo','https://token-plan-cn.xiaomimimo.com/v1/chat/completions'],
    ['deepseek',url,'search'],['zhipu',url,'model'],['zhipu',url,'unknown'],['unknown',url],
    ['qwen','https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['qwen','https://a.b.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['qwen','https://llm-x.unknown.maas.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['qwen','https://llm-x.cn-beijing.maas.aliyuncs.com.attacker.invalid/compatible-mode/v1/chat/completions'],
    ['qwen','https://anything.aliyuncs.com/compatible-mode/v1/chat/completions']
  ])assert.throws(()=>validateEndpoint(provider,endpoint,kind),e=>e.code==='VALIDATION');
});

test('one pinned public IP; original Host, SNI and certificate identity; no reusable global agent',async()=>{
  const io=network({answers:[{address:'2606:4700:4700::1111',family:6},{address:'1.1.1.1',family:4}]});
  assert.deepEqual(await io.transport.postJson(input()),{ok:true});
  assert.equal(io.dns.length,1);assert.deepEqual(io.dns[0],['open.bigmodel.cn',{all:true,verbatim:true}]);
  assert.equal(io.calls.length,1);const o=io.calls[0].options;
  assert.equal(o.hostname,'1.1.1.1');assert.equal(o.family,4);assert.equal(o.servername,'open.bigmodel.cn');
  assert.equal(o.headers.Host,'open.bigmodel.cn');assert.equal(o.headers.Authorization,`Bearer ${fakeKey}`);
  assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);assert.equal(o.method,'POST');assert.equal(o.port,443);
  assert.equal(o.path,'/api/paas/v4/web_search');assert.equal(o.headers['Content-Length'],Buffer.byteLength(io.calls[0].body));
  assert.deepEqual(JSON.parse(io.calls[0].body),{search_query:'南京'});
  assert.equal(o.checkServerIdentity('1.1.1.1',{subjectaltname:'DNS:open.bigmodel.cn'}),undefined);
  assert.ok(o.checkServerIdentity('open.bigmodel.cn',{subjectaltname:'DNS:attacker.invalid'}));
});
test('ordinary global IPv6 is pinned without another lookup',async()=>{
  const io=network({answers:[{address:'2606:4700:4700::1111',family:6}]});
  await io.transport.postJson(input());assert.equal(io.calls[0].options.hostname,'2606:4700:4700::1111');assert.equal(io.calls[0].options.family,6);
});
for(const address of ['0.1.2.3','10.0.0.1','100.64.0.1','127.0.0.1','169.254.1.1','172.16.0.1','172.31.255.255','192.0.0.9','192.0.2.1','192.31.196.1','192.52.193.1','192.88.99.1','192.168.0.1','192.175.48.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','fc00::1','fe80::1','ff02::1','::ffff:127.0.0.1','::ffff:808:808','64:ff9b::808:808','2001::1','2001:db8::1','2002:808:808::1','2620:4f:8000::1','3fff::1','fe80::1%eth0'])test(`DNS rejects reserved address ${address} before sending Key`,async()=>{
  const io=network({answers:[{address,family:address.includes(':')?6:4}]});
  await assert.rejects(io.transport.postJson(input()),safe('AI_ENDPOINT_BLOCKED'));assert.equal(io.calls.length,0);
});
test('mixed public/private, malformed/empty DNS and mismatched family all fail closed',async()=>{
  for(const answers of [[],[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],[{address:'8.8.8.8',family:6}],[{address:'not-an-ip',family:4}],null]){
    const io=network({answers});await assert.rejects(io.transport.postJson(input()),safe('AI_ENDPOINT_BLOCKED'));assert.equal(io.calls.length,0);
  }
});
for(const [status,code] of [[301,'AI_RESPONSE'],[302,'AI_RESPONSE'],[307,'AI_RESPONSE'],[308,'AI_RESPONSE'],[401,'AI_AUTH'],[403,'AI_AUTH'],[429,'AI_RATE_LIMIT'],[500,'AI_RESPONSE']])test(`HTTP ${status} is safe, with exactly one request and no redirects/retries`,async()=>{
  const io=network({status,body:fakeKey,headers:{location:`https://attacker.invalid/?key=${fakeKey}`}});
  await assert.rejects(io.transport.postJson(input()),safe(code));assert.equal(io.calls.length,1);assert.equal(io.dns.length,1);
});
for(const [body,headers] of [[fakeKey,{'content-type':'application/json'}],['null',{'content-type':'application/json'}],['[]',{'content-type':'application/json'}],['{}',{'content-type':'text/html'}],['{}',{'content-type':'application/json','content-encoding':'gzip'}],[Buffer.from([0xff]),{'content-type':'application/json'}]])test(`non-object/invalid JSON or unsupported response encoding is sanitized: ${String(body).slice(0,8)}`,async()=>{
  const io=network({body,headers});await assert.rejects(io.transport.postJson(input()),safe('AI_RESPONSE'));
});
test('1 MiB cap counts bytes, not Unicode characters, including declared oversized bodies',async()=>{
  for(const options of [{body:JSON.stringify({text:'南'.repeat(350000)})},{body:'{}',headers:{'content-type':'application/json','content-length':'1048577'}}]){
    const io=network(options);await assert.rejects(io.transport.postJson(input()),safe('AI_RESPONSE'));assert.equal(io.calls.length,1);
  }
  const io=network({body:JSON.stringify({text:'x'.repeat(1048565)})}); // 11 bytes of JSON framing
  const result=await io.transport.postJson(input());assert.equal(result.text.length,1048565);
});
test('response limit applies cumulatively across chunks',async()=>{
  const io=network({stall:true});const pending=io.transport.postJson({...input(),maxBytes:10});await io.ready;
  io.response.write('{"text":');io.response.write('"南京"}');await assert.rejects(pending,safe('AI_RESPONSE'));assert.equal(io.response.destroyed,true);
});
test('DNS and native request errors never retain external diagnostics or a Key',async()=>{
  const io=network({error:new Error(`native error ${fakeKey}`)});await assert.rejects(io.transport.postJson(input()),safe('AI_NETWORK'));
  const badDns=createHttpsTransport({lookup:async()=>{throw new Error(fakeKey);},requestImpl:io.requestImpl});
  await assert.rejects(badDns.postJson(input()),safe('AI_NETWORK'));assert.equal(io.calls.length,1);
  const sync=createHttpsTransport({lookup:io.lookup,requestImpl:()=>{throw new Error(fakeKey);}});
  await assert.rejects(sync.postJson(input()),safe('AI_NETWORK'));
});
test('30-second total timeout covers DNS and late answers cannot trigger a request',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let resolveDns;const io=network();
  const transport=createHttpsTransport({lookup:()=>new Promise(resolve=>{resolveDns=resolve;}),requestImpl:io.requestImpl});
  const pending=transport.postJson(input());const rejection=assert.rejects(pending,safe('AI_TIMEOUT'));
  t.mock.timers.tick(30000);await rejection;resolveDns([{address:'8.8.8.8',family:4}]);await Promise.resolve();await Promise.resolve();assert.equal(io.calls.length,0);
});
test('one total deadline covers DNS plus response reading, not a fresh 30 seconds per phase',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let resolveDns;const io=network({stall:true});
  const transport=createHttpsTransport({lookup:()=>new Promise(resolve=>{resolveDns=resolve;}),requestImpl:io.requestImpl});
  const pending=transport.postJson(input());const rejection=assert.rejects(pending,safe('AI_TIMEOUT'));
  t.mock.timers.tick(20000);resolveDns([{address:'8.8.8.8',family:4}]);await io.ready;
  t.mock.timers.tick(9999);assert.equal(io.calls[0].req.destroyed,undefined);
  t.mock.timers.tick(1);await rejection;assert.equal(io.calls[0].req.destroyed,true);assert.equal(io.response.destroyed,true);
});
test('abort before lookup, during lookup and during reading sends no further request',async()=>{
  const io=network({stall:true});const pre=new AbortController();pre.abort(new Error(fakeKey));
  await assert.rejects(io.transport.postJson({...input(),signal:pre.signal}),safe('AI_CANCELLED'));assert.equal(io.dns.length,0);
  let resolveDns;const mid=new AbortController();const transport=createHttpsTransport({lookup:()=>new Promise(resolve=>{resolveDns=resolve;}),requestImpl:io.requestImpl});
  const waiting=transport.postJson({...input(),signal:mid.signal});mid.abort(new Error(fakeKey));await assert.rejects(waiting,safe('AI_CANCELLED'));
  resolveDns([{address:'8.8.8.8',family:4}]);await Promise.resolve();assert.equal(io.calls.length,0);
  const reading=new AbortController();const active=io.transport.postJson({...input(),signal:reading.signal});await io.ready;reading.abort(new Error(fakeKey));
  await assert.rejects(active,safe('AI_CANCELLED'));assert.equal(io.response.destroyed,true);
});
test('endpoint/header/size validation precedes DNS and ignores unsafe override attempts',async()=>{
  const io=network();
  for(const changes of [{url:'https://attacker.invalid/'},{headers:{Host:'attacker.invalid'}},{headers:{Authorization:`Bearer ${fakeKey}\r\nHost: attacker.invalid`}},{maxBytes:1048577},{timeoutMs:120001},{body:undefined}])await assert.rejects(io.transport.postJson({...input(),...changes}),e=>e.code==='VALIDATION');
  assert.equal(io.dns.length,0);assert.equal(io.calls.length,0);
});
test('input body and headers are snapshotted before async DNS',async()=>{
  let resolveDns;const io=network();const transport=createHttpsTransport({lookup:()=>new Promise(resolve=>{resolveDns=resolve;}),requestImpl:io.requestImpl});
  const args=input();const pending=transport.postJson(args);args.headers.Authorization='Bearer changed';args.body.search_query='changed';args.url='https://attacker.invalid/';
  resolveDns([{address:'8.8.8.8',family:4}]);await pending;
  assert.equal(io.calls[0].options.headers.Authorization,`Bearer ${fakeKey}`);assert.deepEqual(JSON.parse(io.calls[0].body),{search_query:'南京'});
});
test('response errors, abort and premature close are local errors and never retry',async()=>{
  for(const event of ['error','aborted','close']){
    const io=network({stall:true});const pending=io.transport.postJson(input());await io.ready;
    io.response.emit(event,new Error(fakeKey));await assert.rejects(pending,safe('AI_NETWORK'));assert.equal(io.calls.length,1);assert.equal(io.response.destroyed,true);
  }
});
test('safe request processing writes no Key to console on success or failure',async t=>{
  const logged=[];for(const method of ['log','info','warn','error','debug'])t.mock.method(console,method,(...args)=>logged.push(args.join(' ')));
  await network().transport.postJson(input());await assert.rejects(network({error:new Error(fakeKey)}).transport.postJson(input()),safe('AI_NETWORK'));
  assert.deepEqual(logged,[]);
});
