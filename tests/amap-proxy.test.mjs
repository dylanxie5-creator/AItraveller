import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createAmapProxy} from '../src/server/amap-proxy.mjs';

const SECURITY='FAKE-AMAP-SECURITY-CODE';
const safe=code=>error=>{assert.equal(error.code,code);assert.equal(String(error.stack).includes(SECURITY),false);return true;};
function network({status=200,body='{"status":"1"}',headers={'content-type':'application/json'},stall=false,answers=[{address:'8.8.8.8',family:4}]}={}) {const calls=[],dns=[];let response,readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});const lookup=async(...args)=>{dns.push(args);return answers;};const requestImpl=(options,callback)=>{const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};req.end=()=>queueMicrotask(()=>{response=new PassThrough();response.statusCode=status;response.headers=headers;calls.push({options,req,response});callback(response);readyResolve();if(!stall)response.end(body);});return req;};return {calls,dns,lookup,requestImpl,ready,get response(){return response;}};}
const store={async resolveSecurityCode(revision){assert.equal(revision,undefined);return SECURITY;}};
const input=(overrides={})=>({method:'GET',path:'/_AMapService/v3/config/district',searchParams:new URLSearchParams('keywords=320000&subdistrict=1&extensions=all'),...overrides});

test('proxy pins one public IP while preserving fixed host SNI path and appending server security',async()=>{
  const io=network(),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});const result=await proxy.handle(input());assert.equal(result.body.toString(),'{"status":"1"}');assert.equal(io.calls.length,1);assert.deepEqual(io.dns[0],['restapi.amap.com',{all:true,verbatim:true}]);
  const options=io.calls[0].options;assert.equal(options.hostname,'8.8.8.8');assert.equal(options.servername,'restapi.amap.com');assert.equal(options.headers.Host,'restapi.amap.com');assert.equal(options.method,'GET');assert.match(options.path,/^\/v3\/config\/district\?/);assert.equal(new URL(`https://x${options.path}`).searchParams.get('jscode'),SECURITY);assert.equal(result.contentType,'application/json; charset=utf-8');
});

test('proxy validates and preserves the AMap JSONP callback wrapper',async()=>{
  const callback='jsonp_491459_1792476699492_',body=`${callback}({"status":"1","districts":[]})`,io=network({body,headers:{'content-type':'application/json;charset=UTF-8'}}),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});
  const result=await proxy.handle(input({searchParams:new URLSearchParams(`keywords=320000&subdistrict=1&extensions=all&callback=${callback}`)}));assert.equal(result.body.toString(),body);assert.equal(result.contentType,'application/javascript; charset=utf-8');
});

test('proxy rejects methods versioned paths oversized queries and supplied jscode before network',async()=>{
  const io=network(),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});
  for(const value of [input({method:'POST'}),input({path:'/_AMapService/v3/other'}),input({path:'/_AMapService/7/v3/config/district'}),input({searchParams:new URLSearchParams('jscode=evil')}),input({searchParams:new URLSearchParams('callback=alert')}),input({searchParams:new URLSearchParams(`keywords=${'x'.repeat(2100)}`)})])await assert.rejects(proxy.handle(value));
  assert.equal(io.calls.length,0);
});

test('proxy rejects a mismatched JSONP wrapper after one upstream request',async()=>{
  const callback='jsonp_491459_1792476699492_',io=network({body:'jsonp_999_1792476699492_({"status":"1"})'}),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});
  await assert.rejects(proxy.handle(input({searchParams:new URLSearchParams(`callback=${callback}`)})),safe('MAP_PROXY_RESPONSE'));assert.equal(io.calls.length,1);
});

for(const status of [301,302,307,308,401,500])test(`proxy does not redirect or retry HTTP ${status}`,async()=>{const io=network({status}),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});await assert.rejects(proxy.handle(input()),safe('MAP_PROXY_RESPONSE'));assert.equal(io.calls.length,1);assert.equal(io.dns.length,1);});

test('proxy enforces JSON type and a cumulative one MiB response cap',async()=>{
  for(const options of [{headers:{'content-type':'text/html'}},{body:'x'.repeat(1048577)}]){const io=network(options),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});await assert.rejects(proxy.handle(input()),safe('MAP_PROXY_RESPONSE'));assert.equal(io.calls.length,1);}
});

test('one total timeout and abort destroy the single active request',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const io=network({stall:true}),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl,timeoutMs:1000});const pending=proxy.handle(input());await io.ready;const rejection=assert.rejects(pending,safe('MAP_PROXY_TIMEOUT'));t.mock.timers.tick(1000);await rejection;assert.equal(io.calls[0].req.destroyed,true);
  const abortIo=network({stall:true}),abortProxy=createAmapProxy({settingsStore:store,lookup:abortIo.lookup,requestImpl:abortIo.requestImpl}),controller=new AbortController(),active=abortProxy.handle(input({signal:controller.signal}));await abortIo.ready;controller.abort();await assert.rejects(active,safe('MAP_PROXY_ABORTED'));assert.equal(abortIo.calls[0].req.destroyed,true);
});

test('reserved DNS answers and external diagnostics fail closed without logging secrets',async t=>{
  const logged=[];for(const method of ['log','warn','error','info','debug'])t.mock.method(console,method,(...args)=>logged.push(args.join(' ')));const io=network({answers:[{address:'127.0.0.1',family:4}]}),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});await assert.rejects(proxy.handle(input()),safe('MAP_PROXY_BLOCKED'));assert.equal(io.calls.length,0);assert.equal(logged.join('\n').includes(SECURITY),false);
});

for(const address of ['10.0.0.1','169.254.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','::1','64:ff9b::808:808','2001:db8::1'])test(`proxy blocks reserved DNS ${address}`,async()=>{
  const io=network({answers:[{address,family:address.includes(':')?6:4}]}),proxy=createAmapProxy({settingsStore:store,lookup:io.lookup,requestImpl:io.requestImpl});await assert.rejects(proxy.handle(input()),safe('MAP_PROXY_BLOCKED'));assert.equal(io.calls.length,0);
});
