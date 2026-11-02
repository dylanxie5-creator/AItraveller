import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {createArchivePdfLayout} from '../src/archive/pdf-layout.mjs';
import {createTripArchivePdf,renderTripArchivePdf} from '../src/archive/trip-pdf.mjs';

class RecordingDocument {
  constructor() {this.calls=[];this.pages=[];this.page=null;this.y=0;this.x=0;this.currentFont='';this.currentSize=10;}
  registerFont(name,path,family) {this.calls.push(['registerFont',name,path,family]);return this;}
  addPage(options={}) {this.calls.push(['addPage',options]);this.page={width:595.28,height:841.89,margins:options.margins};this.pages.push(this.page);this.x=options.margins.left;this.y=options.margins.top;return this;}
  bufferedPageRange() {return {start:0,count:this.pages.length};}
  switchToPage(index) {this.calls.push(['switchToPage',index]);this.page=this.pages[index];return this;}
  font(name) {this.currentFont=name;this.calls.push(['font',name]);return this;}
  fontSize(size) {this.currentSize=size;this.calls.push(['fontSize',size]);return this;}
  fillColor(color) {this.calls.push(['fillColor',color]);return this;}
  strokeColor(color) {this.calls.push(['strokeColor',color]);return this;}
  lineWidth(width) {this.calls.push(['lineWidth',width]);return this;}
  heightOfString(value,options={}) {const width=options.width??450,perLine=Math.max(1,Math.floor(width/Math.max(5,this.currentSize*.55))),lines=Math.max(1,Math.ceil(Array.from(String(value)).length/perLine));return lines*(this.currentSize+3);}
  widthOfString(value) {return Array.from(String(value)).length*this.currentSize*.55;}
  text(value,x,top,options={}) {if(typeof x==='object'){options=x;x=undefined;top=undefined;}else if(typeof top==='object'){options=top;top=undefined;}const y=typeof top==='number'?top:this.y;this.calls.push(['text',String(value),x,y,options]);this.y=y+this.heightOfString(value,options);return this;}
  moveTo(...args) {this.calls.push(['moveTo',...args]);return this;}
  lineTo(...args) {this.calls.push(['lineTo',...args]);return this;}
  stroke() {this.calls.push(['stroke']);return this;}
  rect(...args) {this.calls.push(['rect',...args]);return this;}
  fill(...args) {this.calls.push(['fill',...args]);return this;}
  save() {this.calls.push(['save']);return this;}
  restore() {this.calls.push(['restore']);return this;}
  link(...args) {this.calls.push(['link',...args]);return this;}
}

class AutoPagingDocument extends RecordingDocument {
  text(value,x,top,options={}) {
    if(typeof x==='object'){options=x;x=undefined;top=undefined;}else if(typeof top==='object'){options=top;top=undefined;}
    const y=typeof top==='number'?top:this.y;
    const height=this.heightOfString(value,options);
    if(this.page&&y+height>this.page.height-this.page.margins.bottom) {
      this.calls.push(['automaticPageBreak',String(value)]);
      this.addPage({size:'A4',layout:'portrait',margins:{...this.page.margins}});
      return super.text(value,x,this.y,options);
    }
    return super.text(value,x,y,options);
  }
}

