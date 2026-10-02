export function el(tag,attributes={},...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)) {if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);else if(key==='class')node.className=value;else if(value!==false&&value!==null&&value!==undefined)node.setAttribute(key,String(value));}
  for(const child of children.flat(Infinity)){if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));}return node;
}
export const button=(text,action,kind='primary')=>el('button',{type:'button',class:`button ${kind}`,onClick:action},text);
export function tripCard(trip,actions) {return el('button',{class:'trip-card',type:'button',onClick:()=>actions.navigate({type:'detail',id:trip.id})},el('span',{class:`badge ${trip.status}`},trip.statusLabel),el('h3',{},trip.name),el('p',{class:'route-text'},trip.routeText),el('div',{class:'trip-meta'},el('span',{},`${trip.startDate} — ${trip.endDate}`),el('span',{},`${trip.travelerCount} 人 · ${trip.budgetText}`)));}
export function renderView(root,state,actions) {
  if(state.type==='delete-error'){const box=root.querySelector('[data-delete-error]');if(box){box.textContent=state.message;box.hidden=false;}return;}
  root.replaceChildren();document.querySelectorAll('[data-nav]').forEach(n=>n.classList.toggle('active',n.dataset.nav===(state.type==='home'?'home':'trips')));
  if(state.type==='loading'){root.append(el('p',{class:'loading',role:'status'},'正在载入行程…'));return;}
  if(state.type==='error'){root.append(el('section',{class:'empty-state'},el('h1',{},state.code==='NOT_FOUND'?'行程已不存在':'暂时无法载入'),el('p',{role:'alert'},state.message),button('重新载入',()=>actions.retry(state.route)),button('返回行程',()=>actions.navigate({type:'trips'}),'secondary')));return;}
  if(state.type==='editor'){root.append(el('p',{class:'loading'},'编辑器正在准备…'));return;}
  const home=state.type==='home';
  root.append(el('header',{class:'page-header'},el('div',{},el('p',{class:'eyebrow'},home?'TRAVEL JOURNAL':state.type==='detail'?'YOUR ITINERARY':'MY TRIPS'),el('h1',{},home?'旅行概览':state.type==='detail'?state.trip.name:'我的行程')),button('＋ 新建行程',()=>actions.navigate({type:'new'}))));
  if(home){
    const counts=state.data.counts;
    root.append(el('div',{class:'stats'},...[[counts.total,'全部行程'],[counts.upcoming,'待出发'],[counts.ongoing,'进行中'],[counts.completed,'已结束']].map(([value,label])=>el('section',{class:'stat'},el('span',{class:'stat-value'},value),el('span',{class:'stat-label'},label)))));
    root.append(el('div',{class:'section-heading'},el('h2',{},'最近一趟旅行'),button('查看全部',()=>actions.navigate({type:'trips'}),'text')));
    root.append(state.trip?tripCard(state.trip,actions):empty(actions));
    root.append(el('section',{class:'local-note'},el('span',{class:'note-symbol'},'◇'),el('div',{},el('h3',{},'属于你的旅行手账'),el('p',{},'先把时间和路线安排好。行程保存在这台电脑上，关闭网页后仍可继续。'))));
  }else if(state.type==='trips'){
    if(!state.trips.length){root.append(empty(actions));return;}
    for(const [status,label] of [['ongoing','进行中'],['upcoming','待出发'],['completed','已结束']]){const rows=state.trips.filter(t=>t.status===status);if(rows.length)root.append(el('section',{class:'trip-group'},el('h2',{},`${label} · ${rows.length}`),el('div',{class:'trip-grid'},rows.map(t=>tripCard(t,actions)))));}
  }else{
    const t=state.trip;root.append(el('section',{class:'detail-summary'},el('span',{class:`badge ${t.status}`},t.statusLabel),el('p',{class:'detail-date'},`${t.startDate} — ${t.endDate}`),el('div',{class:'detail-facts'},el('span',{},`${t.travelerCount} 人出行`),el('span',{},`预算 ${t.budgetText}`))));
    root.append(el('section',{class:'timeline-panel'},el('h2',{},'城市路线'),el('ol',{class:'timeline'},t.cities.map((city,i)=>el('li',{},el('span',{class:'city-number'},String(i+1).padStart(2,'0')),el('div',{},el('h3',{},city.cityName),el('p',{},`${city.arrivalDate} — ${city.departureDate}`),el('span',{class:'muted'},city.provinceName)))))));
    root.append(el('p',{'data-delete-error':'',class:'form-error',hidden:true,role:'alert'}),el('div',{class:'detail-actions'},button('编辑行程',()=>actions.navigate({type:'edit',id:t.id})),button('删除行程',()=>actions.deleteTrip(t),'danger'),button('返回列表',()=>actions.navigate({type:'trips'}),'secondary')));
  }
}
function empty(actions){return el('section',{class:'empty-state'},el('div',{class:'empty-symbol','aria-hidden':'true'},'＋'),el('h2',{},'还没有行程'),el('p',{},'目的地、日期、路线，从第一趟旅行开始记录。'),button('创建第一趟行程',()=>actions.navigate({type:'new'})));}
