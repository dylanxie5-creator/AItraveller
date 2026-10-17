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
