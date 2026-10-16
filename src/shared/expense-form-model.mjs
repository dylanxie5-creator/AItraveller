const centsToYuan=cents=>(cents/100).toFixed(2);
const isDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function createExpenseForm({trip,expense=null,categories,today=()=>new Date().toISOString().slice(0,10)}) {
  if(!trip||!Array.isArray(trip.cities)||!Array.isArray(categories))throw new TypeError('花销表单数据无效');
  const day=today(),initialDate=day>=trip.startDate&&day<=trip.endDate?day:trip.startDate;
  const values=expense?{amountYuan:centsToYuan(expense.amountCents),categoryId:expense.categoryId,cityCode:expense.cityCode,spentDate:expense.spentDate,note:expense.note}:{amountYuan:'',categoryId:categories[0]?.id??'',cityCode:null,spentDate:initialDate,note:''};
  let errors={},firstError=null;
  const allowed=new Set(['amountYuan','categoryId','cityCode','spentDate','note']);
  const cityOptions=[{value:null,label:'整个行程',state:'trip'},...trip.cities.map(city=>({value:city.cityCode,label:city.cityName,state:'current'}))];
  if(expense?.cityCode&&!trip.cities.some(city=>city.cityCode===expense.cityCode))cityOptions.push({value:expense.cityCode,label:`${expense.cityName}（已移出路线）`,state:'removed'});
  function validate() {
    errors={};const amount=typeof values.amountYuan==='string'?values.amountYuan.trim():'';
    if(amount.length>32||!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)||Number(amount)<=0)errors.amountYuan='金额需大于0，最多两位小数';
    if(!categories.some(item=>item.id===values.categoryId))errors.categoryId='请选择有效分类';
    if(!isDate(values.spentDate)||values.spentDate<trip.startDate||values.spentDate>trip.endDate)errors.spentDate='花销日期须在行程范围内';
    if(typeof values.note!=='string'||[...values.note.trim()].length>200)errors.note='备注最多200字';
    if(values.cityCode!==null&&!trip.cities.some(city=>city.cityCode===values.cityCode)&&expense?.cityCode!==values.cityCode)errors.cityCode='请选择当前行程城市';
    firstError=Object.keys(errors)[0]??null;return !firstError;
  }
  return {
    snapshot:()=>({values:{...values},errors:{...errors},firstError,cityOptions:cityOptions.map(item=>({...item}))}),
    setField(name,value){if(!allowed.has(name))throw new TypeError('未知花销字段');values[name]=value;delete errors[name];if(firstError===name)firstError=null;},
    validate,
    toInput:()=>({...values}),
  };
}
