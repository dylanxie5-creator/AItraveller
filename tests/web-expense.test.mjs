import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseController} from '../src/web/expense-controller.mjs';
import {createApiClient} from '../src/web/api-client.mjs';
import {renderExpenseView} from '../src/web/expense-views.mjs';

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

test('deleting an expense reloads the current overview when the route is unchanged',async()=>{
  const expense={id:'expense-1',tripId:'trip-1',revision:2,amountCents:25000,categoryName:'餐饮',cityName:'整个行程',cityState:'trip',spentDate:'2026-10-10',note:'测试花销'};
  const before={...overview,summary:{hasExpenses:true,totalCents:25000},expenses:[expense]};
  const after={...overview,summary:{hasExpenses:false,totalCents:0},expenses:[]};
  let overviewCalls=0;
  const api={expenseOverview:async()=>++overviewCalls===1?before:after,deleteExpense:async()=>({deleted:true,id:expense.id})};
  const c=createExpenseController({api,render:()=>{},navigate:()=>{},confirm:async()=>true,createId:()=> 'operation-1'});

  await c.load({type:'expenses',id:'trip-1'});
  await c.deleteExpense(expense);

  assert.equal(overviewCalls,2);
  assert.equal(c.snapshot().overview.summary.totalCents,0);
  assert.deepEqual(c.snapshot().overview.expenses,[]);
});

test('expense API client encodes identities and sends commands unchanged',async()=>{
  const calls=[],api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({data:{ok:true}})};}}),command={operationId:'op',expectedRevision:1};
  await api.saveExpense('trip unsafe','expense unsafe',command);await api.deleteExpenseCategory('trip unsafe','custom:tea',command);
  assert.equal(calls[0].url,'/api/trips/trip%20unsafe/expenses/expense%20unsafe');assert.deepEqual(JSON.parse(calls[0].options.body),command);
  assert.equal(calls[1].url,'/api/trips/trip%20unsafe/expense-categories/custom%3Atea');
});

test('expense overview renders four responsive sections and hostile notes as text',()=>{
  class FakeNode {constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(){}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}}
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FakeNode;globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',String(text))};
  try {
    const root=new FakeNode('main'),note='<img src=x onerror=alert(1)>';
    renderExpenseView(root,{type:'expenses',overview:{trip:{...trip,name:'测试行程'},categories,summary:{hasExpenses:true,totalCents:12000,budgetCents:10000,budgetRemainingCents:-2000,budgetState:'over',byCategory:[{categoryId:'default:food',name:'餐饮',totalCents:12000,count:1}],byCity:[{cityCode:null,cityName:'整个行程',cityState:'trip',totalCents:12000,count:1}],recentExpenses:[]},expenses:[{id:'expense-1',revision:1,amountCents:12000,categoryName:'餐饮',cityName:'整个行程',cityState:'trip',spentDate:'2026-10-10',note}] }},{navigate:()=>{},deleteExpense:()=>{}});
    const nodes=[];(function visit(node){nodes.push(node);for(const child of node.children??[])visit(child);})(root);
    assert.equal(nodes.filter(node=>node.attrs?.['data-expense-section']).length,4);assert.ok(nodes.some(node=>node.tag==='#text'&&node.text===note));assert.equal(nodes.some(node=>node.tag==='img'),false);assert.ok(nodes.some(node=>node.className.includes('expense-layout')));assert.ok(nodes.some(node=>node.tag==='#text'&&node.text.includes('已超预算')));
  } finally {globalThis.Node=priorNode;globalThis.document=priorDocument;}
});
