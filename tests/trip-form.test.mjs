import test from 'node:test';import assert from 'node:assert/strict';
import {createTripForm} from '../src/shared/trip-form-model.mjs';
import {getCityByCode} from '../src/domain/city-catalog.mjs';
import {input} from './helpers/fixtures.mjs';
test('three step form validates and retains raw fields and identity',()=>{
  const form=createTripForm({createId:()=> 'trip-1'});assert.equal(form.next(),false);assert.ok(form.snapshot().errors.name);
  const data=input();for(const key of ['name','startDate','endDate','travelerCount','budgetYuan'])form.change(key,data[key]);assert.equal(form.next(),true);assert.equal(form.snapshot().step,'route');
  data.cities.forEach(c=>{form.addCity({...getCityByCode(c.cityCode),...c});});assert.equal(form.next(),true);assert.equal(form.snapshot().step,'confirm');assert.equal(form.snapshot().id,'trip-1');assert.equal(form.toInput().budgetYuan,'3200.50');form.previous();assert.equal(form.snapshot().step,'route');
});
test('restored invalid draft and city movements keep exact input',()=>{
  const slot={targetTripId:'trip-1',baseTripRevision:0,step:'route',input:{...input(),budgetYuan:'bad'}};
  const form=createTripForm({slot,createId:()=>assert.fail('must preserve identity')});form.moveCity(0,1);assert.equal(form.snapshot().input.cities[1].arrivalDate,'2026-10-10');form.moveCity(1,0);assert.equal(form.snapshot().input.budgetYuan,'bad');assert.equal(form.next(),false,'must revalidate basic fields before confirmation');
});
test('edited form initializes exact budget from integer cents and base revision',()=>{
  const form=createTripForm({trip:{...input(),id:'trip-1',revision:3,budgetCents:320050}});assert.equal(form.snapshot().baseTripRevision,3);assert.equal(form.toInput().budgetYuan,'3200.50');
});
