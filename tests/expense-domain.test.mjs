import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_EXPENSE_CATEGORIES,normalizeCategoryName,createCategoryCatalog} from '../src/expenses/categories.mjs';
import {normalizeExpenseInput} from '../src/expenses/validation.mjs';
import {computeExpenseSummary,presentExpenses} from '../src/expenses/statistics.mjs';

const NOW='2026-10-09T12:00:00.000Z';
const trip=(overrides={})=>({
  id:'trip-1',name:'江南旅行',startDate:'2026-10-10',endDate:'2026-10-13',budgetCents:2500,
  cities:[
    {cityCode:'320100',cityName:'南京市',arrivalDate:'2026-10-10',departureDate:'2026-10-11',order:0},
    {cityCode:'320500',cityName:'苏州市',arrivalDate:'2026-10-11',departureDate:'2026-10-13',order:1},
  ],...overrides,
});
const custom=(name='咖啡',overrides={})=>({
  id:'custom:coffee',tripId:'trip-1',revision:1,name,normalizedName:normalizeCategoryName(name),
  createdAt:NOW,updatedAt:NOW,...overrides,
});
const catalog=(categories=[custom()])=>createCategoryCatalog(categories);
const validInput=(overrides={})=>({
  amountYuan:'12.30',categoryId:'default:food',cityCode:'320100',spentDate:'2026-10-10',note:'早餐',...overrides,
});
const oldExpense=()=>expense({id:'expense-old',cityCode:'330100',cityName:'旧城',spentDate:'2026-10-12'});
const context=(overrides={})=>({trip:trip(),catalog:catalog(),previous:null,...overrides});
const expense=(overrides={})=>({
  id:'expense-1',tripId:'trip-1',revision:1,amountCents:1000,categoryId:'default:food',
  cityCode:'320100',cityName:'南京市',spentDate:'2026-10-10',note:'早餐',createdAt:NOW,updatedAt:NOW,...overrides,
});
const hasField=field=>error=>error?.code==='VALIDATION'&&Boolean(error.fields?.[field]);

test('default categories are stable and custom catalog entries are normalized sorted copies',()=>{
  assert.deepEqual(DEFAULT_EXPENSE_CATEGORIES.map(item=>[item.id,item.name]),[
    ['default:transport','交通'],['default:lodging','住宿'],['default:food','餐饮'],['default:tickets','门票'],
    ['default:shopping','购物'],['default:entertainment','娱乐'],['default:other','其他'],
  ]);
  const later=custom('夜宵',{id:'custom:late',createdAt:'2026-10-10T00:00:00.000Z'});
  const earlier=custom('咖啡',{id:'custom:early',createdAt:'2026-10-08T00:00:00.000Z'});
  const source=[later,earlier];const result=createCategoryCatalog(source);
  source[1].name='被篡改';
  assert.deepEqual(result.list.slice(-2).map(item=>item.id),['custom:early','custom:late']);
  assert.equal(result.resolve('custom:early').name,'咖啡');
  assert.equal(result.resolve('missing'),null);
});

test('normalization prevents default and custom category aliases',()=>{
  assert.equal(normalizeCategoryName('  ＦＯＯ  '),'foo');
  assert.throws(()=>createCategoryCatalog([custom(' 交通 ')]),hasField('name'));
  assert.throws(()=>createCategoryCatalog([custom('ＣＡＦＥ',{id:'custom:one'}),custom(' cafe ',{id:'custom:two'})]),hasField('name'));
  assert.throws(()=>createCategoryCatalog([custom('   ')]),hasField('name'));
});

test('money accepts explicit two-decimal yuan and rejects ambiguous formats',()=>{
  assert.equal(normalizeExpenseInput(validInput({amountYuan:' 12.30 '}),context()).amountCents,1230);
  assert.equal(normalizeExpenseInput(validInput({amountYuan:'0.01'}),context()).amountCents,1);
  assert.equal(normalizeExpenseInput(validInput({amountYuan:'90071992547409.91'}),context()).amountCents,Number.MAX_SAFE_INTEGER);
  for(const amountYuan of ['','0','-1','1e2','+1','１','.5','1.','01','1.001','90071992547409.92'])
    assert.throws(()=>normalizeExpenseInput(validInput({amountYuan}),context()),hasField('amountYuan'),amountYuan);
});

test('dates include trip boundaries and notes use Unicode code-point limits',()=>{
  assert.equal(normalizeExpenseInput(validInput({spentDate:'2026-10-10'}),context()).spentDate,'2026-10-10');
  assert.equal(normalizeExpenseInput(validInput({spentDate:'2026-10-13'}),context()).spentDate,'2026-10-13');
  assert.equal(normalizeExpenseInput(validInput({note:'  早饭  '}),context()).note,'早饭');
  assert.equal(normalizeExpenseInput(validInput({note:'😀'.repeat(200)}),context()).note.length,400);
  for(const spentDate of ['2026-10-09','2026-10-14','2026-02-29',''])
    assert.throws(()=>normalizeExpenseInput(validInput({spentDate}),context()),hasField('spentDate'),spentDate);
  assert.throws(()=>normalizeExpenseInput(validInput({note:'旅'.repeat(201)}),context()),hasField('note'));
});

