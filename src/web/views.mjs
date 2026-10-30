import {renderHomeExpenseCard,renderTripExpenseCard} from './expense-views.mjs';
import {el,button} from './ui-elements.mjs';
export {el,button} from './ui-elements.mjs';
export function homeFootprintSummary(data) {const value=data?.footprints??{};const provinceCount=Number.isSafeInteger(value.provinceCount)?value.provinceCount:0,cityCount=Number.isSafeInteger(value.cityCount)?value.cityCount:0,visitCount=Number.isSafeInteger(value.visitCount)?value.visitCount:0;return {provinceCount,cityCount,visitCount,empty:visitCount===0,route:{type:'footprints'}};}
export function tripCard(trip,actions) {return el('button',{class:'trip-card',type:'button',onClick:()=>actions.navigate({type:'detail',id:trip.id})},el('span',{class:`badge ${trip.status}`},trip.statusLabel),el('h3',{},trip.name),el('p',{class:'route-text'},trip.routeText),el('div',{class:'trip-meta'},el('span',{},`${trip.startDate} — ${trip.endDate}`),el('span',{},`${trip.travelerCount} 人 · ${trip.budgetText}`)));}
export function renderView(root,state,actions) {
  if(state.type==='delete-error'){const box=root.querySelector('[data-delete-error]');if(box){box.textContent=state.message;box.hidden=false;}return;}
  root.replaceChildren();
  if(state.type==='loading'){root.append(el('p',{class:'loading',role:'status'},'正在载入行程…'));return;}
  if(state.type==='error'){root.append(el('section',{class:'empty-state'},el('h1',{},state.code==='NOT_FOUND'?'行程已不存在':'暂时无法载入'),el('p',{role:'alert'},state.message),button('重新载入',()=>actions.retry(state.route)),button('返回行程',()=>actions.navigate({type:'trips'}),'secondary')));return;}
  if(state.type==='editor'){root.append(el('p',{class:'loading'},'编辑器正在准备…'));return;}
  const home=state.type==='home';
  root.append(el('header',{class:'page-header'},el('div',{},el('p',{class:'eyebrow'},home?'TRAVEL JOURNAL':state.type==='detail'?'YOUR ITINERARY':'MY TRIPS'),el('h1',{},home?'旅行概览':state.type==='detail'?state.trip.name:'我的行程')),button('＋ 新建行程',()=>actions.navigate({type:'new'}))));
  if(home){
    const counts=state.data.counts;
    root.append(el('div',{class:'stats'},...[[counts.total,'全部行程'],[counts.upcoming,'待出发'],[counts.ongoing,'进行中'],[counts.completed,'已结束']].map(([value,label])=>el('section',{class:'stat'},el('span',{class:'stat-value'},value),el('span',{class:'stat-label'},label)))));
    root.append(renderHomeExpenseCard(state.data.expenses,actions));
    const footprints=homeFootprintSummary(state.data);
    root.append(el('section',{class:'home-footprint-card'},el('div',{},el('p',{class:'eyebrow'},'CHINA FOOTPRINTS'),el('h2',{},footprints.empty?'还没有点亮城市':'你的中国足迹'),el('p',{},footprints.empty?'完成行程或手动补录后，这里会点亮你的旅行地图。':`${footprints.provinceCount} 个省级地区 · ${footprints.cityCount} 座城市 · ${footprints.visitCount} 次到访`)),button(footprints.empty?'去记录第一处足迹':'查看足迹地图',()=>actions.navigate(footprints.route),'secondary')));
    root.append(el('div',{class:'section-heading'},el('h2',{},'最近一趟旅行'),button('查看全部',()=>actions.navigate({type:'trips'}),'text')));
    root.append(state.trip?tripCard(state.trip,actions):empty(actions));
    root.append(el('section',{class:'local-note'},el('span',{class:'note-symbol'},'◇'),el('div',{},el('h3',{},'属于你的旅行手账'),el('p',{},'先把时间和路线安排好。行程保存在这台电脑上，关闭网页后仍可继续。'))));
  }else if(state.type==='trips'){
    if(!state.trips.length){root.append(empty(actions));return;}
    for(const [status,label] of [['ongoing','进行中'],['upcoming','待出发'],['completed','已结束']]){const rows=state.trips.filter(t=>t.status===status);if(rows.length)root.append(el('section',{class:'trip-group'},el('h2',{},`${label} · ${rows.length}`),el('div',{class:'trip-grid'},rows.map(t=>tripCard(t,actions)))));}
  }else{
    const t=state.trip;root.append(el('section',{class:'detail-summary'},el('span',{class:`badge ${t.status}`},t.statusLabel),el('p',{class:'detail-date'},`${t.startDate} — ${t.endDate}`),el('div',{class:'detail-facts'},el('span',{},`${t.travelerCount} 人出行`),el('span',{},`预算 ${t.budgetText}`))));
    root.append(el('section',{class:'timeline-panel'},el('h2',{},'城市路线'),el('ol',{class:'timeline'},t.cities.map((city,i)=>el('li',{},el('span',{class:'city-number'},String(i+1).padStart(2,'0')),el('div',{},el('h3',{},city.cityName),el('p',{},`${city.arrivalDate} — ${city.departureDate}`),el('span',{class:'muted'},city.provinceName)))))));
    root.append(renderTripExpenseCard(state.expenseOverview,actions));
    if(state.guide)root.append(el('section',{class:'guide-link'},el('div',{},el('h2',{},'由 AI 攻略创建'),el('p',{},state.guide.status==='deleted'?'正式行程已删除，转换时的冻结快照仍保留。':'正式行程保存的是转换时快照；当前攻略可继续独立编辑。')),button('查看当前原攻略',()=>actions.navigate({type:'ai-plan',id:state.guide.planId}),'secondary')));
    const archive=t.status==='completed'?el('a',{class:'button secondary',href:`#/reports/trips/${t.id}/print`,target:'_blank',rel:'noopener'},'导出行程档案'):el('p',{class:'archive-eligibility'},'行程结束后可生成档案。');
    root.append(el('p',{'data-delete-error':'',class:'form-error',hidden:true,role:'alert'}),archive,el('div',{class:'detail-actions'},button('编辑行程',()=>actions.navigate({type:'edit',id:t.id})),button('删除行程',()=>actions.deleteTrip(t),'danger'),button('返回列表',()=>actions.navigate({type:'trips'}),'secondary')));
  }
}
function empty(actions){return el('section',{class:'empty-state'},el('div',{class:'empty-symbol','aria-hidden':'true'},'＋'),el('h2',{},'还没有行程'),el('p',{},'目的地、日期、路线，从第一趟旅行开始记录。'),button('创建第一趟行程',()=>actions.navigate({type:'new'})));}

