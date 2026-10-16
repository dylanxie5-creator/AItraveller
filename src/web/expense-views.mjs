import {formatCents} from '../shared/money.mjs';

function el(tag,attributes={},...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)){if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);else if(key==='class')node.className=value;else if(value!==false&&value!==null&&value!==undefined)node.setAttribute(key,String(value));}
  for(const child of children.flat(Infinity))if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
const button=(text,action,kind='primary')=>el('button',{type:'button',class:`button ${kind}`,onClick:action},text);
const money=cents=>`¥${formatCents(cents)}`;

function expenseRow(item,actions={}) {
  const note=item.note?el('p',{class:'expense-note'},item.note):null;
  return el('article',{class:'expense-row'},el('div',{class:'expense-row-main'},el('strong',{},money(item.amountCents)),el('span',{class:'expense-category'},item.categoryName),el('span',{class:`expense-city ${item.cityState==='removed'?'removed':''}`},item.cityState==='removed'?`${item.cityName}（已移出路线）`:item.cityName)),el('time',{datetime:item.spentDate},item.spentDate),note,actions.navigate?el('div',{class:'expense-row-actions'},button('编辑',()=>actions.navigate({type:'expense-edit',id:item.tripId??actions.tripId,expenseId:item.id}),'secondary'),button('删除',()=>actions.deleteExpense(item),'danger')):null);
}

export function renderHomeExpenseCard(overview,actions) {
  return el('section',{class:'home-expense-card'},el('div',{},el('p',{class:'eyebrow'},'TRIP EXPENSES'),el('h2',{},'旅行花销'),el('p',{},overview?.hasExpenses?'所有行程已记录花销':'尚无记录')),el('strong',{class:'home-expense-total'},overview?.hasExpenses?money(overview.totalCents):'—'),overview?.hasExpenses?button('从行程查看明细',()=>actions.navigate({type:'trips'}),'secondary'):null);
}

export function renderTripExpenseCard(overview,actions) {
  const {summary}=overview;
  const budget=summary.budgetState==='unset'?'未设置预算':summary.budgetState==='over'?`${money(summary.budgetRemainingCents)} · 已超预算`: `剩余 ${money(summary.budgetRemainingCents)}`;
  return el('section',{class:'trip-expense-card'},el('div',{class:'section-heading'},el('div',{},el('p',{class:'eyebrow'},'EXPENSES'),el('h2',{},'这趟行程的花销')),button(summary.hasExpenses?'查看全部':'记录第一笔',()=>actions.navigate({type:summary.hasExpenses?'expenses':'expense-new',id:overview.trip.id}),summary.hasExpenses?'secondary':'primary')),el('div',{class:'expense-card-facts'},el('div',{},el('span',{},'累计'),el('strong',{},summary.hasExpenses?money(summary.totalCents):'—')),el('div',{},el('span',{},'预算状态'),el('strong',{class:summary.budgetState==='over'?'over-budget':''},summary.hasExpenses||summary.budgetState!=='unset'?budget:'未设置预算'))),summary.hasExpenses?el('div',{class:'recent-expenses'},summary.recentExpenses.map(item=>expenseRow(item))):el('p',{class:'muted'},'尚无记录。金额、分类、城市和日期会保存在这趟行程中。'));
}

function header(title,tripId,actions) {return el('header',{class:'page-header'},el('div',{},el('p',{class:'eyebrow'},'TRIP EXPENSES'),el('h1',{},title)),el('div',{class:'header-actions'},button('返回行程',()=>actions.navigate({type:'detail',id:tripId}),'secondary')));}

function renderOverview(root,state,actions) {
  const {trip,summary,expenses}=state.overview,budget=summary.budgetState==='unset'?'未设置预算':summary.budgetState==='over'?`${money(summary.budgetRemainingCents)} · 已超预算`:`剩余 ${money(summary.budgetRemainingCents)}`;
  root.append(header(`${trip.name} · 花销`,trip.id,actions),el('div',{class:'expense-toolbar'},button('＋ 记录花销',()=>actions.navigate({type:'expense-new',id:trip.id})),button('管理分类',()=>actions.navigate({type:'expense-categories',id:trip.id}),'secondary')));
  const layout=el('div',{class:'expense-layout'});
  layout.append(
    el('section',{'data-expense-section':'summary',class:'expense-section expense-summary'},el('h2',{},'总览'),el('div',{class:'expense-summary-grid'},el('div',{},el('span',{},'累计花销'),el('strong',{},summary.hasExpenses?money(summary.totalCents):'—')),el('div',{},el('span',{},'预算'),el('strong',{},summary.budgetCents===null?'未设置预算':money(summary.budgetCents))),el('div',{},el('span',{},'预算余额'),el('strong',{class:summary.budgetState==='over'?'over-budget':''},summary.hasExpenses||summary.budgetCents!==null?budget:'—'))),!summary.hasExpenses?el('p',{class:'muted'},'尚无记录'):null),
    el('section',{'data-expense-section':'category',class:'expense-section'},el('h2',{},'按分类'),summary.byCategory.length?el('ul',{class:'expense-breakdown'},summary.byCategory.map(item=>el('li',{},el('span',{},`${item.name} · ${item.count} 笔`),el('strong',{},money(item.totalCents))))):el('p',{class:'muted'},'尚无记录')),
    el('section',{'data-expense-section':'city',class:'expense-section'},el('h2',{},'按城市'),summary.byCity.length?el('ul',{class:'expense-breakdown'},summary.byCity.map(item=>el('li',{},el('span',{},item.cityState==='removed'?`${item.cityName}（已移出路线）`:item.cityName),el('strong',{},money(item.totalCents))))):el('p',{class:'muted'},'尚无记录')),
    el('section',{'data-expense-section':'records',class:'expense-section expense-records'},el('h2',{},'全部记录'),expenses.length?el('div',{class:'expense-list'},expenses.map(item=>expenseRow(item,{...actions,tripId:trip.id}))):el('p',{class:'muted'},'尚无记录'))
  );root.append(layout);
}

