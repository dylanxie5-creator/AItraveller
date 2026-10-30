export function el(tag,attributes={},...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)) {
    if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='class')node.className=String(value);
    else if(value!==false&&value!==null&&value!==undefined)node.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity)) {
    if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name,{label=null,className=''}={}) {
  const attributes={class:`icon${className?` ${className}`:''}`,focusable:'false'};
  if(label){attributes.role='img';attributes['aria-label']=label;}
  else attributes['aria-hidden']='true';
  return el('svg',attributes,el('use',{href:`/web/icons.svg#${name}`}));
}

export function button(text,action,kind='primary',attributes={}) {
  const extraClass=attributes.class?` ${attributes.class}`:'';
  const state=attributes['data-state']??(attributes['aria-busy']===true||attributes['aria-busy']==='true'?'busy':attributes.disabled?'disabled':kind==='danger'?'destructive':'ready');
  return el('button',{...attributes,type:'button',class:`button ${kind}${extraClass}`,'data-state':state,onClick:action},text);
}

export function pageHeader({eyebrow,title,primaryAction=null,secondaryActions=[]}) {
  const heading=el('div',{class:'page-heading'},eyebrow?el('p',{class:'eyebrow'},eyebrow):null,el('h1',{},title));
  const actions=[...secondaryActions,primaryAction].filter(Boolean);
  return el('header',{class:'page-header'},heading,actions.length?el('div',{class:'header-actions'},actions):null);
}

export function statusBadge(text,tone='neutral') {
  return el('span',{class:`badge status-badge ${tone}`,'data-tone':tone},text);
}

export function stepper({steps,currentStep}) {
  return el('ol',{class:'stepper','aria-label':'行程创建步骤'},steps.map((step,index)=>{
    const state=step.state??(step.id===currentStep?'current':'upcoming');
    return el('li',{'data-step':step.id,'data-state':state,'aria-current':state==='current'?'step':null},
      el('span',{class:'step-index','aria-hidden':'true'},state==='completed'?'✓':String(index+1)),
      el('span',{class:'step-copy'},el('span',{class:'step-label'},step.label),state==='completed'?el('span',{class:'step-status'},'已完成'):null));
  }));
}

export function fieldMessage({id,text,tone='hint'}) {
  return el('span',{id,class:`field-message ${tone}`,'data-tone':tone,role:tone==='error'?'alert':null,hidden:!text},text??'');
}

export function actionGroup(...children) {
  return el('div',{class:'action-group'},children);
}
