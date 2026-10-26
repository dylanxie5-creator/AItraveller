import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTravelArchive,buildTripArchive,isCompletedTrip} from '../src/reports/archive-model.mjs';

const generatedAt='2026-10-26T12:00:00.000Z',cutoffDate='2026-10-26';
function trip(overrides={}) {
  return {id:'trip-secret',revision:9,name:'金陵四日秋游',startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:2,budgetCents:320050,createdAt:'hidden',updatedAt:'hidden',cities:[
    {cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',arrivalDate:'2026-10-10',departureDate:'2026-10-13',order:0,operationId:'hidden'},
  ],...overrides};
}
function expenseOverview({total=8880,category='交通',cityName='南京市',cityState='current'}={}) {
  return {trip:trip(),categories:[],summary:{hasExpenses:true,totalCents:total,budgetCents:320050,budgetRemainingCents:320050-total,budgetState:'within',byCategory:[{categoryId:'default:transport',name:category,totalCents:total,count:1}],byCity:[{cityCode:'320100',cityName,cityState,totalCents:total,count:1}],recentExpenses:[]},expenses:[{id:'expense-secret',tripId:'trip-secret',revision:4,amountCents:total,categoryId:'default:transport',categoryName:category,cityCode:'320100',cityName,cityState,spentDate:'2026-10-10',note:'高铁',operationId:'hidden',createdAt:'hidden',updatedAt:'hidden'}]};
}
function guide() {
  const content=label=>({trip:{name:label,startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:2,budgetCents:320050,cities:[]},days:[],cautions:[label]});
  return {id:'plan-secret',revision:7,provider:'deepseek',model:'deepseek-chat',edited:true,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-02T00:00:00.000Z',content:content('当前攻略'),conversionSnapshot:content('转换快照'),original:content('模型原始输出'),operationId:'hidden',keyCipher:'SECRET_CIPHER',databasePath:'C:\\secret\\travel.sqlite',sources:[
    {sourceId:'s1',title:'官方资料',url:'https://example.com/guide',summary:'摘要',publishedAt:'2026-09-01',retrievedAt:'2026-10-01T00:00:00.000Z',icon:'https://example.com/icon'},
    {sourceId:'s2',title:'旧资料',url:'javascript:alert(1)',summary:'仅作文字',publishedAt:null,retrievedAt:'2026-10-01T00:00:00.000Z'},
  ]};
}
function visit(overrides={}) {return {id:'visit-secret',revision:3,cityCode:'320100',cityName:'南京市',provinceCode:'320000',provinceName:'江苏省',datePrecision:'day',dateStart:'2026-10-10',dateEnd:'2026-10-10',source:'trip',linkedTripId:'trip-secret',tripNameSnapshot:'金陵四日秋游',note:'秋游',createdAt:'hidden',updatedAt:'hidden',...overrides};}
function report(overrides={}) {return buildTripArchive({trip:trip(overrides.trip),expenseOverview:expenseOverview(overrides.expense),visits:overrides.visits??[visit()],guide:overrides.guide===undefined?guide():overrides.guide,generatedAt,cutoffDate});}

test('completed boundary requires end date before today',()=>{
  assert.equal(isCompletedTrip(trip({endDate:'2026-10-25'}),'2026-10-26'),true);
  assert.equal(isCompletedTrip(trip({endDate:'2026-10-26'}),'2026-10-26'),false);
  assert.equal(isCompletedTrip(trip({endDate:'2026-10-27'}),'2026-10-26'),false);
});

test('trip archive strips storage identities and preserves three guide versions',()=>{
  const value=report();
  assert.equal(value.trip.durationDays,4);assert.equal(value.expenses.items[0].amountCents,8880);assert.equal(value.footprints[0].note,'秋游');
  assert.equal(value.guide.current.cautions[0],'当前攻略');assert.equal(value.guide.conversionSnapshot.cautions[0],'转换快照');assert.equal(value.guide.original.cautions[0],'模型原始输出');
  assert.deepEqual(value.guide.sources.map(({url,href,publishedAt,retrievedAt})=>({url,href,publishedAt,retrievedAt})),[
    {url:'https://example.com/guide',href:'https://example.com/guide',publishedAt:'2026-09-01',retrievedAt:'2026-10-01T00:00:00.000Z'},
    {url:'javascript:alert(1)',href:null,publishedAt:null,retrievedAt:'2026-10-01T00:00:00.000Z'},
  ]);
  const text=JSON.stringify(value);for(const forbidden of ['trip-secret','expense-secret','visit-secret','plan-secret','revision','operationId','keyCipher','SECRET_CIPHER','C:\\secret','icon'])assert.equal(text.includes(forbidden),false,forbidden);
});

test('travel archive sorts completed chapters and computes exact totals',()=>{
  const older=report({trip:{name:'较早行程',startDate:'2025-12-30',endDate:'2026-01-02'},expense:{total:1200,category:'餐饮',cityName:'南京市'}});
  const newer=report({trip:{name:'较新行程',startDate:'2026-10-10',endDate:'2026-10-13'},expense:{total:8880,category:'餐饮',cityName:'南京市'}});
  const ongoing=report({trip:{name:'尚未结束',startDate:'2026-10-20',endDate:'2026-10-26'},expense:{total:500,category:'交通',cityName:'苏州市'}});
  const value=buildTravelArchive({tripArchives:[older,ongoing,newer],allVisits:[visit(),visit({id:'manual',source:'manual',linkedTripId:null,cityCode:'330100',cityName:'杭州市',provinceCode:'330000',provinceName:'浙江省'})],generatedAt,cutoffDate});
  assert.deepEqual(value.trips.map(item=>item.trip.name),['较新行程','较早行程']);
  assert.deepEqual(value.summary,{tripCount:2,travelDayCount:8,totalExpenseCents:10080,provinceCount:2,cityCount:2,visitCount:2});
  assert.deepEqual(value.byCategory,[{name:'餐饮',totalCents:10080,count:2}]);
  assert.equal(value.byCity[0].totalCents,10080);assert.deepEqual(value.directory.map(group=>group.year),['2026','2025']);
  assert.deepEqual(value.footprints.map(item=>item.source),['trip','manual']);
});

test('archive aggregation handles collisions boundaries and overflow',()=>{
  const whole=report({trip:{name:'整趟花销',startDate:'2026-01-01',endDate:'2026-01-02'},expense:{total:300,category:'餐饮',cityName:'整个行程',cityState:'trip'}});
  const city=report({trip:{name:'城市花销',startDate:'2026-01-01',endDate:'2026-01-03'},expense:{total:500,category:'餐饮',cityName:'南京市',cityState:'current'}});
  const value=buildTravelArchive({tripArchives:[whole,city],allVisits:[],generatedAt,cutoffDate});
  assert.equal(value.wholeTripExpenseCents,300);assert.deepEqual(value.byCity,[{provinceName:'江苏省',cityName:'南京市',totalCents:500,count:1}]);assert.equal(value.byCategory[0].totalCents,800);assert.equal(value.summary.travelDayCount,5);
  const huge=report({trip:{name:'巨大花销'},expense:{total:Number.MAX_SAFE_INTEGER,category:'其他',cityName:'整个行程',cityState:'trip'}});
  assert.throws(()=>buildTravelArchive({tripArchives:[huge,whole],allVisits:[],generatedAt,cutoffDate}),RangeError);
});
