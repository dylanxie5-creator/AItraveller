import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../src/web/api-client.mjs';
import {createArchiveController} from '../src/web/archive-controller.mjs';
import {renderArchiveView} from '../src/web/archive-views.mjs';
import {renderView} from '../src/web/views.mjs';
import {readFileSync} from 'node:fs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tripReport=()=>({kind:'trip',generatedAt:'2026-10-26T12:00:00.000Z',cutoffDate:'2026-10-26',databaseVersion:4,trip:{name:'档案行程',startDate:'2026-10-10',endDate:'2026-10-13',durationDays:4,travelerCount:2,budgetCents:320050,cities:[]},expenses:{hasExpenses:false,totalCents:0,budgetCents:320050,budgetRemainingCents:320050,budgetState:'within',byCategory:[],byCity:[],items:[]},footprints:[],guide:null});
const totalReport=(trips=[tripReport()])=>({kind:'archive',generatedAt:'2026-10-26T12:00:00.000Z',cutoffDate:'2026-10-26',databaseVersion:4,summary:{tripCount:trips.length,travelDayCount:trips.length?4:0,totalExpenseCents:0,provinceCount:0,cityCount:0,visitCount:0},byYear:[],byCategory:[],byCity:[],wholeTripExpenseCents:0,directory:[],trips,footprints:[]});

test('archive API client uses exact GET endpoints without request bodies',async()=>{
  const calls=[],api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({data:{ok:true}})};}});
  await api.travelArchive();await api.tripArchive('unsafe id');
  assert.deepEqual(calls.map(call=>[call.url,call.options.method,call.options.body]),[['/api/archive','GET',undefined],['/api/archive/trips/unsafe%20id','GET',undefined]]);
});

test('archive controller ignores late and disposed loads and snapshots API data',async()=>{
  const old=deferred(),fresh=totalReport(),states=[];let calls=0;const controller=createArchiveController({api:{travelArchive:()=>calls++===0?old.promise:Promise.resolve(fresh)},render:state=>states.push(state),print:()=>{}});
  const first=controller.load({type:'archive-home'});await controller.load({type:'archive-print'});fresh.trips[0].trip.name='API 已修改';old.resolve(totalReport([]));await first;
  assert.equal(states.at(-1).type,'archive-report');assert.equal(controller.snapshot().report.trips[0].trip.name,'档案行程');assert.equal(Object.isFrozen(controller.snapshot().report),true);
  const pending=deferred(),disposedStates=[];const disposed=createArchiveController({api:{travelArchive:()=>pending.promise},render:state=>disposedStates.push(state),print:()=>{}});const loading=disposed.load({type:'archive-home'});disposed.dispose();pending.resolve(totalReport());await loading;assert.equal(disposedStates.length,1);
});

test('archive controller exposes empty error retry and guarded print states',async()=>{
  const states=[],prints=[];let mode='empty';const api={travelArchive:async()=>{if(mode==='error')throw {message:'档案加载失败'};return totalReport(mode==='empty'?[]:undefined);},tripArchive:async()=>tripReport()};
  const controller=createArchiveController({api,render:state=>states.push(state),print:()=>prints.push('print')});
  const loading=controller.load({type:'archive-home'});controller.print();await loading;assert.equal(states.at(-1).type,'archive-empty');controller.print();assert.equal(prints.length,0);
  mode='error';await controller.load({type:'archive-print'});assert.equal(states.at(-1).type,'archive-error');assert.deepEqual(states.at(-1).route,{type:'archive-print'});controller.print();assert.equal(prints.length,0);
  mode='ready';await controller.load(states.at(-1).route);assert.equal(states.at(-1).type,'archive-report');controller.print();assert.deepEqual(prints,['print']);
  await controller.load({type:'trip-archive-print',id:'trip-1'});controller.print();assert.deepEqual(prints,['print','print']);
});

