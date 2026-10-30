import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,createFootprintRuntime,hasPendingWrites,navigationSection} from '../src/web/app.mjs';
import {parseRoute,routeToHash} from '../src/web/router.mjs';
import {createApiClient} from '../src/web/api-client.mjs';
import {homeFootprintSummary,renderView} from '../src/web/views.mjs';
import {presentTrip} from '../src/domain/trip-presenter.mjs';
import {setup,prepare} from './helpers/database.mjs';
import {readFileSync} from 'node:fs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('navigation parses only known routes and safely decodes trip ids',()=>{
  assert.deepEqual(parseRoute('#/trips/trip-1/edit'),{type:'edit',id:'trip-1'});assert.deepEqual(parseRoute('#/new'),{type:'new'});assert.deepEqual(parseRoute('#/data'),{type:'data'});assert.equal(routeToHash({type:'data'}),'#/data');assert.deepEqual(parseRoute('#/bad'),{type:'home'});
});
test('expense routes round trip only safe identities',()=>{
  const routes=[{type:'expenses',id:'trip-1'},{type:'expense-new',id:'trip-1'},{type:'expense-edit',id:'trip-1',expenseId:'expense-1'},{type:'expense-categories',id:'trip-1'}];
  for(const route of routes)assert.deepEqual(parseRoute(routeToHash(route)),route);
  assert.deepEqual(parseRoute('#/trips/bad%2Fid/expenses'),{type:'home'});
});
test('footprint routes round trip only safe identities',()=>{
  const routes=[{type:'footprints'},{type:'footprint-province',provinceCode:'320000'},{type:'footprint-city',cityCode:'320100'},{type:'footprint-new'},{type:'footprint-edit',visitId:'visit-1'},{type:'footprint-manage'},{type:'footprint-settings'}];
  for(const route of routes)assert.deepEqual(parseRoute(routeToHash(route)),route);
  for(const hash of ['#/footprints/cities/32%2F0100','#/footprints/visits/bad%2Fid/edit','#/footprints/provinces/123'])assert.deepEqual(parseRoute(hash),{type:'home'});
});
test('archive routes round trip only safe identities',()=>{
  const routes=[{type:'archive-home'},{type:'archive-print'},{type:'trip-archive-print',id:'trip-1'}];
  for(const route of routes)assert.deepEqual(parseRoute(routeToHash(route)),route);
  for(const hash of ['#/reports/trips/bad%2Fid/print','#/reports/trips/%252e%252e/print','#/reports/trips/a.b/print'])assert.deepEqual(parseRoute(hash),{type:'home'});
});
test('footprint navigation uses its own active destinations',()=>{
  assert.equal(navigationSection({type:'footprints'}),'footprints');
  assert.equal(navigationSection({type:'footprint-city',cityCode:'320100'}),'footprints');
  assert.equal(navigationSection({type:'footprint-settings'}),'footprint-settings');
  assert.equal(navigationSection({type:'expenses',id:'trip-1'}),'trips');
  assert.equal(navigationSection({type:'data'}),'data');
});
test('home footprint summary exposes real counts, empty state and destination',()=>{
  assert.deepEqual(homeFootprintSummary({footprints:{provinceCount:3,cityCount:7,visitCount:12}}),{provinceCount:3,cityCount:7,visitCount:12,empty:false,route:{type:'footprints'}});
  assert.deepEqual(homeFootprintSummary({}),{provinceCount:0,cityCount:0,visitCount:0,empty:true,route:{type:'footprints'}});
});
test('footprint runtime replaces and disposes one controller per route',async()=>{
  const events=[];
  const runtime=createFootprintRuntime({api:{},root:{},navigate:()=>{},confirm:()=>false,render:()=>{},adapterFactory:()=>({destroy(){events.push('adapter-destroy');}}),controllerFactory:options=>({async load(route){events.push(['load',route.type,Boolean(options.mapAdapter)]);},dispose(){events.push('controller-dispose');},snapshot(){return {pendingCommand:null};}})});
  await runtime.load({type:'footprints'});
  await runtime.load({type:'footprint-city',cityCode:'320100'});
  runtime.dispose();
  assert.deepEqual(events,[['load','footprints',true],'controller-dispose',['load','footprint-city',false],'controller-dispose']);
});
test('before unload warns for active or unresolved writes but not idle state',()=>{
  assert.equal(hasPendingWrites([{busy:true}]),true);
  assert.equal(hasPendingWrites([{dirty:true}]),true);
  assert.equal(hasPendingWrites([{hasPendingSave:true}]),true);
  assert.equal(hasPendingWrites([{pendingCommand:{operationId:'save-1'}}]),true);
  assert.equal(hasPendingWrites([null,{}]),false);
});
test('empty overview is real zero and load errors are not empty trips',async t=>{
  const {service}=setup(t),screens=[];
  const app=createApp({api:{overview:async()=>service.getOverview(),trips:async()=>{throw {code:'NETWORK',message:'加载失败'};}},render:s=>screens.push(s),navigate:()=>{},confirm:()=>false});
  await app.load({type:'home'});assert.equal(screens.at(-1).data.counts.total,0);
  await app.load({type:'trips'});assert.equal(screens.at(-1).type,'error');assert.equal(screens.at(-1).message,'加载失败');
});
test('late old route response never replaces current page',async t=>{
  const {service}=setup(t),old=deferred(),screens=[];
  let loads=0;
  const app=createApp({api:{overview:()=>loads++===0?old.promise:Promise.resolve(service.getOverview()),trips:async()=>[]},render:s=>screens.push(s),navigate:()=>{}});
  const first=app.load({type:'home'});await app.load({type:'trips'});old.resolve(service.getOverview());await first;
  assert.equal(screens.at(-1).type,'trips');
});
test('cancel delete keeps data and confirmed delete uses exact revision',async t=>{
  const {service}=setup(t);const trip=service.saveTrip('trip-1',prepare(service));const routes=[];
  const api={deleteTrip:async(id,revision)=>service.deleteTrip(id,revision)};
  const canceled=createApp({api,render:()=>{},navigate:r=>routes.push(r),confirm:()=>false});await canceled.deleteTrip(trip);assert.equal(service.listTrips().length,1);
  const yes=createApp({api,render:()=>{},navigate:r=>routes.push(r),confirm:()=>true});await yes.deleteTrip(trip);assert.equal(service.listTrips().length,0);assert.deepEqual(routes,[{type:'trips'}]);
});
test('deletion conflict preserves current trip with visible error',async()=>{
  const screens=[];const app=createApp({api:{deleteTrip:async()=>{throw {code:'CONFLICT',message:'请重新载入'};}},render:s=>screens.push(s),navigate:()=>assert.fail('must not navigate'),confirm:()=>true});
  await app.deleteTrip({id:'trip-1',name:'江南',revision:1});assert.equal(screens.at(-1).type,'delete-error');assert.equal(screens.at(-1).trip.id,'trip-1');
});
test('API client preserves error status and sends versioned delete JSON',async()=>{
  let command;
  const api=createApiClient({fetchImpl:async(url,options)=>{command={url,options};return {ok:false,status:409,json:async()=>({error:{code:'CONFLICT',message:'旧版本'}})};}});
  await assert.rejects(api.deleteTrip('trip-1',2),e=>e.status===409&&e.code==='CONFLICT');assert.deepEqual(JSON.parse(command.options.body),{expectedTripRevision:2});
});
test('presenter derives Chinese status and precise budget',t=>{
  const {service}=setup(t);const trip=service.saveTrip('trip-1',prepare(service));const view=presentTrip(trip,'2026-10-02');assert.equal(view.statusLabel,'待出发');assert.equal(view.budgetText,'¥3,200.50');assert.equal(view.routeText,'南京市 · 苏州市');
});

