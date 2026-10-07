import {HttpError} from './request-guards.mjs';

const found=(value,message='记录不存在')=>{if(value===null||value===undefined)throw new HttpError(404,'NOT_FOUND',message);return value;};

export async function routeAiApi({settings,jobs,plans},method,path,body) {
  if(method==='GET'&&path==='/api/ai/settings')return {status:200,data:settings.getPublic()};
  if(method==='PUT'&&path==='/api/ai/settings')return {status:200,data:await settings.update(body)};
  if(method==='POST'&&path==='/api/ai/jobs')return {status:202,data:await jobs.submit(body)};
  if(method==='GET'&&path==='/api/ai/jobs')return {status:200,data:jobs.list()};
  const job=/^\/api\/ai\/jobs\/([a-zA-Z0-9_-]{1,80})$/u.exec(path);
  if(method==='GET'&&job)return {status:200,data:found(jobs.get(job[1]),'规划任务不存在')};
  if(method==='GET'&&path==='/api/ai/plans')return {status:200,data:plans.list()};
  const plan=/^\/api\/ai\/plans\/([a-zA-Z0-9_-]{1,80})$/u.exec(path);
  if(method==='GET'&&plan)return {status:200,data:found(plans.get(plan[1]),'攻略不存在')};
  if(method==='PUT'&&plan)return {status:200,data:plans.update(plan[1],body)};
  const convert=/^\/api\/ai\/plans\/([a-zA-Z0-9_-]{1,80})\/convert$/u.exec(path);
  if(method==='POST'&&convert)return {status:200,data:plans.convert(convert[1],body)};
  const guide=/^\/api\/ai\/trips\/([a-zA-Z0-9_-]{1,80})\/guide$/u.exec(path);
  if(method==='GET'&&guide)return {status:200,data:found(plans.forTrip(guide[1]),'关联攻略不存在')};
  throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
}
