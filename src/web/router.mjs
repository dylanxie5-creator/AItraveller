export function parseRoute(hash) {
  const path=String(hash??'').replace(/^#/,'');
  if(path==='/ai/settings')return {type:'ai-settings'};
  if(path==='/ai/new')return {type:'ai-new'};
  if(path==='/ai/plans')return {type:'ai-plans'};
  let ai=/^\/ai\/jobs\/([a-zA-Z0-9_-]{1,80})$/.exec(path);
  if(ai)return {type:'ai-job',id:ai[1]};
  ai=/^\/ai\/plans\/([a-zA-Z0-9_-]{1,80})(\/edit)?$/.exec(path);
  if(ai)return {type:ai[2]?'ai-plan-edit':'ai-plan',id:ai[1]};
  if(path==='/trips')return {type:'trips'};if(path==='/new')return {type:'new'};
  const match=/^\/trips\/([a-zA-Z0-9_-]{1,80})(\/edit)?$/.exec(path);
  return match?{type:match[2]?'edit':'detail',id:match[1]}:{type:'home'};
}
export function routeToHash(route) {
  if(route.type==='home')return '#/';
  if(route.type==='trips')return '#/trips';
  if(route.type==='new')return '#/new';
  if(route.type==='ai-settings')return '#/ai/settings';
  if(route.type==='ai-new')return '#/ai/new';
  if(route.type==='ai-plans')return '#/ai/plans';
  if(route.type==='ai-job')return `#/ai/jobs/${route.id}`;
  if(route.type==='ai-plan'||route.type==='ai-plan-edit')return `#/ai/plans/${route.id}${route.type==='ai-plan-edit'?'/edit':''}`;
  return `#/trips/${route.id}${route.type==='edit'?'/edit':''}`;
}
export function navigate(route) {location.hash=routeToHash(route).slice(1);}
