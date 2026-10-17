export function parseRoute(hash) {
  const path=String(hash??'').replace(/^#/,'');
  if(path==='/ai/settings')return {type:'ai-settings'};
  if(path==='/ai/new')return {type:'ai-new'};
  if(path==='/ai/plans')return {type:'ai-plans'};
  if(path==='/footprints')return {type:'footprints'};
  if(path==='/footprints/new')return {type:'footprint-new'};
  if(path==='/footprints/manage')return {type:'footprint-manage'};
  if(path==='/footprints/settings')return {type:'footprint-settings'};
  let footprint=/^\/footprints\/provinces\/(\d{6})$/.exec(path);if(footprint)return {type:'footprint-province',provinceCode:footprint[1]};
  footprint=/^\/footprints\/cities\/(\d{6})$/.exec(path);if(footprint)return {type:'footprint-city',cityCode:footprint[1]};
  footprint=/^\/footprints\/visits\/([a-zA-Z0-9_-]{1,80})\/edit$/.exec(path);if(footprint)return {type:'footprint-edit',visitId:footprint[1]};
  let ai=/^\/ai\/jobs\/([a-zA-Z0-9_-]{1,80})$/.exec(path);
  if(ai)return {type:'ai-job',id:ai[1]};
  ai=/^\/ai\/plans\/([a-zA-Z0-9_-]{1,80})(\/edit)?$/.exec(path);
  if(ai)return {type:ai[2]?'ai-plan-edit':'ai-plan',id:ai[1]};
  if(path==='/trips')return {type:'trips'};if(path==='/new')return {type:'new'};
  let expense=/^\/trips\/([a-zA-Z0-9_-]{1,80})\/expenses$/.exec(path);if(expense)return {type:'expenses',id:expense[1]};
  expense=/^\/trips\/([a-zA-Z0-9_-]{1,80})\/expenses\/new$/.exec(path);if(expense)return {type:'expense-new',id:expense[1]};
  expense=/^\/trips\/([a-zA-Z0-9_-]{1,80})\/expenses\/([a-zA-Z0-9_-]{1,80})\/edit$/.exec(path);if(expense)return {type:'expense-edit',id:expense[1],expenseId:expense[2]};
  expense=/^\/trips\/([a-zA-Z0-9_-]{1,80})\/expense-categories$/.exec(path);if(expense)return {type:'expense-categories',id:expense[1]};
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
  if(route.type==='footprints')return '#/footprints';
  if(route.type==='footprint-new')return '#/footprints/new';
  if(route.type==='footprint-manage')return '#/footprints/manage';
  if(route.type==='footprint-settings')return '#/footprints/settings';
  if(route.type==='footprint-province')return `#/footprints/provinces/${route.provinceCode}`;
  if(route.type==='footprint-city')return `#/footprints/cities/${route.cityCode}`;
  if(route.type==='footprint-edit')return `#/footprints/visits/${route.visitId}/edit`;
  if(route.type==='ai-job')return `#/ai/jobs/${route.id}`;
  if(route.type==='ai-plan'||route.type==='ai-plan-edit')return `#/ai/plans/${route.id}${route.type==='ai-plan-edit'?'/edit':''}`;
  if(route.type==='expenses')return `#/trips/${route.id}/expenses`;
  if(route.type==='expense-new')return `#/trips/${route.id}/expenses/new`;
  if(route.type==='expense-edit')return `#/trips/${route.id}/expenses/${route.expenseId}/edit`;
  if(route.type==='expense-categories')return `#/trips/${route.id}/expense-categories`;
  return `#/trips/${route.id}${route.type==='edit'?'/edit':''}`;
}
export function navigate(route) {location.hash=routeToHash(route).slice(1);}
