export class StoreError extends Error {
  constructor(code,message) { super(message);this.name='StoreError';this.code=code; }
}
export const conflict=()=>new StoreError('CONFLICT','内容已发生变化，请先重新载入，当前输入仍保留');
export const missing=()=>new StoreError('NOT_FOUND','这趟行程不存在或已经删除');
export const corrupt=()=>new StoreError('STORAGE_CORRUPT','本地数据无法读取，请保留原文件，不要覆盖');
export function validId(value) {return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);}
export function validRevision(value) {return Number.isSafeInteger(value)&&value>=0;}
