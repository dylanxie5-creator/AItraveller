import {getCityByCode} from '../../src/domain/city-catalog.mjs';

const codes = ['320100', '320500', '330100', '310100'];
const start = '2026-10-10';
const at = offset => new Date(Date.parse(start + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);

export function aiInput({cityCount = 2, days = 4} = {}) {
  return {name: '江南小旅行', startDate: start, endDate: at(days - 1), travelerCount: 1,
    budgetYuan: '3200.50', cityCodes: codes.slice(0, cityCount), preferences: '慢节奏，逛博物馆'};
}

export function sources() {
  return [{sourceId: 's1', title: '南京旅游资料', url: 'https://example.com/nanjing',
    summary: '博物馆和城市游览资料。', publishedAt: '2026-09-01', retrievedAt: '2026-10-05T04:00:00.000Z'},
  {sourceId: 's2', title: '苏州旅游资料', url: 'https://example.com/suzhou',
    summary: '园林和古城资料。', publishedAt: null, retrievedAt: '2026-10-05T04:00:00.000Z'}];
}

// Fixtures generate inputs only. Assertions use hand-derived dates, money and counts.
export function planContent(request) {
  const totalDays = (Date.parse(request.endDate) - Date.parse(request.startDate)) / 86400000 + 1;
  const date = offset => new Date(Date.parse(request.startDate) + offset * 86400000).toISOString().slice(0, 10);
  const handoffs = Array.from({length:request.cities.length-1}, (_, i) =>
    Math.max(i, Math.floor((i+1)*(totalDays-1)/request.cities.length)));
  const cities = request.cities.map((city, order) => {
    const known = getCityByCode(city.cityCode);
    return {cityCode:known.cityCode,cityName:known.cityName,provinceCode:known.provinceCode,provinceName:known.provinceName,
      arrivalDate: date(order === 0 ? 0 : handoffs[order-1]),
      departureDate: date(order === request.cities.length - 1 ? totalDays - 1 : handoffs[order]), order};
  });
  return {trip: {name: request.name, startDate: request.startDate, endDate: request.endDate,
    travelerCount: request.travelerCount, budgetCents: request.budgetCents, cities},
  days: Array.from({length: totalDays}, (_, i) => ({date: date(i), activities: [{
    cityCode: cities.find(c => c.arrivalDate <= date(i) && date(i) <= c.departureDate).cityCode,
    title: '城市漫步', description: '按体力合理安排，当日信息以官方公告为准。', sourceIds: ['s1']}]})),
  cautions: ['门票及营业时间请核对官方最新公告。']};
}

export function searchResponse(rows = []) {
  return {id: 'fixture-search', created: 1791172800, request_id: 'fixture-request',
    search_intent: [], search_result: rows.map((row, i) => ({title: '旅游资料',
      content: '可核对的检索摘要', link: `https://example.com/source-${i + 1}`,
      media: 'fixture', icon: 'https://example.com/icon.svg', refer: `[ref_${i + 1}]`,
      publish_date: '2026-09-01', ...row}))};
}
