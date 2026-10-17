import {HttpError} from './request-guards.mjs';

export async function routeMapApi(settings,method,path,body) {
  if(path==='/api/map-settings'){if(method==='GET')return {status:200,data:settings.getPublic()};if(method==='PUT')return {status:200,data:await settings.update(body)};}
  if(path==='/api/map-session'&&method==='GET')return {status:200,data:await settings.resolveSession()};
  throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
}