export function renderForm(root,state,controller,api,{full=true}={}) {
  const status=state.busy?'正在保存…':state.saved?'草稿已保存':state.dirty?'草稿尚未保存':'准备就绪';
  if(!full&&root.querySelector('#save-status')) {
    root.querySelector('#save-status').textContent=status;
    const error=root.querySelector('#save-error');error.textContent=state.error;error.hidden=!state.error;
    root.querySelectorAll('[data-form-control]').forEach(node=>node.disabled=state.busy||(state.hasPendingSave&&node.dataset.pendingAction!=='save'));
    root.querySelectorAll('[data-field-error]').forEach(node=>{const text=state.errors[node.dataset.fieldError]??'';node.textContent=text;node.hidden=!text;});
    return;
  }
  root.replaceChildren();const steps=['basic','route','confirm'];
  root.append(el('header',{class:'page-header'},el('div',{},el('p',{class:'eyebrow'},'PLAN YOUR JOURNEY'),el('h1',{},state.baseTripRevision?'编辑行程':'新建行程')),el('span',{id:'save-status',class:'save-status',role:'status'},status)));
  root.append(el('ol',{class:'steps','aria-label':'行程创建步骤'},...['基本信息','城市路线','确认保存'].map((label,i)=>el('li',{class:steps.indexOf(state.step)>=i?'current':'','aria-current':state.step===steps[i]?'step':null},el('span',{},i+1),label))));
  const panel=el('section',{class:'form-panel'}),errors=state.errors;
  function field(label,key,value,{type='text',id=key,onInput,placeholder,min,max}={}) {
    const errorId=`error-${id}`;
    const control=el('input',{id,type,value:value??'',placeholder,min,max,step:type==='number'?'1':null,'data-form-control':'','data-error-key':key,'aria-invalid':Boolean(errors[key]),'aria-describedby':errorId,disabled:state.busy,onInput:event=>onInput(event.target.value)});
    return el('div',{class:'field'},el('label',{for:id},label),control,el('span',{id:errorId,'data-field-error':key,class:'field-error',hidden:!errors[key],role:'alert'},errors[key]??''));
  }
  const data=state.input;
  if(state.step==='basic') {
    panel.append(el('h2',{},'这趟旅行，怎么安排？'),field('行程名称','name',data.name,{placeholder:'例如：江南四日小旅行',onInput:value=>controller.change('name',value)}),el('div',{class:'form-grid'},field('开始日期','startDate',data.startDate,{type:'date',onInput:value=>controller.change('startDate',value)}),field('结束日期','endDate',data.endDate,{type:'date',onInput:value=>controller.change('endDate',value)})),el('div',{class:'form-grid'},field('出行人数','travelerCount',data.travelerCount,{type:'number',min:'1',onInput:value=>controller.change('travelerCount',value)}),field('总预算（元，可选）','budgetYuan',data.budgetYuan,{placeholder:'例如：3200.50',onInput:value=>controller.change('budgetYuan',value)})));
    panel.querySelector('#name').maxLength=100;panel.querySelector('#budgetYuan').inputMode='decimal';
  } else if(state.step==='route') {
    panel.append(el('h2',{},'把想去的城市，串成一条路线'),el('p',{class:'field-hint'},'调整城市顺序，并安排每一站的到达和离开日期。'));
    const results=el('div',{class:'search-results'}),searchStatus=el('p',{class:'field-hint',role:'status'});let searchSequence=0;
    const search=el('input',{id:'city-search',type:'search',placeholder:'搜索城市或省份','data-form-control':'',disabled:state.busy,onInput:async event=>{
      const query=event.target.value.trim(),token=++searchSequence;results.replaceChildren();searchStatus.textContent=query?'正在搜索…':'';if(!query)return;
      try{const cities=await api.cities(query);if(token!==searchSequence||!results.isConnected)return;searchStatus.textContent=cities.length?'':'没有找到城市，请换个关键词';results.append(...cities.map(city=>button(`${city.cityName} · ${city.provinceName}`,()=>controller.addCity(city),'search-result')));}catch{if(token===searchSequence&&results.isConnected)searchStatus.textContent='搜索失败，请重新输入后重试';}
    }});
    panel.append(el('div',{class:'field'},el('label',{for:'city-search'},'搜索城市'),search,searchStatus,results),el('p',{class:'field-error','data-field-error':'cities',hidden:!errors.cities},errors.cities??''));
    const basicErrors=Object.entries(errors).filter(([key])=>!key.startsWith('city_')&&key!=='cities');if(basicErrors.length)panel.append(el('p',{class:'form-error'},'基本信息需要修正，请返回上一步：'+basicErrors.map(([,value])=>value).join('；')));
    if(!data.cities.length)panel.append(el('p',{class:'route-empty'},'还未添加城市。搜索后点击结果即可加入路线。'));
    data.cities.forEach((city,index)=>{
      const up=button('上移',()=>controller.moveCity(index,index-1),'secondary');up.setAttribute('aria-label',`上移${city.cityName}`);up.disabled=state.busy||index===0;up.setAttribute('data-form-control','');
      const down=button('下移',()=>controller.moveCity(index,index+1),'secondary');down.setAttribute('aria-label',`下移${city.cityName}`);down.disabled=state.busy||index===data.cities.length-1;down.setAttribute('data-form-control','');
      const remove=button('移除',()=>controller.removeCity(index),'text');remove.setAttribute('aria-label',`移除${city.cityName}`);remove.setAttribute('data-form-control','');
      panel.append(el('section',{class:'route-city'},el('div',{class:'route-city-header'},el('h3',{},`${String(index+1).padStart(2,'0')} · ${city.cityName??city.cityCode}`),el('div',{class:'city-controls'},up,down,remove)),el('div',{class:'form-grid'},field(`${city.cityName}到达日期`,`city_${index}`,city.arrivalDate,{id:`arrival-${index}`,type:'date',min:data.startDate,max:data.endDate,onInput:value=>controller.changeCity(index,'arrivalDate',value)}),field(`${city.cityName}离开日期`,`city_${index}`,city.departureDate,{id:`departure-${index}`,type:'date',min:data.startDate,max:data.endDate,onInput:value=>controller.changeCity(index,'departureDate',value)}))));
    });
  } else {
    panel.append(el('h2',{},'出发前，再确认一次'),el('div',{class:'confirmation'},el('h3',{},data.name),el('p',{},`${data.startDate} — ${data.endDate}`),el('p',{},`${data.travelerCount} 人出行 · ${data.budgetYuan?'预算 ¥'+data.budgetYuan:'未设置预算'}`)),el('ol',{class:'confirm-route'},data.cities.map(city=>el('li',{},el('strong',{},city.cityName??city.cityCode),el('span',{},`${city.arrivalDate} — ${city.departureDate}`)))));
    if(Object.keys(errors).length)panel.append(el('p',{class:'form-error'},Object.values(errors).join('；')));
  }
  root.append(panel,el('p',{id:'save-error',class:'form-error',role:'alert',hidden:!state.error},state.error));
  const actions=el('div',{class:'form-actions'});
  const discard=button('舍弃草稿',()=>controller.discard(),'text');discard.setAttribute('data-form-control','');actions.append(discard);
  const right=el('div',{class:'step-actions'});
  if(state.step!=='basic'){const previous=button('上一步',()=>controller.previous(),'secondary');previous.setAttribute('data-form-control','');right.append(previous);}
  const next=button(state.step==='confirm'?'确认保存':'下一步',()=>state.step==='confirm'?controller.save():controller.next());next.setAttribute('data-form-control','');if(state.step==='confirm')next.setAttribute('data-pending-action','save');right.append(next);
  if(state.error){const retry=button(state.hasPendingSave?'重试保存行程':'重试保存草稿',()=>state.hasPendingSave?controller.retrySave():controller.retryDraft(),'secondary');retry.setAttribute('data-form-control','');if(state.hasPendingSave)retry.setAttribute('data-pending-action','save');right.append(retry);}
  actions.append(right);root.append(actions);root.querySelectorAll('[data-form-control]').forEach(node=>{if(state.busy||(state.hasPendingSave&&node.dataset.pendingAction!=='save'))node.disabled=true;});
  const first=Object.keys(errors)[0];if(first)root.querySelector(`[data-error-key="${first}"]`)?.focus();
}
