function freeze(value) {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}

export function createArchiveController({api,render,print}={}) {
  let sequence=0,disposed=false,current=null;
  const emit=state=>{current=state;if(!disposed)render(state);};
  return {
    async load(route) {
      if(disposed)return;const token=++sequence;emit({type:'archive-loading',route});
      try {
        const value=route.type==='trip-archive-print'?await api.tripArchive(route.id):await api.travelArchive();if(disposed||token!==sequence)return;
        const report=freeze(structuredClone(value));
        if(report.kind==='archive'&&!report.trips.length)emit({type:'archive-empty',route,report});
        else emit({type:route.type==='archive-home'?'archive-home':'archive-report',route,report});
      } catch(error) {if(!disposed&&token===sequence)emit({type:'archive-error',route,message:error?.message??'档案加载失败，请重试'});}
    },
    print() {if(!disposed&&current?.type==='archive-report')print();},
    dispose() {disposed=true;sequence++;},
    snapshot:()=>current,
  };
}
