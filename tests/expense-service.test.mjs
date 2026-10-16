import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,prepare} from './helpers/database.mjs';

const expense=(operationId='op-expense-1',overrides={})=>({operationId,expectedRevision:0,input:{amountYuan:'88.50',categoryId:'default:food',cityCode:'320100',spentDate:'2026-10-10',note:'晚餐',...overrides}});

test('lost create response replays one expense and never overwrites a newer edit',t=>{
  const c=setup(t);c.service.saveTrip('trip-1',prepare(c.service));
  const command=expense(),first=c.expenses.saveExpense('trip-1','expense-1',command);
  const edited=c.expenses.saveExpense('trip-1','expense-1',{operationId:'op-edit-1',expectedRevision:1,input:{...command.input,note:'新版'}});
  assert.equal(edited.revision,2);assert.deepEqual(c.expenses.saveExpense('trip-1','expense-1',command),first);
  assert.equal(c.expenses.getOverview('trip-1').expenses.length,1);assert.equal(c.expenses.getExpense('trip-1','expense-1').note,'新版');
});

test('expense commands enforce trip ownership versions payload identity and history',t=>{
  const c=setup(t);c.service.saveTrip('trip-1',prepare(c.service));c.service.saveTrip('trip-2',prepare(c.service,'trip-2'));
  const first=c.expenses.saveExpense('trip-1','expense-1',expense());
  assert.throws(()=>c.expenses.getExpense('trip-2','expense-1'),e=>e.code==='NOT_FOUND');
  assert.throws(()=>c.expenses.saveExpense('trip-1','expense-1',{...expense(),input:{...expense().input,note:'changed'}}),e=>e.code==='CONFLICT');
  assert.throws(()=>c.expenses.saveExpense('trip-1','expense-1',{operationId:'other',expectedRevision:0,input:expense().input}),e=>e.code==='CONFLICT');
  assert.equal(c.expenses.getExpense('trip-1','expense-1').revision,first.revision);
  c.database.db.prepare("UPDATE trip_cities SET payload=? WHERE trip_id='trip-1' AND position=0").run(JSON.stringify({cityCode:'320200',cityName:'无锡市',provinceCode:'320000',provinceName:'江苏省',arrivalDate:'2026-10-10',departureDate:'2026-10-11',order:0}));
  const historical=c.expenses.saveExpense('trip-1','expense-1',{operationId:'history-edit',expectedRevision:1,input:{...expense().input,note:'保留历史城市'}});
  assert.equal(historical.cityName,'南京市');
});

test('custom categories update presentations and used categories stay protected',t=>{
  const c=setup(t);c.service.saveTrip('trip-1',prepare(c.service));
  const category=c.expenses.saveCategory('trip-1','custom:coffee',{operationId:'cat-create',expectedRevision:0,name:'咖啡'});
  c.expenses.saveExpense('trip-1','expense-1',expense('use-category',{categoryId:category.id}));
  const renamed=c.expenses.saveCategory('trip-1',category.id,{operationId:'cat-rename',expectedRevision:1,name:'咖啡茶饮'});
  assert.equal(c.expenses.getOverview('trip-1').summary.byCategory[0].name,'咖啡茶饮');
  assert.throws(()=>c.expenses.deleteCategory('trip-1',renamed.id,{operationId:'cat-delete',expectedRevision:2}),e=>e.code==='CATEGORY_IN_USE');
});

test('overview and global overview aggregate only persisted records',t=>{
  const c=setup(t);c.service.saveTrip('trip-1',prepare(c.service));c.service.saveTrip('trip-2',prepare(c.service,'trip-2'));
  assert.deepEqual(c.expenses.getGlobalOverview(),{hasExpenses:false,totalCents:0});
  c.expenses.saveExpense('trip-1','expense-1',expense('first'));
  c.expenses.saveExpense('trip-2','expense-2',expense('second',{amountYuan:'11.50',cityCode:null}));
  const overview=c.expenses.getOverview('trip-1');
  assert.equal(overview.summary.totalCents,8850);assert.equal(overview.expenses[0].categoryName,'餐饮');assert.equal(overview.categories.length,7);
  assert.deepEqual(c.expenses.getGlobalOverview(),{hasExpenses:true,totalCents:10000});
});

test('delete commands are idempotent and trip deletion cascades expense data',t=>{
  const c=setup(t);const trip=c.service.saveTrip('trip-1',prepare(c.service));
  c.expenses.saveExpense('trip-1','expense-1',expense());
  const command={operationId:'delete-expense',expectedRevision:1};
  assert.deepEqual(c.expenses.deleteExpense('trip-1','expense-1',command),{deleted:true,id:'expense-1'});
  assert.deepEqual(c.expenses.deleteExpense('trip-1','expense-1',command),{deleted:true,id:'expense-1'});
  c.expenses.saveExpense('trip-1','expense-2',expense('another'));
  c.service.deleteTrip('trip-1',trip.revision);
  assert.throws(()=>c.expenses.getOverview('trip-1'),e=>e.code==='NOT_FOUND');
  assert.equal(c.database.db.prepare('SELECT count(*) n FROM expenses').get().n,0);
  assert.equal(c.database.db.prepare('SELECT count(*) n FROM expense_operation_receipts').get().n,0);
});
