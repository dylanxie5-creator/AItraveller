import {button,el,pageHeader} from './ui-elements.mjs';

function downloadAction(text,href) {
  return el('div',{class:'pdf-download-action','data-pdf-download-scope':''},
    el('a',{class:'button secondary',href,'data-pdf-download':'','aria-label':text},text),
    el('p',{class:'pdf-download-status','data-pdf-download-status':'',role:'status','aria-live':'polite'},'准备下载'),
    el('p',{class:'form-error','data-pdf-download-error':'',role:'alert',hidden:true}));
}

export function renderArchiveView(root,state,actions) {
  root.replaceChildren();
  if(state.type==='archive-loading'){root.append(el('p',{class:'loading',role:'status'},'正在整理旅行档案…'));return;}
  if(state.type==='archive-error'){root.append(el('section',{class:'empty-state'},el('h1',{},'暂时无法载入档案'),el('p',{role:'alert'},state.message),button('重新载入',()=>actions.retry(state.route))));return;}
  if(state.type==='archive-empty'){root.append(el('section',{class:'empty-state'},el('h1',{},'还没有可收录的行程'),el('p',{},`截至 ${state.report.cutoffDate}，只有已经结束的行程会进入旅行档案。`)));return;}
  const report=state.report;
  root.append(pageHeader({eyebrow:'TRAVEL ARCHIVE',title:'旅行档案'}),el('section',{class:'archive-intro archive-yearbook-cover journal-section'},
    el('img',{class:'travel-wash',src:'/web/travel-wash.png',alt:'','aria-hidden':'true'}),
    el('div',{},el('p',{class:'eyebrow'},'PRIVATE TRAVEL YEARBOOK'),el('h2',{},`${report.summary.tripCount} 趟已结束行程`),el('p',{},`收录截止 ${report.cutoffDate}，每次点击都会按当前路线、攻略、花销与足迹即时生成，不保存导出历史。`),downloadAction('下载旅行总档案 PDF','/api/archive.pdf'))));
}
