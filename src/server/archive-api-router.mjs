import {HttpError} from './request-guards.mjs';

export function routeArchiveApi(archives,method,path) {
  if(method==='GET'&&path==='/api/archive')return {status:200,data:archives.getTravelArchive()};
  const trip=/^\/api\/archive\/trips\/([a-zA-Z0-9_-]{1,80})$/u.exec(path);
  if(method==='GET'&&trip)return {status:200,data:archives.getTripArchive(trip[1])};
  throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
}
