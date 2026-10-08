import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute,routeToHash} from '../src/web/router.mjs';
import {createApiClient} from '../src/web/api-client.mjs';
import {createAiController} from '../src/web/ai-controller.mjs';
import {createAiPlanEditor} from '../src/web/ai-plan-editor.mjs';
import {editorFieldId} from '../src/web/ai-plan-editor.mjs';
import {buildSettingsCommand,defaultKeyAction,defaultSearchKeyAction,firstAiField,safeSourceUrl} from '../src/web/ai-views.mjs';
import {createQaAi,parseQaArguments} from '../scripts/start-ai-qa.mjs';
import {setup} from './helpers/database.mjs';
import {resolve} from 'node:path';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const settings=()=>({revision:2,providers:{
  deepseek:{model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',keyConfigured:true},
  zhipu:{model:'glm-4.7',endpoint:'https://open.bigmodel.cn/api/paas/v4/chat/completions',keyConfigured:true},
  mimo:{model:'',endpoint:'',keyConfigured:false},kimi:{model:'',endpoint:'',keyConfigured:false},qwen:{model:'',endpoint:'',keyConfigured:false}
},search:{keyMode:'zhipu',keyConfigured:true},jobActive:false});
const input=()=>({name:'江南小旅行',startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:1,budgetYuan:'3200.50',cityCodes:['320100','320500'],preferences:'慢节奏'});
const content=()=>({trip:{name:'江南小旅行',startDate:'2026-10-10',endDate:'2026-10-10',travelerCount:1,budgetCents:null,cities:[{cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',arrivalDate:'2026-10-10',departureDate:'2026-10-10',order:0}]},days:[{date:'2026-10-10',activities:[{cityCode:'320100',title:'博物馆',description:'提前预约',sourceIds:['s1']}]}],cautions:['核对开放时间']});

test('AI routes are distinct from existing trip editor routes',()=>{
  assert.deepEqual(parseRoute('#/ai/settings'),{type:'ai-settings'});
  assert.deepEqual(parseRoute('#/ai/new'),{type:'ai-new'});
  assert.deepEqual(parseRoute('#/ai/jobs/job-1'),{type:'ai-job',id:'job-1'});
  assert.deepEqual(parseRoute('#/ai/plans'),{type:'ai-plans'});
  assert.deepEqual(parseRoute('#/ai/plans/plan-1'),{type:'ai-plan',id:'plan-1'});
  assert.deepEqual(parseRoute('#/ai/plans/plan-1/edit'),{type:'ai-plan-edit',id:'plan-1'});
  assert.deepEqual(parseRoute('#/trips/trip-1/edit'),{type:'edit',id:'trip-1'});
  assert.equal(routeToHash({type:'ai-plan-edit',id:'plan-1'}),'#/ai/plans/plan-1/edit');
});

test('AI API client uses the exact HTTP methods and bodies',async()=>{
  const calls=[];const api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({data:{ok:true}})};}});
  await api.aiSettings();await api.saveAiSettings({expectedRevision:1});await api.aiJobs();await api.aiJob('job-1');
  await api.startAiJob({operationId:'op-1'});await api.aiPlans();await api.aiPlan('plan-1');
  await api.updateAiPlan('plan-1',{expectedRevision:1});await api.convertAiPlan('plan-1',{expectedRevision:1});await api.tripGuide('trip-1');
  assert.deepEqual(calls.map(call=>[call.url,call.options.method]),[
    ['/api/ai/settings','GET'],['/api/ai/settings','PUT'],['/api/ai/jobs','GET'],['/api/ai/jobs/job-1','GET'],
    ['/api/ai/jobs','POST'],['/api/ai/plans','GET'],['/api/ai/plans/plan-1','GET'],['/api/ai/plans/plan-1','PUT'],
    ['/api/ai/plans/plan-1/convert','POST'],['/api/ai/trips/trip-1/guide','GET']
  ]);
  assert.deepEqual(JSON.parse(calls[4].options.body),{operationId:'op-1'});
});

test('uncertain submit freezes one command and explicit new generation gets a new id',async()=>{
  const commands=[];let fail=true,id=0;const routes=[],screens=[];
  const controller=createAiController({api:{startAiJob:async command=>{commands.push(structuredClone(command));if(fail){fail=false;throw {code:'NETWORK',message:'响应不确定'};}return {id:'job-1',state:'queued'};}},render:s=>screens.push(s),navigate:r=>routes.push(r),createId:()=>`op-${++id}`});
  const draft=input(),first=controller.submit({settingsRevision:2,provider:'deepseek',input:draft});draft.name='被修改';await first;
  assert.equal(controller.snapshot().pendingCommand.input.name,'江南小旅行');
  await controller.retrySubmit();assert.deepEqual(commands[1],commands[0]);assert.deepEqual(routes,[{type:'ai-job',id:'job-1'}]);
  await controller.submit({settingsRevision:2,provider:'deepseek',input:{...input(),name:'另一趟'}});
  assert.equal(commands[2].operationId,'op-2');assert.notEqual(commands[2].operationId,commands[0].operationId);
});

test('failed submit rerenders the exact submitted input instead of an older draft',async()=>{
  const screens=[];const controller=createAiController({api:{startAiJob:async()=>{throw {code:'VALIDATION',message:'日期无效',fields:{startDate:'请选择日期'}};}},render:s=>screens.push(s),navigate:()=>{},createId:()=> 'op-1'});
  await controller.submit({settingsRevision:2,provider:'deepseek',input:input()});
  assert.equal(screens.at(-1).input.name,'江南小旅行');
  assert.equal(screens.at(-1).input.cityCodes[1],'320500');
  assert.deepEqual(screens.at(-1).fields,{startDate:'请选择日期'});
});
test('uncertain submit rejects changed input and can only resend the frozen command',async()=>{
  let attempts=0,ids=0;const commands=[];
  const controller=createAiController({api:{startAiJob:async command=>{commands.push(structuredClone(command));if(attempts++===0)throw {code:'NETWORK',message:'响应不确定'};return {id:'job-1'};}},render:()=>{},navigate:()=>{},createId:()=>`op-${++ids}`});
  await controller.submit({settingsRevision:2,provider:'deepseek',input:input()});
  await controller.submit({settingsRevision:2,provider:'deepseek',input:{...input(),name:'不应产生新请求'}});
  assert.equal(ids,1);assert.deepEqual(commands[1],commands[0]);
});

test('polling waits two seconds, performs GET only, and stops after disposal',async()=>{
  const timers=[],calls=[];const states=[{id:'job-1',state:'searching',searchCalls:1,modelCalls:0},{id:'job-1',state:'succeeded',planId:'plan-1',searchCalls:2,modelCalls:1}];
  const clock={setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}};
  const controller=createAiController({api:{aiJob:async id=>{calls.push(id);return states.shift();}},render:()=>{},navigate:()=>{},clock});
  await controller.load({type:'ai-job',id:'job-1'});assert.deepEqual(calls,['job-1']);assert.equal(timers[0].ms,2000);
  await timers.shift().fn();assert.deepEqual(calls,['job-1','job-1']);controller.dispose();
  assert.equal(timers.length,0);
});
test('failed job explicit reuse carries its retained input into a new operation form',async()=>{
  const screens=[],routes=[];const controller=createAiController({api:{aiSettings:async()=>settings()},render:s=>screens.push(s),navigate:r=>routes.push(r)});
  const retained=input();controller.reuseJob({input:retained});retained.name='外部修改';
  await controller.load({type:'ai-new'});
  assert.deepEqual(routes,[{type:'ai-new'}]);assert.equal(screens.at(-1).input.name,'江南小旅行');
  assert.equal(controller.snapshot().draft.cityCodes[1],'320500');
});

test('late AI route response never overwrites the current route',async()=>{
  const old=deferred(),screens=[];const controller=createAiController({api:{aiPlans:()=>old.promise,aiSettings:async()=>settings()},render:s=>screens.push(s),navigate:()=>{}});
  const first=controller.load({type:'ai-plans'});await controller.load({type:'ai-settings'});old.resolve([]);await first;
  assert.equal(screens.at(-1).type,'ai-settings');
});

test('settings command never retains typed secrets and requires explicit key actions',()=>{
  const raw={deepseek:{model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',keyAction:'replace',apiKey:'TEMP-KEY'},
    zhipu:{model:'glm-4.7',endpoint:'https://open.bigmodel.cn/api/paas/v4/chat/completions',keyAction:'retain',apiKey:''},
    search:{keyMode:'zhipu',keyAction:'retain',apiKey:''}};
  const command=buildSettingsCommand(settings(),raw);
  assert.equal(command.providers.deepseek.apiKey,'TEMP-KEY');assert.equal(command.providers.zhipu.apiKey,undefined);
  raw.deepseek.apiKey='';assert.throws(()=>buildSettingsCommand(settings(),raw),/请输入新的 API Key/);
  raw.deepseek.keyAction='delete';assert.equal(buildSettingsCommand(settings(),raw).providers.deepseek.apiKey,undefined);
});
test('unconfigured optional providers default to no key instead of forcing five keys',()=>{
  assert.equal(defaultKeyAction(false),'delete');
  assert.equal(defaultKeyAction(true),'retain');
});
test('reusing Zhipu keeps any hidden separate search key until explicit deletion',()=>{
  assert.equal(defaultSearchKeyAction({keyMode:'zhipu',keyConfigured:false}),'retain');
  assert.equal(defaultSearchKeyAction({keyMode:'separate',keyConfigured:false}),'delete');
});

test('plan editor saves with revision, keeps conflicting edits, and warns before leaving',async()=>{
  const original={id:'plan-1',revision:3,content:content(),sources:[],conversion:null};const calls=[],screens=[];
  const editor=createAiPlanEditor({api:{updateAiPlan:async(id,command)=>{calls.push({id,command});throw {code:'CONFLICT',message:'攻略已在其他页面修改'};}},plan:original,render:s=>screens.push(s),navigate:()=>{},confirm:()=>false});
  editor.change(['days',0,'activities',0,'title'],'中山陵');await editor.save();
  assert.equal(calls[0].command.expectedRevision,3);assert.equal(calls[0].command.content.days[0].activities[0].title,'中山陵');
  assert.equal(editor.snapshot().dirty,true);assert.equal(editor.snapshot().content.days[0].activities[0].title,'中山陵');
  assert.equal(await editor.leave(),false);assert.match(editor.snapshot().error,/其他页面修改/);
});
test('editor fields receive stable unique ids for accessible labels',()=>{
  assert.equal(editorFieldId(0,0,'title'),'day-0-activity-0-title');
  assert.equal(editorFieldId(0,1,'title'),'day-0-activity-1-title');
});

test('source links allow only http(s) and force safe relationship attributes',()=>{
  assert.equal(safeSourceUrl('javascript:alert(1)'),null);
  assert.equal(safeSourceUrl('data:text/html,<script>alert(1)</script>'),null);
  assert.equal(safeSourceUrl('https://example.com/a'),'https://example.com/a');
  assert.equal(safeSourceUrl('http://example.com/a'),'http://example.com/a');
});
test('first known AI field error is selected for focus without trusting arbitrary selectors',()=>{
  assert.equal(firstAiField({unknown:'x',startDate:'请选择日期',name:'请输入名称'}),'startDate');
  assert.equal(firstAiField({unknown:'x'}),null);
});
test('QA arguments reject the production database path even under a Unicode workspace',()=>{
  assert.throws(()=>parseQaArguments(['--port','3211','--db',resolve('runtime/travel.sqlite')]),/禁止连接正式/);
  assert.equal(parseQaArguments(['--port','3211','--db','runtime/qa-ai.sqlite']).port,3211);
});

test('QA AI factory completes through fixed local fakes without external transport',async t=>{
  const {database}=setup(t);const protector={protect:async value=>`cipher:${value}`,unprotect:async value=>value.slice(7)};
  const ai=createQaAi({database,protector});
  const configured=await ai.settings.update({expectedRevision:0,providers:{
    deepseek:{model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',keyAction:'replace',apiKey:'QA-MODEL'},
    zhipu:{model:'glm-4.7',endpoint:'https://open.bigmodel.cn/api/paas/v4/chat/completions',keyAction:'replace',apiKey:'QA-SEARCH'}
  },search:{keyMode:'zhipu',keyAction:'retain'}});
  const job=await ai.jobs.submit({operationId:'qa-op-1',settingsRevision:configured.revision,provider:'deepseek',input:input()});
  await ai.jobs.settled();const finished=ai.jobs.get(job.id);
  assert.equal(finished.state,'succeeded');assert.equal(finished.searchCalls,2);assert.equal(finished.modelCalls,1);
  assert.deepEqual(ai.qaEvidence,{mode:'SIMULATED_NO_EXTERNAL_TRANSPORT',searchCalls:2,modelCalls:1});
});
