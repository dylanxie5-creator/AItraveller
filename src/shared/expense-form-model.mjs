import {normalizeExpenseInput} from '../expenses/validation.mjs';

const centsToYuan=cents=>(cents/100).toFixed(2);

export function createExpenseForm({trip,expense=null,categories,today=()=>new Date().toISOString().slice(0,10)}) {
  if(!trip||!Array.isArray(trip.cities)||!Array.isArray(categories))throw new TypeError('花销表单数据无效');
  const day=today(),initialDate=day>=trip.startDate&&day<=trip.endDate?day:trip.startDate;
  const values=expense?{amountYuan:centsToYuan(expense.amountCents),categoryId:expense.categoryId,cityCode:expense.cityCode,spentDate:expense.spentDate,note:expense.note}:{amountYuan:'',categoryId:categories[0]?.id??'',cityCode:null,spentDate:initialDate,note:''};
  let errors={},firstError=null;
  const allowed=new Set(['amountYuan','categoryId','cityCode','spentDate','note']);
  const catalog={resolve:id=>categories.find(item=>item.id===id)??null};
  const previous=expense?{...expense,tripId:trip.id}:null;
  const cityOptions=[{value:null,label:'整个行程',state:'trip'},...trip.cities.map(city=>({value:city.cityCode,label:city.cityName,state:'current'}))];
  if(expense?.cityCode&&!trip.cities.some(city=>city.cityCode===expense.cityCode))cityOptions.push({value:expense.cityCode,label:`${expense.cityName}（已移出路线）`,state:'removed'});
  function validate() {
    try{normalizeExpenseInput(values,{trip,catalog,previous});errors={};firstError=null;return true;}
    catch(error){if(error?.code!=='VALIDATION')throw error;errors={...error.fields};firstError=Object.keys(errors)[0]??null;return false;}
  }
  return {
    snapshot:()=>({values:{...values},errors:{...errors},firstError,cityOptions:cityOptions.map(item=>({...item}))}),
    setField(name,value){if(!allowed.has(name))throw new TypeError('未知花销字段');values[name]=value;delete errors[name];if(firstError===name)firstError=null;},
    validate,
    toInput:()=>({...values}),
  };
}
