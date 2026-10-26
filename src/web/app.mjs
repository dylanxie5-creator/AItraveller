import {createApiClient} from './api-client.mjs';
import {navigate,parseRoute} from './router.mjs';
import {renderView,renderForm} from './views.mjs';
import {createTripForm} from '../shared/trip-form-model.mjs';
import {createFormController} from './form-controller.mjs';
import {createAiController} from './ai-controller.mjs';
import {renderAiView} from './ai-views.mjs';
import {createAiPlanEditor,renderAiEditor} from './ai-plan-editor.mjs';
import {createExpenseController} from './expense-controller.mjs';
import {renderExpenseView} from './expense-views.mjs';
import {createFootprintController} from './footprint-controller.mjs';
import {renderFootprintView} from './footprint-views.mjs';
import {createAmapAdapter} from './amap-adapter.mjs';
import {createDataController} from './data-controller.mjs';
import {renderDataView} from './data-views.mjs';
import {createArchiveController} from './archive-controller.mjs';
import {renderArchiveView} from './archive-views.mjs';
import {presentTrip,orderTrips} from '../shared/trip-presenter.mjs';
const footprintRoutes=new Set(['footprints','footprint-province','footprint-city','footprint-new','footprint-edit','footprint-manage','footprint-settings']);
const archiveRoutes=new Set(['archive-home','archive-print','trip-archive-print']);

