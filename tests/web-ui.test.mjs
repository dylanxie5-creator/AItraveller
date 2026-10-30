import test from 'node:test';
import assert from 'node:assert/strict';
import {actionGroup,button,fieldMessage,icon,pageHeader,statusBadge,stepper} from '../src/web/ui-elements.mjs';
import {createUiRuntime} from '../src/web/ui-runtime.mjs';

class FakeNode {
  constructor(tag='',text='') {
    this.tag=tag;
    this.text=text;
    this.children=[];
    this.attrs={};
    this.className='';
    this.dataset={};
  }
  setAttribute(key,value) {
    const text=String(value);
    this.attrs[key]=text;
    if(key==='class')this.className=text;
    if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=text;
  }
  getAttribute(key) {return key==='class'?this.className:this.attrs[key]??null;}
  addEventListener() {}
  append(...items) {for(const item of items)this.children.push(item instanceof FakeNode?item:new FakeNode('#text',String(item)));}
}

function withDom(run) {
  const priorNode=globalThis.Node,priorDocument=globalThis.document;
  globalThis.Node=FakeNode;
  globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',String(text))};
  try{return run();}finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}
}

test('shared UI elements expose stable button, icon, header and badge semantics',()=>withDom(()=>{
  const save=button('保存',()=>{},'primary',{'aria-describedby':'save-help'});
  assert.equal(save.getAttribute('type'),'button');
  assert.match(save.className,/button primary/);
  assert.equal(save.getAttribute('aria-describedby'),'save-help');
  assert.equal(icon('map-pin').getAttribute('aria-hidden'),'true');
  assert.equal(icon('shield-check',{label:'数据安全'}).getAttribute('aria-label'),'数据安全');
  assert.equal(statusBadge('已结束','completed').dataset.tone,'completed');

  const heading=pageHeader({eyebrow:'TRAVEL JOURNAL',title:'旅行概览',primaryAction:save,secondaryActions:[button('查看全部',()=>{},'secondary')]});
  assert.equal(heading.tag,'header');
  assert.equal(heading.children.filter(child=>child instanceof FakeNode).length,2);
}));

test('shared stepper exposes completed current and upcoming states without fake links',()=>withDom(()=>{
  const node=stepper({currentStep:'route',steps:[
    {id:'basic',label:'基本信息',state:'completed'},
    {id:'route',label:'城市路线',state:'current'},
    {id:'confirm',label:'确认保存',state:'upcoming'},
  ]});
  const rows=node.children.filter(child=>child instanceof FakeNode),texts=row=>{const values=[];(function walk(item){if(item.tag==='#text')values.push(item.text);for(const child of item.children??[])walk(child);})(row);return values.join(' ');};
  assert.equal(rows[1].getAttribute('aria-current'),'step');assert.match(texts(rows[0]),/已完成/);assert.equal(rows[2].children.some(child=>['button','a'].includes(child.tag)),false);
  assert.equal(fieldMessage({id:'name-help',text:'必填',tone:'error'}).getAttribute('role'),'alert');assert.match(actionGroup(button('继续',()=>{})).className,/action-group/);
}));

