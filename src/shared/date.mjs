export function isDateOnly(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function todayDateOnly(date=new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function getTripStatus(trip,today) {
  if(!isDateOnly(today)||!isDateOnly(trip.startDate)||!isDateOnly(trip.endDate)) throw new TypeError('Invalid calendar date');
  return today<trip.startDate?'upcoming':today>trip.endDate?'completed':'ongoing';
}
