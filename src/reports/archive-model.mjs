const isoDate=/^\d{4}-\d{2}-\d{2}$/u;
const copy=value=>value===null?null:structuredClone(value);
function safeAdd(left,right) {const value=left+right;if(!Number.isSafeInteger(value))throw new RangeError('档案金额超出安全范围');return value;}
function days(start,end) {const value=(Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000+1;if(!Number.isSafeInteger(value)||value<1)throw new TypeError('行程日期无效');return value;}
function safeHref(value) {try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?value:null;}catch{return null;}}
function visitView(value) {return {cityName:value.cityName,provinceName:value.provinceName,datePrecision:value.datePrecision,dateStart:value.dateStart,dateEnd:value.dateEnd??null,source:value.source,note:value.note??''};}

export function isCompletedTrip(trip,today) {
  if(!trip||typeof trip.endDate!=='string'||!isoDate.test(trip.endDate)||typeof today!=='string'||!isoDate.test(today))throw new TypeError('行程日期无效');
  return trip.endDate<today;
}

export function buildTripArchive({trip,expenseOverview,visits,guide,generatedAt,cutoffDate,databaseVersion=4}) {
  const cities=trip.cities.map(city=>({cityName:city.cityName,provinceName:city.provinceName,arrivalDate:city.arrivalDate,departureDate:city.departureDate}));
  const cityByCode=new Map(trip.cities.map(city=>[city.cityCode,city]));
  const summary=expenseOverview.summary,items=expenseOverview.expenses.map(item=>({spentDate:item.spentDate,categoryName:item.categoryName,cityName:item.cityName,cityState:item.cityState,amountCents:item.amountCents,note:item.note??''}));
  const expenses={hasExpenses:summary.hasExpenses,totalCents:summary.totalCents,budgetCents:summary.budgetCents,budgetRemainingCents:summary.budgetRemainingCents,budgetState:summary.budgetState,
    byCategory:summary.byCategory.map(item=>({name:item.name,totalCents:item.totalCents,count:item.count})),
    byCity:summary.byCity.map(item=>({provinceName:item.cityCode===null?'':cityByCode.get(item.cityCode)?.provinceName??'',cityName:item.cityName,cityState:item.cityState,totalCents:item.totalCents,count:item.count})),items};
  let guideView=null;
  if(guide)guideView={provider:guide.provider,model:guide.model,edited:guide.edited,createdAt:guide.createdAt,updatedAt:guide.updatedAt,current:copy(guide.content),conversionSnapshot:copy(guide.conversionSnapshot),original:copy(guide.original),sources:guide.sources.map(source=>({sourceId:source.sourceId,title:source.title,url:source.url,href:safeHref(source.url),summary:source.summary,publishedAt:source.publishedAt??null,retrievedAt:source.retrievedAt}))};
  return {kind:'trip',generatedAt,cutoffDate,databaseVersion,trip:{name:trip.name,startDate:trip.startDate,endDate:trip.endDate,travelerCount:trip.travelerCount,budgetCents:trip.budgetCents,durationDays:days(trip.startDate,trip.endDate),cities},expenses,footprints:visits.map(visitView),guide:guideView};
}

export function buildTravelArchive({tripArchives,allVisits,generatedAt,cutoffDate,databaseVersion=4}) {
  const trips=tripArchives.filter(item=>isCompletedTrip(item.trip,cutoffDate)).slice().sort((a,b)=>b.trip.startDate.localeCompare(a.trip.startDate));
  let travelDayCount=0,totalExpenseCents=0,wholeTripExpenseCents=0;const categories=new Map(),cities=new Map(),years=new Map();
  for(const item of trips) {
    travelDayCount=safeAdd(travelDayCount,item.trip.durationDays);totalExpenseCents=safeAdd(totalExpenseCents,item.expenses.totalCents);
    const year=item.trip.startDate.slice(0,4),yearRow=years.get(year)??{year,tripCount:0,totalExpenseCents:0,trips:[]};yearRow.tripCount++;yearRow.totalExpenseCents=safeAdd(yearRow.totalExpenseCents,item.expenses.totalCents);yearRow.trips.push({name:item.trip.name,startDate:item.trip.startDate,endDate:item.trip.endDate,route:item.trip.cities.map(city=>city.cityName),totalExpenseCents:item.expenses.totalCents});years.set(year,yearRow);
    for(const row of item.expenses.byCategory){const total=categories.get(row.name)??{name:row.name,totalCents:0,count:0};total.totalCents=safeAdd(total.totalCents,row.totalCents);total.count=safeAdd(total.count,row.count);categories.set(row.name,total);}
    for(const row of item.expenses.byCity) {
      if(row.cityState==='trip'){wholeTripExpenseCents=safeAdd(wholeTripExpenseCents,row.totalCents);continue;}
      const key=`${row.provinceName}\n${row.cityName}`,total=cities.get(key)??{provinceName:row.provinceName,cityName:row.cityName,totalCents:0,count:0};total.totalCents=safeAdd(total.totalCents,row.totalCents);total.count=safeAdd(total.count,row.count);cities.set(key,total);
    }
  }
  const footprints=allVisits.map(visitView),provinceCount=new Set(footprints.map(item=>item.provinceName)).size,cityCount=new Set(footprints.map(item=>`${item.provinceName}\n${item.cityName}`)).size;
  const directory=[...years.values()].sort((a,b)=>b.year.localeCompare(a.year)).map(({year,trips:rows})=>({year,trips:rows}));
  const byYear=[...years.values()].sort((a,b)=>b.year.localeCompare(a.year)).map(({year,tripCount,totalExpenseCents})=>({year,tripCount,totalExpenseCents}));
  const byCategory=[...categories.values()].sort((a,b)=>b.totalCents-a.totalCents||a.name.localeCompare(b.name));
  const byCity=[...cities.values()].sort((a,b)=>b.totalCents-a.totalCents||a.provinceName.localeCompare(b.provinceName)||a.cityName.localeCompare(b.cityName));
  return {kind:'archive',generatedAt,cutoffDate,databaseVersion,summary:{tripCount:trips.length,travelDayCount,totalExpenseCents,provinceCount,cityCount,visitCount:footprints.length},byYear,byCategory,byCity,wholeTripExpenseCents,directory,trips,footprints};
}
