export function createApiClient({fetchImpl=globalThis.fetch,baseUrl=''}={}) {
  async function call(path,method='GET',body) {
    let response;
    try{response=await fetchImpl(baseUrl+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch{throw {status:0,code:'NETWORK',message:'本机服务未连接，请确认网站已启动后重试'};}
    let payload;try{payload=await response.json();}catch{throw {status:response.status,code:'NETWORK',message:'服务返回异常，请重试'};}
    if(!response.ok)throw {status:response.status,...payload.error};
    return payload.data;
  }
  const key=k=>encodeURIComponent(k);
  return {
    overview:()=>call('/api/overview'),trips:()=>call('/api/trips'),trip:id=>call('/api/trips/'+key(id)),cities:q=>call('/api/cities?q='+key(q)),
    draft:k=>call('/api/drafts/'+key(k)),saveDraft:(k,c)=>call('/api/drafts/'+key(k),'PUT',c),discardDraft:(k,c)=>call('/api/drafts/'+key(k),'DELETE',c),
    saveTrip:(id,c)=>call('/api/trips/'+key(id),'PUT',c),deleteTrip:(id,revision)=>call('/api/trips/'+key(id),'DELETE',{expectedTripRevision:revision}),
    expenseOverview:id=>call('/api/trips/'+key(id)+'/expenses'),expense:(tripId,id)=>call('/api/trips/'+key(tripId)+'/expenses/'+key(id)),
    saveExpense:(tripId,id,command)=>call('/api/trips/'+key(tripId)+'/expenses/'+key(id),'PUT',command),deleteExpense:(tripId,id,command)=>call('/api/trips/'+key(tripId)+'/expenses/'+key(id),'DELETE',command),
    expenseCategories:id=>call('/api/trips/'+key(id)+'/expense-categories'),saveExpenseCategory:(tripId,id,command)=>call('/api/trips/'+key(tripId)+'/expense-categories/'+key(id),'PUT',command),deleteExpenseCategory:(tripId,id,command)=>call('/api/trips/'+key(tripId)+'/expense-categories/'+key(id),'DELETE',command),
    syncFootprints:()=>call('/api/footprints/sync','POST',{}),footprintOverview:()=>call('/api/footprints'),footprintProvince:code=>call('/api/footprints/provinces/'+key(code)),footprintCity:code=>call('/api/footprints/cities/'+key(code)),footprintManage:()=>call('/api/footprints/manage'),footprintVisit:id=>call('/api/footprints/visits/'+key(id)),
    saveFootprintVisit:(id,command)=>call('/api/footprints/visits/'+key(id),'PUT',command),deleteFootprintVisit:(id,command)=>call('/api/footprints/visits/'+key(id),'DELETE',command),suppressFootprint:(tripId,cityCode,command)=>call('/api/footprints/suppressions/'+key(tripId)+'/'+key(cityCode),'PUT',command),restoreFootprint:(tripId,cityCode,command)=>call('/api/footprints/suppressions/'+key(tripId)+'/'+key(cityCode),'DELETE',command),
    mapSettings:()=>call('/api/map-settings'),saveMapSettings:command=>call('/api/map-settings','PUT',command),mapSession:()=>call('/api/map-session'),
    aiSettings:()=>call('/api/ai/settings'),saveAiSettings:command=>call('/api/ai/settings','PUT',command),
    aiJobs:()=>call('/api/ai/jobs'),aiJob:id=>call('/api/ai/jobs/'+key(id)),startAiJob:command=>call('/api/ai/jobs','POST',command),
    aiPlans:()=>call('/api/ai/plans'),aiPlan:id=>call('/api/ai/plans/'+key(id)),updateAiPlan:(id,command)=>call('/api/ai/plans/'+key(id),'PUT',command),
    convertAiPlan:(id,command)=>call('/api/ai/plans/'+key(id)+'/convert','POST',command),tripGuide:id=>call('/api/ai/trips/'+key(id)+'/guide')
  };
}
