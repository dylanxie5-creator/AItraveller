import {actionGroup,button,el,pageHeader,statusBadge} from './ui-elements.mjs';

export const providers=Object.freeze({
  deepseek:{name:'DeepSeek',model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions'},
  zhipu:{name:'智谱',model:'glm-4.7',endpoint:'https://open.bigmodel.cn/api/paas/v4/chat/completions'},
  mimo:{name:'小米 MiMo',model:'mimo-v2.6-flash',endpoint:'https://api.xiaomimimo.com/v1/chat/completions'},
  kimi:{name:'Kimi',model:'kimi-k2.6',endpoint:'https://api.moonshot.cn/v1/chat/completions'},
  qwen:{name:'通义千问',model:'qwen3.6-plus',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'}
});
export const defaultKeyAction=keyConfigured=>keyConfigured?'retain':'delete';
export const defaultSearchKeyAction=search=>search.keyMode==='zhipu'?'retain':defaultKeyAction(search.keyConfigured);
const aiFields=new Set(['name','startDate','endDate','travelerCount','budgetYuan','cityCodes','preferences','provider']);
export function firstAiField(fields={}){return Object.keys(fields).find(key=>aiFields.has(key))??null;}
export function safeSourceUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
export function buildSettingsCommand(current,raw) {
  const result={expectedRevision:current.revision,providers:{},search:{keyMode:raw.search.keyMode,keyAction:raw.search.keyAction}};
  for(const [id,value] of Object.entries(raw)) {
    if(id==='search')continue;
    if(!Object.hasOwn(providers,id))continue;
    const row={model:value.model.trim(),endpoint:value.endpoint.trim(),keyAction:value.keyAction};
    if(row.keyAction==='replace'){if(!value.apiKey)throw new Error(`${providers[id].name}：请输入新的 API Key`);row.apiKey=value.apiKey;}
    result.providers[id]=row;
  }
  if(result.search.keyAction==='replace'){if(!raw.search.apiKey)throw new Error('智谱搜索：请输入新的 API Key');result.search.apiKey=raw.search.apiKey;}
  return result;
}
const heading=(eyebrow,title,action)=>pageHeader({eyebrow,title,secondaryActions:action?[action]:[]});
const field=(label,input)=>el('div',{class:'field'},el('label',{for:input.id},label),input);
const inputNode=(id,value,attributes={})=>el('input',{id,value:value??'',...attributes});
function statusText(job){return {queued:'等待开始',searching:'正在检索资料',generating:'正在生成攻略',succeeded:'攻略已保存',failed:'生成失败',interrupted:'上次运行已中断'}[job.state]??'任务状态未知';}

export function renderAiView(root,state,actions) {
  root.replaceChildren();
  if(state.type==='ai-loading'){root.append(el('p',{class:'loading',role:'status'},'正在载入 AI 规划…'));return;}
  if(state.type==='ai-error'){root.append(el('section',{class:'empty-state'},el('h1',{},'暂时无法载入'),el('p',{role:'alert'},state.message),button('重试',()=>actions.retry(state.route)),button('返回攻略',()=>actions.navigate({type:'ai-plans'}),'secondary')));return;}
  if(state.type==='ai-settings'){renderSettings(root,state,actions);return;}
  if(state.type==='ai-new'){renderPlanner(root,state,actions);return;}
  if(state.type==='ai-job'){renderJob(root,state,actions);return;}
  if(state.type==='ai-plans'){renderPlans(root,state,actions);return;}
  if(state.type==='ai-plan'){renderPlan(root,state.plan,actions);return;}
}
function renderSettings(root,state,actions) {
  const form=el('form',{class:'form-panel ai-settings',onSubmit:async event=>{
    event.preventDefault();const data=new FormData(form),raw={};
    for(const id of Object.keys(providers))raw[id]={model:data.get(`${id}-model`),endpoint:data.get(`${id}-endpoint`),keyAction:data.get(`${id}-key-action`),apiKey:data.get(`${id}-key`)};
    raw.search={keyMode:data.get('search-mode'),keyAction:data.get('search-key-action'),apiKey:data.get('search-key')};
    try{await actions.saveSettings(buildSettingsCommand(state.settings,raw));}catch(error){notice.textContent=error.message;notice.hidden=false;}
    form.querySelectorAll('input[type=password]').forEach(node=>{node.value='';});
  }});
  const notice=el('p',{class:'form-error',role:'alert',hidden:!state.error},state.error??'');
  root.append(heading('LOCAL AI SETTINGS','模型与搜索设置'),el('p',{class:'privacy-note'},'Key 仅提交到本机服务，以 Windows 当前用户加密保存；页面永不回填。'));
  for(const [id,meta] of Object.entries(providers)) {
    const value=state.settings.providers[id],action=defaultKeyAction(value.keyConfigured);
    form.append(el('fieldset',{class:'provider-card'},el('legend',{},meta.name),
      field('模型名称',inputNode(`${id}-model`,value.model||meta.model,{name:`${id}-model`,required:true})),
      field('官方接口地址',inputNode(`${id}-endpoint`,value.endpoint||meta.endpoint,{name:`${id}-endpoint`,required:true})),
      field(value.keyConfigured?'API Key（已配置；留空不会读取或显示）':'API Key',inputNode(`${id}-key`,'',{name:`${id}-key`,type:'password',autocomplete:'new-password'})),
      el('div',{class:'key-actions'},...[['retain','保留'],['replace','替换'],['delete','明确删除']].map(([key,label])=>el('label',{},el('input',{type:'radio',name:`${id}-key-action`,value:key,checked:action===key,disabled:key==='retain'&&!value.keyConfigured}),label)))));
  }
  form.append(el('fieldset',{class:'provider-card'},el('legend',{},'联网检索'),
    el('label',{},el('input',{type:'radio',name:'search-mode',value:'zhipu',checked:state.settings.search.keyMode==='zhipu'}),'复用智谱模型 Key'),
    el('label',{},el('input',{type:'radio',name:'search-mode',value:'separate',checked:state.settings.search.keyMode==='separate'}),'使用独立智谱搜索 Key'),
    field('独立搜索 Key',inputNode('search-key','',{name:'search-key',type:'password',autocomplete:'new-password'})),
    el('div',{class:'key-actions'},...[['retain','保留'],['replace','替换'],['delete','明确删除']].map(([key,label])=>el('label',{},el('input',{type:'radio',name:'search-key-action',value:key,checked:defaultSearchKeyAction(state.settings.search)===key,disabled:key==='retain'&&state.settings.search.keyMode==='separate'&&!state.settings.search.keyConfigured}),label)))));
  const save=button(state.busy?'正在保存…':'保存设置',()=>{},'primary',{'aria-busy':state.busy?'true':null,'data-state':state.busy?'busy':'ready',disabled:state.busy});
  form.append(notice,actionGroup(save));save.type='submit';
  if(state.saved)form.prepend(el('p',{class:'success-note',role:'status'},'设置已保存，Key 输入框已清空。'));
  root.append(form);
}
function renderPlanner(root,state,actions) {
  const configured=Object.entries(state.settings.providers).filter(([,v])=>v.keyConfigured&&v.model&&v.endpoint);
  const data=state.input;
  const form=el('form',{class:'form-panel',onSubmit:event=>{
    event.preventDefault();const values=new FormData(form),cities=String(values.get('cityCodes')??'').split(/[，,\s]+/u).map(v=>v.trim()).filter(Boolean);
    actions.submit({settingsRevision:state.settings.revision,provider:values.get('provider'),input:{name:values.get('name'),startDate:values.get('startDate'),endDate:values.get('endDate'),travelerCount:Number(values.get('travelerCount')),budgetYuan:values.get('budgetYuan'),cityCodes:cities,preferences:values.get('preferences')}});
  }});
  root.append(heading('AI TRAVEL PLANNER','生成一份有来源的旅行攻略',button('查看已保存攻略',()=>actions.navigate({type:'ai-plans'}),'secondary')),
    el('section',{class:'cost-notice'},el('strong',{},'发起后会连接你选择的平台'),el('p',{},'最多按目的地发起 3 次智谱联网检索，并发起 1 次所选模型请求。失败不会自动重试或追加调用。')));
  const add=(label,name,type='text',extra={})=>form.append(field(label,inputNode(name,data[name]??'',{name,type,required:extra.required??true,...extra})));
  add('行程名称','name');form.append(el('div',{class:'form-grid'},field('开始日期',inputNode('startDate',data.startDate,{name:'startDate',type:'date',required:true})),field('结束日期',inputNode('endDate',data.endDate,{name:'endDate',type:'date',required:true}))));
  form.append(el('div',{class:'form-grid'},field('人数',inputNode('travelerCount',data.travelerCount,{name:'travelerCount',type:'number',min:1,required:true})),field('预算（元，可选）',inputNode('budgetYuan',data.budgetYuan,{name:'budgetYuan',inputmode:'decimal'}))));
  add('城市代码（1–3 个，用逗号分隔，如 320100,320500）','cityCodes','text',{value:data.cityCodes.join(',')});
  const cityInput=form.querySelector('#cityCodes');cityInput.value=data.cityCodes.join(',');
  form.append(field('偏好（可选）',el('textarea',{id:'preferences',name:'preferences',maxlength:1000},data.preferences??'')),
    field('模型平台',el('select',{id:'provider',name:'provider',required:true},configured.length?configured.map(([id,v])=>el('option',{value:id},`${providers[id].name} · ${v.model}`)):el('option',{value:''},'请先配置模型和 Key'))));
  if(state.error)form.append(el('p',{class:'form-error',role:'alert'},state.error));
  const retry=state.uncertain?button('按同一请求编号重试',()=>actions.retrySubmit(),'secondary'):null;
  const submit=button(state.busy?'正在提交…':'确认成本并开始生成',()=>{},'primary',{'aria-busy':state.busy?'true':null,'data-state':state.busy?'busy':state.uncertain||!configured.length?'disabled':'ready'});submit.type='submit';submit.disabled=state.busy||state.uncertain||!configured.length;
  if(state.uncertain)form.querySelectorAll('input,textarea,select').forEach(control=>{control.disabled=true;});
  form.append(actionGroup(retry,submit));root.append(form);
  for(const [key,value] of Object.entries(state.fields??{})) {
    if(!aiFields.has(key))continue;const control=form.querySelector(`#${key}`);if(!control)continue;
    control.setAttribute('aria-invalid','true');control.parentElement?.append(el('span',{class:'field-error',role:'alert'},value));
  }
  const first=firstAiField(state.fields);if(first)form.querySelector(`#${first}`)?.focus();
}
function renderJob(root,state,actions) {
  const job=state.job;root.append(heading('AI PLANNING JOB','规划任务'),el('section',{class:'job-card'},statusBadge(statusText(job),job.state),el('h2',{},job.input?.name??'旅行攻略'),el('p',{},`已预留：检索 ${job.searchCalls}/3 次 · 模型 ${job.modelCalls}/1 次`),
    job.error?el('p',{class:'form-error',role:'alert'},job.error.message):[],
    actionGroup(job.state==='succeeded'?button('查看攻略',()=>actions.navigate({type:'ai-plan',id:job.planId})):null,
      ['failed','interrupted'].includes(job.state)?button('基于保留输入新生成',()=>actions.reuseJob(job),'secondary'):null)));
}
function renderPlans(root,state,actions) {
  root.append(heading('SAVED AI GUIDES','我的 AI 攻略',button('＋ 新建 AI 规划',()=>actions.navigate({type:'ai-new'}))));
  if(!state.plans.length){root.append(el('section',{class:'empty-state'},el('h2',{},'还没有 AI 攻略'),el('p',{},'这里不会展示示例或伪造结果。完成一次规划后，攻略会保存在本机。')));return;}
  root.append(el('div',{class:'trip-grid'},state.plans.map(plan=>el('button',{type:'button',class:'trip-card',onClick:()=>actions.navigate({type:'ai-plan',id:plan.id})},el('span',{class:'badge'},plan.edited?'已编辑':'模型原稿'),el('h3',{},plan.content.trip.name),el('p',{},`${plan.content.trip.startDate} — ${plan.content.trip.endDate}`),el('span',{class:'muted'},`${providers[plan.provider]?.name??plan.provider} · ${plan.model}`)))));
}
export function renderPlan(root,plan,actions,{editing=false}={}) {
  root.append(heading('SAVED AI GUIDE',plan.content.trip.name,actionGroup(editing?null:button('手工编辑',()=>actions.navigate({type:'ai-plan-edit',id:plan.id}),'secondary'),button('创建正式行程',()=>actions.convert(plan)))));
  if(plan.conversion)root.append(el('p',{class:plan.conversion.status==='deleted'?'form-error':'success-note'},plan.conversion.status==='deleted'?'由此攻略创建的行程已删除；冻结快照仍保留。':'已创建正式行程；后续编辑攻略不会覆盖该行程快照。'));
  for(const day of plan.content.days) {
    const activities=day.activities.map(item=>el('article',{class:'activity'},
      el('h3',{},item.title),el('p',{},item.description),el('span',{class:'source-refs'},item.sourceIds.join('、'))));
    root.append(el('section',{class:'day-card'},el('h2',{},day.date),activities));
  }
  if(plan.content.cautions.length)root.append(el('section',{class:'caution-card'},el('h2',{},'出行提醒'),el('ul',{},plan.content.cautions.map(value=>el('li',{},value)))));
  root.append(el('section',{class:'sources'},el('h2',{},'检索资料（仅保存搜索摘要，未阅读全文）'),...plan.sources.map(source=>{const url=safeSourceUrl(source.url);return el('article',{},el('h3',{},source.title),el('p',{},source.summary),url?el('a',{href:url,target:'_blank',rel:'noopener noreferrer'},'打开来源'):el('span',{class:'muted'},'来源地址不可安全打开'));})));
}