class FakeNode {
  constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';this.classList={toggle(){}};}
  setAttribute(key,value){this.attrs[key]=String(value);}addEventListener(){}
  append(...items){for(const item of items)this.children.push(item instanceof FakeNode?item:new FakeNode('#text',String(item)));}
  replaceChildren(...items){this.children=[];this.append(...items);}querySelector(){return null;}
}
function withDom(run) {const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FakeNode;globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',String(text)),querySelectorAll:()=>[]};try{return run();}finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}}
function nodes(root) {const result=[];(function walk(node){result.push(node);for(const child of node.children)walk(child);})(root);return result;}
const textOf=root=>nodes(root).filter(node=>node.tag==='#text').map(node=>node.text).join(' ');

test('archive landing and trip detail expose only eligible new-tab preview links',()=>withDom(()=>{
  const landing=new FakeNode('main');renderArchiveView(landing,{type:'archive-home',route:{type:'archive-home'},report:totalReport()},{print(){},retry(){}});const landingNodes=nodes(landing),landingText=textOf(landing);
  assert.match(landingText,/1 趟已结束行程/);assert.match(landingText,/2026-10-26/);assert.ok(landingNodes.some(node=>node.tag==='a'&&node.attrs.href==='#/reports/archive/print'&&node.attrs.target==='_blank'&&node.attrs.rel==='noopener'));
  const expenseOverview={summary:{totalCents:0,budgetCents:320050,budgetRemainingCents:320050,budgetState:'within',recentExpenses:[]}};
  const completed=new FakeNode('main');renderView(completed,{type:'detail',trip:{id:'trip-1',name:'已结束',status:'completed',statusLabel:'已结束',startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:2,budgetText:'¥3,200.50',cities:[]},guide:null,expenseOverview},{navigate(){},deleteTrip(){},retry(){}});assert.ok(nodes(completed).some(node=>node.tag==='a'&&node.attrs.href==='#/reports/trips/trip-1/print'&&node.attrs.target==='_blank'));
  const ongoing=new FakeNode('main');renderView(ongoing,{type:'detail',trip:{id:'trip-2',name:'进行中',status:'ongoing',statusLabel:'进行中',startDate:'2026-10-20',endDate:'2026-10-26',travelerCount:1,budgetText:'未设预算',cities:[]},guide:null,expenseOverview:{summary:{...expenseOverview.summary,budgetCents:null,budgetRemainingCents:null,budgetState:'unset'}}},{navigate(){},deleteTrip(){},retry(){}});assert.match(textOf(ongoing),/行程结束后可生成档案/);assert.equal(nodes(ongoing).some(node=>node.attrs.href?.includes('/reports/trips/')),false);
}));

test('archive report renders hostile data as text complete guide versions and all expense rows',()=>withDom(()=>{
  const report=tripReport(),hostile='<script>alert(1)</script>',image='<img src=x onerror=alert(1)>',longUrl=`https://example.com/${'a'.repeat(500)}`;report.trip.name=hostile;report.trip.cities=[{cityName:'南京市',provinceName:'江苏省',arrivalDate:'2026-10-10',departureDate:'2026-10-13'}];report.expenses.hasExpenses=true;report.expenses.items=Array.from({length:80},(_,i)=>({spentDate:'2026-10-10',categoryName:'餐饮',cityName:'南京市',cityState:'current',amountCents:100+i,note:i===0?image:`记录 ${i}`}));report.expenses.totalCents=11160;report.expenses.byCategory=[{name:'餐饮',totalCents:11160,count:80}];report.expenses.byCity=[{provinceName:'江苏省',cityName:'南京市',cityState:'current',totalCents:11160,count:80}];report.footprints=[{cityName:'南京市',provinceName:'江苏省',datePrecision:'trip_range',dateStart:'2026-10-10',dateEnd:'2026-10-13',source:'trip',note:'足迹'}];
  const plan=label=>({trip:{name:label,startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:2,budgetCents:320050,cities:[{cityCode:'320100',cityName:'南京市'}]},days:[{date:'2026-10-10',activities:[{cityCode:'320100',title:label,description:'安排',sourceIds:['s1']}]}],cautions:[label]});report.guide={provider:'deepseek',model:'deepseek-chat',edited:true,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-02T00:00:00.000Z',current:plan('当前攻略'),conversionSnapshot:plan('转换时快照'),original:plan('模型原始输出'),sources:[{sourceId:'s1',title:'长链接',url:longUrl,href:longUrl,summary:'摘要',publishedAt:null,retrievedAt:'2026-10-01T00:00:00.000Z'},{sourceId:'s2',title:'危险链接',url:'javascript:alert(1)',href:null,summary:'仅文本',publishedAt:null,retrievedAt:'2026-10-01T00:00:00.000Z'}]};
  const root=new FakeNode('main');renderArchiveView(root,{type:'archive-report',route:{type:'trip-archive-print',id:'trip-1'},report},{print(){},retry(){}});const all=nodes(root),text=textOf(root);
  assert.ok(text.includes(hostile));assert.ok(text.includes(image));assert.equal(all.some(node=>node.tag==='script'||node.tag==='img'),false);assert.equal(all.filter(node=>node.attrs['data-expense-row']==='').length,80);
  assert.ok(all.some(node=>node.tag==='a'&&node.attrs.href===longUrl&&node.attrs.rel==='noopener noreferrer'));assert.equal(all.some(node=>node.tag==='a'&&node.attrs.href?.startsWith('javascript:')),false);
  for(const label of ['当前攻略','创建正式行程时的攻略快照','模型原始输出','检索来源','足迹与备注'])assert.match(text,new RegExp(label));assert.ok(all.some(node=>node.tag==='button'&&textOf(node).includes('打印/保存为 PDF')));
}));

test('archive report renders divergent guide metadata and activity city assignments',()=>withDom(()=>{
  const report=tripReport();
  const plan=(name,cityName,travelerCount,budgetCents)=>({trip:{name,startDate:'2026-10-10',endDate:'2026-10-13',travelerCount,budgetCents,cities:[{cityCode:'320100',cityName,provinceName:'江苏省',arrivalDate:'2026-10-10',departureDate:'2026-10-13'}]},days:[{date:'2026-10-10',activities:[{cityCode:'320100',title:'共同活动',description:'共同说明',sourceIds:[]}]}],cautions:[]});
  report.guide={provider:'deepseek',model:'deepseek-chat',edited:true,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-02T00:00:00.000Z',current:plan('当前版专属名称','当前版路线城市',2,10000),conversionSnapshot:plan('转换版专属名称','转换版路线城市',3,20000),original:plan('原始版专属名称','原始版路线城市',4,30000),sources:[]};
  const root=new FakeNode('main');renderArchiveView(root,{type:'archive-report',route:{type:'trip-archive-print',id:'trip-1'},report},{print(){},retry(){}});const text=textOf(root);
  for(const expected of ['当前版专属名称','转换版专属名称','原始版专属名称','当前版路线城市','转换版路线城市','原始版路线城市','2 人','3 人','4 人','创建于','更新于'])assert.ok(text.includes(expected),expected);
}));

test('total archive renders cross-trip city totals and precision-aware historical footprint ranges',()=>withDom(()=>{
  const report=totalReport([]);report.byCity=[{provinceName:'江苏省',cityName:'南京市',totalCents:12345,count:7}];report.wholeTripExpenseCents=500;report.footprints=[{provinceName:'四川省',cityName:'成都市',datePrecision:'trip_range',dateStart:'2026-01-01',dateEnd:'2026-01-19',source:'detached',note:'历史足迹'},{provinceName:'广东省',cityName:'广州市',datePrecision:'year',dateStart:'2024',dateEnd:null,source:'manual',note:''}];
  const root=new FakeNode('main');renderArchiveView(root,{type:'archive-report',route:{type:'archive-print'},report},{print(){},retry(){}});const text=textOf(root);
  for(const expected of ['跨行程城市花销','江苏省 · 南京市 · 7 笔','¥123.45','2026年1月1日—1月19日','2024年','历史行程','手动补录'])assert.ok(text.includes(expected),expected);
}));

test('archive empty sections remain explicit and incomplete states have no print action',()=>withDom(()=>{
  const root=new FakeNode('main');renderArchiveView(root,{type:'archive-report',route:{type:'trip-archive-print',id:'trip-1'},report:tripReport()},{print(){},retry(){}});const text=textOf(root);for(const label of ['攻略与每日安排','花销统计与明细','足迹与备注','暂无相关记录'])assert.match(text,new RegExp(label));
  for(const state of [{type:'archive-loading',route:{type:'archive-print'}},{type:'archive-error',route:{type:'archive-print'},message:'失败'},{type:'archive-empty',route:{type:'archive-home'},report:totalReport([])}]){const target=new FakeNode('main');renderArchiveView(target,state,{print(){},retry(){}});assert.equal(nodes(target).some(node=>node.tag==='button'&&textOf(node).includes('打印/保存为 PDF')),false);}
}));

test('archive stylesheet declares fixed A4 pagination and long-content guards',()=>{
  const css=readFileSync(new URL('../src/web/archive-styles.css',import.meta.url),'utf8');assert.match(css,/@page\s*\{[^}]*size:\s*A4 portrait/s);assert.match(css,/@media\s+print/);assert.match(css,/thead\s*\{[^}]*table-header-group/s);assert.match(css,/break-before:\s*page/);assert.match(css,/break-inside:\s*avoid/);assert.match(css,/\.archive-document\s*\{[^}]*overflow-wrap:\s*anywhere/s);assert.match(css,/\.archive-expense-table\s*\{[^}]*table-layout:\s*fixed/s);assert.match(css,/\.archive-expense-table[^}]*td[^}]*\{[^}]*overflow-wrap:\s*anywhere/s);
});

test('archive landing names its preview while print DOM excludes screen runtime hooks and decoration',()=>withDom(()=>{
  const landing=new FakeNode('main');renderArchiveView(landing,{type:'archive-home',route:{type:'archive-home'},report:totalReport()},{print(){},retry(){}});const landingNodes=nodes(landing),preview=landingNodes.find(node=>node.tag==='a'&&node.attrs.href==='#/reports/archive/print');assert.ok(landingNodes.some(node=>node.tag==='h1'&&textOf(node).includes('旅行档案')));assert.ok(preview);assert.match(textOf(preview),/预览旅行总档案/);assert.ok(landingNodes.some(node=>node.className.includes('archive-yearbook-cover')));
  const print=new FakeNode('main');renderArchiveView(print,{type:'archive-report',route:{type:'archive-print'},report:totalReport()},{print(){},retry(){}});const printNodes=nodes(print);for(const node of printNodes){assert.equal(Object.hasOwn(node.attrs,'data-spotlight'),false);assert.equal(Object.hasOwn(node.attrs,'data-counter'),false);assert.notEqual(node.attrs.src,'/web/travel-wash.png');}
}));
