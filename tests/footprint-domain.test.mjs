import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeManualVisitInput,validateStoredVisit,formatVisitDate,compareVisits} from '../src/footprints/validation.mjs';
import {summarizeFootprints,presentFootprintGroups} from '../src/footprints/presentation.mjs';

const NOW='2026-10-17T12:00:00.000Z';
const resolveCity=code=>code==='320100'?{cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省'}:code==='320500'?{cityCode:'320500',cityName:'苏州市',provinceCode:'320000',provinceName:'江苏省'}:code==='330100'?{cityCode:'330100',cityName:'杭州市',provinceCode:'330000',provinceName:'浙江省'}:null;
const manual=(overrides={})=>({id:'visit-1',revision:1,cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'day',dateStart:'2026-05-02',dateEnd:null,source:'manual',linkedTripId:null,tripNameSnapshot:null,note:'春游',createdAt:NOW,updatedAt:NOW,...overrides});
const tripVisit=(overrides={})=>manual({id:'auto-1',datePrecision:'trip_range',dateStart:'2026-05-01',dateEnd:'2026-05-03',source:'trip',linkedTripId:'trip-1',tripNameSnapshot:'金陵行',...overrides});
const hasField=field=>error=>error?.code==='VALIDATION'&&Boolean(error.fields?.[field]);

test('manual input resolves canonical city snapshots and preserves partial-date precision',()=>{
  const options={resolveCity,today:()=> '2026-10-17'};
  assert.deepEqual(normalizeManualVisitInput({cityCode:'320100',datePrecision:'year',dateStart:'2026',note:'  春游  '},options),{
    cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'year',dateStart:'2026',dateEnd:null,note:'春游',
  });
  assert.equal(normalizeManualVisitInput({cityCode:'320100',datePrecision:'month',dateStart:'2026-10',note:''},options).dateStart,'2026-10');
  assert.equal(normalizeManualVisitInput({cityCode:'320100',datePrecision:'day',dateStart:'2026-10-16',note:''},options).dateStart,'2026-10-16');
  assert.throws(()=>normalizeManualVisitInput({cityCode:'999999',datePrecision:'year',dateStart:'2025',note:''},options),hasField('cityCode'));
});

test('manual dates accept started current periods but reject future periods and today/future exact dates',()=>{
  const options={resolveCity,today:()=> '2026-10-17'};
  for(const [datePrecision,dateStart] of [['year','2026'],['month','2026-10'],['day','2026-10-16']])
    assert.equal(normalizeManualVisitInput({cityCode:'320100',datePrecision,dateStart,note:''},options).dateStart,dateStart);
  for(const [datePrecision,dateStart] of [['year','2027'],['month','2026-11'],['day','2026-10-17'],['day','2026-10-18'],['month','2026-13'],['day','2026-02-29']])
    assert.throws(()=>normalizeManualVisitInput({cityCode:'320100',datePrecision,dateStart,note:''},options),hasField('dateStart'),`${datePrecision}:${dateStart}`);
});

test('notes use Unicode code points and canonical names cannot be supplied by clients',()=>{
  const options={resolveCity,today:()=> '2026-10-17'};
  assert.equal([...normalizeManualVisitInput({cityCode:'320100',datePrecision:'year',dateStart:'2025',note:'😀'.repeat(200)},options).note].length,200);
  assert.throws(()=>normalizeManualVisitInput({cityCode:'320100',datePrecision:'year',dateStart:'2025',note:'😀'.repeat(201)},options),hasField('note'));
  const normalized=normalizeManualVisitInput({cityCode:'320100',cityName:'伪造市',provinceName:'伪造省',datePrecision:'year',dateStart:'2025',note:''},options);
  assert.equal(normalized.cityName,'南京市');assert.equal(normalized.provinceName,'江苏省');
});

test('stored visit validation accepts exact trip manual and detached shapes',()=>{
  assert.deepEqual(validateStoredVisit(manual()),manual());
  assert.equal(validateStoredVisit(tripVisit()).source,'trip');
  assert.equal(validateStoredVisit(tripVisit({source:'detached',linkedTripId:null})).source,'detached');
  assert.throws(()=>validateStoredVisit(tripVisit({source:'trip',linkedTripId:null})),/足迹/);
  assert.throws(()=>validateStoredVisit(manual({source:'manual',linkedTripId:'trip-1'})),/足迹/);
  assert.throws(()=>validateStoredVisit(manual({datePrecision:'month',dateStart:'2026-1'})),/足迹/);
  assert.throws(()=>validateStoredVisit(manual({note:'旅'.repeat(201)})),/足迹/);
});

test('date formatting and stable reverse chronology retain declared precision',()=>{
  assert.equal(formatVisitDate(manual({datePrecision:'year',dateStart:'2024'})),'2024年');
  assert.equal(formatVisitDate(manual({datePrecision:'month',dateStart:'2024-05'})),'2024年5月');
  assert.equal(formatVisitDate(manual({datePrecision:'day',dateStart:'2024-05-06'})),'2024年5月6日');
  assert.equal(formatVisitDate(tripVisit()),'2026年5月1日—5月3日');
  const input=[manual({id:'b',datePrecision:'year',dateStart:'2025'}),manual({id:'a',datePrecision:'year',dateStart:'2025'}),manual({id:'c',dateStart:'2026-01-01'})];
  assert.deepEqual(input.toSorted(compareVisits).map(item=>item.id),['c','a','b']);
});

test('summary counts unique provinces and cities while preserving repeated visits',()=>{
  const visits=[manual(),manual({id:'visit-2'}),manual({id:'visit-3',cityCode:'320500',cityName:'苏州市'}),manual({id:'visit-4',cityCode:'330100',cityName:'杭州市',provinceCode:'330000',provinceName:'浙江省'})];
  assert.deepEqual(summarizeFootprints(visits),{provinceCount:2,cityCount:3,visitCount:4});
});

test('group presentation totals only linked trip expenses for the matching city',()=>{
  const visits=[tripVisit(),tripVisit({id:'auto-2',linkedTripId:'trip-2',tripNameSnapshot:'再游金陵'}),manual({id:'manual-2',cityCode:'330100',cityName:'杭州市',provinceCode:'330000',provinceName:'浙江省'})];
  const expenses=[
    {id:'e1',tripId:'trip-1',cityCode:'320100',amountCents:1200},
    {id:'e2',tripId:'trip-1',cityCode:null,amountCents:5000},
    {id:'e3',tripId:'trip-1',cityCode:'320500',amountCents:800},
    {id:'e4',tripId:'trip-2',cityCode:'320100',amountCents:300},
  ];
  const visitsBefore=structuredClone(visits),expensesBefore=structuredClone(expenses);
  const result=presentFootprintGroups({visits,expenses});
  assert.deepEqual(result.summary,{provinceCount:2,cityCount:2,visitCount:3});
  const nanjing=result.cities.find(city=>city.cityCode==='320100');
  assert.equal(nanjing.visitCount,2);assert.equal(nanjing.totalCents,1500);
  assert.deepEqual(nanjing.tripExpenses,[{tripId:'trip-1',totalCents:1200},{tripId:'trip-2',totalCents:300}]);
  assert.equal(result.provinces.find(item=>item.provinceCode==='320000').cityCount,1);
  assert.deepEqual(visits,visitsBefore);assert.deepEqual(expenses,expensesBefore);
});
