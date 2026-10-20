import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmapAdapter} from '../src/web/amap-adapter.mjs';
import {createFootprintController} from '../src/web/footprint-controller.mjs';

function runtime({manual=false,failCodes=new Set(),children=true}={}) {const calls={loads:[],maps:[],searches:[],polygons:[],markers:[],callbacks:new Map()};class AMapMap {constructor(container,options){this.container=container;this.options=options;this.overlays=[];this.destroyed=false;calls.maps.push(this);}add(value){this.overlays.push(value);}destroy(){this.destroyed=true;}}class Polygon {constructor(options){this.options=options;this.events={};calls.polygons.push(this);}on(name,fn){this.events[name]=fn;}off(){this.events={};}}class Marker {constructor(options){this.options=options;this.events={};calls.markers.push(this);}on(name,fn){this.events[name]=fn;}off(){this.events={};}}class DistrictSearch {constructor(options){this.options=options;}search(code,callback){calls.searches.push(code);calls.callbacks.set(code,callback);if(manual)return;queueMicrotask(()=>{if(failCodes.has(code)){callback('error',{});return;}if(code.endsWith('0000'))callback('complete',{districtList:[{adcode:code,boundaries:[[[118,32],[119,32],[119,33]]],districtList:children?[{adcode:'320100',name:'南京市',center:{lng:118.8,lat:32.1}}]:[]} ]});else callback('complete',{districtList:[{adcode:code,center:{lng:118.8,lat:32.1},boundaries:[]} ]});});}}const AMap={Map:AMapMap,Polygon,Marker,DistrictSearch};const window={location:{origin:'http://127.0.0.1:3213'},AMapLoader:{async load(options){calls.loads.push(options);return AMap;}}};return {calls,window,document:{},AMap};}
const session={provider:'amap',revision:7,key:'FAKE-JS-KEY',serviceHost:'/_AMapService'};
const provinces=[{provinceCode:'320000',provinceName:'江苏省',cities:[{cityCode:'320100',cityName:'南京市'}]}];

test('adapter loads once with exact API contract and renders warm clickable visited overlays',async()=>{
  const io=runtime(),provincesClicked=[],citiesClicked=[],adapter=createAmapAdapter({window:io.window,document:io.document});const result=await adapter.mount({id:'map'},{session,provinces,onProvince:code=>provincesClicked.push(code),onCity:code=>citiesClicked.push(code)});
  assert.deepEqual(io.calls.loads,[{key:'FAKE-JS-KEY',version:'2.0',plugins:['AMap.DistrictSearch']}]);assert.equal(io.window._AMapSecurityConfig.serviceHost,'http://127.0.0.1:3213/_AMapService');assert.deepEqual(io.calls.searches,['320000']);assert.equal(io.calls.polygons[0].options.fillColor,'#d97757');assert.equal(io.calls.markers.length,1);io.calls.polygons[0].events.click();io.calls.markers[0].events.click();assert.deepEqual(provincesClicked,['320000']);assert.deepEqual(citiesClicked,['320100']);assert.deepEqual(result.warnings,[]);
  await adapter.mount({id:'second'},{session,provinces,onProvince:()=>{},onCity:()=>{}});assert.equal(io.calls.loads.length,1);assert.equal(io.calls.maps[0].destroyed,true);adapter.destroy();assert.equal(io.calls.maps[1].destroyed,true);assert.deepEqual(io.calls.polygons.at(-1).events,{});
});

test('municipality or unmatched city falls back to a direct city-code query',async()=>{
  const io=runtime({children:false}),adapter=createAmapAdapter({window:io.window,document:io.document});await adapter.mount({}, {session,provinces,onProvince:()=>{},onCity:()=>{}});assert.deepEqual(io.calls.searches,['320000','320100']);assert.equal(io.calls.markers.length,1);
});

