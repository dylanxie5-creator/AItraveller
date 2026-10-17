import test from 'node:test';
import assert from 'node:assert/strict';
import {createFootprintController} from '../src/web/footprint-controller.mjs';
import {renderFootprintView} from '../src/web/footprint-views.mjs';
import {createApiClient} from '../src/web/api-client.mjs';

const visit={id:'visit-1',revision:1,cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'year',dateStart:'2025',dateEnd:null,source:'manual',linkedTripId:null,tripNameSnapshot:null,note:'旧记录'};
const city={cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',visitCount:1,totalCents:2580,tripExpenses:[{tripId:'trip-1',totalCents:2580}],visits:[visit],wholeTripExpensesExcluded:true};
const overview={summary:{provinceCount:1,cityCount:1,visitCount:1},provinces:[{provinceCode:'320000',provinceName:'江苏省',cityCount:1,visitCount:1,totalCents:2580,cities:[city]}],cities:[city],visits:[visit]};
const deferred=()=>{let resolve;const promise=new Promise(value=>{resolve=value;});return {promise,resolve};};

test('footprint API client uses exact encoded paths methods and unchanged envelopes',async()=>{
  const calls=[],api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({data:{ok:true}})};}}),command={operationId:'op-1',expectedRevision:2,input:{note:'原样'}};
  await api.syncFootprints();await api.footprintProvince('320000');await api.footprintCity('320100');await api.saveFootprintVisit('unsafe id',command);await api.deleteFootprintVisit('unsafe id',command);await api.suppressFootprint('trip unsafe','320100',{operationId:'s'});await api.restoreFootprint('trip unsafe','320100',{operationId:'r'});await api.saveMapSettings(command);
  assert.deepEqual(calls.map(item=>[item.url,item.options.method]),[['/api/footprints/sync','POST'],['/api/footprints/provinces/320000','GET'],['/api/footprints/cities/320100','GET'],['/api/footprints/visits/unsafe%20id','PUT'],['/api/footprints/visits/unsafe%20id','DELETE'],['/api/footprints/suppressions/trip%20unsafe/320100','PUT'],['/api/footprints/suppressions/trip%20unsafe/320100','DELETE'],['/api/map-settings','PUT']]);
  assert.deepEqual(JSON.parse(calls[3].options.body),command);
});

test('overview syncs before reading and search keeps a usable province city list without a map',async()=>{
  const order=[],renders=[];const api={syncFootprints:async()=>order.push('sync'),footprintOverview:async()=>{order.push('read');return overview;}};const controller=createFootprintController({api,render:state=>renders.push(state),navigate:()=>{}});
  await controller.load({type:'footprints'});assert.deepEqual(order,['sync','read']);assert.equal(controller.snapshot().filteredProvinces.length,1);
  controller.setField('query','不存在');assert.equal(controller.snapshot().filteredProvinces.length,0);controller.setField('query','南京');assert.equal(controller.snapshot().filteredProvinces[0].cities[0].cityName,'南京市');assert.equal(renders.at(-1).mapState,'unavailable');
});

test('manual form retains raw input and frozen operation identity after a failed save',async()=>{
  const calls=[],routes=[];let fail=true,n=0;const api={saveFootprintVisit:async(id,command)=>{calls.push({id,command});if(fail)throw {message:'结果未知'};return visit;}};const controller=createFootprintController({api,render:()=>{},navigate:route=>routes.push(route),today:()=> '2026-10-17',createId:()=>`id-${++n}`});
  await controller.load({type:'footprint-new'});controller.setField('cityCode','320100');controller.setField('datePrecision','year');controller.setField('dateStart','2025');controller.setField('note',' 保留输入 ');await controller.save();const pending=controller.snapshot().pendingCommand;assert.equal(controller.snapshot().values.note,' 保留输入 ');assert.equal(calls[0].command.operationId,pending.operationId);
  fail=false;await controller.save();assert.equal(calls[1].command.operationId,pending.operationId);assert.deepEqual(routes,[{type:'footprint-manage'}]);
});

