import cities from '../data/china-cities.json' with {type:'json'};
const byCode=new Map(cities.map(city=>[city.cityCode,city]));
export const cityCount=cities.length;
export function getCityByCode(code) { const city=byCode.get(code); return city?{...city}:null; }
export function searchCities(query,limit=20) {
  const q=String(query??'').trim().replace(/市$/,'');
  if(!q) return [];
  return cities.filter(city=>city.searchName.includes(q)||city.provinceName.includes(q)).slice(0,Math.max(0,Math.min(20,Number.isInteger(limit)?limit:20))).map(city=>({...city}));
}
