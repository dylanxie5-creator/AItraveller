import {el,button} from './views.mjs';
const clone=value=>structuredClone(value);
const errorMessage=error=>error?.message??'保存失败，请重试';
export function createAiPlanEditor({api,plan,render,navigate,confirm=()=>false}) {
  let disposed=false,current=clone(plan),content=clone(plan.content),dirty=false,busy=false,error='',fields={};
  const snapshot=()=>clone({plan:current,content,dirty,busy,error,fields});
  const show=options=>{if(!disposed)render(snapshot(),options);};
  function change(path,value) {
    const parts=Array.isArray(path)?path:String(path).split('.');
    let target=content;
    for(let i=0;i<parts.length-1;i++){if(target?.[parts[i]]===undefined)return;target=target[parts[i]];}
    target[parts.at(-1)]=clone(value);dirty=true;error='';fields={};show();
  }
  async function save() {
    if(busy||!dirty)return current;busy=true;show();
    try {current=await api.updateAiPlan(current.id,{expectedRevision:current.revision,content:clone(content)});content=clone(current.content);dirty=false;error='';fields={};return current;}
    catch(failure){error=errorMessage(failure);fields=failure?.fields??{};return null;}
    finally{busy=false;show({focusField:Object.keys(fields)[0]});}
  }
  async function leave() {return !dirty||await confirm('攻略还有未保存的修改，确定离开并放弃这些修改吗？');}
  function dispose(){disposed=true;}
  return {change,save,leave,snapshot,dispose,navigate};
}

const input=(value,onInput,attributes={})=>el('input',{value,...attributes,onInput:event=>onInput(event.target.value)});
export const editorFieldId=(dayIndex,activityIndex,field)=>`day-${dayIndex}-activity-${activityIndex}-${field}`;
export function renderAiEditor(root,state,actions,{focusField}={}) {
  root.replaceChildren();
  root.append(el('header',{class:'page-header'},el('div',{},el('p',{class:'eyebrow'},'MANUAL GUIDE EDITOR'),el('h1',{},'手工编辑攻略')),el('span',{class:'save-status'},state.dirty?'有未保存修改':'已保存')));
  if(state.error)root.append(el('p',{class:'form-error',role:'alert'},state.error));
  const content=state.content;
  content.days.forEach((day,dayIndex)=>{
    const card=el('section',{class:'day-card'},el('h2',{},day.date));
    day.activities.forEach((activity,activityIndex)=>{
      const base=['days',dayIndex,'activities',activityIndex];
      const titleId=editorFieldId(dayIndex,activityIndex,'title'),descriptionId=editorFieldId(dayIndex,activityIndex,'description');
      const row=el('article',{class:'activity-editor'},
        el('div',{class:'field'},el('label',{for:titleId},'活动标题'),input(activity.title,value=>actions.change([...base,'title'],value),{id:titleId,'data-editor-field':`day_${dayIndex}`,maxlength:80})),
        el('div',{class:'field'},el('label',{for:descriptionId},'活动说明'),el('textarea',{id:descriptionId,maxlength:150,onInput:event=>actions.change([...base,'description'],event.target.value)},activity.description)),
        el('fieldset',{class:'source-picker'},el('legend',{},'引用来源编号'),...state.plan.sources.map(source=>el('label',{},el('input',{type:'checkbox',checked:activity.sourceIds.includes(source.sourceId),onChange:event=>{
          const next=event.target.checked?[...activity.sourceIds,source.sourceId]:activity.sourceIds.filter(id=>id!==source.sourceId);actions.change([...base,'sourceIds'],next);
        }}),`${source.sourceId} · ${source.title}`))),
        button('删除活动',()=>{if(day.activities.length>1)actions.change(['days',dayIndex,'activities'],day.activities.filter((_,i)=>i!==activityIndex));},'text'));
      row.querySelector('button').disabled=day.activities.length<=1;card.append(row);
    });
    const add=button('＋ 添加活动',()=>{if(day.activities.length<5)actions.change(['days',dayIndex,'activities'],[...day.activities,{cityCode:day.activities.at(-1).cityCode,title:'新活动',description:'',sourceIds:[]}]);},'secondary');
    add.disabled=day.activities.length>=5;card.append(add);root.append(card);
  });
  root.append(el('section',{class:'form-panel'},el('h2',{},'出行提醒'),el('label',{for:'editor-cautions',class:'field-hint'},'每行一条提醒'),el('textarea',{id:'editor-cautions',class:'wide-textarea',onInput:event=>actions.change(['cautions'],event.target.value.split('\n').map(value=>value.trim()).filter(Boolean)),maxlength:2000},content.cautions.join('\n'))));
  root.append(el('details',{class:'snapshot-panel'},el('summary',{},'查看模型原始快照（只读）'),el('pre',{},JSON.stringify(state.plan.original,null,2))),
    el('details',{class:'snapshot-panel'},el('summary',{},'查看检索资料（只读）'),el('ul',{},state.plan.sources.map(source=>el('li',{},`${source.sourceId} · ${source.title}`)))));
  root.append(el('div',{class:'form-actions'},button('返回攻略',()=>actions.navigate({type:'ai-plan',id:state.plan.id}),'secondary'),button(state.busy?'正在保存…':'保存手工修改',()=>actions.save())));
  if(focusField)root.querySelector(`[data-editor-field="${CSS.escape(focusField)}"]`)?.focus();
}
