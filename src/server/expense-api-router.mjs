import {HttpError} from './request-guards.mjs';

export function routeExpenseApi(expenses,method,path,body) {
  const overview=/^\/api\/trips\/([a-zA-Z0-9_-]{1,80})\/expenses$/.exec(path);
  if(overview&&method==='GET')return {status:200,data:expenses.getOverview(overview[1])};
  const expense=/^\/api\/trips\/([a-zA-Z0-9_-]{1,80})\/expenses\/([a-zA-Z0-9_-]{1,80})$/.exec(path);
  if(expense){if(method==='GET')return {status:200,data:expenses.getExpense(expense[1],expense[2])};if(method==='PUT')return {status:200,data:expenses.saveExpense(expense[1],expense[2],body)};if(method==='DELETE')return {status:200,data:expenses.deleteExpense(expense[1],expense[2],body)};}
  const categoryList=/^\/api\/trips\/([a-zA-Z0-9_-]{1,80})\/expense-categories$/.exec(path);
  if(categoryList&&method==='GET')return {status:200,data:expenses.listCategories(categoryList[1])};
  const category=/^\/api\/trips\/([a-zA-Z0-9_-]{1,80})\/expense-categories\/(custom:[a-zA-Z0-9_-]{1,70})$/.exec(path);
  if(category){if(method==='PUT')return {status:200,data:expenses.saveCategory(category[1],category[2],body)};if(method==='DELETE')return {status:200,data:expenses.deleteCategory(category[1],category[2],body)};}
  throw new HttpError(404,'NOT_FOUND','页面或记录不存在');
}
