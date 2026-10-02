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
  return {overview:()=>call('/api/overview'),trips:()=>call('/api/trips'),trip:id=>call('/api/trips/'+key(id)),cities:q=>call('/api/cities?q='+key(q)),draft:k=>call('/api/drafts/'+key(k)),saveDraft:(k,c)=>call('/api/drafts/'+key(k),'PUT',c),discardDraft:(k,c)=>call('/api/drafts/'+key(k),'DELETE',c),saveTrip:(id,c)=>call('/api/trips/'+key(id),'PUT',c),deleteTrip:(id,revision)=>call('/api/trips/'+key(id),'DELETE',{expectedTripRevision:revision})};
}
