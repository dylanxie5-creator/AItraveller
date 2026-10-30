import {HttpError} from './request-guards.mjs';

export async function routeArchiveApi({archives,archivePdf},method,path) {
  if(method==='GET'&&path==='/api/archive.pdf') {
    if(!archivePdf)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
    return {status:200,download:await archivePdf.getTravelPdf()};
  }
  const tripPdf=/^\/api\/archive\/trips\/([a-zA-Z0-9_-]{1,80})\.pdf$/u.exec(path);
  if(method==='GET'&&tripPdf) {
    if(!archivePdf)throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
    return {status:200,download:await archivePdf.getTripPdf(tripPdf[1])};
  }
  if(method==='GET'&&path==='/api/archive')return {status:200,data:archives.getTravelArchive()};
  const trip=/^\/api\/archive\/trips\/([a-zA-Z0-9_-]{1,80})$/u.exec(path);
  if(method==='GET'&&trip)return {status:200,data:archives.getTripArchive(trip[1])};
  throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
}
