import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseForm} from '../src/shared/expense-form-model.mjs';

const trip={id:'trip-1',startDate:'2026-10-10',endDate:'2026-10-13',cities:[{cityCode:'320100',cityName:'南京市'},{cityCode:'320500',cityName:'苏州市'}]};
const categories=[{id:'default:food',name:'餐饮',kind:'default'}];

test('new form picks today inside trip and start date outside trip',()=>{
  assert.equal(createExpenseForm({trip,categories,today:()=> '2026-10-10'}).snapshot().values.spentDate,'2026-10-10');
  assert.equal(createExpenseForm({trip,categories,today:()=> '2027-01-01'}).snapshot().values.spentDate,trip.startDate);
});

test('expense form preserves raw values validates fields and emits server input',()=>{
  const form=createExpenseForm({trip,categories,today:()=> '2026-10-10'});form.setField('amountYuan','0');form.setField('note',' 保留空格直到提交 ');
  assert.equal(form.validate(),false);assert.ok(form.snapshot().errors.amountYuan);assert.equal(form.snapshot().firstError,'amountYuan');
  form.setField('amountYuan','12.30');assert.equal(form.validate(),true);assert.deepEqual(form.toInput(),{amountYuan:'12.30',categoryId:'default:food',cityCode:null,spentDate:'2026-10-10',note:' 保留空格直到提交 '});
});

test('editing keeps a removed historical city as a selectable option',()=>{
  const expense={amountCents:880,categoryId:'default:food',cityCode:'999999',cityName:'历史城',spentDate:'2026-10-11',note:'旧记录'};
  const state=createExpenseForm({trip,expense,categories,today:()=> '2026-10-10'}).snapshot();
  assert.equal(state.values.amountYuan,'8.80');assert.deepEqual(state.cityOptions.at(-1),{value:'999999',label:'历史城（已移出路线）',state:'removed'});
});
