import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseStore} from '../src/storage/expense-store.mjs';
import {createExpenseCategoryStore} from '../src/storage/expense-category-store.mjs';
import {createExpenseOperationStore} from '../src/storage/expense-operation-store.mjs';
import {setup} from './helpers/database.mjs';

const NOW='2026-10-09T12:00:00.000Z';
const LATER='2026-10-10T12:00:00.000Z';
const content=(overrides={})=>({amountCents:1230,categoryId:'default:food',cityCode:'320100',cityName:'南京市',spentDate:'2026-10-10',note:'早餐',...overrides});
const hasCode=code=>error=>error?.code===code;
function context(t) {
  const state=setup(t);state.database.db.exec("INSERT INTO trips VALUES('trip-1',1,'{}'); INSERT INTO trips VALUES('trip-2',1,'{}')");
  return {...state,expenses:createExpenseStore(state.database),categories:createExpenseCategoryStore(state.database),operations:createExpenseOperationStore(state.database)};
}

test('expense put uses optimistic revisions and never crosses trips',t=>{
  const c=context(t),saved=c.expenses.put('trip-1','expense-1',content(),{expectedRevision:0,now:NOW});
  assert.equal(saved.revision,1);assert.equal(c.expenses.get('trip-2','expense-1'),null);
  assert.throws(()=>c.expenses.put('trip-1','expense-1',content(),{expectedRevision:0,now:LATER}),hasCode('CONFLICT'));
  assert.throws(()=>c.expenses.put('trip-2','expense-1',content(),{expectedRevision:0,now:LATER}),hasCode('CONFLICT'));
  const changed=c.expenses.put('trip-1','expense-1',content({amountCents:2500}),{expectedRevision:1,now:LATER});
  assert.equal(changed.revision,2);assert.equal(changed.amountCents,2500);assert.equal(changed.createdAt,NOW);assert.equal(changed.updatedAt,LATER);
});

test('expense reads are defensive and list uses stable date update id order',t=>{
  const c=context(t);
  c.expenses.put('trip-1','b',content({spentDate:'2026-10-11'}),{expectedRevision:0,now:NOW});
  c.expenses.put('trip-1','c',content({spentDate:'2026-10-12'}),{expectedRevision:0,now:NOW});
  c.expenses.put('trip-1','a',content({spentDate:'2026-10-11'}),{expectedRevision:0,now:NOW});
  c.expenses.put('trip-1','d',content({spentDate:'2026-10-11'}),{expectedRevision:0,now:LATER});
  const got=c.expenses.get('trip-1','a');got.note='改写';
  assert.equal(c.expenses.get('trip-1','a').note,'早餐');
  assert.deepEqual(c.expenses.list('trip-1').map(item=>item.id),['c','d','a','b']);
});

test('expense storage rejects unsafe content and detects corrupt persisted rows',t=>{
  const c=context(t);
  for(const bad of [content({amountCents:0}),content({amountCents:Number.MAX_SAFE_INTEGER+1}),content({cityCode:'bad'}),content({note:'旅'.repeat(201)})])
    assert.throws(()=>c.expenses.put('trip-1','bad',bad,{expectedRevision:0,now:NOW}),error=>error.code==='STORAGE_CORRUPT'||error.code==='VALIDATION');
  c.database.db.exec(`INSERT INTO expenses VALUES('broken','trip-1',1,0,'default:food',NULL,NULL,'2026-10-10','','${NOW}','${NOW}')`);
  assert.throws(()=>c.expenses.get('trip-1','broken'),hasCode('STORAGE_CORRUPT'));
});

test('custom categories normalize names enforce revisions and reject aliases',t=>{
  const c=context(t),saved=c.categories.put('trip-1','custom:coffee','  ＣＡＦＥ  ',{expectedRevision:0,now:NOW});
  assert.equal(saved.name,'ＣＡＦＥ');assert.equal(saved.normalizedName,'cafe');assert.equal(saved.revision,1);
  assert.throws(()=>c.categories.put('trip-1','custom:other',' cafe ',{expectedRevision:0,now:NOW}),hasCode('CONFLICT'));
  assert.throws(()=>c.categories.put('trip-1','custom:coffee','茶饮',{expectedRevision:0,now:LATER}),hasCode('CONFLICT'));
  assert.equal(c.categories.put('trip-1','custom:coffee','茶饮',{expectedRevision:1,now:LATER}).revision,2);
  assert.equal(c.categories.get('trip-2','custom:coffee'),null);
});

test('used custom category cannot be deleted or orphan expenses',t=>{
  const c=context(t);c.categories.put('trip-1','custom:coffee','咖啡',{expectedRevision:0,now:NOW});
  c.expenses.put('trip-1','expense-1',content({categoryId:'custom:coffee'}),{expectedRevision:0,now:NOW});
  assert.equal(c.categories.usageCount('trip-1','custom:coffee'),1);
  assert.throws(()=>c.categories.remove('trip-1','custom:coffee',1),hasCode('CATEGORY_IN_USE'));
  assert.equal(c.expenses.get('trip-1','expense-1').categoryId,'custom:coffee');
  c.expenses.remove('trip-1','expense-1',1);assert.equal(c.categories.remove('trip-1','custom:coffee',1),true);
});

test('trip deletion cascades all expense storage records',t=>{
  const c=context(t);c.categories.put('trip-1','custom:coffee','咖啡',{expectedRevision:0,now:NOW});
  c.expenses.put('trip-1','expense-1',content({categoryId:'custom:coffee'}),{expectedRevision:0,now:NOW});
  c.operations.insert({operationId:'op-1',tripId:'trip-1',entityType:'expense',entityId:'expense-1',requestHash:'hash-1',response:{id:'expense-1',revision:1}});
  c.database.db.exec("DELETE FROM trips WHERE id='trip-1'");
  assert.deepEqual(c.expenses.list('trip-1'),[]);assert.deepEqual(c.categories.list('trip-1'),[]);assert.equal(c.operations.find('op-1'),null);
});

test('operation receipts replay defensive responses and reject changed identities',t=>{
  const c=context(t),command={operationId:'op-1',tripId:'trip-1',entityType:'expense',entityId:'expense-1',requestHash:'hash-1',response:{id:'expense-1',revision:1}};
  const first=c.operations.insert(command);first.response.revision=99;
  assert.equal(c.operations.find('op-1').response.revision,1);
  assert.deepEqual(c.operations.insert(command),c.operations.find('op-1'));
  assert.throws(()=>c.operations.insert({...command,requestHash:'hash-2'}),hasCode('CONFLICT'));
  assert.throws(()=>c.operations.insert({...command,operationId:'op-2',tripId:'trip-2',entityId:'expense-1'}),hasCode('CONFLICT'));
});
