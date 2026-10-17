import {compareVisits,validateStoredVisit} from './validation.mjs';

function safeAdd(left,right) {
  const value=left+right;
  if(!Number.isSafeInteger(value))throw new RangeError('城市花销总额超出安全范围');
  return value;
}

export function summarizeFootprints(visits) {
  if(!Array.isArray(visits))throw new TypeError('足迹数据无效');
  const provinces=new Set(),cities=new Set();
  for(const candidate of visits) {const visit=validateStoredVisit(candidate);provinces.add(visit.provinceCode);cities.add(visit.cityCode);}
  return {provinceCount:provinces.size,cityCount:cities.size,visitCount:visits.length};
}

export function presentFootprintGroups({visits,expenses=[]}={}) {
  if(!Array.isArray(visits)||!Array.isArray(expenses))throw new TypeError('足迹展示数据无效');
  const presented=visits.map(validateStoredVisit).sort(compareVisits);
  const expensesByTripCity=new Map();
  for(const expense of expenses) {
    if(!expense||typeof expense.tripId!=='string'||!Number.isSafeInteger(expense.amountCents)||expense.amountCents<=0)throw new TypeError('花销记录无效');
    if(expense.cityCode===null)continue;
    if(typeof expense.cityCode!=='string'||!/^\d{6}$/.test(expense.cityCode))throw new TypeError('花销城市无效');
    const key=`${expense.tripId}\n${expense.cityCode}`;
    expensesByTripCity.set(key,safeAdd(expensesByTripCity.get(key)??0,expense.amountCents));
  }
  const cityMap=new Map();
  for(const visit of presented) {
    let city=cityMap.get(visit.cityCode);
    if(!city) {city={cityCode:visit.cityCode,cityName:visit.cityName,provinceCode:visit.provinceCode,provinceName:visit.provinceName,visitCount:0,totalCents:0,tripExpenses:[],visits:[]};cityMap.set(visit.cityCode,city);}
    city.visitCount++;city.visits.push(structuredClone(visit));
    if(visit.linkedTripId) {
      const totalCents=expensesByTripCity.get(`${visit.linkedTripId}\n${visit.cityCode}`)??0;
      city.totalCents=safeAdd(city.totalCents,totalCents);
      city.tripExpenses.push({tripId:visit.linkedTripId,totalCents});
    }
  }
  const cities=[...cityMap.values()].map(city=>({...city,tripExpenses:city.tripExpenses.map(item=>({...item})),visits:city.visits.map(item=>({...item}))})).sort((a,b)=>a.provinceCode.localeCompare(b.provinceCode)||a.cityCode.localeCompare(b.cityCode));
  const provinceMap=new Map();
  for(const city of cities) {
    let province=provinceMap.get(city.provinceCode);
    if(!province) {province={provinceCode:city.provinceCode,provinceName:city.provinceName,cityCount:0,visitCount:0,totalCents:0,cities:[]};provinceMap.set(city.provinceCode,province);}
    province.cityCount++;province.visitCount+=city.visitCount;province.totalCents=safeAdd(province.totalCents,city.totalCents);province.cities.push({...city});
  }
  const provinces=[...provinceMap.values()].sort((a,b)=>a.provinceCode.localeCompare(b.provinceCode));
  return {summary:summarizeFootprints(presented),provinces,cities,visits:presented.map(item=>({...item}))};
}
