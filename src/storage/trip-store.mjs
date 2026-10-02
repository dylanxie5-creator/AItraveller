import {conflict,missing,corrupt,validId,validRevision} from './errors.mjs';
import {validateBasicInfo,validateCities,ValidationError} from '../shared/trip-validation.mjs';
import {formatCents} from '../shared/money.mjs';
export function createTripStore(database) {
  const {db}=database;
  function get(id) {
    const row=db.prepare('SELECT * FROM trips WHERE id=?').get(id);if(!row)return null;
    try {
      const base=JSON.parse(row.payload);
      const cities=db.prepare('SELECT * FROM trip_cities WHERE trip_id=? ORDER BY position').all(id).map((r,i)=>{if(r.position!==i)throw corrupt();return JSON.parse(r.payload);});
      if(!validId(id)||!validRevision(row.revision)||row.revision<1||!base||!['createdAt','updatedAt'].every(k=>typeof base[k]==='string'&&Number.isFinite(Date.parse(base[k]))))throw corrupt();
      if(base.budgetCents!==null&&(!Number.isSafeInteger(base.budgetCents)||base.budgetCents<=0))throw corrupt();
      const snapshots=new Map(cities.map(c=>[c.cityCode,c]));
      if(cities.some((c,i)=>!/^\d{6}$/.test(c.cityCode)||c.order!==i||['cityName','provinceName'].some(k=>typeof c[k]!=='string'||!c[k])||!/^\d{6}$/.test(c.provinceCode)))throw corrupt();
      if(Object.keys(validateBasicInfo({...base,budgetYuan:base.budgetCents===null?'':formatCents(base.budgetCents).replaceAll(',','')})).length||Object.keys(validateCities(base,cities,code=>snapshots.get(code))).length)throw corrupt();
      return {...base,id,revision:row.revision,cities};
    }catch{throw corrupt();}
  }
  return {get,list(){return db.prepare('SELECT id FROM trips ORDER BY id').all().map(r=>get(r.id));},
    put(id,content,{expectedRevision,now}) {
      if(!validId(id)||!validRevision(expectedRevision))throw new ValidationError({form:'无效的行程身份'});
      return database.transaction(()=>{
        const old=get(id);if((old?.revision??0)!==expectedRevision)throw conflict();
        const base={name:content.name,startDate:content.startDate,endDate:content.endDate,travelerCount:content.travelerCount,budgetCents:content.budgetCents,createdAt:old?.createdAt??now,updatedAt:now};
        db.prepare('INSERT INTO trips(id,revision,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(id,expectedRevision+1,JSON.stringify(base));
        db.prepare('DELETE FROM trip_cities WHERE trip_id=?').run(id);
        const insert=db.prepare('INSERT INTO trip_cities VALUES(?,?,?)');content.cities.forEach((city,i)=>insert.run(id,i,JSON.stringify(city)));
        return get(id);
      });
    },remove(id,expectedRevision){return database.transaction(()=>{const old=get(id);if(!old)throw missing();if(old.revision!==expectedRevision)throw conflict();db.prepare('DELETE FROM trips WHERE id=?').run(id);return true;});}
  };
}
