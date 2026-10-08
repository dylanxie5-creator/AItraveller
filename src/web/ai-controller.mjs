const activeStates=new Set(['queued','searching','generating']);
const clone=value=>value===undefined?undefined:structuredClone(value);
const message=error=>error?.message??'操作失败，请重试';

export function createAiController({api,render,navigate,confirm=()=>false,clock=globalThis,createId=()=>crypto.randomUUID(),initialDraft=null}) {
  let disposed=false,sequence=0,timer=null,pendingCommand=null,draft=clone(initialDraft),state={type:'idle'};
  const show=next=>{state=next;if(!disposed)render(clone(next));};
  const stopPoll=()=>{if(timer!==null){clock.clearTimeout(timer);timer=null;}};
  const snapshot=()=>clone({...state,pendingCommand,draft});
  async function poll(id=state.job?.id??state.route?.id) {
    if(disposed||!id)return;
    const token=sequence;
    try {
      const job=await api.aiJob(id);
      if(disposed||token!==sequence)return;
      show({type:'ai-job',route:{type:'ai-job',id},job});
      if(activeStates.has(job.state))timer=clock.setTimeout(()=>{timer=null;void poll(id);},2000);
    }catch(error){if(!disposed&&token===sequence)show({type:'ai-error',route:{type:'ai-job',id},message:message(error),code:error?.code});}
  }
  async function load(route) {
    const token=++sequence;stopPoll();show({type:'ai-loading',route});
    try {
      let next;
      if(route.type==='ai-settings')next={type:'ai-settings',settings:await api.aiSettings()};
      else if(route.type==='ai-new'){const settings=await api.aiSettings();draft=draft??{name:'',startDate:'',endDate:'',travelerCount:1,budgetYuan:'',cityCodes:[],preferences:''};next={type:'ai-new',settings,input:clone(draft)};}
      else if(route.type==='ai-job'){if(token===sequence)await poll(route.id);return;}
      else if(route.type==='ai-plans')next={type:'ai-plans',plans:await api.aiPlans()};
      else if(route.type==='ai-plan')next={type:'ai-plan',plan:await api.aiPlan(route.id)};
      else return;
      if(!disposed&&token===sequence)show(next);
    }catch(error){if(!disposed&&token===sequence)show({type:'ai-error',route,message:message(error),code:error?.code});}
  }
  function changeInput(path,value) {
    if(!draft)return;draft={...draft,[path]:clone(value)};
    if(state.type==='ai-new')show({...state,input:clone(draft),error:'',fields:{}});
  }
  async function submit(values) {
    if(pendingCommand)return sendPending();
    draft=clone(values.input);
    const command={operationId:createId(),settingsRevision:values.settingsRevision,provider:values.provider,input:clone(draft)};
    pendingCommand=command;show({...state,input:clone(draft),busy:true,error:'',fields:{}});
    return sendPending();
  }
  async function sendPending() {
    if(!pendingCommand)return;
    const command=clone(pendingCommand);
    try {
      const job=await api.startAiJob(command);pendingCommand=null;show({...state,busy:false,error:''});navigate({type:'ai-job',id:job.id});return job;
    }catch(error) {
      const fields=error?.fields??{};const uncertain=error?.code==='NETWORK'||error?.status===0;
      if(!uncertain)pendingCommand=null;
      show({...state,busy:false,error:message(error),fields,uncertain});
      return null;
    }
  }
  async function saveSettings(command) {
    show({...state,busy:true,error:'',fields:{}});
    try {const settings=await api.saveAiSettings(clone(command));show({type:'ai-settings',settings,saved:true});return settings;}
    catch(error){show({...state,busy:false,error:message(error),fields:error?.fields??{},clearSecrets:true});return null;}
  }
  async function convert(plan) {
    if(!await confirm('将按当前攻略快照创建一趟正式行程，之后两边互不覆盖。是否继续？'))return null;
    try {const receipt=await api.convertAiPlan(plan.id,{expectedRevision:plan.revision});navigate({type:'detail',id:receipt.tripId});return receipt;}
    catch(error){show({...state,error:message(error)});return null;}
  }
  function reuseJob(job) {draft=clone(job.input);navigate({type:'ai-new'});}
  function dispose(){disposed=true;sequence++;stopPoll();}
  return {load,submit,retrySubmit:sendPending,poll,dispose,snapshot,changeInput,saveSettings,convert,reuseJob};
}
