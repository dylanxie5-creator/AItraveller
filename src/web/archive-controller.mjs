function freeze(value) {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}

export function createArchiveController({api,render}={}) {
  let sequence=0,disposed=false,current=null;
  const emit=state=>{current=state;if(!disposed)render(state);};
  return {
    async load(route={type:'archive-home'}) {
      if(disposed)return;const safeRoute={type:'archive-home'},token=++sequence;emit({type:'archive-loading',route:safeRoute});
      try {
        const value=await api.travelArchive();if(disposed||token!==sequence)return;const report=freeze(structuredClone(value));
        emit(report.kind==='archive'&&!report.trips.length?{type:'archive-empty',route:safeRoute,report}:{type:'archive-home',route:safeRoute,report});
      } catch(error) {if(!disposed&&token===sequence)emit({type:'archive-error',route:safeRoute,message:error?.message??'档案加载失败，请重试'});}
    },
    dispose() {disposed=true;sequence++;},
    snapshot:()=>current,
  };
}
