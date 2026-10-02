export function yuanToCents(text) {
  if(typeof text!=='string'||text.length>32||!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole,decimal='']=text.split('.');
  const value=BigInt(whole+decimal.padEnd(2,'0'));
  return value>0n&&value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null;
}
export function formatCents(cents) {
  if(!Number.isSafeInteger(cents)) throw new TypeError('Invalid cents');
  const value=BigInt(cents); const abs=value<0n?-value:value;
  return `${value<0n?'-':''}${(abs/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${(abs%100n).toString().padStart(2,'0')}`;
}
