import {isDateOnly} from './date.mjs';
import {yuanToCents} from './money.mjs';
export class ValidationError extends Error {
  constructor(fields) { super('请检查填写内容'); this.name='ValidationError'; this.code='VALIDATION'; this.fields=fields; }
}
export function validateBasicInfo(input={}) {
  const errors={};
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100) errors.name='请填写行程名称（最多100字）';
  if(!isDateOnly(input.startDate)) errors.startDate='请选择有效的开始日期';
  if(!isDateOnly(input.endDate)||(!errors.startDate&&input.endDate<input.startDate)) errors.endDate='结束日期不能早于开始日期';
  if(!Number.isSafeInteger(input.travelerCount)||input.travelerCount<1) errors.travelerCount='出行人数至少为1人';
  if(input.budgetYuan!==''&&input.budgetYuan!==null&&input.budgetYuan!==undefined&&yuanToCents(input.budgetYuan)===null) errors.budgetYuan='预算需大于0，最多两位小数';
  return errors;
}
export function validateCities(input={},cities=[],resolveCity) {
  if(!Array.isArray(cities)||!cities.length) return {cities:'请至少添加一个城市'};
  const errors={};const seen=new Set();
  cities.forEach((city,index)=>{
    const key=`city_${index}`;
    if(!city||typeof city.cityCode!=='string'||!resolveCity(city.cityCode)) {errors[key]='请选择有效城市';return;}
    if(seen.has(city.cityCode)) errors[key]='同一行程不能重复城市';seen.add(city.cityCode);
    if(!isDateOnly(city.arrivalDate)||!isDateOnly(city.departureDate)||city.arrivalDate>city.departureDate) errors[key]='请填写有效的城市到离日期';
    else if(city.arrivalDate<input.startDate||city.departureDate>input.endDate) errors[key]='城市日期须在行程范围内';
  });
  if(Object.keys(errors).length) return errors;
  for(let i=1;i<cities.length;i++) {
    if(cities[i].arrivalDate<cities[i-1].departureDate) errors[`city_${i}`]='城市路线时间须按先后顺序，不可重叠';
    for(let j=0;j<i-1;j++) if(cities[i].arrivalDate<=cities[j].departureDate) errors[`city_${i}`]='非相邻城市不能共用日期';
  }
  return errors;
}
export function normalizeTripInput(input,resolveCity) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new ValidationError({form:'请输入有效行程'});
  const fields={...validateBasicInfo(input),...validateCities(input,input.cities,resolveCity)};
  if(Object.keys(fields).length) throw new ValidationError(fields);
  return {name:input.name.trim(),startDate:input.startDate,endDate:input.endDate,travelerCount:input.travelerCount,budgetCents:input.budgetYuan?yuanToCents(input.budgetYuan):null,cities:input.cities.map((city,order)=>{
    const known=resolveCity(city.cityCode);
    return {cityCode:known.cityCode,cityName:known.cityName,provinceCode:known.provinceCode,provinceName:known.provinceName,arrivalDate:city.arrivalDate,departureDate:city.departureDate,order};
  })};
}
