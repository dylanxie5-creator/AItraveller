import {isDateOnly} from '../shared/date.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';

function amountToCents(value) {
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(text.length>32||!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text))return null;
  const [whole,decimal='']=text.split('.');
  const cents=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'));
  return cents>0n&&cents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cents):null;
}

export function normalizeExpenseInput(input,{trip,catalog,previous=null}={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ValidationError({form:'请输入有效花销'});
  if(!trip||typeof trip.id!=='string'||!isDateOnly(trip.startDate)||!isDateOnly(trip.endDate)||!Array.isArray(trip.cities)||!catalog?.resolve)throw new ValidationError({form:'所属行程无效'});
  const fields={};
  const amountCents=amountToCents(input.amountYuan);
  if(amountCents===null)fields.amountYuan='金额需大于0，最多两位小数';
  const categoryId=typeof input.categoryId==='string'?input.categoryId.trim():'';
  if(!categoryId||!catalog.resolve(categoryId))fields.categoryId='请选择有效分类';
  const spentDate=typeof input.spentDate==='string'?input.spentDate:'';
  if(!isDateOnly(spentDate)||spentDate<trip.startDate||spentDate>trip.endDate)fields.spentDate='花销日期须在行程范围内';
  const note=typeof input.note==='string'?input.note.trim():'';
  if(typeof input.note!=='string'||[...note].length>200)fields.note='备注最多200字';
  const rawCity=input.cityCode===null||input.cityCode===undefined||input.cityCode===''?null:input.cityCode;
  let cityCode=null,cityName=null;
  if(rawCity!==null) {
    if(typeof rawCity!=='string'||!/^\d{6}$/.test(rawCity))fields.cityCode='请选择当前行程城市';
    else {
      const current=trip.cities.find(city=>city?.cityCode===rawCity);
      if(current&&typeof current.cityName==='string'&&current.cityName){cityCode=current.cityCode;cityName=current.cityName;}
      else if(previous?.tripId===trip.id&&previous.cityCode===rawCity&&typeof previous.cityName==='string'&&previous.cityName){cityCode=rawCity;cityName=previous.cityName;}
      else fields.cityCode='请选择当前行程城市';
    }
  }
  if(Object.keys(fields).length)throw new ValidationError(fields);
  return {amountCents,categoryId,cityCode,cityName,spentDate,note};
}
