function safeAdd(left,right) {
  const value=left+right;
  if(!Number.isSafeInteger(value))throw new RangeError('花销总额超出安全范围');
  return value;
}

function currentCities(trip) {
  if(!trip||!Array.isArray(trip.cities))throw new TypeError('行程城市无效');
  return new Map(trip.cities.map((city,index)=>[city.cityCode,{...city,index}]));
}

export function presentExpenses({trip,expenses,catalog}) {
  if(!Array.isArray(expenses)||!catalog?.resolve)throw new TypeError('花销数据无效');
  const cities=currentCities(trip);
  return expenses.map(expense=>{
    if(!expense||typeof expense.id!=='string'||!Number.isSafeInteger(expense.amountCents)||expense.amountCents<=0)throw new TypeError('花销记录无效');
    const category=catalog.resolve(expense.categoryId);
    if(!category)throw new TypeError('花销分类不存在');
    let cityName,cityState;
    if(expense.cityCode===null){cityName='整个行程';cityState='trip';}
    else if(cities.has(expense.cityCode)){cityName=cities.get(expense.cityCode).cityName;cityState='current';}
    else {
      if(typeof expense.cityCode!=='string'||!/^\d{6}$/.test(expense.cityCode)||typeof expense.cityName!=='string'||!expense.cityName)throw new TypeError('花销城市无效');
      cityName=expense.cityName;cityState='removed';
    }
    return {...expense,categoryName:category.name,cityName,cityState};
  }).sort((a,b)=>b.spentDate.localeCompare(a.spentDate)||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
}

export function computeExpenseSummary({trip,expenses,catalog,limitRecent=3}) {
  if(!Number.isSafeInteger(limitRecent)||limitRecent<0)throw new TypeError('最近花销数量无效');
  if(trip.budgetCents!==null&&(!Number.isSafeInteger(trip.budgetCents)||trip.budgetCents<=0))throw new TypeError('行程预算无效');
  const presented=presentExpenses({trip,expenses,catalog});
  const categoryTotals=new Map(),cityTotals=new Map();let totalCents=0;
  for(const item of presented) {
    totalCents=safeAdd(totalCents,item.amountCents);
    const category=categoryTotals.get(item.categoryId)??{categoryId:item.categoryId,name:item.categoryName,totalCents:0,count:0};
    category.totalCents=safeAdd(category.totalCents,item.amountCents);category.count++;categoryTotals.set(item.categoryId,category);
    const key=item.cityCode??'__trip__';
    const city=cityTotals.get(key)??{cityCode:item.cityCode,cityName:item.cityName,cityState:item.cityState,totalCents:0,count:0};
    city.totalCents=safeAdd(city.totalCents,item.amountCents);city.count++;cityTotals.set(key,city);
  }
  const byCategory=catalog.list.filter(item=>categoryTotals.has(item.id)).map(item=>({...categoryTotals.get(item.id)}));
  const routeOrder=new Map(trip.cities.map((city,index)=>[city.cityCode,index]));
  const stateOrder={trip:0,current:1,removed:2};
  const byCity=[...cityTotals.values()].sort((a,b)=>stateOrder[a.cityState]-stateOrder[b.cityState]
    ||(a.cityState==='current'?(routeOrder.get(a.cityCode)-routeOrder.get(b.cityCode)):0)
    ||String(a.cityCode??'').localeCompare(String(b.cityCode??''))).map(item=>({...item}));
  const budgetCents=trip.budgetCents;
  const budgetRemainingCents=budgetCents===null?null:budgetCents-totalCents;
  if(budgetRemainingCents!==null&&!Number.isSafeInteger(budgetRemainingCents))throw new RangeError('预算余额超出安全范围');
  return {
    hasExpenses:presented.length>0,totalCents,budgetCents,budgetRemainingCents,
    budgetState:budgetCents===null?'unset':budgetRemainingCents<0?'over':'within',
    byCategory,byCity,recentExpenses:presented.slice(0,limitRecent),
  };
}