export function renderExpenseForm(root,state,controller) {
  const edit=state.route.type==='expense-edit',values=state.values,errors=state.errors;
  root.append(header(edit?'编辑花销':'记录花销',state.trip.id,{navigate:route=>location.hash=route.type==='detail'?`/trips/${route.id}`:`/trips/${state.trip.id}/expenses`}),el('section',{class:'form-panel expense-form'},el('h2',{},edit?'修改这笔记录':'这一笔花在哪里？')));
  const panel=root.children[root.children.length-1];
  function field(label,key,control) {const errorId=`expense-error-${key}`;control.setAttribute('id',`expense-${key}`);control.setAttribute('aria-describedby',errorId);control.setAttribute('aria-invalid',Boolean(errors[key]));return el('div',{class:'field'},el('label',{for:`expense-${key}`},label),control,el('span',{id:errorId,class:'field-error',role:'alert',hidden:!errors[key]},errors[key]??''));}
  const input=(key,type='text',extra={})=>el('input',{type,value:values[key]??'',...extra,disabled:state.busy,onInput:event=>controller.setField(key,event.target.value)});
  const category=el('select',{disabled:state.busy,onChange:event=>controller.setField('categoryId',event.target.value)},state.categories.map(item=>el('option',{value:item.id,selected:item.id===values.categoryId},item.name)));
  const city=el('select',{disabled:state.busy,onChange:event=>controller.setField('cityCode',event.target.value||null)},state.cityOptions.map(item=>el('option',{value:item.value??'',selected:item.value===values.cityCode},item.label)));
  const note=el('textarea',{maxlength:'200',disabled:state.busy,onInput:event=>controller.setField('note',event.target.value)},values.note);
  panel.append(field('金额（元）','amountYuan',input('amountYuan','text',{inputmode:'decimal',placeholder:'例如：88.50'})),el('div',{class:'form-grid'},field('分类','categoryId',category),field('城市','cityCode',city)),field('日期','spentDate',input('spentDate','date',{min:state.trip.startDate,max:state.trip.endDate})),field('备注（可选，最多 200 字）','note',note));
  root.append(el('p',{class:'form-error',role:'alert',hidden:!state.error},state.error),el('div',{class:'form-actions'},button('取消',()=>location.hash=`/trips/${state.trip.id}/expenses`,'secondary'),button(state.busy?'正在保存…':'保存花销',()=>controller.save())));
  if(['amountYuan','categoryId','cityCode','spentDate','note'].includes(state.firstError))panel.querySelector(`#expense-${state.firstError}`)?.focus();
}

function renderCategories(root,state,actions) {
  root.append(header(`${state.trip.name} · 分类`,state.trip.id,actions));
  const add=el('input',{id:'new-expense-category',maxlength:'20',placeholder:'例如：咖啡茶饮'});
  root.append(el('section',{class:'expense-section category-manager'},el('h2',{},'新增自定义分类'),el('div',{class:'inline-category-form'},el('label',{for:'new-expense-category'},'分类名称'),add,button('新增',()=>actions.saveCategory({tripId:state.trip.id,expectedRevision:0,name:add.value})))),el('p',{class:'form-error',role:'alert',hidden:!state.error},state.error));
  const list=el('section',{class:'expense-section category-manager'},el('h2',{},'当前分类'));
  for(const category of state.categories){const row=el('div',{class:'category-row'},el('div',{},el('strong',{},category.name),el('span',{class:'muted'},category.inUse?`${category.usageCount} 笔正在使用`:'尚未使用')));if(category.kind==='custom'){const name=el('input',{value:category.name,'aria-label':`重命名${category.name}`});row.append(name,button('保存名称',()=>actions.saveCategory({tripId:state.trip.id,id:category.id,expectedRevision:category.revision,name:name.value}),'secondary'),button('删除',()=>actions.deleteCategory({...category,tripId:state.trip.id}),'danger'));}else row.append(el('span',{class:'badge'},'默认'));list.append(row);}root.append(list);
}

export function renderExpenseView(root,state,actions) {
  root.replaceChildren();
  if(state.type==='expense-loading'){root.append(el('p',{class:'loading',role:'status'},'正在载入花销…'));return;}
  if(state.type==='expense-error'){root.append(el('section',{class:'empty-state'},el('h1',{},'暂时无法载入'),el('p',{role:'alert'},state.error),button('重新载入',()=>actions.retry(state.route))));return;}
  if(state.type==='expenses'){renderOverview(root,state,actions);return;}
  if(state.type==='expense-form'){renderExpenseForm(root,state,actions.controller);return;}
  if(state.type==='expense-categories')renderCategories(root,state,actions);
}
