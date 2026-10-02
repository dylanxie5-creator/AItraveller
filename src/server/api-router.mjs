import {searchCities} from '../domain/city-catalog.mjs';
import {HttpError} from './request-guards.mjs';
export function routeApi(service,method,path,query,body) {
  if(method==='GET'&&path==='/api/overview')return service.getOverview();
  if(method==='GET'&&path==='/api/cities')return searchCities(query.get('q'));
  if(method==='GET'&&path==='/api/trips')return service.listTrips();
  const trip=/^\/api\/trips\/([a-zA-Z0-9_-]{1,80})$/.exec(path);
  if(trip){if(method==='GET')return service.getTrip(trip[1]);if(method==='PUT')return service.saveTrip(trip[1],body);if(method==='DELETE')return service.deleteTrip(trip[1],body.expectedTripRevision);}
  const draft=/^\/api\/drafts\/(new|edit:[a-zA-Z0-9_-]{1,80})$/.exec(path);
  if(draft){if(method==='GET')return service.getDraft(draft[1]);if(method==='PUT')return service.saveDraft(draft[1],body);if(method==='DELETE')return service.discardDraft(draft[1],body);}
  throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
}