test('edit delete revoke and restore use explicit confirmations and reload management',async()=>{
  const calls=[];let allow=false;const api={footprintVisit:async()=>visit,footprintManage:async()=>({summary:overview.summary,visits:[visit],suppressions:[]}),saveFootprintVisit:async(...args)=>calls.push(['save',...args]),deleteFootprintVisit:async(...args)=>calls.push(['delete',...args]),suppressFootprint:async(...args)=>calls.push(['suppress',...args]),restoreFootprint:async(...args)=>calls.push(['restore',...args])};const controller=createFootprintController({api,render:()=>{},navigate:()=>{},confirm:async()=>allow,createId:(()=>{let n=0;return()=>`op-${++n}`;})(),today:()=> '2026-10-17'});
  await controller.load({type:'footprint-manage'});await controller.deleteVisit(visit);await controller.suppress({...visit,source:'trip',linkedTripId:'trip-1'});assert.equal(calls.length,0);allow=true;await controller.deleteVisit(visit);await controller.suppress({...visit,source:'trip',linkedTripId:'trip-1'});await controller.restore({tripId:'trip-1',cityCode:'320100'});
  assert.deepEqual(calls.map(item=>item[0]),['delete','suppress','restore']);assert.equal(calls[0][2].expectedRevision,1);
});

test('city and settings failures stay local while late or disposed loads are ignored',async()=>{
  const old=deferred(),renders=[];const api={footprintCity:()=>old.promise,mapSettings:async()=>({provider:'amap',revision:0,keyConfigured:false,securityConfigured:false,complete:false}),saveMapSettings:async()=>{throw {message:'设置失败'};}};const controller=createFootprintController({api,render:state=>renders.push(state),navigate:()=>{}});const pending=controller.load({type:'footprint-city',cityCode:'320100'});await controller.load({type:'footprint-settings'});controller.setField('keyValue','typed-key');controller.setField('securityValue','typed-security');await controller.saveSettings();assert.equal(controller.snapshot().error,'设置失败');assert.equal(controller.snapshot().values.keyValue,'typed-key');old.resolve(city);await pending;assert.equal(controller.snapshot().type,'footprint-settings');controller.dispose();assert.equal(renders.at(-1).type,'footprint-settings');
});

test('views render city expense exclusion and hostile values only as text',()=>{
  class FakeNode {constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(){}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}}
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FakeNode;globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',String(text))};
  try {const root=new FakeNode('main'),hostile='<img src=x onerror=alert(1)>',state={type:'footprint-city',city:{...city,cityName:hostile,visits:[{...visit,note:hostile}]},busy:false,error:''};renderFootprintView(root,state,{navigate:()=>{},deleteVisit:()=>{},suppress:()=>{}});const nodes=[];(function walk(node){nodes.push(node);for(const child of node.children??[])walk(child);})(root);assert.ok(nodes.some(node=>node.tag==='#text'&&node.text===hostile));assert.equal(nodes.some(node=>node.tag==='img'),false);assert.ok(nodes.some(node=>node.tag==='#text'&&node.text.includes('整趟行程花销未计入')));assert.ok(nodes.some(node=>node.tag==='#text'&&node.text.includes('¥25.80')));}finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}
});

test('overview rerenders preserve the live map container',()=>{
  class FakeNode {constructor(tag=''){this.tag=tag;this.children=[];this.attrs={};this.className='';}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(){}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}querySelector(selector){if(selector==='[data-footprint-map]'&&Object.hasOwn(this.attrs,'data-footprint-map'))return this;for(const child of this.children){const found=child?.querySelector?.(selector);if(found)return found;}return null;}}
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FakeNode;globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:()=>new FakeNode('#text')};
  try {const root=new FakeNode('main'),actions={navigate:()=>{},controller:{setField:()=>{}}},state={type:'footprints',overview,filteredProvinces:overview.provinces,query:'',mapState:'loading',mapError:''};const first=renderFootprintView(root,state,actions);const marker=new FakeNode('canvas');first.append(marker);const second=renderFootprintView(root,{...state,mapState:'ready'},actions);assert.equal(second,first);assert.equal(second.children.includes(marker),true);}finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}
});
