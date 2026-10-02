import test from 'node:test';
import assert from 'node:assert/strict';
import {isDateOnly,getTripStatus,todayDateOnly} from '../src/shared/date.mjs';
import {yuanToCents,formatCents} from '../src/shared/money.mjs';
import {validateBasicInfo,validateCities,normalizeTripInput} from '../src/shared/trip-validation.mjs';
import {searchCities,getCityByCode,cityCount} from '../src/domain/city-catalog.mjs';
import {input} from './helpers/fixtures.mjs';

test('calendar and inclusive trip status boundaries',()=>{
  for(const [date,want] of [['2024-02-29',true],['2026-02-29',false],['2026-13-01',false],['26-01-01',false]]) assert.equal(isDateOnly(date),want);
  for(const [date,want] of [['2026-10-09','upcoming'],['2026-10-10','ongoing'],['2026-10-13','ongoing'],['2026-10-14','completed']]) assert.equal(getTripStatus(input(),date),want);
  assert.equal(todayDateOnly(new Date(2026,9,2)),'2026-10-02');
});
test('exact positive budget boundaries without float rounding',()=>{
  for(const [text,want] of [['3200.50',320050],['0.01',1],['90071992547409.91',Number.MAX_SAFE_INTEGER],['90071992547409.92',null],['0',null],['-1',null],['1e2',null],['1.234',null],['',null]]) assert.equal(yuanToCents(text),want);
  assert.equal(formatCents(320050),'3,200.50');
  assert.equal(formatCents(Number.MAX_SAFE_INTEGER),'90,071,992,547,409.91');
});
test('basic fields reject invalid names, dates, count and budget',()=>{
  assert.deepEqual(validateBasicInfo(input()),{});
  assert.deepEqual(Object.keys(validateBasicInfo({...input(),name:' ',endDate:'2026-02-29',travelerCount:0,budgetYuan:'0'})),['name','endDate','travelerCount','budgetYuan']);
  assert.deepEqual(validateBasicInfo({...input(),budgetYuan:''}),{});
});
test('normalization resolves authoritative city names and integer budget',()=>{
  const trip=normalizeTripInput({...input(),name:'  江南小旅行  ',cities:input().cities.map(c=>({...c,cityName:'伪造'}))},getCityByCode);
  assert.equal(trip.name,'江南小旅行'); assert.equal(trip.budgetCents,320050);
  assert.equal(trip.cities[0].cityName,'南京市'); assert.equal(trip.cities[1].order,1);
  assert.throws(()=>normalizeTripInput({...input(),budgetYuan:'-1'},getCityByCode),e=>e.name==='ValidationError'&&Boolean(e.fields.budgetYuan));
});
test('route rejects duplicate unknown outside reversed and overlapping cities',()=>{
  const v=(cities)=>validateCities(input(),cities,getCityByCode);
  assert.deepEqual(v(input().cities),{});
  for(const cities of [[],[{...input().cities[0],cityCode:'999999'}],[input().cities[0],{...input().cities[1],cityCode:'320100'}],[{...input().cities[0],arrivalDate:'2026-10-09'}],[input().cities[1],input().cities[0]],[{...input().cities[0],departureDate:'2026-10-13'}, {...input().cities[1],arrivalDate:'2026-10-12',departureDate:'2026-10-12'}],[input().cities[0],{...input().cities[1],departureDate:'2026-10-11'},{cityCode:'330100',arrivalDate:'2026-10-11',departureDate:'2026-10-13'}]]) assert.ok(Object.keys(v(cities)).length);
  assert.ok(Object.keys(v([{...input().cities[0],arrivalDate:'2026-10-12',departureDate:'2026-10-13'}, {...input().cities[1],arrivalDate:'2026-10-10',departureDate:'2026-10-11'}])).length,'disjoint reverse chronology also rejected');
});
test('344 independent catalog entries support search and defensive copies',()=>{
  assert.equal(cityCount,344); assert.equal(searchCities('南京')[0].cityCode,'320100'); assert.deepEqual(searchCities(''),[]); assert.equal(searchCities('省',200).length,20);
  for(const code of ['810000','820000','710000','419000','429000','469000','659000']) assert.ok(getCityByCode(code));
  const city=getCityByCode('320100'); city.cityName='改名'; assert.equal(getCityByCode('320100').cityName,'南京市');
});
