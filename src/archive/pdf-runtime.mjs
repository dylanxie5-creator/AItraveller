import {existsSync} from 'node:fs';
import {win32 as path} from 'node:path';
import PDFDocument from 'pdfkit';
import {StoreError} from '../storage/errors.mjs';

export const PDF_LIMIT_BYTES=67108864;

const publicErrors={
  PDF_FONT_UNAVAILABLE:'当前电脑缺少生成中文 PDF 所需的字体',
  PDF_GENERATION_FAILED:'暂时无法生成 PDF，请重试',
  PDF_TOO_LARGE:'PDF 内容过多，无法生成单个文件',
};

const failure=code=>new StoreError(code,publicErrors[code]);
const controlled=error=>error instanceof StoreError&&Object.hasOwn(publicErrors,error.code)?error:failure('PDF_GENERATION_FAILED');

export function resolveArchiveFonts({fontsDirectory='C:\\Windows\\Fonts',exists=existsSync}={}) {
  const regular=path.join(fontsDirectory,'msyh.ttc');
  const bold=path.join(fontsDirectory,'msyhbd.ttc');
  if(!exists(regular))throw failure('PDF_FONT_UNAVAILABLE');
  return {regular,bold:exists(bold)?bold:regular};
}

export function sanitizePdfFilenamePart(value,{maxCodePoints=60}={}) {
  const limit=Number.isSafeInteger(maxCodePoints)&&maxCodePoints>0?maxCodePoints:60;
  const clean=String(value??'')
    .replace(/[\p{Cc}\p{Cf}]/gu,'')
    .replace(/[<>:"/\\|?*]/gu,'')
    .trim()
    .replace(/[. ]+$/gu,'')
    .trim();
  return Array.from(clean||'未命名行程').slice(0,limit).join('').replace(/[. ]+$/gu,'')||'未命名行程';
}

export function archivePdfFilename(report) {
  if(report?.kind==='trip')return `旅行档案-${sanitizePdfFilenamePart(report.trip?.name)}-${report.trip?.endDate??'未知日期'}.pdf`;
  return `旅行总档案-截至${report?.cutoffDate??'未知日期'}.pdf`;
}

export async function createPdfBuffer({render,PDFDocumentClass=PDFDocument,documentOptions={},maxBytes=PDF_LIMIT_BYTES}={}) {
  if(typeof render!=='function'||typeof PDFDocumentClass!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw failure('PDF_GENERATION_FAILED');
  let doc;
  try {
    doc=new PDFDocumentClass({...documentOptions,autoFirstPage:false,bufferPages:true,compress:true});
    const chunks=[];
    let total=0,settled=false;
    const completed=new Promise((resolve,reject)=>{
      doc.on('data',chunk=>{
        if(settled)return;
        const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        total+=value.length;
        if(total>maxBytes){settled=true;reject(failure('PDF_TOO_LARGE'));return;}
        chunks.push(value);
      });
      doc.once('error',()=>{if(!settled){settled=true;reject(failure('PDF_GENERATION_FAILED'));}});
      doc.once('end',()=>{if(!settled){settled=true;resolve(Buffer.concat(chunks,total));}});
    });
    await render(doc);
    const range=doc.bufferedPageRange?.();
    if(!range||!Number.isSafeInteger(range.count)||range.count<1)throw failure('PDF_GENERATION_FAILED');
    doc.end();
    const buffer=await completed;
    if(buffer.length>maxBytes)throw failure('PDF_TOO_LARGE');
    if(buffer.length<5||buffer.subarray(0,5).toString('ascii')!=='%PDF-')throw failure('PDF_GENERATION_FAILED');
    return buffer;
  } catch(error) {
    throw controlled(error);
  }
}
