import {createArchivePdfLayout} from './pdf-layout.mjs';
import {createPdfBuffer,resolveArchiveFonts} from './pdf-runtime.mjs';

const money=cents=>Number.isSafeInteger(cents)?`¥${(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'未设置';
const route=trip=>trip?.cities?.map(city=>city.cityName).filter(Boolean).join(' → ')||'未记录城市';
const visitDate=visit=>visit.datePrecision==='day'?visit.dateStart:visit.dateEnd&&visit.dateEnd!==visit.dateStart?`${visit.dateStart} 至 ${visit.dateEnd}`:visit.dateStart;

function planChapter(layout,label,plan) {
  layout.heading(label,3);
  if(!plan){layout.paragraph('暂无相关记录');return;}
  const trip=plan.trip??{};
  const cityNames=new Map((trip.cities??[]).map(city=>[city.cityCode,city.cityName??city.cityCode]));
  const budget=trip.budgetCents===null||trip.budgetCents===undefined?'未设置':money(trip.budgetCents);
  layout.paragraph(`${trip.name??'未命名攻略'} · ${trip.startDate??'—'} 至 ${trip.endDate??'—'} · ${trip.travelerCount??'—'} 人 · 预算 ${budget}`);
  if(Array.isArray(trip.cities)&&trip.cities.length)layout.list(trip.cities.map(city=>`${city.provinceName??''}${city.cityName??city.cityCode??''} · ${city.arrivalDate??'—'} 至 ${city.departureDate??'—'}`));
  if(Array.isArray(plan.days)&&plan.days.length) {
    for(const day of plan.days) {
      layout.heading(day.date??'未记录日期',3);
      layout.list((day.activities??[]).map(activity=>{
        const city=cityNames.get(activity.cityCode)??activity.cityName??activity.cityCode??'城市未知';
        const sources=Array.isArray(activity.sourceIds)&&activity.sourceIds.length?`｜来源 ${activity.sourceIds.join('、')}`:'';
        return `${activity.title??'未命名活动'}｜${activity.description??'暂无说明'}｜${city}${sources}`;
      }));
    }
  } else layout.paragraph('暂无每日安排');
  layout.heading('注意事项',3);
  layout.list(plan.cautions??[]);
}

export function renderTripArchivePdf(layout,report,{standalone=true}={}) {
  const trip=report?.trip??{},expenses=report?.expenses??{},guide=report?.guide;
  layout.addPage(`${standalone?'单趟档案':'行程章节'} · ${trip.name??'未命名行程'}`);
  layout.title(trip.name??'未命名行程',`${trip.startDate??'—'} 至 ${trip.endDate??'—'} · ${route(trip)}`);
  layout.heading('行程概览');
  layout.facts([
    {label:'旅行时长',value:Number.isSafeInteger(trip.durationDays)?`${trip.durationDays} 天`:'—'},
    {label:'出行人数',value:Number.isSafeInteger(trip.travelerCount)?`${trip.travelerCount} 人`:'—'},
    {label:'预算',value:trip.budgetCents===null?'未设置':money(trip.budgetCents)},
    {label:'实际花销',value:money(expenses.totalCents??0)},
  ]);
  layout.heading('城市路线');
  layout.list((trip.cities??[]).map(city=>`${city.provinceName??''} · ${city.cityName??'未命名城市'} · ${city.arrivalDate??'—'} 至 ${city.departureDate??'—'}`));

  layout.heading('攻略与每日安排');
  if(guide)layout.paragraph(`${guide.provider??'未知提供方'} · ${guide.model??'未知模型'} · ${guide.edited?'已编辑':'模型原稿'}`);
  planChapter(layout,'当前攻略',guide?.current);
  planChapter(layout,'转换时快照',guide?.conversionSnapshot);
  planChapter(layout,'模型原始输出',guide?.original);
  layout.heading('检索来源',3);
  if(guide?.sources?.length)for(const item of guide.sources)layout.source({...item,title:item.sourceId?`[${item.sourceId}] ${item.title??'未命名来源'}`:item.title});else layout.paragraph('暂无相关记录');

  layout.heading('花销统计与明细');
  if(expenses.hasExpenses) {
    layout.facts([
      {label:'合计',value:money(expenses.totalCents)},
      {label:'预算剩余',value:expenses.budgetRemainingCents===null?'未设置预算':money(expenses.budgetRemainingCents)},
    ]);
    layout.heading('按分类',3);
    layout.list((expenses.byCategory??[]).map(item=>`${item.name} · ${item.count} 笔 · ${money(item.totalCents)}`));
    layout.heading('按城市',3);
    layout.list((expenses.byCity??[]).map(item=>`${item.provinceName?`${item.provinceName} · `:''}${item.cityName} · ${item.count} 笔 · ${money(item.totalCents)}`));
    layout.heading('逐笔明细',3);
    layout.expenseTable(expenses.items??[]);
  } else layout.paragraph('暂无相关记录');

  layout.heading('足迹与备注');
  const footprints=(report?.footprints??[]).map(item=>`${item.provinceName??''} · ${item.cityName??'未命名城市'} · ${visitDate(item)??'日期未知'} · ${item.note||'无备注'}`);
  if(footprints.length)layout.list(footprints);else layout.paragraph('暂无相关记录');
}

export async function createTripArchivePdf(report,options={}) {
  const fonts=options.fonts??resolveArchiveFonts(options.fontOptions);
  return createPdfBuffer({
    PDFDocumentClass:options.PDFDocumentClass,
    maxBytes:options.maxBytes,
    documentOptions:{info:{Title:`旅行档案 - ${report?.trip?.name??'未命名行程'}`,Author:'智游足迹',Subject:'个人旅行档案',CreationDate:new Date(report?.generatedAt??Date.now())}},
    render(doc) {const layout=createArchivePdfLayout(doc,{fonts});renderTripArchivePdf(layout,report);layout.finalize();},
  });
}
