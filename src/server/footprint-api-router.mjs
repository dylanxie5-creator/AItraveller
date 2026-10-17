import {HttpError} from './request-guards.mjs';

export function routeFootprintApi(footprints,method,path,body) {
  if(path==='/api/footprints/sync'&&method==='POST')return {status:200,data:footprints.syncAll()};
  if(path==='/api/footprints'&&method==='GET')return {status:200,data:footprints.getOverview()};
  if(path==='/api/footprints/manage'&&method==='GET')return {status:200,data:footprints.getManagement()};
  const province=/^\/api\/footprints\/provinces\/(\d{6})$/.exec(path);if(province&&method==='GET')return {status:200,data:footprints.getProvince(province[1])};
  const city=/^\/api\/footprints\/cities\/(\d{6})$/.exec(path);if(city&&method==='GET')return {status:200,data:footprints.getCity(city[1])};
  const visit=/^\/api\/footprints\/visits\/([a-zA-Z0-9_-]{1,80})$/.exec(path);if(visit){if(method==='GET')return {status:200,data:footprints.getVisit(visit[1])};if(method==='PUT')return {status:200,data:footprints.saveVisit(visit[1],body)};if(method==='DELETE')return {status:200,data:footprints.deleteVisit(visit[1],body)};}
  const suppression=/^\/api\/footprints\/suppressions\/([a-zA-Z0-9_-]{1,80})\/(\d{6})$/.exec(path);if(suppression){if(method==='PUT')return {status:200,data:footprints.suppress(suppression[1],suppression[2],body)};if(method==='DELETE')return {status:200,data:footprints.restore(suppression[1],suppression[2],body)};}
  throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
}
