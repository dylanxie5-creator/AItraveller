import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseController} from '../src/web/expense-controller.mjs';
import {createApiClient} from '../src/web/api-client.mjs';

const trip={id:'trip-1',startDate:'2026-10-10',endDate:'2026-10-13',cities:[{cityCode:'320100',cityName:'南京市'}]};
const categories=[{id:'default:food',name:'餐饮',kind:'default'}];
const overview={trip,categories,summary:{hasExpenses:false,totalCents:0},expenses:[]};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('failed save preserves typed fields and retry command identity',async()=>{
  const calls=[],renders=[],routes=[];let fail=true,id=0;
  const api={expenseOverview:async()=>overview,saveExpense:async(tripId,expenseId,command)=>{calls.push({tripId,expenseId,command});if(fail)throw {code:'NETWORK',message:'结果未知'};return {id:expenseId,revision:1};}};
  const controller=createExpenseController({api,render:s=>renders.push(s),navigate:r=>routes.push(r),today:()=> '2026-10-10',createId:()=>`id-${++id}`});
  await controller.load({type:'expense-new',id:'trip-1'});controller.setField('amountYuan','20');controller.setField('note','保留这段输入');await controller.save();
  assert.equal(controller.snapshot().values.note,'保留这段输入');const pending=controller.snapshot().pendingCommand;assert.equal(calls[0].command.operationId,pending.operationId);
  fail=false;await controller.retrySave();assert.equal(calls[1].command.operationId,pending.operationId);assert.deepEqual(routes,[{type:'expenses',id:'trip-1'}]);
});

test('double save sends once and stale or disposed loads never render',async()=>{
  const save=deferred(),old=deferred(),renders=[];let saveCalls=0;
  const api={expenseOverview:id=>id==='old'?old.promise:Promise.resolve(overview),saveExpense:async()=>{saveCalls++;return save.promise;}};
  const c=createExpenseController({api,render:s=>renders.push(s),navigate:()=>{},today:()=> '2026-10-10',createId:(()=>{let n=0;return()=>`id-${++n}`;})()});
  const pending=c.load({type:'expenses',id:'old'});await c.load({type:'expense-new',id:'trip-1'});old.resolve(overview);await pending;
  c.setField('amountYuan','10');const a=c.save(),b=c.save();assert.equal(saveCalls,1);c.dispose();save.resolve({id:'id-1',revision:1});await Promise.all([a,b]);
  assert.notEqual(renders.at(-1).type,'expenses');
});

test('delete cancel confirm and category errors remain explicit',async()=>{
  const calls=[],renders=[];let allow=false;
  const api={expenseOverview:async()=>overview,deleteExpense:async(...args)=>calls.push(args),saveExpenseCategory:async()=>{throw {code:'CONFLICT',message:'分类冲突'};},deleteExpenseCategory:async()=>{throw {code:'CATEGORY_IN_USE',message:'分类正在使用'};}};
  const c=createExpenseController({api,render:s=>renders.push(s),navigate:()=>{},confirm:async()=>allow,createId:()=> 'operation-1'});
  await c.load({type:'expense-categories',id:'trip-1'});
  await c.deleteExpense({id:'expense-1',tripId:'trip-1',revision:2});assert.equal(calls.length,0);allow=true;await c.deleteExpense({id:'expense-1',tripId:'trip-1',revision:2});assert.equal(calls[0][2].expectedRevision,2);
  await c.saveCategory({tripId:'trip-1',id:'custom:tea',expectedRevision:0,name:'茶饮'});assert.equal(renders.at(-1).error,'分类冲突');
  await c.deleteCategory({tripId:'trip-1',id:'custom:tea',revision:1});assert.equal(renders.at(-1).error,'分类正在使用');
});

test('expense API client encodes identities and sends commands unchanged',async()=>{
  const calls=[],api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({data:{ok:true}})};}}),command={operationId:'op',expectedRevision:1};
  await api.saveExpense('trip unsafe','expense unsafe',command);await api.deleteExpenseCategory('trip unsafe','custom:tea',command);
  assert.equal(calls[0].url,'/api/trips/trip%20unsafe/expenses/expense%20unsafe');assert.deepEqual(JSON.parse(calls[0].options.body),command);
  assert.equal(calls[1].url,'/api/trips/trip%20unsafe/expense-categories/custom%3Atea');
});
