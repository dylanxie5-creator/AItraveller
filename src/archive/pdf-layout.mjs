const MARGINS={top:58,right:54,bottom:58,left:54};
const PALETTE={accent:'#9A4F3D',ink:'#2F2A26',muted:'#6F625A',line:'#D9CBBF',soft:'#F4ECE5',white:'#FFFFFF'};
const BODY_SIZE=9.5;

const text=value=>value===null||value===undefined||value===''?'—':String(value);
const money=cents=>Number.isSafeInteger(cents)?`¥${(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—';

export function createArchivePdfLayout(doc,{fonts}={}) {
  if(!doc||!fonts?.regular||!fonts?.bold)throw new TypeError('PDF 布局配置无效');
  doc.registerFont('ArchiveRegular',fonts.regular,'MicrosoftYaHei');
  doc.registerFont('ArchiveBold',fonts.bold,fonts.bold===fonts.regular?'MicrosoftYaHei':'MicrosoftYaHei-Bold');
  const pageLabels=[];
  let currentLabel='旅行档案';

  const contentWidth=()=>doc.page.width-MARGINS.left-MARGINS.right;
  const bottom=()=>doc.page.height-MARGINS.bottom;
  function addPage(label=currentLabel) {
    currentLabel=label||currentLabel;
    doc.addPage({size:'A4',layout:'portrait',margins:{...MARGINS}});
    pageLabels.push(currentLabel);
    return doc.page;
  }
  function ensureSpace(height=24) {
    if(!doc.page){addPage();return true;}
    if(doc.y+Math.max(0,height)<=bottom())return false;
    addPage(currentLabel);return true;
  }
  function write(value,{font='ArchiveRegular',size=BODY_SIZE,color=PALETTE.ink,width=contentWidth(),lineGap=2,indent=0,link}={}) {
    const valueText=text(value),options={width:width-indent,lineGap};
    if(link)options.link=link;
    doc.font(font).fontSize(size);
    const height=doc.heightOfString(valueText,options);
    if(height<bottom()-MARGINS.top)ensureSpace(Math.min(height,80));
    doc.fillColor(color).text(valueText,MARGINS.left+indent,doc.y,options);
    doc.y+=6;
    return height;
  }
  function title(value,subtitle='') {
    ensureSpace(88);
    write(value,{font:'ArchiveBold',size:25,color:PALETTE.accent,lineGap:4});
    if(subtitle)write(subtitle,{size:10.5,color:PALETTE.muted});
    doc.y+=10;
  }
  function heading(value,level=2) {
    const size=level>=3?11.5:16,space=level>=3?30:42;
    ensureSpace(space);
    doc.y+=level>=3?5:10;
    write(value,{font:'ArchiveBold',size,color:level>=3?PALETTE.ink:PALETTE.accent,lineGap:2});
    if(level<3){const y=doc.y-2;doc.strokeColor(PALETTE.line).lineWidth(.8).moveTo(MARGINS.left,y).lineTo(MARGINS.left+contentWidth(),y).stroke();doc.y+=7;}
  }
  function paragraph(value,options={}) {return write(value,options);}
  function facts(items=[]) {
    const rows=Array.isArray(items)?items:[];
    if(!rows.length){paragraph('暂无相关记录',{color:PALETTE.muted});return;}
    for(const item of rows) {
      ensureSpace(24);
      const line=`${text(item.label)}：${text(item.value)}`;
      write(line,{font:'ArchiveRegular',size:10,color:PALETTE.ink,indent:8});
    }
    doc.y+=4;
  }
  function list(items=[]) {
    const rows=Array.isArray(items)?items:[];
    if(!rows.length){paragraph('暂无相关记录',{color:PALETTE.muted});return;}
    for(const item of rows)write(`• ${text(item)}`,{indent:8});
  }
  function source(item={}) {
    ensureSpace(74);
    heading(item.title||'未命名来源',3);
    if(item.summary)paragraph(item.summary,{color:PALETTE.muted});
    if(item.url)write(item.url,{size:8.5,color:PALETTE.accent,link:item.href||undefined});
    const dates=[item.publishedAt?`发布 ${item.publishedAt}`:'发布时间未知',item.retrievedAt?`检索 ${item.retrievedAt}`:''].filter(Boolean).join(' · ');
    if(dates)paragraph(dates,{size:8,color:PALETTE.muted});
  }
  function expenseTable(items=[]) {
    const rows=Array.isArray(items)?items:[];
    if(!rows.length){paragraph('暂无相关记录',{color:PALETTE.muted});return;}
    const widths=[66,58,76,72,contentWidth()-272],headers=['日期','分类','城市','金额','备注'];
    const headerHeight=25;
    function drawHeader() {
      ensureSpace(headerHeight+18);
      const y=doc.y;let x=MARGINS.left;
      doc.fillColor(PALETTE.soft).rect(x,y,contentWidth(),headerHeight).fill();
      doc.font('ArchiveBold').fontSize(8.5).fillColor(PALETTE.ink);
      headers.forEach((value,index)=>{doc.text(value,x+4,y+7,{width:widths[index]-8,lineBreak:false});x+=widths[index];});
      doc.y=y+headerHeight;
    }
    drawHeader();
    for(const item of rows) {
      const cells=[text(item.spentDate),text(item.categoryName),text(item.cityName),money(item.amountCents),text(item.note||'—')];
      doc.font('ArchiveRegular').fontSize(8.2);
      const rowHeight=Math.max(24,...cells.map((value,index)=>doc.heightOfString(value,{width:widths[index]-8,lineGap:1})+10));
      if(ensureSpace(rowHeight)){drawHeader();}
      const y=doc.y;let x=MARGINS.left;
      doc.strokeColor(PALETTE.line).lineWidth(.5).moveTo(x,y).lineTo(x+contentWidth(),y).stroke();
      doc.fillColor(PALETTE.ink).font('ArchiveRegular').fontSize(8.2);
      cells.forEach((value,index)=>{doc.text(value,x+4,y+5,{width:widths[index]-8,lineGap:1});x+=widths[index];});
      doc.y=y+rowHeight;
    }
    doc.y+=8;
  }
  function finalize() {
    const range=doc.bufferedPageRange();
    for(let offset=0;offset<range.count;offset++) {
      const index=range.start+offset;doc.switchToPage(index);
      const label=pageLabels[offset]??'旅行档案';
      doc.font('ArchiveRegular').fontSize(7.5).fillColor(PALETTE.muted).text(label,MARGINS.left,28,{width:contentWidth(),align:'left',lineBreak:false});
      doc.strokeColor(PALETTE.line).lineWidth(.6).moveTo(MARGINS.left,44).lineTo(MARGINS.left+contentWidth(),44).stroke();
      doc.font('ArchiveRegular').fontSize(8).fillColor(PALETTE.muted).text(`第 ${offset+1} 页`,MARGINS.left,doc.page.height-36,{width:contentWidth(),align:'center',lineBreak:false});
    }
  }
  return {addPage,ensureSpace,title,heading,paragraph,facts,list,source,expenseTable,finalize};
}

