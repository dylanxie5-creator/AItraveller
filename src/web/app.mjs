import {createApiClient} from './api-client.mjs';
import {navigate,parseRoute} from './router.mjs';
import {renderView,renderForm} from './views.mjs';
import {createTripForm} from '../shared/trip-form-model.mjs';
import {createFormController} from './form-controller.mjs';
import {createAiController} from './ai-controller.mjs';
import {renderAiView} from './ai-views.mjs';
import {createAiPlanEditor,renderAiEditor} from './ai-plan-editor.mjs';
import {presentTrip,orderTrips} from '../shared/trip-presenter.mjs';
export function createApp({api,render,navigate,confirm=()=>false,openEditor}) {
  let sequence=0,deleting=false;
  return {async load(route){
    const token=++sequence;render({type:'loading',route});
    try {
      let state;
      if(route.type==='home'){const data=await api.overview();state={type:'home',data,trip:data.recentTrip?presentTrip(data.recentTrip,data.today):null};}
      else if(route.type==='trips'){const [trips,overview]=await Promise.all([api.trips(),api.overview()]);state={type:'trips',trips:orderTrips(trips,overview.today)};}
      else if(route.type==='detail'){const [trip,overview,guide]=await Promise.all([api.trip(route.id),api.overview(),api.tripGuide?.(route.id).catch(error=>{if(error.code==='NOT_FOUND')return null;throw error;})??null]);state={type:'detail',trip:presentTrip(trip,overview.today),guide};}
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
  let editor=null,aiEditor=null,activeHash=location.hash,suppressHash=null,navigationQueue=Promise.resolve();
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
  const createAi=()=>createAiController({api,render:state=>renderAiView(root,state,{navigate,retry:r=>ai.load(r),submit:values=>ai.submit(values),retrySubmit:()=>ai.retrySubmit(),saveSettings:command=>ai.saveSettings(command),convert:plan=>ai.convert(plan)}),navigate,confirm:message=>window.confirm(message)});
  ai=createAi();
  async function loadRoute(route) {
    document.querySelectorAll('[data-nav]').forEach(node=>node.classList.toggle('active',node.dataset.nav===(route.type==='home'?'home':route.type==='trips'||['detail','edit','new'].includes(route.type)?'trips':route.type==='ai-settings'?'ai-settings':'ai')));
    if(route.type==='ai-plan-edit') {
      renderAiView(root,{type:'ai-loading',route},{});
      try {
        const plan=await api.aiPlan(route.id);
        if(JSON.stringify(parseRoute(location.hash))!==JSON.stringify(route))return;
        aiEditor=createAiPlanEditor({api,plan,render:(state,options)=>renderAiEditor(root,state,aiEditor,options),navigate,confirm:message=>window.confirm(message)});
        renderAiEditor(root,aiEditor.snapshot(),aiEditor);
      }catch(error){renderAiView(root,{type:'ai-error',route,message:error.message??'加载失败，请重试'},{navigate,retry:loadRoute});}
    } else if(route.type.startsWith('ai-'))await ai.load(route);
    else await app.load(route);
  }
  window.addEventListener('hashchange',()=>{
    if(location.hash===suppressHash){suppressHash=null;return;}
    navigationQueue=navigationQueue.then(async()=>{
      const targetHash=location.hash;
      if(editor){if(!await editor.leave()){suppressHash=activeHash;location.hash=activeHash;return;}editor.dispose();editor=null;}
      if(aiEditor){if(!await aiEditor.leave()){suppressHash=activeHash;location.hash=activeHash;return;}aiEditor.dispose();aiEditor=null;}
      ai.dispose();ai=createAi();activeHash=targetHash;await loadRoute(parseRoute(targetHash));
    }).catch(()=>{});
  });
  window.addEventListener('beforeunload',event=>{if((editor&&(editor.snapshot().dirty||editor.snapshot().busy||editor.snapshot().hasPendingSave))||(aiEditor&&aiEditor.snapshot().dirty)){event.preventDefault();event.returnValue='';}});
  loadRoute(parseRoute(location.hash));
}
