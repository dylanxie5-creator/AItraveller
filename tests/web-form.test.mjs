import test from 'node:test';import assert from 'node:assert/strict';
import {createFormController} from '../src/web/form-controller.mjs';
import {createTripForm} from '../src/shared/trip-form-model.mjs';
import {setup,prepare} from './helpers/database.mjs';import {input} from './helpers/fixtures.mjs';
import {renderForm} from '../src/web/views.mjs';
function editor(t,{apiOverride={},slot,render=()=>{}}={}) {
  const {service}=setup(t);const api={draft:async k=>service.getDraft(k),saveDraft:async(k,c)=>service.saveDraft(k,c),discardDraft:async(k,c)=>service.discardDraft(k,c),saveTrip:async(id,c)=>service.saveTrip(id,c),trip:async id=>service.getTrip(id),...apiOverride};
  const model=createTripForm({slot:slot??{targetTripId:'trip-1',baseTripRevision:0,step:'basic',input:input()}});const routes=[];let id=0;
  const controller=createFormController({api,model,draftKey:'new',slot:{key:'new',revision:0,state:'closed'},render,navigate:r=>routes.push(r),confirm:()=>true,clock:{setTimeout:()=>1,clearTimeout:()=>{}},createId:()=>`id-${++id}`});return {service,model,controller,routes};
}
test('failed draft save blocks step change and preserves user input',async t=>{
  const {controller,model}=editor(t,{apiOverride:{saveDraft:async()=>{throw {code:'NETWORK',message:'断开'};},draft:async()=>{throw Error();}}});await controller.start();await controller.next();assert.equal(model.snapshot().step,'basic');assert.equal(model.toInput().name,'江南小旅行');assert.equal(controller.snapshot().error,'断开');
});
test('lost committed draft response is reconciled before newer input writes',async t=>{
  let first=true;const state=editor(t);const original=state.controller;
  original.dispose(); const {service,model}=state;let n=0;
  const controller=createFormController({api:{saveDraft:async(k,c)=>{const saved=service.saveDraft(k,c);if(first){first=false;throw {code:'NETWORK',message:'lost'};}return saved;},draft:async k=>service.getDraft(k)},model,draftKey:'new',slot:{key:'new',revision:0,state:'closed'},render:()=>{},navigate:()=>{},confirm:()=>true,clock:{setTimeout:()=>1,clearTimeout:()=>{}},createId:()=>`retry-${++n}`});
  await controller.start();controller.change('name','新标题');await controller.next();assert.equal(service.getDraft('new').input.name,'新标题');assert.equal(model.snapshot().step,'route');
});
test('uncertain trip save retries same command and creates only one trip',async t=>{
  let savedCommand;let first=true;const {service,model,controller,routes}=editor(t,{apiOverride:{saveTrip:async(id,command)=>{if(first){savedCommand=structuredClone(command);first=false;throw {code:'NETWORK',message:'lost'};}assert.deepEqual(command,savedCommand);return service.saveTrip(id,command);}}});
  await controller.start();await controller.next();await controller.next();await controller.save();assert.equal(model.snapshot().step,'confirm');assert.equal(routes.length,0);await controller.retrySave();assert.equal(service.listTrips().length,1);assert.equal(routes[0].type,'detail');
});
test('uncertain uncommitted save blocks step changes until its exact command succeeds',async t=>{
  let first=true;const commands=[];const {service,controller,model,routes}=editor(t,{apiOverride:{saveTrip:async(id,c)=>{commands.push(structuredClone(c));if(first){first=false;throw {code:'NETWORK',message:'lost'};}return service.saveTrip(id,c);}}});
  await controller.start();await controller.next();await controller.next();await controller.save();
  const revision=service.getDraft('new').revision;await controller.previous();
  assert.equal(model.snapshot().step,'confirm');assert.equal(service.getDraft('new').revision,revision);
  await controller.next();controller.change('name','改标题');await controller.retryDraft();
  assert.equal(model.toInput().name,'江南小旅行');await controller.retrySave();
  assert.deepEqual(commands[1],commands[0]);assert.equal(service.listTrips().length,1);assert.equal(routes[0].type,'detail');
});

