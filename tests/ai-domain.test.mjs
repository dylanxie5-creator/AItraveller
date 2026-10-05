import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAiInput, normalizePlanContent} from '../src/ai/validation.mjs';
import {normalizeSearchResults} from '../src/ai/sources.mjs';
import {AiError} from '../src/ai/errors.mjs';
import {getCityByCode} from '../src/domain/city-catalog.mjs';
import {normalizeTripInput} from '../src/shared/trip-validation.mjs';
import {aiInput, sources, planContent, searchResponse} from './helpers/ai-fixtures.mjs';
import {input as tripInput} from './helpers/fixtures.mjs';

const normalizeInput = value => normalizeAiInput(value, getCityByCode);
const validatePlan = (value, request = null, resolver = getCityByCode) =>
  normalizePlanContent(value, {request, sources: sources(), resolveCity: resolver});
const plan = () => planContent(normalizeInput(aiInput()));
const invalid = (fn, field) => assert.throws(fn, error =>
  error.code === 'VALIDATION' && (!field || Object.hasOwn(error.fields, field)));
const retrievedAt = '2026-10-05T04:00:00.000Z';
const search = (raw, priorSources = []) => normalizeSearchResults(raw, {retrievedAt, priorSources});

test('AI 14-day three-city request preserves exact money and canonical names', () => {
  const result = normalizeInput({...aiInput({days:14, cityCount:3}), name:' 江南小旅行 '});
  assert.equal(result.name,'江南小旅行');
  assert.equal(result.startDate,'2026-10-10');
  assert.equal(result.endDate,'2026-10-23');
  assert.equal(result.budgetCents,320050);
  assert.deepEqual(result.cities.map(c => c.cityName),['南京市','苏州市','杭州市']);
  assert.equal(result.budgetYuan,undefined);
});

test('AI 15-day limit does not restrict manual trip dates', () => {
  invalid(() => normalizeInput(aiInput({days:15})), 'endDate');
  assert.equal(normalizeTripInput({...tripInput(), endDate:'2026-10-24'},getCityByCode).endDate,'2026-10-24');
});

test('AI allows one-day two-city handoff but rejects impossible third city', () => {
  assert.equal(normalizeInput(aiInput({days:1,cityCount:2})).cities.length,2);
  invalid(() => normalizeInput(aiInput({days:1,cityCount:3})), 'cityCodes');
});

for (const [name, change, field] of [
  ['four cities', v => v.cityCodes.push('330100','310100'), 'cityCodes'],
  ['no city', v => v.cityCodes=[], 'cityCodes'],
  ['duplicate city', v => v.cityCodes[1]=v.cityCodes[0], 'cityCodes'],
  ['unknown city', v => v.cityCodes[0]='999999', 'cityCodes'],
  ['numeric city code', v => v.cityCodes[0]=320100, 'cityCodes'],
  ['impossible calendar date', v => v.startDate='2026-02-30', 'startDate'],
  ['reversed dates', v => v.endDate='2026-10-09', 'endDate'],
  ['zero travelers', v => v.travelerCount=0, 'travelerCount'],
  ['fractional travelers', v => v.travelerCount=1.5, 'travelerCount'],
  ['fractional cents', v => v.budgetYuan='1.001', 'budgetYuan'],
  ['numeric budget', v => v.budgetYuan=3200.5, 'budgetYuan'],
  ['negative budget', v => v.budgetYuan='-1', 'budgetYuan'],
  ['too many preference characters', v => v.preferences='游'.repeat(1001), 'preferences'],
  ['nonstr preference', v => v.preferences={}, 'preferences']
]) test(`AI request rejects ${name}`, () => {
  const value=aiInput();change(value);invalid(() => normalizeInput(value),field);
});

test('AI preferences count Unicode characters and optional budget stays null', () => {
  const value = {...aiInput(),preferences:'😀'.repeat(1000),budgetYuan:''};
  assert.equal([...normalizeInput(value).preferences].length,1000);
  assert.equal(normalizeInput(value).budgetCents,null);
});

