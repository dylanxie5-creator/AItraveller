import {createExpenseForm} from '../shared/expense-form-model.mjs';

export function createExpenseController({api,render,navigate,confirm=()=>false,today,createId=()=>crypto.randomUUID()}) {
  let sequence=0,disposed=false,busy=false,current=null,route=null,form=null,pendingCommand=null,error='';
  const snapshot=()=>form?{...form.snapshot(),type:'expense-form',route,trip:current?.trip,categories:current?.categories??[],busy,error,pendingCommand:pendingCommand?structuredClone(pendingCommand):null}:current?{...current,busy,error}:null;
  const emit=()=>{if(!disposed&&current)render(snapshot());};
  const fail=failure=>{error=failure?.message??'操作失败，请重试';emit();};
  async function load(nextRoute) {
    const token=++sequence;route=nextRoute;form=null;pendingCommand=null;error='';if(!disposed)render({type:'expense-loading',route:nextRoute});
    try {
      if(nextRoute.type==='expenses'){const overview=await api.expenseOverview(nextRoute.id);current={type:'expenses',route:nextRoute,overview};}
      else if(nextRoute.type==='expense-categories'){const overview=await api.expenseOverview(nextRoute.id);current={type:'expense-categories',route:nextRoute,trip:overview.trip,categories:overview.categories};}
      else if(nextRoute.type==='expense-new'){const overview=await api.expenseOverview(nextRoute.id);current={type:'expense-form',route:nextRoute,trip:overview.trip,categories:overview.categories,expense:null};form=createExpenseForm({trip:overview.trip,categories:overview.categories,today});}
      else if(nextRoute.type==='expense-edit'){const [overview,expense]=await Promise.all([api.expenseOverview(nextRoute.id),api.expense(nextRoute.id,nextRoute.expenseId)]);current={type:'expense-form',route:nextRoute,trip:overview.trip,categories:overview.categories,expense};form=createExpenseForm({trip:overview.trip,expense,categories:overview.categories,today});}
      else throw {code:'NOT_FOUND',message:'页面不存在'};
      if(token!==sequence||disposed)return;emit();
    }catch(failure){if(token===sequence&&!disposed){current={type:'expense-error',route:nextRoute};fail(failure);}}
  }
  function setField(name,value){if(disposed||busy||!form)return;form.setField(name,value);error='';emit();}
  async function save() {
    if(disposed||busy||!form)return;busy=true;emit();
    try {
      if(!form.validate()){pendingCommand=null;error='请检查填写内容';emit();return;}
      const expenseId=route.type==='expense-edit'?route.expenseId:(pendingCommand?.expenseId??createId());
      if(!pendingCommand)pendingCommand={expenseId,operationId:createId(),expectedRevision:current.expense?.revision??0,input:form.toInput()};
      const {expenseId:entityId,...command}=pendingCommand;await api.saveExpense(route.id,entityId,command);
      pendingCommand=null;error='';if(!disposed)navigate({type:'expenses',id:route.id});
    }catch(failure){fail(failure);}finally{busy=false;emit();}
  }
  async function deleteExpense(expense) {
    if(disposed||busy||!await confirm('确定删除这笔花销吗？'))return;busy=true;emit();
    try{await api.deleteExpense(expense.tripId??route?.id,expense.id,{operationId:createId(),expectedRevision:expense.revision});if(!disposed)navigate({type:'expenses',id:expense.tripId??route?.id});}catch(failure){fail(failure);}finally{busy=false;emit();}
  }
  async function saveCategory(command) {
    if(disposed||busy)return;busy=true;emit();
    try{await api.saveExpenseCategory(command.tripId,command.id,{operationId:createId(),expectedRevision:command.expectedRevision,name:command.name});error='';}catch(failure){fail(failure);}finally{busy=false;emit();}
  }
  async function deleteCategory(category) {
    if(disposed||busy||!await confirm('确定删除这个分类吗？'))return;busy=true;emit();
    try{await api.deleteExpenseCategory(category.tripId??route?.id,category.id,{operationId:createId(),expectedRevision:category.revision});error='';}catch(failure){fail(failure);}finally{busy=false;emit();}
  }
  return {load,setField,save,retrySave:save,deleteExpense,saveCategory,deleteCategory,dispose(){disposed=true;sequence++;},snapshot};
}
