import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../src/web/api-client.mjs';
import {createArchiveController} from '../src/web/archive-controller.mjs';
import {createPdfDownloadRuntime} from '../src/web/pdf-download-runtime.mjs';
import {renderArchiveView} from '../src/web/archive-views.mjs';
import {renderView} from '../src/web/views.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tripReport=()=>({kind:'trip',generatedAt:'2026-10-26T12:00:00.000Z',cutoffDate:'2026-10-26',databaseVersion:4,trip:{name:'档案行程',startDate:'2026-10-10',endDate:'2026-10-13',durationDays:4,travelerCount:2,budgetCents:320050,cities:[]},expenses:{hasExpenses:false,totalCents:0,budgetCents:320050,budgetRemainingCents:320050,budgetState:'within',byCategory:[],byCity:[],items:[]},footprints:[],guide:null});
const totalReport=(trips=[tripReport()])=>({kind:'archive',generatedAt:'2026-10-26T12:00:00.000Z',cutoffDate:'2026-10-26',databaseVersion:4,summary:{tripCount:trips.length,travelDayCount:trips.length?4:0,totalExpenseCents:0,provinceCount:0,cityCount:0,visitCount:0},byYear:[],byCategory:[],byCity:[],wholeTripExpenseCents:0,directory:[],trips,footprints:[]});

test('archive API client uses exact GET endpoints without request bodies',async()=>{
  const calls=[],api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({data:{ok:true}})};}});
  await api.travelArchive();await api.tripArchive('unsafe id');
  assert.deepEqual(calls.map(call=>[call.url,call.options.method,call.options.body]),[['/api/archive','GET',undefined],['/api/archive/trips/unsafe%20id','GET',undefined]]);
});