test('request rejects inherited, accessor and prototype pollution fields without running getters', () => {
  invalid(() => normalizeInput(Object.assign(Object.create({inherited:true}),aiInput())));
  const value=aiInput();let read=false;
  Object.defineProperty(value,'preferences',{enumerable:true,get(){read=true;return '';}});
  invalid(() => normalizeInput(value));assert.equal(read,false);
  invalid(() => normalizeInput(JSON.parse(JSON.stringify(aiInput()).replace(/}$/,',"__proto__":{}}'))));
});

test('plan canonicalizes untrusted city labels without changing the input snapshot', () => {
  const request=normalizeInput(aiInput());const value=planContent(request);
  value.trip.cities[0].cityName='假城市';
  const result=validatePlan(value,request);
  assert.equal(result.trip.cities[0].cityName,'南京市');
  assert.equal(value.trip.cities[0].cityName,'假城市');
  assert.deepEqual(result.days.map(d => d.date),['2026-10-10','2026-10-11','2026-10-12','2026-10-13']);
});

test('adjacent handoff day may contain activities from both cities', () => {
  const value=plan();value.days[1].activities.push({...value.days[1].activities[0],cityCode:'320500',sourceIds:['s2']});
  assert.deepEqual(validatePlan(value).days[1].activities.map(a => a.cityCode),['320100','320500']);
});

for (const [name, change] of [
  ['missing daily record', v => v.days.splice(1,1)],
  ['duplicate daily date', v => v.days[1].date=v.days[0].date],
  ['out-of-order daily date', v => [v.days[0],v.days[1]]=[v.days[1],v.days[0]]],
  ['activity before city arrival', v => v.days[0].activities[0].cityCode='320500'],
  ['unknown activity city', v => v.days[0].activities[0].cityCode='999999'],
  ['unknown source reference', v => v.days[0].activities[0].sourceIds=['s999']],
  ['duplicate source reference', v => v.days[0].activities[0].sourceIds=['s1','s1']],
  ['empty activities', v => v.days[0].activities=[]],
  ['six activities', v => v.days[0].activities=Array.from({length:6},()=>({...v.days[0].activities[0]}))],
  ['long activity title', v => v.days[0].activities[0].title='游'.repeat(81)],
  ['long activity description', v => v.days[0].activities[0].description='游'.repeat(151)],
  ['eleven cautions', v => v.cautions=Array(11).fill('提醒')],
  ['long caution', v => v.cautions=['游'.repeat(201)]],
  ['city dates outside trip', v => v.trip.cities[0].arrivalDate='2026-10-09'],
  ['city reversed dates', v => v.trip.cities[0].departureDate='2026-10-09'],
  ['route overlap', v => v.trip.cities[1].arrivalDate='2026-10-10'],
  ['uncovered first date', v => v.trip.cities[0].arrivalDate='2026-10-11'],
  ['route gap', v => {v.trip.cities[0].departureDate='2026-10-10';v.trip.cities[1].arrivalDate='2026-10-12';}],
  ['extra output field', v => v.html='<script>bad</script>'],
  ['noninteger cents', v => v.trip.budgetCents=320050.5],
  ['nonpositive budget', v => v.trip.budgetCents=0]
]) test(`plan rejects ${name} without silently repairing it`, () => {
  const value=plan();change(value);invalid(() => validatePlan(value));
});

for (const [name, change] of [
  ['model changed traveler count', v => v.trip.travelerCount=2],
  ['model changed budget', v => v.trip.budgetCents=320000],
  ['model changed name', v => v.trip.name='另一趟'],
  ['model swapped cities', v => v.trip.cities.reverse()],
  ['model omitted city', v => v.trip.cities.pop()]
]) test(`generated plan rejects ${name}`, () => {
  const request=normalizeInput(aiInput()),value=planContent(request);change(value);
  invalid(() => validatePlan(value,request));
});