test('partial district failure returns bounded warnings while successful provinces remain',async()=>{
  const io=runtime({failCodes:new Set(['330000'])}),adapter=createAmapAdapter({window:io.window,document:io.document}),input=[...provinces,{provinceCode:'330000',provinceName:'浙江省',cities:[]}];const result=await adapter.mount({}, {session,provinces:input,onProvince:()=>{},onCity:()=>{}});assert.deepEqual(result.warnings,['浙江省']);assert.equal(io.calls.polygons.length,1);
});

test('loader timeout rejects cleanly and leaves no map instance',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const window={location:{origin:'http://127.0.0.1:3213'},AMapLoader:{load:()=>new Promise(()=>{})}},adapter=createAmapAdapter({window,document:{},timeoutMs:10});const pending=adapter.mount({}, {session,provinces,onProvince:()=>{},onCity:()=>{}});const rejection=assert.rejects(pending,/地图脚本加载超时/);t.mock.timers.tick(10);await rejection;
});

test('only public administrative identifiers reach the SDK and stale callbacks do nothing after destroy',async()=>{
  const io=runtime({manual:true}),navigations=[],adapter=createAmapAdapter({window:io.window,document:io.document});const privateProvince={provinceCode:'320000',provinceName:'江苏省',cities:[{cityCode:'320100',cityName:'南京市'}]};const pending=adapter.mount({}, {session,provinces:[privateProvince],onProvince:code=>navigations.push(code),onCity:code=>navigations.push(code)});while(!io.calls.callbacks.has('320000'))await Promise.resolve();adapter.destroy();io.calls.callbacks.get('320000')('complete',{districtList:[{boundaries:[[[1,2]]],districtList:[{adcode:'320100',center:{lng:1,lat:2}}]}]});await pending;assert.equal(io.calls.polygons.length,0);assert.deepEqual(navigations,[]);
  const sdkText=JSON.stringify({loads:io.calls.loads,searches:io.calls.searches,mapOptions:io.calls.maps.map(item=>item.options)});for(const secret of ['秘密行程','2026-10-01','私人备注','2580'])assert.equal(sdkText.includes(secret),false);
});

test('controller renders list first then mounts only public map data and ignores a late session after disposal',async()=>{
  const overview={summary:{provinceCount:1,cityCount:1,visitCount:2},provinces:[{provinceCode:'320000',provinceName:'江苏省',cityCount:1,visitCount:2,totalCents:2580,cities:[{cityCode:'320100',cityName:'南京市',visitCount:2,totalCents:2580,visits:[{note:'私人备注',dateStart:'2026-10-01',tripNameSnapshot:'秘密行程'}]}]}],cities:[],visits:[]},renders=[],mounted=[],routes=[];const api={syncFootprints:async()=>{},footprintOverview:async()=>overview,mapSession:async()=>session};const mapAdapter={async mount(container,options){mounted.push({container,options});return {warnings:[]};},destroy(){mounted.push('destroy');}};const controller=createFootprintController({api,render:state=>{renders.push(state);return {id:'map-container'};},navigate:route=>routes.push(route),mapAdapter});await controller.load({type:'footprints'});assert.equal(renders.some(state=>state.type==='footprints'&&state.mapState!=='ready'),true);assert.deepEqual(mounted[0].options.provinces,[{provinceCode:'320000',provinceName:'江苏省',cities:[{cityCode:'320100',cityName:'南京市'}]}]);mounted[0].options.onProvince('320000');mounted[0].options.onCity('320100');assert.deepEqual(routes,[{type:'footprint-province',provinceCode:'320000'},{type:'footprint-city',cityCode:'320100'}]);
  let resolveSession;const waiting=new Promise(resolve=>{resolveSession=resolve;}),late=createFootprintController({api:{...api,mapSession:()=>waiting},render:()=>({}),navigate:()=>assert.fail('late navigation'),mapAdapter});const load=late.load({type:'footprints'});await Promise.resolve();late.dispose();resolveSession(session);await load;assert.equal(mounted.at(-1),'destroy');
});