test('lost committed save response retains retry identity despite attempted mutations',async t=>{
  let first=true;const commands=[];const {service,controller,model,routes}=editor(t,{apiOverride:{saveTrip:async(id,c)=>{commands.push(structuredClone(c));const trip=service.saveTrip(id,c);if(first){first=false;throw {code:'NETWORK',message:'lost'};}return trip;}}});
  await controller.start();await controller.next();await controller.next();await controller.save();
  controller.change('name','改标题');assert.equal(model.toInput().name,'江南小旅行');assert.equal(controller.snapshot().hasPendingSave,true);
  await controller.discard();assert.equal(routes.length,0);await controller.retrySave();
  assert.deepEqual(commands[1],commands[0]);assert.equal(service.listTrips().length,1);assert.equal(routes[0].type,'detail');
});

test('server rejects historical unknown city with visible route field error and retained input',async t=>{
  const {service,database}=setup(t);service.saveTrip('trip-1',prepare(service));
  const row=database.db.prepare('SELECT payload FROM trip_cities WHERE trip_id=? AND position=0').get('trip-1');
  database.db.prepare('UPDATE trip_cities SET payload=? WHERE trip_id=? AND position=0').run(JSON.stringify({...JSON.parse(row.payload),cityCode:'999999',cityName:'历史城'}),'trip-1');
  const model=createTripForm({trip:service.getTrip('trip-1')});let n=0;const commands=[];
  const controller=createFormController({api:{saveDraft:async(k,c)=>service.saveDraft(k,c),draft:async k=>service.getDraft(k),saveTrip:async(id,c)=>{commands.push(structuredClone(c));return service.saveTrip(id,c);},trip:async id=>service.getTrip(id)},model,draftKey:'edit:trip-1',slot:service.getDraft('edit:trip-1'),render:()=>{},navigate:()=>{},clock:{setTimeout:()=>1,clearTimeout:()=>{}},createId:()=>`legacy-${++n}`});
  await controller.start();await controller.next();await controller.next();await controller.save();
  assert.equal(controller.snapshot().errors.city_0,'请选择有效城市');assert.equal(controller.snapshot().step,'route');assert.equal(controller.snapshot().hasPendingSave,false);
  assert.equal(model.toInput().cities[0].cityName,'历史城');assert.equal(service.getTrip('trip-1').revision,1);
  controller.removeCity(0);controller.addCity({cityCode:'320100',cityName:'南京市',arrivalDate:'2026-10-10',departureDate:'2026-10-11'});controller.moveCity(1,0);await controller.next();await controller.save();
  assert.equal(service.getTrip('trip-1').revision,2);assert.equal(service.getTrip('trip-1').cities[0].cityName,'南京市');assert.notEqual(commands[0].operationId,commands[1].operationId);
});
test('discard closes session and dispose prevents late rendering',async t=>{
  const rendered=[];const {controller,service}=editor(t,{render:s=>rendered.push(s)});await controller.start();await controller.discard();assert.equal(service.getDraft('new').state,'closed');controller.dispose();const count=rendered.length;controller.change('name','不能再写');await controller.next();assert.equal(rendered.length,count);assert.equal(service.getDraft('new').state,'closed');
});
test('submit flushes draft and rejects stale editor version without losing input',async t=>{
  const {controller,model}=editor(t,{apiOverride:{saveTrip:async()=>{throw {code:'CONFLICT',message:'请重新载入'};}}});await controller.start();await controller.next();await controller.next();await controller.save();assert.equal(controller.snapshot().error,'请重新载入');assert.equal(model.toInput().budgetYuan,'3200.50');
});
test('slow first autosave serializes later writes and keeps newest input',async t=>{
  const {service}=setup(t);let release;const gate=new Promise(r=>release=r);let active=0,max=0,first=true;
  const model=createTripForm({slot:{targetTripId:'trip-1',baseTripRevision:0,step:'basic',input:input()}});
  const controller=createFormController({api:{saveDraft:async(k,c)=>{active++;max=Math.max(max,active);if(first){first=false;await gate;}const result=service.saveDraft(k,c);active--;return result;},draft:async k=>service.getDraft(k)},model,draftKey:'new',slot:{key:'new',revision:0,state:'closed'},render:()=>{},navigate:()=>{},clock:{setTimeout:()=>1,clearTimeout:()=>{}},createId:()=> 'session-1'});
  const start=controller.start();await Promise.resolve();controller.change('name','最后输入');const next=controller.next();release();await start;await next;
  assert.equal(max,1);assert.equal(service.getDraft('new').input.name,'最后输入');assert.equal(service.getDraft('new').step,'route');
});
test('disposed editor ignores late render while preserving completed storage write',async t=>{
  const {service}=setup(t);let release;const gate=new Promise(r=>release=r);const rendered=[];
  const model=createTripForm({slot:{targetTripId:'trip-1',baseTripRevision:0,step:'basic',input:input()}});
  const controller=createFormController({api:{saveDraft:async(k,c)=>{await gate;return service.saveDraft(k,c);}},model,draftKey:'new',slot:{key:'new',revision:0,state:'closed'},render:s=>rendered.push(s),navigate:()=>{},clock:{setTimeout:()=>1,clearTimeout:()=>{}},createId:()=> 'session-1'});
  const starting=controller.start();await Promise.resolve();controller.dispose();release();await starting;
  assert.equal(rendered.length,0);assert.equal(service.getDraft('new').state,'active');
});

