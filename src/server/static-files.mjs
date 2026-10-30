import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const webFiles=new Set(['index.html','styles.css','footprint-styles.css','archive-styles.css','app.mjs','ui-runtime.mjs','pdf-download-runtime.mjs','api-client.mjs','router.mjs','views.mjs','ui-elements.mjs','form-controller.mjs','expense-controller.mjs','expense-views.mjs','footprint-controller.mjs','footprint-views.mjs','data-controller.mjs','data-views.mjs','archive-controller.mjs','archive-views.mjs','amap-adapter.mjs','ai-controller.mjs','ai-views.mjs','ai-plan-editor.mjs','favicon.svg','icons.svg','travel-wash.png']);
const sharedFiles=new Set(['date.mjs','money.mjs','trip-validation.mjs','trip-form-model.mjs','expense-form-model.mjs','footprint-form-model.mjs','footprint-format.mjs','trip-presenter.mjs']);
export const defaultWebRoot=fileURLToPath(new URL('../web/',import.meta.url));
export const defaultSharedRoot=fileURLToPath(new URL('../shared/',import.meta.url));
export async function staticFile(path,{webRoot=defaultWebRoot,sharedRoot=defaultSharedRoot}={}) {
  let root,name;if(path==='/'){root=webRoot;name='index.html';}
  else if(path.startsWith('/web/')&&webFiles.has(path.slice(5))){root=webRoot;name=path.slice(5);}
  else if(path.startsWith('/shared/')&&sharedFiles.has(path.slice(8))){root=sharedRoot;name=path.slice(8);}
  else return null;
  try {
    const base=await realpath(root),file=await realpath(resolve(root,name));if(!file.startsWith(base+sep))return null;
    const body=await readFile(file);const type=name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/javascript';return {body,type:type+(type.startsWith('text/')||type==='image/svg+xml'?'; charset=utf-8':'')};
  }catch{return null;}
}