function report({empty=false,long=false,expenseCount=2}={}) {
  const items=Array.from({length:expenseCount},(_,index)=>({spentDate:`2026-10-${String(10+(index%4)).padStart(2,'0')}`,categoryName:index%2?'餐饮':'交通',cityName:'南京市',cityState:'current',amountCents:1880+index,note:long?`第 ${index+1} 笔 ${'很长的中文备注'.repeat(30)}`:`第 ${index+1} 笔`}));
  const plan=label=>({trip:{name:label,startDate:'2026-10-10',endDate:'2026-10-13',travelerCount:2,budgetCents:320050,cities:[{cityCode:'320100',cityName:'南京市',provinceName:'江苏省',arrivalDate:'2026-10-10',departureDate:'2026-10-13'}]},days:[{date:'2026-10-10',activities:[{cityCode:'320100',title:`${label}活动`,description:'参观博物馆并沿城墙散步',sourceIds:['s1']}]}],cautions:[`${label}注意事项`]});
  return {kind:'trip',generatedAt:'2026-10-30T12:34:56.000Z',cutoffDate:'2026-10-30',databaseVersion:4,trip:{name:'金陵四日秋游',startDate:'2026-10-10',endDate:'2026-10-13',durationDays:4,travelerCount:2,budgetCents:320050,cities:[{cityName:'南京市',provinceName:'江苏省',arrivalDate:'2026-10-10',departureDate:'2026-10-13'}]},expenses:{hasExpenses:!empty,totalCents:empty?0:items.reduce((sum,row)=>sum+row.amountCents,0),budgetCents:320050,budgetRemainingCents:300000,budgetState:'within',byCategory:empty?[]:[{name:'交通',totalCents:1880,count:1}],byCity:empty?[]:[{provinceName:'江苏省',cityName:'南京市',cityState:'current',totalCents:1880,count:1}],items:empty?[]:items},footprints:empty?[]:[{provinceName:'江苏省',cityName:'南京市',datePrecision:'day',dateStart:'2026-10-10',dateEnd:'2026-10-10',source:'trip',note:long?'秋日足迹'.repeat(100):'秋游'}],guide:empty?null:{provider:'deepseek',model:'deepseek-chat',edited:true,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-02T00:00:00.000Z',current:plan('当前攻略'),conversionSnapshot:plan('转换时快照'),original:plan('模型原始输出'),sources:[{sourceId:'s1',title:'官方旅行资料',url:long?`https://example.com/${'very-long-unbroken-segment'.repeat(25)}`:'https://example.com/guide',href:long?`https://example.com/${'very-long-unbroken-segment'.repeat(25)}`:'https://example.com/guide',summary:'官方开放时间与预约说明',publishedAt:'2026-09-01',retrievedAt:'2026-10-01T00:00:00.000Z'}]}};
}

function semanticLayout() {
  const calls=[];
  return {calls,addPage:label=>calls.push(['addPage',label]),ensureSpace:value=>calls.push(['ensureSpace',value]),title:(value,subtitle)=>calls.push(['title',value,subtitle]),heading:(value,level)=>calls.push(['heading',value,level]),paragraph:value=>calls.push(['paragraph',String(value)]),facts:value=>calls.push(['facts',value]),list:value=>calls.push(['list',value]),source:value=>calls.push(['source',value]),expenseTable:value=>calls.push(['expenseTable',value]),finalize:()=>calls.push(['finalize'])};
}
const semanticText=layout=>JSON.stringify(layout.calls);

test('layout uses A4 margins registered Chinese fonts warm palette and numbered footers',()=>{
  const doc=new RecordingDocument(),layout=createArchivePdfLayout(doc,{fonts:{regular:'regular.ttc',bold:'bold.ttc'}});
  layout.addPage('单趟档案');layout.title('金陵四日秋游','2026-10-10 至 2026-10-13');layout.finalize();
  assert.deepEqual(doc.calls.filter(call=>call[0]==='registerFont'),[['registerFont','ArchiveRegular','regular.ttc','MicrosoftYaHei'],['registerFont','ArchiveBold','bold.ttc','MicrosoftYaHei-Bold']]);
  const page=doc.calls.find(call=>call[0]==='addPage')[1];
  assert.equal(page.size,'A4');assert.equal(page.layout,'portrait');assert.deepEqual(page.margins,{top:58,right:54,bottom:58,left:54});
  assert.ok(doc.calls.some(call=>call[0]==='fillColor'&&call[1]==='#9A4F3D'));
  assert.ok(doc.calls.some(call=>call[0]==='text'&&call[1]==='第 1 页'));
});

test('finalizing headers and footers does not create footer-only pages',()=>{
  const doc=new AutoPagingDocument(),layout=createArchivePdfLayout(doc,{fonts:{regular:'regular.ttc',bold:'bold.ttc'}});
  layout.addPage('第一页');layout.addPage('第二页');
  const before=doc.pages.length;
  layout.finalize();
  assert.equal(doc.pages.length,before);
  assert.equal(doc.calls.filter(call=>call[0]==='automaticPageBreak').length,0);
});

test('space guard starts a new page before an indivisible block',()=>{
  const doc=new RecordingDocument(),layout=createArchivePdfLayout(doc,{fonts:{regular:'regular.ttc',bold:'bold.ttc'}});
  layout.addPage('章节');doc.y=760;layout.ensureSpace(80);
  assert.equal(doc.calls.filter(call=>call[0]==='addPage').length,2);
});

test('expense table measures wrapped cells repeats its header and emits every row',()=>{
  const doc=new RecordingDocument(),layout=createArchivePdfLayout(doc,{fonts:{regular:'regular.ttc',bold:'bold.ttc'}}),rows=report({expenseCount:80,long:true}).expenses.items;
  layout.addPage('花销');layout.expenseTable(rows);
  const textCalls=doc.calls.filter(call=>call[0]==='text').map(call=>call[1]);
  assert.ok(doc.calls.filter(call=>call[0]==='addPage').length>1);
  assert.ok(textCalls.filter(value=>value==='日期').length>1);
  for(const row of rows)assert.ok(textCalls.includes(row.note),row.note.slice(0,12));
});

test('expense table splits a legal multiline note without header-only or headerless pages',async()=>{
  const doc=new PDFDocument({autoFirstPage:false,bufferPages:true,compress:false}),pageTexts=new Map(),originalText=doc.text;
  doc.text=function(value,...args) {
    const index=this._pageBuffer.indexOf(this.page),values=pageTexts.get(index)??[];
    values.push(String(value));pageTexts.set(index,values);
    return originalText.call(this,value,...args);
  };
  const layout=createArchivePdfLayout(doc,{fonts:{regular:'C:\\Windows\\Fonts\\msyh.ttc',bold:'C:\\Windows\\Fonts\\msyhbd.ttc'}});
  layout.addPage('花销分页');
  layout.expenseTable([
    {spentDate:'2026-10-10',categoryName:'交通',cityName:'南京市',amountCents:2000,note:`${'甲\n'.repeat(89)}尾`},
    {spentDate:'2026-10-11',categoryName:'餐饮',cityName:'苏州市',amountCents:3000,note:'第二笔'},
  ]);
  layout.finalize();
  const count=doc.bufferedPageRange().count;
  const ended=new Promise((resolve,reject)=>{doc.on('data',()=>{});doc.once('end',resolve);doc.once('error',reject);});
  doc.end();await ended;
  assert.ok(count>1,`pages=${count}`);
  for(let index=0;index<count;index++) {
    const values=pageTexts.get(index)??[];
    assert.ok(values.includes('日期'),`page ${index+1} missing expense header`);
    assert.ok(values.some(value=>value.includes('甲')||value.includes('尾')||value==='2026-10-11'),`page ${index+1} has only a header`);
  }
});

test('trip PDF includes cover route three guide versions sources expenses and footprints',()=>{
  const layout=semanticLayout();renderTripArchivePdf(layout,report());const text=semanticText(layout);
  for(const expected of ['金陵四日秋游','行程概览','城市路线','攻略与每日安排','当前攻略','转换时快照','模型原始输出','检索来源','官方旅行资料','花销统计与明细','第 1 笔','足迹与备注','秋游'])assert.match(text,new RegExp(expected));
});

test('trip PDF preserves each guide budget activity city and source references',()=>{
  const value=report();
  value.guide.current.trip.budgetCents=11100;
  value.guide.conversionSnapshot.trip.budgetCents=22200;
  value.guide.original.trip.budgetCents=33300;
  const layout=semanticLayout();renderTripArchivePdf(layout,value);
  const visible=layout.calls.flatMap(call=>call.slice(1)).flat(Infinity).filter(item=>typeof item==='string').join('\n');
  for(const expected of ['¥111.00','¥222.00','¥333.00','南京市','来源 s1'])assert.match(visible,new RegExp(expected));
  const sourceCall=layout.calls.find(call=>call[0]==='source');
  assert.match(sourceCall?.[1]?.title??'',/s1/u);
});

test('trip PDF keeps explicit empty chapters without fabricating guide or expense data',()=>{
  const layout=semanticLayout();renderTripArchivePdf(layout,report({empty:true}));const text=semanticText(layout);
  for(const expected of ['攻略与每日安排','检索来源','花销统计与明细','足迹与备注'])assert.match(text,new RegExp(expected));
  assert.ok((text.match(/暂无相关记录/gu)??[]).length>=6);
  const written=layout.calls.flatMap(call=>call.slice(1)).flat(Infinity).filter(value=>typeof value==='string').join('\n');
  assert.doesNotMatch(written,/示例|undefined|null/u);
});

test('trip PDF handles long CJK note and unbroken source URL without clipping',async()=>{
  const value=report({long:true,expenseCount:80});
  const buffer=await createTripArchivePdf(value,{fonts:{regular:'C:\\Windows\\Fonts\\msyh.ttc',bold:'C:\\Windows\\Fonts\\msyhbd.ttc'}});
  const raw=buffer.toString('latin1'),pages=[...raw.matchAll(/\/Type \/Page\b/gu)].length;
  assert.equal(buffer.subarray(0,5).toString('ascii'),'%PDF-');
  assert.ok(pages>2,`pages=${pages}`);
  assert.ok(buffer.length<67108864);
});