test('edit may change valid basic info while generated output must match request dates', () => {
  const request=normalizeInput(aiInput()),value=planContent(request);
  value.trip.name='我改的攻略';value.trip.travelerCount=2;value.trip.budgetCents=null;
  assert.equal(validatePlan(value).trip.travelerCount,2);
  value.trip.endDate='2026-10-14';value.trip.cities[1].departureDate='2026-10-14';
  value.days.push({date:'2026-10-14',activities:[{cityCode:'320500',title:'返程',description:'',sourceIds:[]}]});
  assert.equal(validatePlan(value).trip.endDate,'2026-10-14');
  invalid(() => validatePlan(value,request));
});

test('model cannot add an unrequested city', () => {
  const request=normalizeInput(aiInput()),value=planContent(request);
  value.trip.cities.push({...value.trip.cities[1],cityCode:'330100',arrivalDate:'2026-10-13',departureDate:'2026-10-13',order:2});
  invalid(() => validatePlan(value,request));
});

test('nonadjacent cities cannot share a day even when two adjacent handoffs are valid', () => {
  const request=normalizeInput(aiInput({cityCount:3})),value=planContent(request);
  value.trip.cities[2].arrivalDate='2026-10-11';
  invalid(() => validatePlan(value));
});

test('48 KiB limit rejects large otherwise field-valid plans without clipping days', () => {
  const request=normalizeInput(aiInput({days:14})),value=planContent(request);
  for(const day of value.days) day.activities=Array.from({length:5},()=>({
    cityCode:day.activities[0].cityCode,title:'😀'.repeat(80),description:'😀'.repeat(150),sourceIds:[]}));
  assert.ok(Buffer.byteLength(JSON.stringify(value),'utf8')>48*1024);
  invalid(() => validatePlan(value));assert.equal(value.days.length,14);
});

test('activity titles use Unicode character counts rather than UTF16 units', () => {
  const value=plan();value.days[0].activities[0].title='😀'.repeat(80);
  assert.equal([...validatePlan(value).days[0].activities[0].title].length,80);
});

test('new edit validates current city catalog instead of trusting historical labels', () => {
  const value=plan();
  invalid(() => validatePlan(value,null,code => code==='320100'?null:getCityByCode(code)));
  assert.equal(value.trip.cities[0].cityName,'南京市');
});

test('suggestions may have no citation but cannot acquire a fake reference', () => {
  const value=plan();value.days[0].activities[0].sourceIds=[];
  assert.deepEqual(validatePlan(value).days[0].activities[0].sourceIds,[]);
});

test('search results get local source IDs and separate published/retrieved times', () => {
  const result=search(searchResponse([{}]));
  assert.deepEqual(result,[{sourceId:'s1',title:'旅游资料',url:'https://example.com/source-1',
    summary:'可核对的检索摘要',publishedAt:'2026-09-01',retrievedAt}]);
});

test('search preserves previous sources and deduplicates fragment URLs', () => {
  const prior=sources(),before=structuredClone(prior);
  const result=search(searchResponse([{link:'https://example.com/nanjing#section'},
    {link:'https://example.com/new'},{link:'https://example.com/new#other'}]),prior);
  assert.deepEqual(result.map(s => [s.sourceId,s.url]),[['s3','https://example.com/new']]);
  assert.deepEqual(prior,before);
  assert.deepEqual(search(searchResponse([{link:'https://example.com/nanjing'}]),prior),[]);
});

test('search filters illegal URLs and nonscalar content', () => {
  const result=search(searchResponse([{link:'javascript:alert(1)'},{link:'data:text/html,bad'},
    {link:'file:///secret'},{link:'https://user:secret@example.com/path'},
    {title:{}},{content:{}},{link:'https://example.com/safe'}]));
  assert.deepEqual(result.map(s => s.url),['https://example.com/safe']);
});

