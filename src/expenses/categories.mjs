import {ValidationError} from '../shared/trip-validation.mjs';

const definitions=[
  ['default:transport','交通'],
  ['default:lodging','住宿'],
  ['default:food','餐饮'],
  ['default:tickets','门票'],
  ['default:shopping','购物'],
  ['default:entertainment','娱乐'],
  ['default:other','其他'],
];

export const DEFAULT_EXPENSE_CATEGORIES=Object.freeze(definitions.map(([id,name])=>Object.freeze({id,name,kind:'default',revision:null})));

export function normalizeCategoryName(name) {
  return typeof name==='string'?name.trim().normalize('NFKC').toLowerCase():'';
}

function invalidName() {throw new ValidationError({name:'分类名称不能为空，且不能与已有分类重复'});}

export function createCategoryCatalog(customCategories=[]) {
  if(!Array.isArray(customCategories))throw new ValidationError({name:'分类数据无效'});
  const seenNames=new Set(DEFAULT_EXPENSE_CATEGORIES.map(item=>normalizeCategoryName(item.name)));
  const seenIds=new Set(DEFAULT_EXPENSE_CATEGORIES.map(item=>item.id));
  const custom=customCategories.map(item=>{
    const name=typeof item?.name==='string'?item.name.trim():'';
    const normalizedName=normalizeCategoryName(name);
    if(!name||!normalizedName||typeof item.id!=='string'||!item.id.startsWith('custom:')||seenIds.has(item.id)||seenNames.has(normalizedName))invalidName();
    seenIds.add(item.id);seenNames.add(normalizedName);
    return {...item,name,normalizedName,kind:'custom'};
  }).sort((a,b)=>String(a.createdAt??'').localeCompare(String(b.createdAt??''))||a.id.localeCompare(b.id));
  const internal=new Map([...DEFAULT_EXPENSE_CATEGORIES,...custom].map(item=>[item.id,{...item}]));
  const clone=item=>item?{...item}:null;
  return {
    list:[...internal.values()].map(clone),
    byId:new Map([...internal].map(([id,item])=>[id,clone(item)])),
    resolve(id){return clone(internal.get(id));},
  };
}
