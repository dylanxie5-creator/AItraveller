import {StoreError} from '../storage/errors.mjs';
import {createArchivePdfLayout} from './pdf-layout.mjs';
import {createPdfBuffer,resolveArchiveFonts} from './pdf-runtime.mjs';
import {renderTripArchivePdf} from './trip-pdf.mjs';

const money=cents=>Number.isSafeInteger(cents)?`¥${(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—';
const visitDate=item=>item.dateEnd&&item.dateEnd!==item.dateStart?`${item.dateStart} 至 ${item.dateEnd}`:item.dateStart??'日期未知';
const sourceLabel=source=>source==='detached'?'历史行程':source==='manual'?'手动补录':'自动同步';
const requireTrips=report=>{if(!Array.isArray(report?.trips)||report.trips.length===0)throw new StoreError('ARCHIVE_EMPTY','还没有已经结束的行程');};

export function renderTravelArchivePdf(layout,report) {
  requireTrips(report);
  const summary=report.summary??{};
  layout.addPage('旅行总档案 · 封面');
  layout.title('我的旅行足迹',`收录截至 ${report.cutoffDate??'—'} 已结束的全部行程`);
  layout.paragraph(`生成于 ${report.generatedAt??'—'} · 数据库版本 v${report.databaseVersion??'—'}`);
  layout.heading('卷首总览');
  layout.facts([
    {label:'已结束行程',value:`${summary.tripCount??0} 趟`},
    {label:'累计旅行',value:`${summary.travelDayCount??0} 天`},
    {label:'累计花销',value:money(summary.totalExpenseCents??0)},
    {label:'到访省份',value:`${summary.provinceCount??0} 个`},
    {label:'到访城市',value:`${summary.cityCount??0} 座`},
    {label:'到访次数',value:`${summary.visitCount??0} 次`},
  ]);
  layout.heading('按年份',3);
  layout.list((report.byYear??[]).map(row=>`${row.year} · ${row.tripCount} 趟 · ${money(row.totalExpenseCents)}`));
  layout.heading('按分类',3);
  layout.list((report.byCategory??[]).map(row=>`${row.name} · ${row.count} 笔 · ${money(row.totalCents)}`));
  layout.heading('跨行程城市花销',3);
  layout.list((report.byCity??[]).map(row=>`${row.provinceName} · ${row.cityName} · ${row.count} 笔 · ${money(row.totalCents)}`));
  layout.paragraph(`未归属具体城市的整趟花销：${money(report.wholeTripExpenseCents??0)}`);

  layout.heading('年度目录');
  for(const group of report.directory??[]) {
    layout.heading(group.year,3);
    layout.list((group.trips??[]).map(row=>`${row.name} · ${row.startDate} 至 ${row.endDate} · ${(row.route??[]).join(' → ')||'未记录城市'} · ${money(row.totalExpenseCents)}`));
  }
  for(const trip of report.trips)renderTripArchivePdf(layout,trip,{standalone:false});

  layout.addPage('卷末 · 全部足迹索引');
  layout.heading('卷末 · 全部足迹索引');
  layout.list((report.footprints??[]).map(item=>`${item.provinceName??''} · ${item.cityName??'未命名城市'} · ${visitDate(item)} · ${sourceLabel(item.source)}${item.note?` · ${item.note}`:''}`));
}

export async function createTravelArchivePdf(report,options={}) {
  requireTrips(report);
  const fonts=options.fonts??resolveArchiveFonts(options.fontOptions);
  return createPdfBuffer({
    PDFDocumentClass:options.PDFDocumentClass,
    maxBytes:options.maxBytes,
    documentOptions:{info:{Title:`旅行总档案 - 截至${report.cutoffDate}`,Author:'智游足迹',Subject:'个人旅行总档案',CreationDate:new Date(report.generatedAt??Date.now())}},
    render(doc) {const layout=createArchivePdfLayout(doc,{fonts});renderTravelArchivePdf(layout,report);layout.finalize();},
  });
}