test('search limits summary by Unicode character count and sources to fifteen', () => {
  const result=search(searchResponse(Array.from({length:20},(_,i)=>({
    link:`https://example.com/r-${i}`,content:'😀'.repeat(1300)}))));
  assert.equal(result.length,15);
  assert.equal(result[14].sourceId,'s15');
  assert.equal([...result[0].summary].length,1200);
});

test('sources limit applies across search requests with stable identifiers', () => {
  const prior=Array.from({length:14},(_,i)=>({...sources()[0],sourceId:`s${i+1}`,url:`https://example.com/old-${i}`}));
  const result=search(searchResponse([{link:'https://example.com/new-1'},{link:'https://example.com/new-2'}]),prior);
  assert.deepEqual(result.map(s => s.sourceId),['s15']);
});

test('invalid publication date is unknown rather than invented retrieval date', () => {
  assert.equal(search(searchResponse([{publish_date:'2026-02-30'}]))[0].publishedAt,null);
});

for(const [name,value] of [['empty',searchResponse()],['unsafe only',searchResponse([{link:'javascript:bad'}])],
  ['missing response',null],['wrong result shape',{search_result:{}}],['untrusted raw error',{error:{message:'SECRET'}}]])
  test(`search rejects ${name} without retaining raw error text`,()=>{
    assert.throws(()=>search(value),e=>e instanceof AiError&&e.code.startsWith('AI_SEARCH_')&&!e.message.includes('SECRET')&&!e.cause);
  });

test('JSON shape and circular or accessor output is rejected without executing it',()=>{
  invalid(()=>validatePlan([]));invalid(()=>normalizeInput(null));
  const value=plan();Object.defineProperty(value,'trip',{enumerable:true,get(){throw Error('should not run');}});
  invalid(()=>validatePlan(value));
  const other=plan();other.circular=other;invalid(()=>validatePlan(other));
});

test('input ignores neither symbol fields nor custom array prototypes',()=>{
  const value=aiInput();value[Symbol('hidden')]='not JSON';invalid(()=>normalizeInput(value));
  const other=aiInput();let iterated=false;
  const proto=Object.create(Array.prototype);
  proto[Symbol.iterator]=function*(){iterated=true;yield '320100';};
  Object.setPrototypeOf(other.cityCodes,proto);
  invalid(()=>normalizeInput(other));assert.equal(iterated,false);
});

test('null prototype JSON records normalize safely and do not share returned arrays',()=>{
  const value=Object.assign(Object.create(null),aiInput());
  const request=normalizeInput(value);
  assert.equal(request.cities[0].cityCode,'320100');
  const raw=planContent(request), result=validatePlan(raw,request);
  result.days[0].activities[0].sourceIds.push('s2');
  assert.deepEqual(raw.days[0].activities[0].sourceIds,['s1']);
});

test('three-city two-day itinerary can share distinct adjacent handoff days',()=>{
  const request=normalizeInput(aiInput({cityCount:3,days:2}));
  assert.deepEqual(validatePlan(planContent(request),request).trip.cities.map(c=>[c.arrivalDate,c.departureDate]),
    [['2026-10-10','2026-10-10'],['2026-10-10','2026-10-11'],['2026-10-11','2026-10-11']]);
});

test('generated date mismatch is rejected even with a complete internally valid route',()=>{
  const request=normalizeInput(aiInput()), raw=planContent(request);
  raw.trip.endDate='2026-10-14';raw.trip.cities[1].departureDate='2026-10-14';
  raw.days.push({date:'2026-10-14',activities:[{cityCode:'320500',title:'返程',description:'',sourceIds:[]}]});
  invalid(()=>validatePlan(raw,request),'endDate');
});

test('search rejects invalid retrieval time and corrupt prior source identities',()=>{
  assert.throws(()=>normalizeSearchResults(searchResponse([{}]),{retrievedAt:'2026-02-30T00:00:00Z'}),
    e=>e.code==='AI_SEARCH_RESPONSE');
  const prior=sources();prior[1].sourceId='s1';
  assert.throws(()=>search(searchResponse([{}]),prior),e=>e.code==='AI_SEARCH_RESPONSE');
});
