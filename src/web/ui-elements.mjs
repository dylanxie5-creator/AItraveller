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
  return el('button',{...attributes,type:'button',class:`button ${kind}${extraClass}`,onClick:action},text);
}

export function pageHeader({eyebrow,title,primaryAction=null,secondaryActions=[]}) {
  const heading=el('div',{class:'page-heading'},eyebrow?el('p',{class:'eyebrow'},eyebrow):null,el('h1',{},title));
  const actions=[...secondaryActions,primaryAction].filter(Boolean);
  return el('header',{class:'page-header'},heading,actions.length?el('div',{class:'header-actions'},actions):null);
}

export function statusBadge(text,tone='neutral') {
  return el('span',{class:'badge status-badge','data-tone':tone},text);
}
