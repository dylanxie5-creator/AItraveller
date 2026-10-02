import {validateBasicInfo,validateCities} from './trip-validation.mjs';
import {formatCents} from './money.mjs';
const steps=['basic','route','confirm'];
export function createTripForm({trip=null,slot=null,createId=()=>crypto.randomUUID()}={}) {
  const input=slot?.input?structuredClone(slot.input):trip?{name:trip.name,startDate:trip.startDate,endDate:trip.endDate,travelerCount:trip.travelerCount,budgetYuan:trip.budgetCents===null?'':formatCents(trip.budgetCents).replaceAll(',',''),cities:structuredClone(trip.cities)}:{name:'',startDate:'',endDate:'',travelerCount:1,budgetYuan:'',cities:[]};
  input.cities=Array.isArray(input.cities)?input.cities:[];
  const state={id:slot?.targetTripId??trip?.id??createId(),baseTripRevision:slot?.baseTripRevision??trip?.revision??0,step:slot?.step??'basic',input,errors:{}};
  const snapshot=()=>structuredClone(state);
  function clearErrors(){state.errors={};}
  function validate(){state.errors={...validateBasicInfo(state.input)};if(state.step!=='basic')Object.assign(state.errors,validateCities(state.input,state.input.cities,code=>state.input.cities.find(c=>c.cityCode===code)));return !Object.keys(state.errors).length;}
  return {snapshot,toInput:()=>structuredClone(state.input),change(field,value){if(!['name','startDate','endDate','travelerCount','budgetYuan'].includes(field))return;state.input[field]=field==='travelerCount'?Number(value):value;clearErrors();},
    addCity(city){if(!city?.cityCode||state.input.cities.some(c=>c.cityCode===city.cityCode)){state.errors.cities='这个城市已经在路线中';return;}state.input.cities.push({...structuredClone(city),arrivalDate:city.arrivalDate??state.input.startDate,departureDate:city.departureDate??state.input.endDate});clearErrors();},
    changeCity(index,field,value){if(state.input.cities[index]&&['arrivalDate','departureDate'].includes(field)){state.input.cities[index][field]=value;clearErrors();}},
    moveCity(from,to){if(from<0||to<0||from>=state.input.cities.length||to>=state.input.cities.length)return;const [city]=state.input.cities.splice(from,1);state.input.cities.splice(to,0,city);clearErrors();},
    removeCity(index){state.input.cities.splice(index,1);clearErrors();},
    next(){if(!validate())return false;const i=steps.indexOf(state.step);if(i<2)state.step=steps[i+1];return true;},
    previous(){state.step=steps[Math.max(0,steps.indexOf(state.step)-1)];clearErrors();},
    setStep(step){if(steps.includes(step))state.step=step;},
    rebase(revision){state.baseTripRevision=revision;},
    validate
  };
}
