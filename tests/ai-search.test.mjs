import test from 'node:test';
import assert from 'node:assert/strict';
import {createZhipuSearch} from '../src/ai/zhipu-search.mjs';
import {AiError} from '../src/ai/errors.mjs';

const key='FAKE-search-secret-not-a-real-key';
const retrievedAt='2026-10-05T02:03:04.000Z';
const row=(overrides={})=>({title:'南京旅游',content:'景点资料',link:'https://example.com/nanjing#heading',publish_date:'2025-01-02',icon:'https://attacker.invalid/icon',media:'原始媒体',...overrides});
function fixture(response={search_result:[row()]}) {
  const calls=[];const transport={postJson:async args=>{calls.push(args);return typeof response==='function'?response(args):response;}};
  return {calls,search:createZhipuSearch({transport,now:()=>new Date(retrievedAt)})};
}
test('one independent fixed Zhipu search POST uses the search Key and exact safe defaults',async()=>{
  const io=fixture();const controller=new AbortController();const sources=await io.search.search({query:' 南京旅游 ',key,signal:controller.signal});
  assert.equal(io.calls.length,1);assert.deepEqual(io.calls[0],{
    provider:'zhipu',kind:'search',url:'https://open.bigmodel.cn/api/paas/v4/web_search',
    headers:{Authorization:`Bearer ${key}`},body:{search_query:'南京旅游',search_engine:'search_std',search_intent:false,count:5,content_size:'medium'},
    timeoutMs:30000,maxBytes:1048576,signal:controller.signal
  });
  assert.deepEqual(sources,[{sourceId:'s1',title:'南京旅游',url:'https://example.com/nanjing',summary:'景点资料',publishedAt:'2025-01-02',retrievedAt}]);
});
test('query counts Unicode code points, with no silent truncation or request for invalid input',async()=>{
  const io=fixture();await io.search.search({query:'😀'.repeat(70),key});assert.equal(io.calls[0].body.search_query,'😀'.repeat(70));
  for(const query of ['', ' ', '南'.repeat(71),'😀'.repeat(71),'南京\n旅游',null])await assert.rejects(io.search.search({query,key}),e=>e.code==='VALIDATION');
  for(const invalid of ['',null,'bad\r\nkey'])await assert.rejects(io.search.search({query:'南京',key:invalid}),e=>e.code==='VALIDATION');
  assert.equal(io.calls.length,1);
});
test('invalid Key, 1703, malformed and empty results stop without retries or model calls',async()=>{
  for(const response of [()=>{throw new AiError('AI_AUTH','密钥无效');},{error:{code:'1703',message:key}},{error:{code:'1300',message:key}},{search_result:[]},{search_result:[row({link:'javascript:alert(1)'})]},null]){
    const io=fixture(response);await assert.rejects(io.search.search({query:'南京',key}),e=>{
      assert.ok(['AI_AUTH','AI_SEARCH_RESPONSE','AI_SEARCH_EMPTY'].includes(e.code));assert.equal(String(e.stack).includes(key),false);assert.equal(e.cause,undefined);return true;
    });assert.equal(io.calls.length,1);
  }
});
test('unexpected dependency errors are sanitized and never retried',async()=>{
  const io=fixture(()=>{throw new Error(`private response ${key}`);});await assert.rejects(io.search.search({query:'南京',key}),e=>e.code==='AI_NETWORK'&&!String(e.stack).includes(key)&&!e.cause);assert.equal(io.calls.length,1);
});
test('retrieval time is local; source publication, URL dedupe/filter and summary limits survive normalization',async()=>{
  const prior=[{sourceId:'s7',title:'旧来源',url:'https://example.com/prior',summary:'旧摘要',publishedAt:null,retrievedAt}];
  const io=fixture({created:0,search_result:[row({link:'https://example.com/prior#x'}),row({title:'旅'.repeat(250),content:'游'.repeat(1400)}),row({link:'https://example.com/nanjing#other'}),row({link:'https://user:password@example.com/'}),row({link:'file:///C:/secret'}),row({link:'http://example.com/other',publish_date:'not-a-date'})]});
  const sources=await io.search.search({query:'南京',key,priorSources:prior});assert.equal(sources.length,2);
  assert.equal(sources[0].sourceId,'s8');assert.equal([...sources[0].title].length,200);assert.equal([...sources[0].summary].length,1200);
  assert.equal(sources[0].retrievedAt,retrievedAt);assert.equal(sources[1].publishedAt,null);assert.equal(sources[1].sourceId,'s9');
  assert.equal(JSON.stringify(sources).includes('attacker.invalid'),false);assert.equal(io.calls.length,1);assert.equal(prior.length,1);
});
test('duplicate-only valid results leave previous sources usable without reassigning IDs',async()=>{
  const io=fixture();const prior=[{sourceId:'s1',title:'旧来源',url:'https://example.com/nanjing',summary:'摘要',publishedAt:null,retrievedAt}];
  assert.deepEqual(await io.search.search({query:'南京',key,priorSources:prior}),[]);assert.equal(io.calls.length,1);
});
