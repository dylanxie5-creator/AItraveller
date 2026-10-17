import {createHash} from 'node:crypto';
import {createTripStore} from '../storage/trip-store.mjs';
import {createFootprintStore} from '../storage/footprint-store.mjs';
import {missing} from '../storage/errors.mjs';
import {isDateOnly,todayDateOnly} from '../shared/date.mjs';

function autoId(tripId,cityCode) {return 'auto-'+createHash('sha256').update(`${tripId}\n${cityCode}`).digest('hex').slice(0,32);}
function sameContent(visit,content) {return ['cityCode','cityName','provinceCode','provinceName','datePrecision','dateStart','dateEnd','source','linkedTripId','tripNameSnapshot','note'].every(key=>visit[key]===content[key]);}

export function createFootprintLifecycle({database,today=todayDateOnly,now=()=>new Date().toISOString()}={}) {
  const trips=createTripStore(database),footprints=createFootprintStore(database);
  function syncTrip(tripId) {
    return database.transaction(()=>{
      const trip=trips.get(tripId);if(!trip)throw missing();const day=today();if(!isDateOnly(day))throw new TypeError('服务端日期无效');
      const existing=new Map(footprints.listByTrip(tripId).map(visit=>[visit.cityCode,visit]));
      const eligible=new Map(trip.cities.filter(city=>city.departureDate<day).map(city=>[city.cityCode,city]));
      for(const [code,visit] of existing)if(!eligible.has(code)||footprints.getSuppression(tripId,code))footprints.remove(visit.id,visit.revision);
      for(const [code,city] of eligible) {
        if(footprints.getSuppression(tripId,code))continue;
        const old=footprints.listByTrip(tripId).find(visit=>visit.cityCode===code)??null;
        const content={cityCode:city.cityCode,cityName:city.cityName,provinceCode:city.provinceCode,provinceName:city.provinceName,datePrecision:'trip_range',dateStart:city.arrivalDate,dateEnd:city.departureDate,source:'trip',linkedTripId:trip.id,tripNameSnapshot:trip.name,note:old?.note??''};
        if(!old)footprints.put(autoId(trip.id,code),content,{expectedRevision:0,now:now()});
        else if(!sameContent(old,content))footprints.put(old.id,content,{expectedRevision:old.revision,now:now()});
      }
      return footprints.listByTrip(tripId);
    });
  }
  function syncAll() {return database.transaction(()=>{for(const trip of trips.list())syncTrip(trip.id);return footprints.list();});}
  function detachTrip(tripId) {return footprints.detachTrip(tripId,{now:now()});}
  return {syncTrip,syncAll,detachTrip};
}