test('category must exist in the current trip catalog',()=>{
  assert.equal(normalizeExpenseInput(validInput({categoryId:'custom:coffee'}),context()).categoryId,'custom:coffee');
  for(const categoryId of ['','custom:other-trip','default:unknown'])
    assert.throws(()=>normalizeExpenseInput(validInput({categoryId}),context()),hasField('categoryId'),categoryId);
});

test('only a current route city or the previous removed city may be saved',()=>{
  assert.deepEqual(normalizeExpenseInput(validInput({cityCode:null}),context()).cityCode,null);
  assert.equal(normalizeExpenseInput(validInput({cityCode:'320500'}),context()).cityName,'苏州市');
  assert.equal(normalizeExpenseInput(validInput({cityCode:'330100'}),context({previous:oldExpense()})).cityName,'旧城');
  assert.throws(()=>normalizeExpenseInput(validInput({cityCode:'999999'}),context()),hasField('cityCode'));
  assert.throws(()=>normalizeExpenseInput(validInput({cityCode:'330100'}),context()),hasField('cityCode'));
});

test('summary distinguishes no records no budget and overspending',()=>{
  const empty=computeExpenseSummary({trip:trip({budgetCents:null}),expenses:[],catalog:catalog()});
  assert.deepEqual(empty,{hasExpenses:false,totalCents:0,budgetCents:null,budgetRemainingCents:null,budgetState:'unset',byCategory:[],byCity:[],recentExpenses:[]});
  const expenses=[
    expense(),
    expense({id:'expense-2',amountCents:2000,categoryId:'custom:coffee',cityCode:null,cityName:null,spentDate:'2026-10-11',updatedAt:'2026-10-10T12:00:00.000Z'}),
    expense({id:'expense-3',amountCents:500,categoryId:'default:transport',cityCode:'330100',cityName:'杭州市',spentDate:'2026-10-12',updatedAt:'2026-10-11T12:00:00.000Z'}),
  ];
  const summary=computeExpenseSummary({trip:trip({budgetCents:3000}),expenses,catalog:catalog()});
  assert.equal(summary.totalCents,3500);assert.equal(summary.budgetState,'over');assert.equal(summary.budgetRemainingCents,-500);
  assert.deepEqual(summary.byCategory,[
    {categoryId:'default:transport',name:'交通',totalCents:500,count:1},
    {categoryId:'default:food',name:'餐饮',totalCents:1000,count:1},
    {categoryId:'custom:coffee',name:'咖啡',totalCents:2000,count:1},
  ]);
  assert.deepEqual(summary.byCity,[
    {cityCode:null,cityName:'整个行程',cityState:'trip',totalCents:2000,count:1},
    {cityCode:'320100',cityName:'南京市',cityState:'current',totalCents:1000,count:1},
    {cityCode:'330100',cityName:'杭州市',cityState:'removed',totalCents:500,count:1},
  ]);
});

test('presented expenses sort by date update time and id without changing input',()=>{
  const input=[
    expense({id:'b',spentDate:'2026-10-11',updatedAt:'2026-10-11T10:00:00.000Z'}),
    expense({id:'c',spentDate:'2026-10-12',updatedAt:'2026-10-12T09:00:00.000Z'}),
    expense({id:'a',spentDate:'2026-10-11',updatedAt:'2026-10-11T10:00:00.000Z'}),
    expense({id:'d',spentDate:'2026-10-11',updatedAt:'2026-10-11T11:00:00.000Z'}),
  ];
  const before=structuredClone(input);const presented=presentExpenses({trip:trip(),expenses:input,catalog:catalog()});
  assert.deepEqual(presented.map(item=>item.id),['c','d','a','b']);
  assert.deepEqual(input,before);
  assert.deepEqual(computeExpenseSummary({trip:trip(),expenses:input,catalog:catalog(),limitRecent:3}).recentExpenses.map(item=>item.id),['c','d','a']);
});

test('custom category renames change historical presentation without changing expense records',()=>{
  const original=expense({categoryId:'custom:coffee'});
  const shown=presentExpenses({trip:trip(),expenses:[original],catalog:catalog([custom('下午茶')])})[0];
  assert.equal(shown.categoryName,'下午茶');
  assert.equal(original.categoryName,undefined);
});

test('summary rejects unsafe totals and malformed persisted references',()=>{
  assert.throws(()=>computeExpenseSummary({trip:trip(),expenses:[expense({amountCents:Number.MAX_SAFE_INTEGER}),expense({id:'expense-2',amountCents:1})],catalog:catalog()}),RangeError);
  assert.throws(()=>presentExpenses({trip:trip(),expenses:[expense({categoryId:'custom:missing'})],catalog:catalog()}),/分类/);
});
