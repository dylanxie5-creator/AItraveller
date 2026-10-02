import test from 'node:test';import assert from 'node:assert/strict';
import {createFormController} from '../src/web/form-controller.mjs';
import {createTripForm} from '../src/shared/trip-form-model.mjs';
import {setup} from './helpers/database.mjs';import {input} from './helpers/fixtures.mjs';
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
test('changed input after uncommitted save failure gets a new operation identity',async t=>{
  const commands=[];const {controller}=editor(t,{apiOverride:{saveTrip:async(id,command)=>{commands.push(structuredClone(command));throw {code:'NETWORK',message:'lost'};}}});await controller.start();await controller.next();await controller.next();await controller.save();controller.change('name','改标题');await controller.save();assert.notEqual(commands[0].operationId,commands[1].operationId);assert.equal(commands[1].input.name,'改标题');
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
