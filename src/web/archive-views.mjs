import {formatCents} from '../shared/money.mjs';
import {formatVisitDate} from '../shared/footprint-format.mjs';
import {button,el,pageHeader} from './ui-elements.mjs';

const money=value=>`¥${formatCents(value)}`;
const time=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short',hour12:false}).format(date):value;};
const empty=()=>el('p',{class:'archive-empty-copy'},'暂无相关记录');
const link=(text,href)=>el('a',{class:'button secondary',href,target:'_blank',rel:'noopener','aria-label':text},text);
const item=(label,value)=>el('div',{class:'archive-fact'},el('span',{},label),el('strong',{},value));
function section(title,...content) {return el('section',{class:'archive-section'},el('h2',{},title),...content);}
function list(rows,render) {return rows.length?el('ul',{class:'archive-list'},rows.map(render)):empty();}

function planView(title,content) {
  if(!content)return section(title,empty());
  const trip=content.trip??{},cities=trip.cities??[],cityByCode=new Map(cities.map(city=>[city.cityCode,city]));
  const route=cities.map(city=>city.cityName).join(' → ')||'未记录城市';
  const budget=trip.budgetCents===null||trip.budgetCents===undefined?'未设置':money(trip.budgetCents);
  const tripMeta=el('div',{class:'archive-guide-version-meta archive-entry'},el('h3',{},trip.name??'未命名攻略'),el('p',{},`${trip.startDate??'—'} — ${trip.endDate??'—'} · ${trip.travelerCount??'—'} 人 · 预算 ${budget}`),el('p',{class:'archive-route'},route));
  const days=(content.days??[]).map(day=>el('article',{class:'archive-entry archive-day'},el('h4',{},day.date),...(day.activities??[]).map(activity=>{const city=cityByCode.get(activity.cityCode);return el('div',{class:'archive-activity'},el('strong',{},activity.title),el('p',{class:'archive-meta'},`城市：${city?.cityName??activity.cityName??'未记录'}`),el('p',{},activity.description),activity.sourceIds?.length?el('p',{class:'archive-source-refs'},`引用：${activity.sourceIds.join('、')}`):null);})));
  return section(title,tripMeta,days.length?days:empty(),content.cautions?.length?el('div',{class:'archive-cautions'},el('h3',{},'注意事项'),el('ul',{},content.cautions.map(value=>el('li',{},value)))):null);
}
function expenseView(report) {
  const value=report.expenses;
  if(!value.hasExpenses)return section('花销统计与明细',empty());
  const budget=value.budgetCents===null?'未设置':money(value.budgetCents),remaining=value.budgetRemainingCents===null?'—':value.budgetRemainingCents<0?`超支 ${money(-value.budgetRemainingCents)}`:`剩余 ${money(value.budgetRemainingCents)}`;
  const facts=el('div',{class:'archive-facts'},item('累计花销',money(value.totalCents)),item('预算',budget),item('预算状态',remaining));
  const breakdowns=el('div',{class:'archive-breakdowns'},
    el('div',{},el('h3',{},'按分类'),list(value.byCategory,row=>el('li',{},el('span',{},`${row.name} · ${row.count} 笔`),el('strong',{},money(row.totalCents))))),
    el('div',{},el('h3',{},'按城市'),list(value.byCity,row=>el('li',{},el('span',{},`${row.cityName} · ${row.count} 笔`),el('strong',{},money(row.totalCents))))));
  const table=el('table',{class:'archive-expense-table'},
    el('thead',{},el('tr',{},...['日期','分类','城市','备注','金额'].map(label=>el('th',{},label)))),
    el('tbody',{},value.items.map(row=>el('tr',{'data-expense-row':''},el('td',{},row.spentDate),el('td',{},row.categoryName),el('td',{},row.cityName),el('td',{},row.note||'—'),el('td',{},money(row.amountCents))))));
  return section('花销统计与明细',facts,breakdowns,table);
}
function footprintView(report) {return section('足迹与备注',list(report.footprints,row=>el('li',{class:'archive-entry'},el('strong',{},`${row.provinceName} · ${row.cityName}`),el('span',{},` ${formatVisitDate(row)}`),row.note?el('p',{},row.note):null)));}
function guideView(report) {
  if(!report.guide)return section('攻略与每日安排',empty());
  const guide=report.guide,sources=guide.sources.length?guide.sources.map(source=>el('article',{class:'archive-entry archive-source'},el('h4',{},`${source.sourceId} · ${source.title}`),el('p',{},source.summary),source.href?el('a',{class:'archive-url',href:source.href,target:'_blank',rel:'noopener noreferrer'},source.url):el('p',{class:'archive-url'},source.url),el('p',{class:'archive-meta'},`发布日期：${source.publishedAt??'未知'} · 检索时间：${time(source.retrievedAt)}`))):[empty()];
  return el('div',{class:'archive-guide'},section('攻略与每日安排',el('p',{class:'archive-meta'},`${guide.provider} · ${guide.model}${guide.edited?' · 已人工修改':''}`),el('p',{class:'archive-meta'},`创建于 ${time(guide.createdAt)} · 更新于 ${time(guide.updatedAt)}`),planView('当前攻略',guide.current)),planView('创建正式行程时的攻略快照',guide.conversionSnapshot),planView('模型原始输出',guide.original),section('检索来源',...sources));
}
function tripChapter(report,{standalone=false}={}) {
  const trip=report.trip;
  return el('article',{class:`archive-trip-chapter${standalone?' standalone':''}`},el('header',{class:'archive-cover'},el('p',{class:'archive-kicker'},standalone?'TRIP ARCHIVE · 单趟档案':'TRIP CHAPTER · 行程章节'),el('h1',{},trip.name),el('p',{},`${trip.startDate} — ${trip.endDate} · ${trip.travelerCount} 人`),el('p',{class:'archive-route'},trip.cities.map(city=>city.cityName).join(' → ')||'未记录城市')),el('div',{class:'archive-facts'},item('旅行时长',`${trip.durationDays} 天`),item('预算',trip.budgetCents===null?'未设置':money(trip.budgetCents)),item('实际花销',money(report.expenses.totalCents))),section('行程概览',list(trip.cities,city=>el('li',{class:'archive-entry'},el('strong',{},city.cityName),el('span',{},` ${city.arrivalDate} — ${city.departureDate} · ${city.provinceName}`)))),guideView(report),expenseView(report),footprintView(report));
}
function totalReport(report) {
  const summary=report.summary;
  return el('div',{class:'archive-document'},el('section',{class:'archive-cover archive-total-cover'},el('p',{class:'archive-kicker'},'TRAVEL ARCHIVE · 个人总档案'),el('h1',{},'我的旅行足迹'),el('p',{},`收录截至 ${report.cutoffDate} 已结束的全部行程`),el('p',{class:'archive-meta'},`生成于 ${time(report.generatedAt)} · 数据库版本 v${report.databaseVersion}`)),el('section',{class:'archive-summary-page'},el('h2',{},'卷首总览'),el('div',{class:'archive-facts'},item('已结束行程',`${summary.tripCount} 趟`),item('累计旅行',`${summary.travelDayCount} 天`),item('累计花销',money(summary.totalExpenseCents)),item('到访省份',`${summary.provinceCount} 个`),item('到访城市',`${summary.cityCount} 座`),item('到访次数',`${summary.visitCount} 次`)),el('div',{class:'archive-breakdowns'},el('div',{},el('h3',{},'按年份'),list(report.byYear,row=>el('li',{},el('span',{},`${row.year} · ${row.tripCount} 趟`),el('strong',{},money(row.totalExpenseCents))))),el('div',{},el('h3',{},'按分类'),list(report.byCategory,row=>el('li',{},el('span',{},`${row.name} · ${row.count} 笔`),el('strong',{},money(row.totalCents)))))),el('div',{class:'archive-total-cities'},el('h3',{},'跨行程城市花销'),list(report.byCity,row=>el('li',{},el('span',{},`${row.provinceName} · ${row.cityName} · ${row.count} 笔`),el('strong',{},money(row.totalCents))))),el('p',{class:'archive-meta'},`未归属具体城市的整趟花销：${money(report.wholeTripExpenseCents)}`)),el('section',{class:'archive-directory'},el('h2',{},'年度目录'),...report.directory.map(group=>el('div',{class:'archive-year'},el('h3',{},group.year),...group.trips.map(row=>el('div',{class:'archive-entry archive-directory-row'},el('strong',{},row.name),el('span',{},`${row.startDate} — ${row.endDate} · ${row.route.join(' → ')} · ${money(row.totalExpenseCents)}`)))))),...report.trips.map(item=>tripChapter(item)),section('卷末 · 全部足迹索引',list(report.footprints,row=>el('li',{class:'archive-entry'},el('strong',{},`${row.provinceName} · ${row.cityName}`),el('span',{},` ${formatVisitDate(row)} · ${row.source==='manual'?'手动补录':row.source==='detached'?'历史行程':'自动同步'}`),row.note?el('p',{},row.note):null))));
}
function reportToolbar(report,actions) {const filename=report.kind==='trip'?`旅行档案-${report.trip.name}-${report.trip.endDate}.pdf`:`旅行总档案-截至${report.cutoffDate}.pdf`;return el('div',{class:'archive-actions'},el('div',{},el('strong',{},'打印预览'),el('p',{},`建议文件名：${filename}`)),button('打印/保存为 PDF',actions.print));}

