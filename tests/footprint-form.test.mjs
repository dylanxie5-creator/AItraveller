import test from 'node:test';
import assert from 'node:assert/strict';
import {createFootprintForm} from '../src/shared/footprint-form-model.mjs';

test('new form preserves raw invalid input and reports a stable first error',()=>{
  const form=createFootprintForm({today:()=> '2026-10-17'});
  form.setField('datePrecision','day');form.setField('cityCode','');form.setField('dateStart','2026-10-17');form.setField('note',' 保留空格 ');
  assert.equal(form.validate(),false);
  const state=form.snapshot();
  assert.deepEqual(state.values,{cityCode:'',datePrecision:'day',dateStart:'2026-10-17',note:' 保留空格 '});
  assert.equal(state.firstError,'cityCode');assert.ok(state.errors.dateStart);
  assert.equal(form.validate(),false);assert.equal(form.snapshot().firstError,'cityCode');
});

test('changing precision clears an incompatible date without touching other input',()=>{
  const form=createFootprintForm({today:()=> '2026-10-17'});
  form.setField('cityCode','320100');form.setField('datePrecision','day');form.setField('dateStart','2026-05-06');form.setField('note','春游');
  form.setField('datePrecision','month');
  assert.deepEqual(form.snapshot().values,{cityCode:'320100',datePrecision:'month',dateStart:'',note:'春游'});
});

test('editing initializes the exact stored precision and emits only trusted server input fields',()=>{
  const visit={cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'month',dateStart:'2025-08',note:'旧记录'};
  const form=createFootprintForm({visit,today:()=> '2026-10-17'});
  assert.deepEqual(form.snapshot().values,{cityCode:'320100',datePrecision:'month',dateStart:'2025-08',note:'旧记录'});
  assert.equal(form.validate(),true);
  assert.deepEqual(form.toInput(),{cityCode:'320100',datePrecision:'month',dateStart:'2025-08',note:'旧记录'});
  assert.equal('cityName' in form.toInput(),false);assert.equal('provinceName' in form.toInput(),false);
});

test('valid form accepts current year and month but not today as an exact day',()=>{
  for(const [datePrecision,dateStart] of [['year','2026'],['month','2026-10']]) {
    const form=createFootprintForm({today:()=> '2026-10-17'});form.setField('cityCode','320100');form.setField('datePrecision',datePrecision);form.setField('dateStart',dateStart);
    assert.equal(form.validate(),true);
  }
  const form=createFootprintForm({today:()=> '2026-10-17'});form.setField('cityCode','320100');form.setField('datePrecision','day');form.setField('dateStart','2026-10-17');
  assert.equal(form.validate(),false);assert.equal(form.snapshot().firstError,'dateStart');
});

test('unknown fields and toInput before validation are rejected',()=>{
  const form=createFootprintForm({today:()=> '2026-10-17'});
  assert.throws(()=>form.setField('cityName','伪造市'),/未知足迹字段/);
  assert.throws(()=>form.toInput(),/验证/);
});
