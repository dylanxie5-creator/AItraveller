export function parseRoute(hash) {
  const path=String(hash??'').replace(/^#/,'');
  if(path==='/trips')return {type:'trips'};if(path==='/new')return {type:'new'};
  const match=/^\/trips\/([a-zA-Z0-9_-]{1,80})(\/edit)?$/.exec(path);
  return match?{type:match[2]?'edit':'detail',id:match[1]}:{type:'home'};
}
export function navigate(route) {location.hash=route.type==='home'?'/':route.type==='trips'?'/trips':route.type==='new'?'/new':`/trips/${route.id}${route.type==='edit'?'/edit':''}`;}