export function navigationSection(route) {
  if(route.type==='home')return 'home';
  if(route.type==='data')return 'data';
  if(archiveRoutes.has(route.type))return 'archive';
  if(route.type==='trips'||['detail','edit','new','expenses','expense-new','expense-edit','expense-categories'].includes(route.type))return 'trips';
  if(route.type==='footprint-settings')return 'footprint-settings';
  if(footprintRoutes.has(route.type))return 'footprints';
  return route.type==='ai-settings'?'ai-settings':'ai';
}
export function hasPendingWrites(states) {return states.filter(Boolean).some(state=>Boolean(state.busy||state.dirty||state.hasPendingSave||state.pendingCommand));}
export function createFootprintRuntime({api,root,navigate,confirm,render=renderFootprintView,controllerFactory=createFootprintController,adapterFactory=()=>createAmapAdapter({window:globalThis.window,document:globalThis.document})}) {
  let controller=null;
  function dispose() {controller?.dispose();controller=null;}
  return {
    async load(route) {
      dispose();
      const mapAdapter=route.type==='footprints'?adapterFactory():null;
      let next;
      next=controllerFactory({api,navigate,confirm,mapAdapter,render:state=>render(root,state,{navigate,controller:next,retry:value=>next.load(value),deleteVisit:visit=>next.deleteVisit(visit),suppress:visit=>next.suppress(visit),restore:item=>next.restore(item)})});
      controller=next;await next.load(route);
    },
    dispose,
    snapshot:()=>controller?.snapshot()??null,
  };
}
export function createApp({api,render,navigate,confirm=()=>false,openEditor}) {
  let sequence=0,deleting=false;
  return {async load(route){
    const token=++sequence;render({type:'loading',route});
    try {
      let state;
      if(route.type==='home'){const data=await api.overview();state={type:'home',data,trip:data.recentTrip?presentTrip(data.recentTrip,data.today):null};}
      else if(route.type==='trips'){const [trips,overview]=await Promise.all([api.trips(),api.overview()]);state={type:'trips',trips:orderTrips(trips,overview.today)};}
      else if(route.type==='detail'){const [trip,overview,guide,expenseOverview]=await Promise.all([api.trip(route.id),api.overview(),api.tripGuide?.(route.id).catch(error=>{if(error.code==='NOT_FOUND')return null;throw error;})??null,api.expenseOverview(route.id)]);state={type:'detail',trip:presentTrip(trip,overview.today),guide,expenseOverview};}
      else state={type:'editor',route};
      if(token!==sequence)return;render(state);if(state.type==='editor')await openEditor?.(route);
    }catch(error){if(token===sequence)render({type:'error',route,message:error.message??'加载失败，请重试',code:error.code});}
  },async deleteTrip(trip){
    if(deleting||!await confirm(`确定删除“${trip.name}”吗？删除后无法恢复。`))return;
    deleting=true;
    try{await api.deleteTrip(trip.id,trip.revision);navigate({type:'trips'});}catch(error){render({type:'delete-error',trip,message:error.message??'删除失败，请重试'});}finally{deleting=false;}
  }};
}
if(typeof document!=='undefined') {
  const root=document.querySelector('#content');const api=createApiClient();
  let editor=null,aiEditor=null,expenseController=null,dataController=null,archiveController=null,activeHash=location.hash,suppressHash=null,navigationQueue=Promise.resolve();
  const app=createApp({api,render:state=>renderView(root,state,{navigate,deleteTrip:t=>app.deleteTrip(t),retry:r=>app.load(r)}),navigate,confirm:message=>window.confirm(message),openEditor:async route=>{
    const key=route.type==='new'?'new':`edit:${route.id}`;
    let [slot,trip]=await Promise.all([api.draft(key),route.type==='edit'?api.trip(route.id):null]);
    if(JSON.stringify(parseRoute(location.hash))!==JSON.stringify(route))return;
    if(slot.state==='active'&&!window.confirm('发现未完成的行程草稿，是否继续编辑？')){
      if(window.confirm('确认舍弃这份未完成的草稿？'))slot=await api.discardDraft(key,{sessionId:slot.sessionId,revision:slot.revision});
    }
    const model=createTripForm({trip,slot:slot.state==='active'?slot:null});
    editor=createFormController({api,model,draftKey:key,slot,render:(state,options)=>renderForm(root,state,editor,api,options),navigate,confirm:message=>window.confirm(message)});
    await editor.start();
  }});
  let ai;
  const createAi=initialDraft=>createAiController({api,render:state=>renderAiView(root,state,{navigate,retry:r=>ai.load(r),submit:values=>ai.submit(values),retrySubmit:()=>ai.retrySubmit(),saveSettings:command=>ai.saveSettings(command),convert:plan=>ai.convert(plan),reuseJob:job=>ai.reuseJob(job)}),navigate,confirm:message=>window.confirm(message),initialDraft});
  ai=createAi();
  const createExpenses=()=>createExpenseController({api,render:state=>renderExpenseView(root,state,{controller:expenseController,navigate,deleteExpense:item=>expenseController.deleteExpense(item),saveCategory:command=>expenseController.saveCategory(command),deleteCategory:category=>expenseController.deleteCategory(category),retry:route=>expenseController.load(route)}),navigate,confirm:message=>window.confirm(message)});
  const footprints=createFootprintRuntime({api,root,navigate,confirm:message=>window.confirm(message)});
  let restoredMessage='';try{restoredMessage=sessionStorage.getItem('data-restore-message')??'';sessionStorage.removeItem('data-restore-message');}catch{}
  const createData=()=>createDataController({api,initialMessage:restoredMessage,render:state=>renderDataView(root,state,dataController),confirm:message=>window.confirm(message),download:url=>{const link=document.createElement('a');link.href=url;link.download='';document.body.append(link);link.click();link.remove();},reload:message=>{try{sessionStorage.setItem('data-restore-message',message);}catch{}location.reload();}});
  const createArchive=()=>createArchiveController({api,render:state=>renderArchiveView(root,state,{print:()=>archiveController.print(),retry:route=>archiveController.load(route)}),print:()=>window.print()});
  async function loadRoute(route) {
    document.body.classList.toggle('archive-print-mode',['archive-print','trip-archive-print'].includes(route.type));
    document.querySelectorAll('[data-nav]').forEach(node=>node.classList.toggle('active',node.dataset.nav===navigationSection(route)));
    if(route.type==='ai-plan-edit') {
      renderAiView(root,{type:'ai-loading',route},{});
      try {
        const plan=await api.aiPlan(route.id);
        if(JSON.stringify(parseRoute(location.hash))!==JSON.stringify(route))return;
        aiEditor=createAiPlanEditor({api,plan,render:(state,options)=>renderAiEditor(root,state,aiEditor,options),navigate,confirm:message=>window.confirm(message)});
        renderAiEditor(root,aiEditor.snapshot(),aiEditor);
      }catch(error){renderAiView(root,{type:'ai-error',route,message:error.message??'加载失败，请重试'},{navigate,retry:loadRoute});}
    } else if(route.type==='data'){dataController=createData();restoredMessage='';await dataController.load();}
    else if(archiveRoutes.has(route.type)){archiveController=createArchive();await archiveController.load(route);}
    else if(route.type.startsWith('ai-'))await ai.load(route);
    else if(footprintRoutes.has(route.type))await footprints.load(route);
    else if(['expenses','expense-new','expense-edit','expense-categories'].includes(route.type)){expenseController=createExpenses();await expenseController.load(route);}
    else await app.load(route);
  }
  window.addEventListener('hashchange',()=>{
    if(location.hash===suppressHash){suppressHash=null;return;}
    navigationQueue=navigationQueue.then(async()=>{
      const targetHash=location.hash;
      if(editor){if(!await editor.leave()){suppressHash=activeHash;location.hash=activeHash;return;}editor.dispose();editor=null;}
      if(aiEditor){if(!await aiEditor.leave()){suppressHash=activeHash;location.hash=activeHash;return;}aiEditor.dispose();aiEditor=null;}
      if(expenseController){expenseController.dispose();expenseController=null;}
      if(dataController){dataController.dispose();dataController=null;}
      if(archiveController){archiveController.dispose();archiveController=null;}
      footprints.dispose();
      const retainedAiDraft=ai.snapshot().draft;ai.dispose();ai=createAi(retainedAiDraft);activeHash=targetHash;await loadRoute(parseRoute(targetHash));
    }).catch(()=>{});
  });
  window.addEventListener('beforeunload',event=>{if(hasPendingWrites([editor?.snapshot(),aiEditor?.snapshot(),expenseController?.snapshot(),dataController?.snapshot(),footprints.snapshot()])){event.preventDefault();event.returnValue='';}});
  loadRoute(parseRoute(location.hash));
}
