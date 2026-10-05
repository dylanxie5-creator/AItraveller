import {isDateOnly} from '../shared/date.mjs';
import {yuanToCents, formatCents} from '../shared/money.mjs';
import {ValidationError, validateBasicInfo, normalizeTripInput} from '../shared/trip-validation.mjs';

const dayNumber = date => Date.parse(date + 'T00:00:00Z') / 86400000;
const fail = (field, message = '请检查规划内容') => { throw new ValidationError({[field]: message}); };

// Do not evaluate accessors or accept a custom prototype from an untrusted object.
function record(value, allowed, required, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(field);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !('value' in descriptor)) fail(field);
  }
  if (required.some(key => !Object.hasOwn(value, key))) fail(field);
}

function list(value, min, max, field) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < min || value.length > max) fail(field);
  // JSON arrays cannot have holes, extra properties or accessor elements.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail(field);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) fail(field);
  }
  return value;
}

function text(value, max, field, {empty = false} = {}) {
  if (typeof value !== 'string' || [...value].length > max || (!empty && !value.trim())) fail(field);
  return value.trim();
}

function duration(startDate, endDate) {
  if (!isDateOnly(startDate)) fail('startDate', '请选择有效的开始日期');
  if (!isDateOnly(endDate) || endDate < startDate) fail('endDate', '请选择有效的结束日期');
  const days = dayNumber(endDate) - dayNumber(startDate) + 1;
  if (days > 14) fail('endDate', 'AI 单次规划最多14天，较长行程可以手动创建');
  return days;
}

/** Validate input without inventing a city route or doing any external work. */
export function normalizeAiInput(input, resolveCity) {
  const fields = ['name', 'startDate', 'endDate', 'travelerCount', 'budgetYuan', 'cityCodes', 'preferences'];
  record(input, fields, ['name', 'startDate', 'endDate', 'travelerCount', 'cityCodes'], 'form');
  const errors = validateBasicInfo(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const days = duration(input.startDate, input.endDate);
  const codes = list(input.cityCodes, 1, 3, 'cityCodes');
  if (new Set(codes).size !== codes.length || codes.some(code => typeof code !== 'string')) fail('cityCodes');
  if (codes.length > days + 1) fail('cityCodes', '一天内最多安排两个相邻城市，请增加旅行天数');
  const cities = codes.map(code => {
    const city = resolveCity(code);
    if (!city) fail('cityCodes', '请选择目录中的有效城市');
    return {cityCode: city.cityCode, cityName: city.cityName, provinceCode: city.provinceCode, provinceName: city.provinceName};
  });
  return {name: input.name.trim(), startDate: input.startDate, endDate: input.endDate,
    travelerCount: input.travelerCount, budgetCents: input.budgetYuan ? yuanToCents(input.budgetYuan) : null,
    cities, preferences: text(input.preferences ?? '', 1000, 'preferences', {empty: true})};
}

/** Validate both generated JSON and edited guides; a non-null request pins generation inputs. */
export function normalizePlanContent(raw, {request = null, sources, resolveCity}) {
  record(raw, ['trip', 'days', 'cautions'], ['trip', 'days', 'cautions'], 'form');
  const baseFields = ['name', 'startDate', 'endDate', 'travelerCount', 'budgetCents', 'cities'];
  record(raw.trip, baseFields, baseFields, 'trip');
  const base = raw.trip;
  const length = duration(base.startDate, base.endDate);
  const cities = list(base.cities, 1, 3, 'cities');
  const cityFields = ['cityCode', 'cityName', 'provinceCode', 'provinceName', 'arrivalDate', 'departureDate', 'order'];
  for (const city of cities) record(city, cityFields, ['cityCode', 'arrivalDate', 'departureDate'], 'cities');
  if (base.budgetCents !== null && (!Number.isSafeInteger(base.budgetCents) || base.budgetCents <= 0)) fail('budgetCents');
  const trip = normalizeTripInput({...base,
    budgetYuan: base.budgetCents === null ? '' : formatCents(base.budgetCents).replaceAll(',', '')}, resolveCity);
  if (trip.cities[0].arrivalDate !== trip.startDate || trip.cities.at(-1).departureDate !== trip.endDate) fail('cities');
  for (let i = 1; i < trip.cities.length; i++) {
    if (dayNumber(trip.cities[i].arrivalDate) > dayNumber(trip.cities[i - 1].departureDate) + 1) fail('cities', '城市路线不能留下空白旅行日');
  }
  if (request) {
    for (const field of ['name', 'startDate', 'endDate', 'travelerCount', 'budgetCents']) {
      if (trip[field] !== request[field]) fail(field, '模型结果与规划输入不一致');
    }
    if (trip.cities.length !== request.cities.length || trip.cities.some((city, i) => city.cityCode !== request.cities[i].cityCode)) fail('cities', '模型不得改变请求中的城市及顺序');
  }
  const sourceList = list(sources, 0, 15, 'sources');
  const sourceIds = new Set();
  for (const source of sourceList) {
    if (!source || typeof source.sourceId !== 'string' || !/^s[1-9]\d*$/u.test(source.sourceId) || sourceIds.has(source.sourceId)) fail('sources');
    sourceIds.add(source.sourceId);
  }
  const days = list(raw.days, length, length, 'days').map((day, i) => {
    const field = `day_${i}`;
    record(day, ['date', 'activities'], ['date', 'activities'], field);
    if (!isDateOnly(day.date) || dayNumber(day.date) !== dayNumber(trip.startDate) + i) fail(field, '每日安排需按顺序完整覆盖旅行日期');
    const activities = list(day.activities, 1, 5, field).map(activity => {
      record(activity, ['cityCode', 'title', 'description', 'sourceIds'], ['cityCode', 'title', 'description', 'sourceIds'], field);
      const city = trip.cities.find(c => c.cityCode === activity.cityCode);
      if (!city || day.date < city.arrivalDate || day.date > city.departureDate) fail(field, '活动城市必须属于当天的城市路线');
      const refs = list(activity.sourceIds, 0, 15, field);
      if (new Set(refs).size !== refs.length || refs.some(ref => !sourceIds.has(ref))) fail(field, '来源引用必须来自实际检索资料');
      return {cityCode: city.cityCode, title: text(activity.title, 80, field),
        description: text(activity.description, 150, field, {empty: true}), sourceIds: [...refs]};
    });
    return {date: day.date, activities};
  });
  const cautions = list(raw.cautions, 0, 10, 'cautions').map(value => text(value, 200, 'cautions'));
  const content = {trip, days, cautions};
  if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 48 * 1024) fail('form', '攻略内容超过本次保存大小限制，请减少内容');
  return content;
}
