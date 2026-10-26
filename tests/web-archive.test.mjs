import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../src/web/api-client.mjs';
import {createArchiveController} from '../src/web/archive-controller.mjs';

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
