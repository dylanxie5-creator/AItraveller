import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../src/web/api-client.mjs';
import {createDataController} from '../src/web/data-controller.mjs';
import {hasPendingWrites} from '../src/web/app.mjs';
import {backupKindLabel,formatBackupBytes,formatBackupTime,renderDataView} from '../src/web/data-views.mjs';

const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const record=(id='11111111-1111-4111-8111-111111111111',kind='manual')=>({id,kind,createdAt:'2026-10-24T08:00:00.000Z',sizeBytes:8192,note:'出发前',fingerprint:'a'.repeat(64)});
const overview=(backups=[])=>({databaseSizeBytes:16384,backupCount:backups.length,lastAutomaticAt:null,warning:null,backups});

test('data API client uses JSON for actions binary for import and a same-origin download URL',async()=>{
  const calls=[],file=new Blob(['SQLite'],{type:'application/vnd.sqlite3'});
  const api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({data:{ok:true}})};}});

  await api.dataBackups();await api.createDataBackup('备注');await api.importDataBackup(file);await api.restoreDataBackup('unsafe id');

  assert.deepEqual(calls.map(call=>[call.url,call.options.method]),[['/api/data/backups','GET'],['/api/data/backups','POST'],['/api/data/backups/import','POST'],['/api/data/backups/unsafe%20id/restore','POST']]);
  assert.deepEqual(JSON.parse(calls[1].options.body),{note:'备注'});
  assert.equal(calls[2].options.headers['Content-Type'],'application/vnd.sqlite3');assert.equal(calls[2].options.body,file);
  assert.deepEqual(JSON.parse(calls[3].options.body),{confirmation:'恢复数据'});
  assert.equal(api.dataBackupDownloadUrl('unsafe id'),'/api/data/backups/unsafe%20id/download');
});

test('data controller ignores late loads and caps notes by Unicode characters',async()=>{
  const old=deferred(),renders=[];let calls=0;
  const controller=createDataController({api:{dataBackups:()=>calls++===0?old.promise:Promise.resolve(overview([record()]))},render:state=>renders.push(state),confirm:()=>false,reload:()=>{},download:()=>{}});
  const first=controller.load();await controller.load();old.resolve(overview());await first;
  controller.setNote('旅'.repeat(81));
  assert.equal(controller.snapshot().data.backups.length,1);assert.equal(Array.from(controller.snapshot().note).length,80);
  assert.equal(renders.at(-1).note,'旅'.repeat(80));
});

test('create and import expose busy state retain failures and reload the catalog on success',async()=>{
  const create=deferred(),upload=deferred(),renders=[];let reads=0;
  const api={dataBackups:async()=>overview(reads++?[record()]:[]),createDataBackup:()=>create.promise,importDataBackup:()=>upload.promise};
  const controller=createDataController({api,render:state=>renders.push(state),confirm:()=>true,reload:()=>{},download:()=>{}});await controller.load();controller.setNote('我的备份');

  const creating=controller.createBackup();assert.equal(controller.snapshot().busy,true);assert.equal(hasPendingWrites([controller.snapshot()]),true);create.resolve(record());await creating;
  assert.equal(controller.snapshot().busy,false);assert.equal(controller.snapshot().note,'');assert.match(controller.snapshot().message,/备份已创建/);

  const importing=controller.importBackup(new Blob(['bad']));assert.equal(controller.snapshot().busy,true);upload.resolve(record('22222222-2222-4222-8222-222222222222'));await importing;
  assert.equal(controller.snapshot().busy,false);assert.match(controller.snapshot().message,/导入成功/);

  api.createDataBackup=async()=>{throw {message:'创建失败'};};controller.setNote('仍需保留');await controller.createBackup();
  assert.equal(controller.snapshot().note,'仍需保留');assert.equal(controller.snapshot().error,'创建失败');
});

test('restore requires confirmation reloads only after success and download never receives a disk path',async()=>{
  const calls=[],downloads=[],reloads=[];let allow=false,fail=false;
  const api={dataBackups:async()=>overview([record()]),dataBackupDownloadUrl:id=>`/api/data/backups/${id}/download`,restoreDataBackup:async id=>{calls.push(id);if(fail)throw {message:'恢复失败'};return {restoredFrom:id};}};
  const controller=createDataController({api,render:()=>{},confirm:async message=>{assert.match(message,/当前数据.*安全备份/);return allow;},reload:message=>reloads.push(message),download:url=>downloads.push(url)});await controller.load();
  controller.download(record());assert.deepEqual(downloads,['/api/data/backups/11111111-1111-4111-8111-111111111111/download']);assert.equal(downloads[0].includes('C:'),false);
  await controller.restore(record());assert.equal(calls.length,0);
  allow=true;fail=true;await controller.restore(record());assert.equal(reloads.length,0);assert.equal(controller.snapshot().error,'恢复失败');
  fail=false;await controller.restore(record());assert.deepEqual(calls,[record().id,record().id]);assert.match(reloads[0],/恢复成功/);
});

test('data view formats stable summary type time and byte labels',()=>{
  assert.equal(formatBackupBytes(0),'0 B');assert.equal(formatBackupBytes(8192),'8 KB');assert.equal(formatBackupBytes(1572864),'1.5 MB');
  assert.equal(formatBackupTime('2026-10-24T08:05:00.000Z'),'2026-10-24 16:05');
  assert.equal(backupKindLabel('auto'),'自动备份');assert.equal(backupKindLabel('manual'),'手动备份');assert.equal(backupKindLabel('pre-restore'),'恢复前备份');
});

