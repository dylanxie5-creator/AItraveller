import {getTripStatus} from './date.mjs';
import {formatCents} from './money.mjs';
export function presentTrip(trip,today) {
  const status=getTripStatus(trip,today);
  return {...trip,status,statusLabel:{upcoming:'待出发',ongoing:'进行中',completed:'已结束'}[status],budgetText:trip.budgetCents===null?'未设预算':`¥${formatCents(trip.budgetCents)}`,routeText:trip.cities.map(c=>c.cityName).join(' · ')};
}
export function orderTrips(trips,today) {
  const weight={ongoing:0,upcoming:1,completed:2};
  return trips.map(t=>presentTrip(t,today)).sort((a,b)=>weight[a.status]-weight[b.status]||(a.status==='completed'?b.endDate.localeCompare(a.endDate):a.startDate.localeCompare(b.startDate))||a.id.localeCompare(b.id));
}
