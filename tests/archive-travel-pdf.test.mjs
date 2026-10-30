import test from 'node:test';
import assert from 'node:assert/strict';
import {createTravelArchivePdf,renderTravelArchivePdf} from '../src/archive/travel-archive-pdf.mjs';

function trip(name,startDate,endDate,cityName,totalCents) {
  return {kind:'trip',generatedAt:'2026-10-30T12:00:00.000Z',cutoffDate:'2026-10-30',databaseVersion:4,trip:{name,startDate,endDate,durationDays:4,travelerCount:2,budgetCents:50000,cities:[{provinceName:'江苏省',cityName,arrivalDate:startDate,departureDate:endDate}]},expenses:{hasExpenses:true,totalCents,budgetCents:50000,budgetRemainingCents:50000-totalCents,budgetState:'within',byCategory:[{name:'交通',totalCents,count:1}],byCity:[{provinceName:'江苏省',cityName,cityState:'current',totalCents,count:1}],items:[{spentDate:startDate,categoryName:'交通',cityName,cityState:'current',amountCents:totalCents,note:`${name}车票`}]},footprints:[{provinceName:'江苏省',cityName,datePrecision:'day',dateStart:startDate,dateEnd:startDate,source:'trip',note:name}],guide:null};
}

function archive(overrides={}) {
  const newer=trip('金陵秋游','2026-10-10','2026-10-13','南京市',8000),older=trip('姑苏春日','2025-03-01','2025-03-03','苏州市',4000);
  return {kind:'archive',generatedAt:'2026-10-30T12:00:00.000Z',cutoffDate:'2026-10-30',databaseVersion:4,summary:{tripCount:2,travelDayCount:7,totalExpenseCents:12000,provinceCount:2,cityCount:3,visitCount:3},byYear:[{year:'2026',tripCount:1,totalExpenseCents:8000},{year:'2025',tripCount:1,totalExpenseCents:4000}],byCategory:[{name:'交通',totalCents:12000,count:2}],byCity:[{provinceName:'江苏省',cityName:'南京市',totalCents:8000,count:1},{provinceName:'江苏省',cityName:'苏州市',totalCents:4000,count:1}],wholeTripExpenseCents:600,directory:[{year:'2026',trips:[{name:'金陵秋游',startDate:'2026-10-10',endDate:'2026-10-13',route:['南京市'],totalExpenseCents:8000}]},{year:'2025',trips:[{name:'姑苏春日',startDate:'2025-03-01',endDate:'2025-03-03',route:['苏州市'],totalExpenseCents:4000}]}],trips:[newer,older],footprints:[{provinceName:'江苏省',cityName:'南京市',datePrecision:'day',dateStart:'2026-10-10',dateEnd:'2026-10-10',source:'trip',note:'秋游'},{provinceName:'浙江省',cityName:'杭州市',datePrecision:'month',dateStart:'2025-05',dateEnd:'2025-06',source:'detached',note:'历史照片补录'},{provinceName:'江苏省',cityName:'南京市',datePrecision:'year',dateStart:'2024',dateEnd:null,source:'manual',note:''}],apiKey:'SECRET_API_KEY',databasePath:'C:\\private\\travel.sqlite',privateSettings:{mapKey:'SECRET_MAP_KEY'},...overrides};
}

function semanticLayout() {
  const calls=[];
  return {calls,addPage:value=>calls.push(['addPage',value]),ensureSpace:value=>calls.push(['ensureSpace',value]),title:(value,subtitle)=>calls.push(['title',value,subtitle]),heading:(value,level)=>calls.push(['heading',value,level]),paragraph:value=>calls.push(['paragraph',String(value)]),facts:value=>calls.push(['facts',value]),list:value=>calls.push(['list',value]),source:value=>calls.push(['source',value]),expenseTable:value=>calls.push(['expenseTable',value]),finalize:()=>calls.push(['finalize'])};
}
const textOf=layout=>JSON.stringify(layout.calls);

test('travel PDF includes cover six summary facts years categories city totals and directory',async()=>{
  const value=archive(),layout=semanticLayout();renderTravelArchivePdf(layout,value);const text=textOf(layout);
  for(const expected of ['我的旅行足迹','卷首总览','已结束行程','累计旅行','累计花销','到访省份','到访城市','到访次数','按年份','2026 · 1 趟','按分类','交通 · 2 笔','跨行程城市花销','南京市 · 1 笔','未归属具体城市的整趟花销','年度目录'])assert.match(text,new RegExp(expected));
  const summaryCall=layout.calls.find(call=>call[0]==='facts');assert.equal(summaryCall[1].length,6);
  const buffer=await createTravelArchivePdf(value,{fonts:{regular:'C:\\Windows\\Fonts\\msyh.ttc',bold:'C:\\Windows\\Fonts\\msyhbd.ttc'}});
  assert.equal(buffer.subarray(0,5).toString('ascii'),'%PDF-');
  assert.ok([...buffer.toString('latin1').matchAll(/\/Type \/Page\b/gu)].length>=4);
});

test('travel PDF begins every trip on a new page and renders all trip chapters',()=>{
  const layout=semanticLayout();renderTravelArchivePdf(layout,archive());
  const pageLabels=layout.calls.filter(call=>call[0]==='addPage').map(call=>call[1]);
  assert.ok(pageLabels.some(value=>value.includes('金陵秋游')));assert.ok(pageLabels.some(value=>value.includes('姑苏春日')));
  const text=textOf(layout);for(const expected of ['金陵秋游车票','姑苏春日车票','花销统计与明细','足迹与备注'])assert.match(text,new RegExp(expected));
});

test('travel PDF finishes with the full precision-aware footprint index',()=>{
  const layout=semanticLayout();renderTravelArchivePdf(layout,archive());const text=textOf(layout);
  assert.match(text,/卷末 · 全部足迹索引/u);
  assert.match(text,/南京市 · 2026-10-10/u);
  assert.match(text,/杭州市 · 2025-05 至 2025-06 · 历史行程 · 历史照片补录/u);
  assert.match(text,/南京市 · 2024 · 手动补录/u);
});

test('travel PDF rejects an archive with zero completed trips',async()=>{
  let constructed=0;class MustNotConstruct {constructor(){constructed++;}}
  await assert.rejects(createTravelArchivePdf(archive({trips:[]}),{PDFDocumentClass:MustNotConstruct}),error=>error.code==='ARCHIVE_EMPTY'&&error.message==='还没有已经结束的行程');
  assert.equal(constructed,0);
});

test('travel PDF does not serialize credentials paths private settings or fake sample content',()=>{
  const layout=semanticLayout();renderTravelArchivePdf(layout,archive());const text=textOf(layout);
  for(const forbidden of ['SECRET_API_KEY','SECRET_MAP_KEY','C:\\\\private','privateSettings','示例行程'])assert.equal(text.includes(forbidden),false,forbidden);
});