test('mobile shell keeps four primary destinations and moves secondary tools into More',()=>{
  const html=readFileSync(new URL('../src/web/index.html',import.meta.url),'utf8');
  const destinations=[...html.matchAll(/data-mobile-destination="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(destinations,['home','trips','footprints','more']);
  const drawer=html.match(/<section[^>]*data-more-drawer[^>]*>([\s\S]*?)<\/section>/)?.[1]??'';
  for(const hash of ['#/archive','#/ai/plans','#/footprints/settings','#/ai/settings','#/data'])assert.match(drawer,new RegExp(`href="${hash.replace('/','\\/')}"`));
  assert.doesNotMatch(html,/data-nav="expenses"|data-mobile-destination="expenses"/);
});

class JournalNode {constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';}setAttribute(key,value){this.attrs[key]=String(value);if(key==='class')this.className=String(value);}addEventListener(){}append(...items){for(const item of items.flat(Infinity))this.children.push(item instanceof JournalNode?item:new JournalNode('#text',String(item)));}replaceChildren(...items){this.children=[];this.append(...items);}querySelector(){return null;}}
const journalNodes=root=>{const rows=[];(function walk(node){rows.push(node);for(const child of node.children)walk(child);})(root);return rows;};
const journalText=root=>journalNodes(root).filter(node=>node.tag==='#text').map(node=>node.text).join(' ');
const textWithin=node=>journalText(node).replace(/\s+/g,' ').trim();
test('home and detail use one narrative hierarchy with ordered trip actions',()=>{
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=JournalNode;globalThis.document={createElement:tag=>new JournalNode(tag),createTextNode:text=>new JournalNode('#text',String(text))};
  try{
    const actions={navigate(){},deleteTrip(){},retry(){}},trip={id:'trip-1',name:'江南长标题旅行',status:'completed',statusLabel:'已结束',startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:2,budgetText:'¥3,200.50',routeText:'南京市 · 苏州市',cities:[]};
    const home=new JournalNode('main');renderView(home,{type:'home',data:{counts:{total:1,upcoming:0,ongoing:0,completed:1},expenses:{hasExpenses:true,totalCents:12000},footprints:{provinceCount:2,cityCount:3,visitCount:4}},trip},actions);const homeNodes=journalNodes(home);
    assert.equal(homeNodes.filter(node=>node.tag==='button'&&node.className.includes('primary')&&textWithin(node).includes('新建行程')).length,1);assert.equal(homeNodes.filter(node=>node.attrs['data-journal-role']==='latest-trip').length,1);assert.equal(homeNodes.filter(node=>node.attrs['data-journal-role']==='footprint-band').length,1);assert.equal(homeNodes.filter(node=>node.attrs['data-journal-role']==='expense-band').length,1);
    for(const value of ['2','3','4'])assert.ok(homeNodes.some(node=>node.attrs['data-counter']===''&&textWithin(node)===value));
    const empty=new JournalNode('main');renderView(empty,{type:'home',data:{counts:{total:0,upcoming:0,ongoing:0,completed:0},expenses:{hasExpenses:false,totalCents:0},footprints:{provinceCount:0,cityCount:0,visitCount:0}},trip:null},actions);assert.doesNotMatch(journalText(empty),/示例|北京|上海/);
    const detail=new JournalNode('main');renderView(detail,{type:'detail',trip,guide:null,expenseOverview:{trip,summary:{hasExpenses:false,totalCents:0,budgetCents:320050,budgetRemainingCents:320050,budgetState:'within',recentExpenses:[]}}},actions);const group=journalNodes(detail).find(node=>node.attrs['data-detail-actions']==='');assert.ok(group);assert.deepEqual(group.children.map(textWithin),['导出行程档案','编辑行程','删除行程','返回列表']);const danger=group.children.find(node=>textWithin(node)==='删除行程');assert.match(danger.className,/danger/);assert.doesNotMatch(danger.className,/primary/);assert.doesNotMatch(journalText(detail),/\bnull\b/);
  }finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}
});