test('archive controller keeps only immutable current home data and explicit empty error retry states',async()=>{
  const old=deferred(),fresh=totalReport(),states=[];let calls=0;const controller=createArchiveController({api:{travelArchive:()=>calls++===0?old.promise:Promise.resolve(fresh)},render:state=>states.push(state)});
  const first=controller.load({type:'archive-home'});await controller.load({type:'archive-home'});fresh.trips[0].trip.name='API 已修改';old.resolve(totalReport([]));await first;
  assert.equal(states.at(-1).type,'archive-home');assert.equal(controller.snapshot().report.trips[0].trip.name,'档案行程');assert.equal(Object.isFrozen(controller.snapshot().report),true);
  const empty=[];const emptyController=createArchiveController({api:{travelArchive:async()=>totalReport([])},render:state=>empty.push(state)});await emptyController.load({type:'archive-home'});assert.equal(empty.at(-1).type,'archive-empty');
  const failed=[];const failedController=createArchiveController({api:{travelArchive:async()=>{throw new Error('档案加载失败');}},render:state=>failed.push(state)});await failedController.load({type:'archive-home'});assert.deepEqual(failed.at(-1),{type:'archive-error',route:{type:'archive-home'},message:'档案加载失败'});
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

test('archive and completed-trip views expose same-origin PDF download actions without print targets',()=>withDom(()=>{
  const landing=new FakeNode('main');renderArchiveView(landing,{type:'archive-home',route:{type:'archive-home'},report:totalReport()},{retry(){}});const landingNodes=nodes(landing);
  const total=landingNodes.find(node=>node.tag==='a'&&node.attrs['data-pdf-download']==='');assert.equal(total.attrs.href,'/api/archive.pdf');assert.match(textOf(total),/下载旅行总档案 PDF/u);assert.equal(total.attrs.target,undefined);assert.ok(landingNodes.some(node=>node.attrs['data-pdf-download-status']===''));assert.ok(landingNodes.some(node=>node.attrs['data-pdf-download-error']===''));
  const expenseOverview={summary:{totalCents:0,budgetCents:320050,budgetRemainingCents:320050,budgetState:'within',recentExpenses:[]}};
  const completed=new FakeNode('main');renderView(completed,{type:'detail',trip:{id:'trip-1',name:'已结束',status:'completed',statusLabel:'已结束',startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:2,budgetText:'¥3,200.50',cities:[]},guide:null,expenseOverview},{navigate(){},deleteTrip(){},retry(){}});const trip=nodes(completed).find(node=>node.tag==='a'&&node.attrs['data-pdf-download']==='');assert.equal(trip.attrs.href,'/api/archive/trips/trip-1.pdf');assert.match(textOf(trip),/下载行程档案 PDF/u);assert.equal(trip.attrs.target,undefined);
  const ongoing=new FakeNode('main');renderView(ongoing,{type:'detail',trip:{id:'trip-2',name:'进行中',status:'ongoing',statusLabel:'进行中',startDate:'2026-10-20',endDate:'2026-10-26',travelerCount:1,budgetText:'未设预算',cities:[]},guide:null,expenseOverview:{summary:{...expenseOverview.summary,budgetCents:null,budgetRemainingCents:null,budgetState:'unset'}}},{navigate(){},deleteTrip(){},retry(){}});assert.match(textOf(ongoing),/行程结束后可生成档案/u);assert.equal(nodes(ongoing).some(node=>node.attrs['data-pdf-download']===''),false);
  for(const root of [landing,completed,ongoing])assert.equal(nodes(root).some(node=>String(node.attrs.href??'').includes('/reports/')||textOf(node).includes('打印')),false);
}));

class RuntimeElement {
  constructor(tag='div',attrs={}) {this.tag=tag;this.attrs={...attrs};this.children=[];this.parentElement=null;this.textContent='';this.hidden=false;this.clicks=0;this.removed=false;}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  setAttribute(name,value){this.attrs[name]=String(value);}getAttribute(name){return this.attrs[name]??null;}hasAttribute(name){return Object.hasOwn(this.attrs,name);}removeAttribute(name){delete this.attrs[name];}
  matches(selector){const match=/^\[([^\]]+)\]$/u.exec(selector);return Boolean(match&&this.hasAttribute(match[1]));}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
  click(){this.clicks++;}remove(){this.removed=true;}
}
function runtimeHarness(fetchImpl) {
  const listeners=new Map(),document={baseURI:'http://127.0.0.1:3210/',created:[],body:new RuntimeElement('body'),addEventListener(type,listener){listeners.set(type,listener);},removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},createElement(tag){const node=new RuntimeElement(tag);this.created.push(node);return node;}},scope=new RuntimeElement('div',{'data-pdf-download-scope':''}),anchor=new RuntimeElement('a',{'data-pdf-download':'',href:'/api/archive.pdf'}),status=new RuntimeElement('p',{'data-pdf-download-status':''}),error=new RuntimeElement('p',{'data-pdf-download-error':''}),queued=[],createdUrls=[],revoked=[];
  error.hidden=true;scope.append(anchor,status,error);document.body.append=node=>{node.parentElement=document.body;document.body.children.push(node);};
  const urlApi={createObjectURL(blob){createdUrls.push(blob);return 'blob:pdf-1';},revokeObjectURL(value){revoked.push(value);}};
  const runtime=createPdfDownloadRuntime({document,fetchImpl,urlApi,queueMicrotaskImpl:callback=>queued.push(callback)});
  const dispatch=target=>listeners.get('click')?.({target,button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
  return {runtime,document,scope,anchor,status,error,queued,createdUrls,revoked,dispatch};
}
const response=({status=200,type='application/pdf',bytes=Buffer.from('%PDF-1.7\nbody'),disposition=`attachment; filename="travel-archive.pdf"; filename*=UTF-8''%E6%97%85%E8%A1%8C%E6%80%BB%E6%A1%A3%E6%A1%88.pdf`}={})=>({ok:status>=200&&status<300,status,headers:{get:name=>name.toLowerCase()==='content-type'?type:name.toLowerCase()==='content-disposition'?disposition:null},blob:async()=>new Blob([bytes],{type})});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('PDF download validates status content type magic and RFC 5987 filename before clicking a Blob URL',async()=>{
  const replies=[response({status:503,type:'application/json',bytes:Buffer.from('{}')}),response({type:'application/json',bytes:Buffer.from('{}')}),response({bytes:Buffer.from('not-pdf')}),response()];let calls=0;const h=runtimeHarness(async()=>replies[calls++]);
  for(let index=0;index<4;index++){h.dispatch(h.anchor);await flush();if(index<3){assert.equal(h.document.created.length,0);assert.equal(h.error.hidden,false);}else{assert.equal(h.document.created.length,1);assert.equal(h.document.created[0].download,'旅行总档案.pdf');assert.equal(h.document.created[0].clicks,1);assert.equal(h.createdUrls[0] instanceof Blob,true);}}
  assert.equal(calls,4);h.runtime.dispose();
});

test('PDF download prevents duplicate pending requests revokes its URL and restores ready state',async()=>{
  const pending=deferred();let calls=0;const h=runtimeHarness(async(url,options)=>{calls++;assert.equal(url,'/api/archive.pdf');assert.deepEqual(options,{cache:'no-store',credentials:'same-origin'});return pending.promise;});
  h.dispatch(h.anchor);h.dispatch(h.anchor);assert.equal(calls,1);assert.equal(h.anchor.getAttribute('aria-disabled'),'true');assert.equal(h.status.textContent,'正在生成 PDF…');
  pending.resolve(response());await flush();assert.equal(h.document.created.length,1);assert.equal(h.queued.length,1);h.queued[0]();assert.deepEqual(h.revoked,['blob:pdf-1']);assert.equal(h.anchor.getAttribute('aria-disabled'),null);assert.equal(h.status.textContent,'PDF 已开始下载');h.runtime.dispose();
});

test('PDF download keeps a controlled inline error and supports an explicit retry',async()=>{
  let calls=0;const h=runtimeHarness(async()=>{calls++;if(calls===1)throw new Error('raw network secret');return response();});
  h.dispatch(h.anchor);await flush();assert.equal(h.error.hidden,false);assert.equal(h.error.textContent,'PDF 下载失败，请重试');assert.equal(h.error.textContent.includes('secret'),false);assert.equal(h.anchor.getAttribute('aria-disabled'),null);
  h.dispatch(h.anchor);await flush();assert.equal(calls,2);assert.equal(h.document.created[0].clicks,1);assert.equal(h.error.hidden,true);h.runtime.dispose();
});
