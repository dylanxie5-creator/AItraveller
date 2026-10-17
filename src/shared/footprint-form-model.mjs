import {isDateOnly} from './date.mjs';

function todayValue(today) {
  const value=typeof today==='function'?today():today;
  if(!isDateOnly(value))throw new TypeError('服务端日期无效');
  return value;
}

function validMonth(value) {return typeof value==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);}

export function createFootprintForm({visit=null,today=()=>new Date().toISOString().slice(0,10)}={}) {
  const day=todayValue(today);
  const values=visit?{cityCode:visit.cityCode,datePrecision:visit.datePrecision,dateStart:visit.dateStart,note:visit.note??''}:{cityCode:'',datePrecision:'year',dateStart:'',note:''};
  const allowed=new Set(['cityCode','datePrecision','dateStart','note']);
  let errors={},firstError=null,validated=false;

  function validate() {
    errors={};
    if(typeof values.cityCode!=='string'||!/^\d{6}$/.test(values.cityCode))errors.cityCode='请选择有效城市';
    if(!['year','month','day'].includes(values.datePrecision))errors.datePrecision='请选择日期精度';
    else if(values.datePrecision==='year'&&(!/^\d{4}$/.test(values.dateStart)||values.dateStart>day.slice(0,4)))errors.dateStart='到访年份不能晚于今年';
    else if(values.datePrecision==='month'&&(!validMonth(values.dateStart)||values.dateStart>day.slice(0,7)))errors.dateStart='到访月份不能晚于当前月份';
    else if(values.datePrecision==='day'&&(!isDateOnly(values.dateStart)||values.dateStart>=day))errors.dateStart='到访日期必须早于今天';
    if(typeof values.note!=='string'||[...values.note.trim()].length>200)errors.note='备注最多200字';
    firstError=Object.keys(errors)[0]??null;validated=!firstError;return validated;
  }

  return {
    snapshot:()=>({values:{...values},errors:{...errors},firstError}),
    setField(name,value) {
      if(!allowed.has(name))throw new TypeError('未知足迹字段');
      if(name==='datePrecision'&&value!==values.datePrecision)values.dateStart='';
      values[name]=value;delete errors[name];if(firstError===name)firstError=null;validated=false;
    },
    validate,
    toInput() {
      if(!validated)throw new Error('请先完成表单验证');
      return {cityCode:values.cityCode,datePrecision:values.datePrecision,dateStart:values.dateStart,note:values.note};
    },
  };
}
