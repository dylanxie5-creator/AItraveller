import {actionGroup,button,el,pageHeader,statusBadge} from './ui-elements.mjs';

export function backupKindLabel(kind) {return {auto:'自动备份',manual:'手动备份','pre-restore':'恢复前备份'}[kind]??'备份';}
export function formatBackupBytes(bytes) {
  if(!Number.isFinite(bytes)||bytes<=0)return '0 B';
  if(bytes<1024)return `${Math.round(bytes)} B`;
  if(bytes<1048576)return `${Number((bytes/1024).toFixed(1))} KB`;
  return `${Number((bytes/1048576).toFixed(1))} MB`;
}
export function formatBackupTime(value) {
  const date=new Date(value);if(Number.isNaN(date.getTime()))return '时间未知';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
function disabled(control,busy) {if(busy)control.setAttribute('disabled','true');return control;}
function backupCard(item,state,controller) {
  const label=formatBackupTime(item.createdAt),actions=actionGroup(),download=button('下载',()=>controller.download(item),'secondary',{'aria-label':`下载 ${label} 的备份`}),restore=button('恢复',()=>controller.restore(item),'danger',{'aria-label':`恢复 ${label} 的备份`});actions.className+=' backup-actions';
  actions.append(disabled(download,state.busy),disabled(restore,state.busy));
  return el('article',{class:'backup-row','data-backup-id':item.id},
    el('div',{class:'backup-row-main'},statusBadge(backupKindLabel(item.kind),item.kind),el('strong',{},label),el('span',{class:'muted'},formatBackupBytes(item.sizeBytes))),
    item.note?el('p',{class:'backup-note'},item.note):el('p',{class:'muted'},'无备注'),actions);
}

export function renderDataView(root,state,controller) {
  root.replaceChildren();
  if(state.type==='data-loading'){root.append(el('p',{class:'loading',role:'status'},'正在读取备份信息…'));return;}
  if(state.type==='data-error'){root.append(el('section',{class:'empty-state'},el('h1',{},'暂时无法读取备份'),el('p',{role:'alert'},state.error)));return;}
  const data=state.data??{databaseSizeBytes:0,backupCount:0,lastAutomaticAt:null,warning:null,backups:[]};
  root.append(pageHeader({eyebrow:'LOCAL DATA SAFETY',title:'数据安全'}));
  root.append(el('div',{class:'stats data-stats'},
    el('section',{class:'stat'},el('span',{class:'stat-value'},formatBackupBytes(data.databaseSizeBytes)),el('span',{class:'stat-label'},'当前数据大小')),
    el('section',{class:'stat'},el('span',{class:'stat-value'},data.backupCount),el('span',{class:'stat-label'},'可用备份')),
    el('section',{class:'stat'},el('span',{class:'stat-value backup-last-time'},data.lastAutomaticAt?formatBackupTime(data.lastAutomaticAt):'尚未创建'),el('span',{class:'stat-label'},'最近自动备份'))));
  root.append(el('section',{class:'data-safety-note journal-section'},el('h2',{},'只保存在这台电脑'),el('p',{},'网站启动时每隔至少 24 小时创建自动备份，并保留最近 14 份。手动备份与恢复前备份不会被自动轮换删除。'),el('p',{},'恢复前会再次确认，并先为当前数据创建一份安全备份。')));
  if(data.warning)root.append(el('p',{class:'form-error',role:'alert'},data.warning.message));
  const note=el('input',{id:'backup-note',type:'text',maxlength:'80',value:state.note,placeholder:'备注（可选，最多 80 字）',disabled:state.busy,onInput:event=>controller.setNote(event.target.value)});
  const create=disabled(button(state.busy?'正在处理…':'创建手动备份',()=>controller.createBackup()),state.busy);
  const file=el('input',{id:'backup-file',type:'file',accept:'.sqlite,application/vnd.sqlite3',hidden:true,disabled:state.busy,onChange:event=>{const selected=event.target.files?.[0];if(selected)controller.importBackup(selected);event.target.value='';}});
  const choose=disabled(button('导入备份文件',()=>file.click?.(),'secondary'),state.busy);
  root.append(el('section',{class:'data-actions-panel journal-section'},el('div',{class:'data-action-copy'},el('h2',{},'立即保存一份'),el('p',{},'手动备份可长期保留并下载为单个 SQLite 文件。')),el('div',{class:'data-action-controls'},el('label',{for:'backup-note'},'备份备注'),note,actionGroup(create,choose),file)));
  root.append(el('p',{class:'success-note',role:'status',hidden:!state.message},state.message),el('p',{class:'form-error',role:'alert',hidden:!state.error},state.error));
  const list=el('section',{class:'backup-list journal-section'},el('div',{class:'section-heading'},el('h2',{},'本机备份'),el('span',{class:'muted'},'按时间从新到旧')));
  if(data.backups.length)list.append(...data.backups.map(item=>backupCard(item,state,controller)));
  else list.append(el('div',{class:'empty-state'},el('span',{class:'empty-symbol','aria-hidden':'true'},'◇'),el('h2',{},'还没有可用备份'),el('p',{},'创建第一份手动备份，或在下次启动时等待自动备份。')));
  root.append(list);
}
