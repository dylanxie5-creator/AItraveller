const signature=s=>JSON.stringify({step:s.step,input:s.input});
export function createFormController({api,model,draftKey,slot,render,navigate,confirm=()=>false,clock=globalThis,createId=()=>crypto.randomUUID()}) {
  let current=structuredClone(slot),sessionId=slot.state==='active'?slot.sessionId:createId(),disposed=false,busy=false,error='',timer,queue=Promise.resolve(),pendingDraft=null,pendingSave=null,lastSignature=slot.state==='active'?signature(model.snapshot()):null;
  const snapshot=()=>({...model.snapshot(),busy,error,dirty:signature(model.snapshot())!==lastSignature||Boolean(pendingDraft),saved:current.state==='active'&&signature(model.snapshot())===lastSignature&&!pendingDraft,hasPendingSave:Boolean(pendingSave)});
  const emit=(full=true)=>{if(!disposed)render(snapshot(),{full});};
  const cancel=()=>{if(timer!==undefined){clock.clearTimeout(timer);timer=undefined;}};
  async function persist(command) {
    try{return await api.saveDraft(draftKey,command);}catch(failure){
      if(['NETWORK','CONFLICT'].includes(failure.code)){
        try{const remote=await api.draft(draftKey);if(remote.state==='active'&&remote.sessionId===command.sessionId&&remote.targetTripId===command.targetTripId&&remote.baseTripRevision===command.baseTripRevision&&remote.revision===command.expectedRevision+1&&remote.step===command.step&&JSON.stringify(remote.input)===JSON.stringify(command.input))return remote;}catch{}
      }throw failure;
    }
  }
  function flush() {
    cancel();
    const run=async()=>{
      if(disposed)return;
      if(pendingDraft){current=await persist(pendingDraft);lastSignature=JSON.stringify({step:pendingDraft.step,input:pendingDraft.input});pendingDraft=null;}
      const state=model.snapshot(),nextSignature=signature(state);
      if(nextSignature!==lastSignature||current.state!=='active'){
        pendingDraft={expectedRevision:current.revision,sessionId,targetTripId:state.id,baseTripRevision:state.baseTripRevision,step:state.step,input:state.input};
        current=await persist(pendingDraft);lastSignature=nextSignature;pendingDraft=null;
      }
      error='';emit(false);
    };
    const result=queue.then(run,run);queue=result.catch(()=>{});return result;
  }
  const fail=failure=>{error=failure.message??'保存失败，当前输入仍保留';emit(false);};
  function changed(action,full=false){if(disposed||busy)return;action();pendingSave=null;error='';cancel();emit(full);timer=clock.setTimeout(()=>flush().catch(fail),400);}
  async function transition(direction) {
    if(disposed||busy)return false;busy=true;emit(false);const oldStep=model.snapshot().step;
    try{await flush();if(direction==='next'){if(!model.next()){emit();return false;}}else model.previous();await flush();emit();return true;}catch(failure){model.setStep(oldStep);fail(failure);return false;}finally{busy=false;emit(false);}
  }
  async function save() {
    if(disposed||busy)return;busy=true;emit(false);
    try {
      if(model.snapshot().step!=='confirm'||!model.validate()){emit();return;}
      if(!pendingSave){await flush();const s=model.snapshot();pendingSave={operationId:createId(),expectedTripRevision:s.baseTripRevision,input:s.input,draft:{key:draftKey,sessionId,revision:current.revision}};}
      const trip=await api.saveTrip(model.snapshot().id,pendingSave);
      await api.trip(trip.id);pendingSave=null;error='';disposed=true;cancel();navigate({type:'detail',id:trip.id});
    }catch(failure){fail(failure);}finally{busy=false;emit(false);}
  }
  return {snapshot,async start(){try{await flush();}catch(failure){fail(failure);}emit();},
    change:(field,value)=>changed(()=>model.change(field,value)),addCity:city=>changed(()=>model.addCity(city),true),changeCity:(i,f,v)=>changed(()=>model.changeCity(i,f,v)),moveCity:(a,b)=>changed(()=>model.moveCity(a,b),true),removeCity:i=>changed(()=>model.removeCity(i),true),next:()=>transition('next'),previous:()=>transition('previous'),save,retrySave:save,
    async retryDraft(){if(disposed||busy)return;try{await flush();emit(false);}catch(failure){fail(failure);}},
    async discard(){if(disposed||busy||!await confirm('确定舍弃当前未完成的草稿吗？'))return;busy=true;emit(false);try{await flush();await api.discardDraft(draftKey,{sessionId,revision:current.revision});disposed=true;cancel();navigate({type:'trips'});}catch(failure){fail(failure);}finally{busy=false;emit(false);}},
    async leave(){if(disposed)return true;if(busy)return false;if(pendingSave){error='请先重试保存，确认上一笔提交的结果';emit(false);return false;}try{await flush();return true;}catch(failure){fail(failure);return false;}},
    dispose(){disposed=true;cancel();}
  };
}
