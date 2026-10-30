import test from 'node:test';
import assert from 'node:assert/strict';
import {button,icon,pageHeader,statusBadge} from '../src/web/ui-elements.mjs';

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