class FormNode {
  constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';this.parentElement=null;this.disabled=false;this.dataset={};}
  setAttribute(key,value){this.attrs[key]=String(value);if(key==='class')this.className=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}addEventListener(){}
  append(...items){for(const item of items){const child=item instanceof FormNode?item:new FormNode('#text',String(item));child.parentElement=this;this.children.push(child);}}
  prepend(...items){const next=[];for(const item of items){const child=item instanceof FormNode?item:new FormNode('#text',String(item));child.parentElement=this;next.push(child);}this.children=[...next,...this.children];}
  replaceChildren(...items){this.children=[];this.append(...items);}focus(){}
  matches(selector){if(selector.startsWith('#'))return this.attrs.id===selector.slice(1);if(selector==='button'||selector==='input'||selector==='textarea'||selector==='select')return this.tag===selector;if(selector.startsWith('[')){const match=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return Boolean(match&&this.attrs[match[1]]!==undefined&&(match[2]===undefined||this.attrs[match[1]]===match[2]));}return false;}
  all(){const result=[];(function walk(node){for(const child of node.children){result.push(child);walk(child);}})(this);return result;}
  querySelector(selector){return this.all().find(node=>node.matches(selector))??null;}
  querySelectorAll(selector){return this.all().filter(node=>selector.split(',').some(part=>node.matches(part.trim())));}
}
const formText=root=>root.all().filter(node=>node.tag==='#text').map(node=>node.text).join(' ');
test('trip form keeps one semantic stepper and distinguishes disabled busy and destructive actions',()=>{
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FormNode;globalThis.document={createElement:tag=>new FormNode(tag),createTextNode:text=>new FormNode('#text',String(text))};
  try{
    const root=new FormNode('main'),values=input(),controller={change(){},changeCity(){},addCity(){},moveCity(){},removeCity(){},discard(){},previous(){},next(){},save(){},retrySave(){},retryDraft(){}};
    renderForm(root,{step:'basic',input:values,errors:{},busy:true,saved:false,dirty:true,error:'',hasPendingSave:false,baseTripRevision:0},controller,{cities:async()=>[]});
    assert.equal(root.all().filter(node=>node.tag==='ol'&&node.className.includes('stepper')).length,1);for(const label of ['基本信息','城市路线','确认保存'])assert.match(formText(root),new RegExp(label));
    for(const id of ['name','startDate','endDate','travelerCount','budgetYuan']){const control=root.querySelector(`#${id}`);assert.ok(control,id);assert.equal(control.getAttribute('aria-describedby'),`message-${id}`);}
    const routeRoot=new FormNode('main');renderForm(routeRoot,{step:'route',input:values,errors:{},busy:false,saved:false,dirty:true,error:'',hasPendingSave:false,baseTripRevision:0},controller,{cities:async()=>[]});
    const buttons=[...root.all(),...routeRoot.all()].filter(node=>node.tag==='button');assert.ok(buttons.some(node=>node.dataset.state==='busy'));assert.ok(buttons.some(node=>node.dataset.state==='destructive'));assert.ok(buttons.some(node=>node.dataset.state==='disabled'));
  }finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}
});
