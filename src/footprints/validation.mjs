import {isDateOnly} from '../shared/date.mjs';
import {ValidationError} from '../shared/trip-validation.mjs';
import {validId} from '../storage/errors.mjs';

export const DATE_PRECISIONS=Object.freeze(['trip_range','year','month','day']);
export const VISIT_SOURCES=Object.freeze(['trip','manual','detached']);
const codePattern=/^\d{6}$/;
const isoPattern=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function resolveToday(today) {
  const value=typeof today==='function'?today():today;
  if(!isDateOnly(value))throw new TypeError('服务端日期无效');
  return value;
}

function validMonth(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}$/.test(value))return false;
  const month=Number(value.slice(5));return month>=1&&month<=12;
}

function validPartialDate(precision,value) {
  if(precision==='year')return typeof value==='string'&&/^\d{4}$/.test(value);
  if(precision==='month')return validMonth(value);
  if(precision==='day')return isDateOnly(value);
  return false;
}

function validateManualDate(precision,value,today) {
  if(!validPartialDate(precision,value))return false;
  if(precision==='year')return value<=today.slice(0,4);
  if(precision==='month')return value<=today.slice(0,7);
  return value<today;
}

export function normalizeManualVisitInput(input,{resolveCity,today}={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ValidationError({form:'请输入有效足迹'});
  if(typeof resolveCity!=='function')throw new TypeError('城市目录无效');
  const day=resolveToday(today),fields={};
  const city=typeof input.cityCode==='string'?resolveCity(input.cityCode):null;
  if(!city||!codePattern.test(city.cityCode)||!codePattern.test(city.provinceCode)||typeof city.cityName!=='string'||!city.cityName||typeof city.provinceName!=='string'||!city.provinceName)fields.cityCode='请选择有效城市';
  const datePrecision=input.datePrecision;
  if(!['year','month','day'].includes(datePrecision))fields.datePrecision='请选择日期精度';
  const dateStart=typeof input.dateStart==='string'?input.dateStart:'';
  if(!fields.datePrecision&&!validateManualDate(datePrecision,dateStart,day))fields.dateStart=datePrecision==='day'?'到访日期必须早于今天':'到访年月不能晚于当前时期';
  const note=typeof input.note==='string'?input.note.trim():'';
  if(typeof input.note!=='string'||[...note].length>200)fields.note='备注最多200字';
  if(Object.keys(fields).length)throw new ValidationError(fields);
  return {cityCode:city.cityCode,cityName:city.cityName,provinceCode:city.provinceCode,provinceName:city.provinceName,datePrecision,dateStart,dateEnd:null,note};
}

function isIso(value) {return typeof value==='string'&&isoPattern.test(value)&&Number.isFinite(Date.parse(value));}
function bad() {throw new TypeError('足迹记录无效');}

export function validateStoredVisit(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return bad();
  if(!validId(value.id)||!Number.isSafeInteger(value.revision)||value.revision<1)return bad();
  if(!codePattern.test(value.cityCode)||typeof value.cityName!=='string'||!value.cityName||value.cityName.length>100)return bad();
  if(!codePattern.test(value.provinceCode)||typeof value.provinceName!=='string'||!value.provinceName||value.provinceName.length>100)return bad();
  if(!DATE_PRECISIONS.includes(value.datePrecision)||!VISIT_SOURCES.includes(value.source))return bad();
  if(value.datePrecision==='trip_range') {
    if(!isDateOnly(value.dateStart)||!isDateOnly(value.dateEnd)||value.dateEnd<value.dateStart)return bad();
  } else if(!validPartialDate(value.datePrecision,value.dateStart)||value.dateEnd!==null)return bad();
  if(typeof value.note!=='string'||[...value.note].length>200)return bad();
  if(value.source==='trip') {
    if(!validId(value.linkedTripId)||value.datePrecision!=='trip_range')return bad();
  } else if(value.linkedTripId!==null)return bad();
  if(value.tripNameSnapshot!==null&&(typeof value.tripNameSnapshot!=='string'||!value.tripNameSnapshot||value.tripNameSnapshot.length>100))return bad();
  if(value.source==='trip'&&value.tripNameSnapshot===null)return bad();
  if(!isIso(value.createdAt)||!isIso(value.updatedAt))return bad();
  return structuredClone(value);
}

function formatDay(value,includeYear=true) {
  const [year,month,day]=value.split('-').map(Number);
  return `${includeYear?`${year}年`:''}${month}月${day}日`;
}

export function formatVisitDate(visit) {
  if(visit.datePrecision==='year')return `${Number(visit.dateStart)}年`;
  if(visit.datePrecision==='month') {const [year,month]=visit.dateStart.split('-').map(Number);return `${year}年${month}月`;}
  if(visit.datePrecision==='day')return formatDay(visit.dateStart);
  if(visit.datePrecision==='trip_range')return `${formatDay(visit.dateStart)}—${formatDay(visit.dateEnd,visit.dateEnd.slice(0,4)!==visit.dateStart.slice(0,4))}`;
  throw new TypeError('足迹日期无效');
}

export function compareVisits(left,right) {
  return right.dateStart.localeCompare(left.dateStart)||right.updatedAt.localeCompare(left.updatedAt)||left.id.localeCompare(right.id);
}