class EventTargetFake {
  constructor(){this.listeners=new Map();}
  addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}
  removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(item=>item!==listener));}
  dispatch(type,event={}){event.type=type;event.target??=this;for(const listener of [...(this.listeners.get(type)??[])])listener(event);}
  listenerCount(type){return (this.listeners.get(type)??[]).length;}
}
class RuntimeNode extends EventTargetFake {
  constructor(name,owner){super();this.name=name;this.owner=owner;this.attrs={};this.dataset={};this.hidden=false;this.textContent='';this.nodes=new Map();this.style={values:new Map(),setProperty:(name,value)=>this.style.values.set(name,value)};this.classList={values:new Set(),add:(...names)=>names.forEach(name=>this.classList.values.add(name)),remove:(...names)=>names.forEach(name=>this.classList.values.delete(name)),toggle:(name,force)=>{const active=force??!this.classList.values.has(name);active?this.classList.values.add(name):this.classList.values.delete(name);return active;}};}
  setAttribute(name,value){this.attrs[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  removeAttribute(name){delete this.attrs[name];}
  focus(){this.owner.activeElement=this;}
  querySelector(selector){return (this.nodes.get(selector)??[])[0]??null;}
  querySelectorAll(selector){return this.nodes.get(selector)??[];}
}
class RuntimeDocument extends EventTargetFake {
  constructor(){super();this.nodes=new Map();this.activeElement=null;}
  querySelector(selector){return (this.nodes.get(selector)??[])[0]??null;}
  querySelectorAll(selector){return this.nodes.get(selector)??[];}
}
function runtimeFixture({reduced=false,coarse=false}={}) {
  const document=new RuntimeDocument(),window=new EventTargetFake();window.location={hash:'#/trips'};window.matchMedia=query=>({matches:query.includes('reduced-motion')?reduced:coarse});window.requestAnimationFrame=callback=>{callback();return 1;};
  const make=name=>new RuntimeNode(name,document),root=make('root'),heading=make('heading'),home=make('home'),mobileHome=make('mobile-home'),trips=make('trips'),more=make('more'),drawer=make('drawer'),backdrop=make('backdrop'),close=make('close'),skip=make('skip'),first=make('first'),last=make('last'),spotlight=make('spotlight'),counter=make('counter');
  home.dataset.nav='home';mobileHome.dataset.nav='home';trips.dataset.nav='trips';more.dataset.nav='more';drawer.hidden=true;backdrop.hidden=true;counter.dataset.counter='7';counter.textContent='7';
  document.nodes.set('[data-nav]',[home,mobileHome,trips,more]);document.nodes.set('[data-mobile-more]',[more]);document.nodes.set('[data-more-drawer]',[drawer]);document.nodes.set('[data-more-backdrop]',[backdrop]);document.nodes.set('[data-more-close]',[close]);document.nodes.set('[data-skip-link]',[skip]);drawer.nodes.set('[data-more-focusable]',[first,last]);root.nodes.set('[data-spotlight]',[spotlight]);root.nodes.set('[data-counter]',[counter]);root.nodes.set('h1',[heading]);
  return {document,window,root,heading,home,mobileHome,trips,more,drawer,backdrop,close,skip,first,last,spotlight,counter};
}

test('refresh marks one active destination and never binds an enhanced node twice',()=>{
  const fixture=runtimeFixture(),runtime=createUiRuntime(fixture);runtime.refresh('home');runtime.refresh('home');
  assert.equal(fixture.home.getAttribute('aria-current'),'page');assert.equal(fixture.mobileHome.getAttribute('aria-current'),'page');assert.equal(fixture.trips.getAttribute('aria-current'),null);
  assert.equal(fixture.spotlight.listenerCount('pointermove'),1);assert.equal(fixture.counter.textContent,'7');assert.equal(fixture.counter.getAttribute('aria-label'),'7');
});

test('mobile more drawer traps focus closes with Escape and restores the trigger',()=>{
  const fixture=runtimeFixture(),runtime=createUiRuntime(fixture);runtime.openMore();
  assert.equal(fixture.drawer.hidden,false);assert.equal(fixture.backdrop.hidden,false);assert.equal(fixture.more.getAttribute('aria-expanded'),'true');assert.equal(fixture.document.activeElement,fixture.first);
  let prevented=false;fixture.document.activeElement=fixture.last;fixture.document.dispatch('keydown',{key:'Tab',shiftKey:false,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(fixture.document.activeElement,fixture.first);
  fixture.document.dispatch('keydown',{key:'Escape',preventDefault(){}});assert.equal(fixture.drawer.hidden,true);assert.equal(fixture.more.getAttribute('aria-expanded'),'false');assert.equal(fixture.document.activeElement,fixture.more);
});

test('skip link focuses content without changing the hash route',()=>{
  const fixture=runtimeFixture(),runtime=createUiRuntime(fixture),before=fixture.window.location.hash;let prevented=false;fixture.skip.dispatch('click',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(fixture.document.activeElement,fixture.root);assert.equal(fixture.window.location.hash,before);runtime.dispose();
});

test('reduced motion and coarse pointer keep content visible without pointer tracking',()=>{
  for(const option of [{reduced:true},{coarse:true}]){const fixture=runtimeFixture(option),runtime=createUiRuntime(fixture);runtime.refresh('home');assert.equal(fixture.spotlight.listenerCount('pointermove'),0);assert.equal(fixture.counter.textContent,'7');assert.equal(fixture.root.classList.values.has('route-entering'),false);runtime.dispose();}
});

test('dispose removes global listeners and late refresh has no effect',()=>{
  const fixture=runtimeFixture(),runtime=createUiRuntime(fixture);runtime.refresh('home');assert.equal(fixture.document.listenerCount('keydown'),1);runtime.dispose();assert.equal(fixture.document.listenerCount('keydown'),0);runtime.refresh('trips');assert.equal(fixture.home.getAttribute('aria-current'),'page');assert.equal(fixture.trips.getAttribute('aria-current'),null);
});
