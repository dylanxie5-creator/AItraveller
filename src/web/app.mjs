import {createApiClient} from './api-client.mjs';
import {navigate,parseRoute} from './router.mjs';
import {renderView,renderForm} from './views.mjs';
import {createTripForm} from '../shared/trip-form-model.mjs';
import {createFormController} from './form-controller.mjs';
import {presentTrip,orderTrips} from '../shared/trip-presenter.mjs';
export function createApp({api,render,navigate,confirm=()=>false,openEditor}) {
  let sequence=0,deleting=false;
  return {async load(route){
    const token=++sequence;render({type:'loading',route});
    try {
      let state;
      if(route.type==='home'){const data=await api.overview();state={type:'home',data,trip:data.recentTrip?presentTrip(data.recentTrip,data.today):null};}
      else if(route.type==='trips'){const [trips,overview]=await Promise.all([api.trips(),api.overview()]);state={type:'trips',trips:orderTrips(trips,overview.today)};}
      else if(route.type==='detail'){const [trip,overview]=await Promise.all([api.trip(route.id),api.overview()]);state={type:'detail',trip:presentTrip(trip,overview.today)};}
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
  let editor=null,activeHash=location.hash,suppressHash=null,navigationQueue=Promise.resolve();
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
  window.addEventListener('hashchange',()=>{
    if(location.hash===suppressHash){suppressHash=null;return;}
    navigationQueue=navigationQueue.then(async()=>{
      const targetHash=location.hash;
      if(editor){if(!await editor.leave()){suppressHash=activeHash;location.hash=activeHash;return;}editor.dispose();editor=null;}
      activeHash=targetHash;await app.load(parseRoute(targetHash));
    }).catch(()=>{});
  });
  window.addEventListener('beforeunload',event=>{if(editor&&(editor.snapshot().dirty||editor.snapshot().busy||editor.snapshot().hasPendingSave)){event.preventDefault();event.returnValue='';}});
  app.load(parseRoute(location.hash));
}
