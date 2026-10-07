import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers/database.mjs';
import {createAiPlanStore} from '../src/storage/ai-plan-store.mjs';
import {normalizeAiInput} from '../src/ai/validation.mjs';
import {getCityByCode} from '../src/domain/city-catalog.mjs';
import {aiInput,planContent,sources} from './helpers/ai-fixtures.mjs';

function fixture(t){const c=setup(t);let id=0,second=0;return {...c,store:createAiPlanStore(c.database,{createId:()=>`plan-${++id}`,now:()=>new Date(Date.parse('2026-10-05T05:00:00Z')+second++*1000)})};}
const content=()=>planContent(normalizeAiInput(aiInput(),getCityByCode));
test('generated plans persist revision one, immutable original/source snapshot and provider metadata',t=>{
  const {store}=fixture(t),input=content(),refs=sources(),saved=store.insertGenerated({content:input,sources:refs,provider:'deepseek',model:'deepseek-flash'});
  input.trip.name='mutated';refs[0].summary='mutated';assert.equal(saved.revision,1);assert.equal(saved.original.trip.name,'江南小旅行');assert.equal(saved.content.trip.name,'江南小旅行');
  assert.equal(saved.sources[0].summary,'博物馆和城市游览资料。');assert.equal(saved.provider,'deepseek');assert.equal(saved.model,'deepseek-flash');assert.equal(store.list().length,1);assert.deepEqual(store.get(saved.id),saved);
});
test('editing increments revision but never alters the generated original or sources',t=>{
  const {store}=fixture(t),saved=store.insertGenerated({content:content(),sources:sources(),provider:'deepseek',model:'deepseek-flash'}),edited=content();edited.cautions=['人工修改'];
  const changed=store.update(saved.id,{expectedRevision:1,content:edited});assert.equal(changed.revision,2);assert.deepEqual(changed.content.cautions,['人工修改']);assert.notDeepEqual(changed.original.cautions,['人工修改']);assert.deepEqual(changed.sources,saved.sources);
  assert.throws(()=>store.update(saved.id,{expectedRevision:1,content:edited}),e=>e.code==='CONFLICT');
});
test('missing plans and invalid identities fail without inserting data',t=>{
  const {store}=fixture(t);assert.equal(store.get('missing'),null);assert.throws(()=>store.update('missing',{expectedRevision:1,content:content()}),e=>e.code==='NOT_FOUND');
  assert.throws(()=>store.insertGenerated({content:content(),sources:sources(),provider:'unknown',model:'x'}),e=>e.code==='VALIDATION');assert.equal(store.list().length,0);
});
test('conversion reader returns a defensive stored snapshot without changing the plan',t=>{
  const {store,database}=fixture(t),saved=store.insertGenerated({content:content(),sources:sources(),provider:'deepseek',model:'deepseek-flash'}),conversion={planId:saved.id,planRevision:saved.revision,tripId:'trip-1',status:'created',snapshot:saved.content};
  database.db.prepare('INSERT INTO ai_conversions VALUES(?,?,?,?)').run(saved.id,'trip-1','created',JSON.stringify(conversion));
  const value=store.getConversion(saved.id);value.status='mutated';assert.equal(store.getConversion(saved.id).status,'created');assert.equal(store.get(saved.id).conversion.status,'created');
});
test('conversion rows missing their frozen plan revision are rejected as corrupt',t=>{
  const {store,database}=fixture(t),saved=store.insertGenerated({content:content(),sources:sources(),provider:'deepseek',model:'deepseek-flash'}),conversion={planId:saved.id,tripId:'trip-1',status:'created',snapshot:saved.content};
  database.db.prepare('INSERT INTO ai_conversions VALUES(?,?,?,?)').run(saved.id,'trip-1','created',JSON.stringify(conversion));
  assert.throws(()=>store.getConversion(saved.id),e=>e.code==='STORAGE_CORRUPT');
});
test('corrupt plan payload is rejected rather than silently skipped',t=>{
  const {store,database}=fixture(t),saved=store.insertGenerated({content:content(),sources:sources(),provider:'deepseek',model:'deepseek-flash'});database.db.prepare('UPDATE ai_plans SET payload=? WHERE id=?').run('{',saved.id);
  assert.throws(()=>store.get(saved.id),e=>e.code==='STORAGE_CORRUPT');assert.throws(()=>store.list(),e=>e.code==='STORAGE_CORRUPT');
});
test('incomplete plan payload is rejected rather than returned with missing snapshots',t=>{
  const {store,database}=fixture(t),saved=store.insertGenerated({content:content(),sources:sources(),provider:'deepseek',model:'deepseek-flash'});
  const row=database.db.prepare('SELECT payload FROM ai_plans WHERE id=?').get(saved.id),payload=JSON.parse(row.payload);delete payload.original;
  database.db.prepare('UPDATE ai_plans SET payload=? WHERE id=?').run(JSON.stringify(payload),saved.id);assert.throws(()=>store.get(saved.id),e=>e.code==='STORAGE_CORRUPT');
});