export function renderArchiveView(root,state,actions) {
  root.replaceChildren();
  if(state.type==='archive-loading'){root.append(el('p',{class:'loading',role:'status'},'正在生成旅行档案…'));return;}
  if(state.type==='archive-error'){root.append(el('section',{class:'empty-state'},el('h1',{},'暂时无法生成档案'),el('p',{role:'alert'},state.message),button('重新载入',()=>actions.retry(state.route))));return;}
  if(state.type==='archive-empty'){root.append(el('section',{class:'empty-state'},el('h1',{},'还没有可收录的行程'),el('p',{},`截至 ${state.report.cutoffDate}，只有已经结束的行程会进入旅行档案。`)));return;}
  if(state.type==='archive-home'){const report=state.report;root.append(pageHeader({eyebrow:'TRAVEL ARCHIVE',title:'旅行档案'}),el('section',{class:'archive-intro archive-yearbook-cover journal-section'},el('img',{src:'/web/travel-wash.png',alt:'','aria-hidden':'true'}),el('div',{},el('p',{class:'eyebrow'},'PRIVATE TRAVEL YEARBOOK'),el('h2',{},`${report.summary.tripCount} 趟已结束行程`),el('p',{},`收录截止 ${report.cutoffDate}，包含完整路线、攻略、花销、足迹与检索来源。`),link('预览旅行总档案','#/reports/archive/print'))));return;}
  if(state.type==='archive-report'){root.append(reportToolbar(state.report,actions),state.report.kind==='archive'?totalReport(state.report):el('div',{class:'archive-document'},tripChapter(state.report,{standalone:true}),el('p',{class:'archive-generated'},`生成于 ${time(state.report.generatedAt)} · 数据库版本 v${state.report.databaseVersion}`)));}
}