test('data view renders safe controls records statuses and hostile notes only as text',()=>{
  class FakeNode {constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(){}append(...items){for(const item of items)this.children.push(item instanceof FakeNode?item:new FakeNode('#text',String(item)));}replaceChildren(...items){this.children=[];this.append(...items);}querySelector(){return null;}}
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FakeNode;globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',String(text))};
  try {
    const root=new FakeNode('main'),hostile='<img src=x onerror=alert(1)>',records=[{...record(),note:hostile},record('22222222-2222-4222-8222-222222222222','auto'),record('33333333-3333-4333-8333-333333333333','pre-restore')];
    const controller={setNote(){},createBackup(){},importBackup(){},download(){},restore(){}};
    renderDataView(root,{type:'data',data:{databaseSizeBytes:16384,backupCount:3,lastAutomaticAt:'2026-10-24T08:05:00.000Z',warning:{message:'自动备份暂未完成'},backups:records},note:'保留',busy:true,error:'导入失败',message:'备份已创建'},controller);
    const nodes=[];(function walk(node){nodes.push(node);for(const child of node.children)walk(child);})(root);const texts=nodes.filter(node=>node.tag==='#text').map(node=>node.text);
    assert.ok(texts.includes('16 KB'));assert.ok(texts.includes('3'));assert.ok(texts.includes('自动备份'));assert.ok(texts.includes('手动备份'));assert.ok(texts.includes('恢复前备份'));
    assert.ok(texts.includes(hostile));assert.equal(nodes.some(node=>node.tag==='img'),false);
    assert.ok(texts.some(text=>text.includes('恢复前会再次确认')));assert.ok(nodes.some(node=>node.attrs.accept==='.sqlite,application/vnd.sqlite3'&&node.attrs.type==='file'&&node.attrs.hidden==='true'));
    assert.equal(nodes.filter(node=>node.tag==='article'&&node.attrs['data-backup-id']).length,3);
    assert.ok(nodes.filter(node=>node.tag==='button'||node.tag==='input').every(node=>node.attrs.disabled==='true'));
    assert.ok(nodes.some(node=>node.attrs.role==='status'&&texts.includes('备份已创建')));assert.ok(nodes.some(node=>node.attrs.role==='alert'));
    const serialized=texts.join(' ');for(const secret of ['keyCipher','securityCipher','apiKey','secret'])assert.equal(serialized.includes(secret),false);
  } finally {globalThis.Node=priorNode;globalThis.document=priorDocument;}
});

test('data view has a useful empty and loading state',()=>{
  class FakeNode {constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(){}append(...items){for(const item of items)this.children.push(item instanceof FakeNode?item:new FakeNode('#text',String(item)));}replaceChildren(...items){this.children=[];this.append(...items);}}
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FakeNode;globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',String(text))};
  try {const root=new FakeNode('main');renderDataView(root,{type:'data-loading'},{});assert.ok(root.children.some(node=>node.attrs.role==='status'));renderDataView(root,{type:'data',data:overview(),note:'',busy:false,error:'',message:''},{setNote(){},createBackup(){},importBackup(){},download(){},restore(){}});const text=[];(function walk(node){if(node.tag==='#text')text.push(node.text);for(const child of node.children)walk(child);})(root);assert.ok(text.some(value=>value.includes('还没有可用备份')));}finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}
});

test('data safety groups label every operation and keep one primary action per group',()=>{
  class FakeNode {constructor(tag='',text=''){this.tag=tag;this.text=text;this.children=[];this.attrs={};this.className='';this.parentElement=null;}setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=String(v);}addEventListener(){}append(...items){for(const item of items.flat(Infinity)){const child=item instanceof FakeNode?item:new FakeNode('#text',String(item));child.parentElement=this;this.children.push(child);}}replaceChildren(...items){this.children=[];this.append(...items);}all(){const rows=[];(function walk(node){for(const child of node.children){rows.push(child);walk(child);}})(this);return rows;}querySelector(){return null;}}
  const priorNode=globalThis.Node,priorDocument=globalThis.document;globalThis.Node=FakeNode;globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',String(text))};
  try{const root=new FakeNode('main');renderDataView(root,{type:'data',data:overview([record()]),note:'留档',busy:false,error:'',message:''},{setNote(){},createBackup(){},importBackup(){},download(){},restore(){}});const nodes=[root,...root.all()],text=node=>{const values=[];(function walk(item){if(item.tag==='#text')values.push(item.text);for(const child of item.children??[])walk(child);})(node);return values.join(' ');};for(const heading of ['数据安全','只保存在这台电脑','立即保存一份','本机备份'])assert.ok(nodes.some(node=>['h1','h2'].includes(node.tag)&&text(node).includes(heading)),heading);const note=nodes.find(node=>node.attrs.id==='backup-note');assert.ok(note);assert.ok(nodes.some(node=>node.tag==='label'&&node.attrs.for==='backup-note'));for(const label of ['创建手动备份','导入备份文件','下载','恢复'])assert.ok(nodes.some(node=>node.tag==='button'&&text(node).includes(label)),label);const groups=nodes.filter(node=>node.className.split(/\s+/).includes('action-group'));assert.ok(groups.length>=2);for(const group of groups)assert.ok(group.all().filter(node=>node.className.split(/\s+/).includes('primary')).length<=1);const restore=nodes.find(node=>node.tag==='button'&&text(node).includes('恢复'));assert.match(restore.className,/danger/);}
  finally{globalThis.Node=priorNode;globalThis.document=priorDocument;}
});
