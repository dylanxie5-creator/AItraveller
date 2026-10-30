const PDF_MAGIC='%PDF-';
const fallbackName=href=>href.includes('/trips/')?'trip-archive.pdf':'travel-archive.pdf';
function safeFilename(value,fallback) {
  const clean=String(value??'').replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu,'').trim().replace(/[. ]+$/gu,'');
  const bounded=Array.from(clean).slice(0,120).join('');
  return bounded.toLowerCase().endsWith('.pdf')?bounded:fallback;
}
function responseFilename(header,href) {
  const fallback=fallbackName(href),match=/filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(String(header??''));
  if(!match)return fallback;
  try{return safeFilename(decodeURIComponent(match[1].trim()),fallback);}catch{return fallback;}
}
async function validPdfBlob(response) {
  if(!response?.ok||!/^application\/pdf(?:;|$)/iu.test(response.headers?.get?.('content-type')??''))throw new Error('invalid response');
  const blob=await response.blob();if(!(blob instanceof Blob)||blob.size<PDF_MAGIC.length)throw new Error('empty response');
  const magic=new TextDecoder('ascii').decode(await blob.slice(0,PDF_MAGIC.length).arrayBuffer());if(magic!==PDF_MAGIC)throw new Error('invalid pdf');
  return blob;
}

export function createPdfDownloadRuntime({document,fetchImpl=fetch,urlApi=URL,queueMicrotaskImpl=queueMicrotask}={}) {
  if(!document?.addEventListener||typeof fetchImpl!=='function')throw new TypeError('PDF 下载运行时配置无效');
  const pending=new WeakSet();let disposed=false;
  async function onClick(event) {
    const anchor=event?.target?.closest?.('[data-pdf-download]');if(!anchor||event.defaultPrevented||event.button!==0)return;
    const href=anchor.getAttribute('href');let target,base;
    try{base=new URL(document.baseURI);target=new URL(href,base);}catch{return;}
    if(target.origin!==base.origin||!target.pathname.startsWith('/api/archive'))return;
    event.preventDefault();if(disposed||pending.has(anchor))return;
    pending.add(anchor);const scope=anchor.closest('[data-pdf-download-scope]'),status=scope?.querySelector('[data-pdf-download-status]'),error=scope?.querySelector('[data-pdf-download-error]');
    anchor.setAttribute('aria-disabled','true');anchor.setAttribute('aria-busy','true');if(status)status.textContent='正在生成 PDF…';if(error){error.textContent='';error.hidden=true;}
    try {
      const requestTarget=target.pathname+target.search,response=await fetchImpl(requestTarget,{cache:'no-store',credentials:'same-origin'}),blob=await validPdfBlob(response);
      const objectUrl=urlApi.createObjectURL(blob),download=document.createElement('a');download.href=objectUrl;download.download=responseFilename(response.headers.get('content-disposition'),requestTarget);download.hidden=true;document.body.append(download);download.click();download.remove();queueMicrotaskImpl(()=>urlApi.revokeObjectURL(objectUrl));
      if(status)status.textContent='PDF 已开始下载';
    } catch {
      if(status)status.textContent='准备下载';if(error){error.textContent='PDF 下载失败，请重试';error.hidden=false;}
    } finally {
      pending.delete(anchor);anchor.removeAttribute('aria-disabled');anchor.removeAttribute('aria-busy');
    }
  }
  document.addEventListener('click',onClick);
  return {dispose(){if(disposed)return;disposed=true;document.removeEventListener('click',onClick);}};
}
