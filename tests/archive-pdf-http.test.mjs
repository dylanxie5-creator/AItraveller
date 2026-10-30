import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createArchivePdfService} from '../src/services/archive-pdf-service.mjs';
import {createHttpApp} from '../src/server/http-app.mjs';
import {PDF_LIMIT_BYTES} from '../src/archive/pdf-runtime.mjs';
import {StoreError} from '../src/storage/errors.mjs';
import {request} from './helpers/http-client.mjs';

const pdf=value=>Buffer.from(`%PDF-1.7\n${value}\n%%EOF`);
async function serve(t,{runtime,current}) {
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  server.on('request',createHttpApp({runtime,...current,allowedHosts:[`127.0.0.1:${port}`,`localhost:${port}`]}));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${port}`;
}
const archivesStub={getTravelArchive(){return {kind:'archive',cutoffDate:'2026-10-30'};},getTripArchive(id){return {kind:'trip',trip:{name:id,endDate:'2026-10-13'}};}};

test('PDF service snapshots current total and trip archives and returns safe names',async()=>{
  const total={kind:'archive',cutoffDate:'2026-10-30'},trip={kind:'trip',trip:{name:'江南/秋游\r\nX: yes.',endDate:'2026-10-13'}};let totalReads=0,tripReads=0;
  const seen=[];const service=createArchivePdfService({archives:{getTravelArchive(){totalReads++;return total;},getTripArchive(id){tripReads++;assert.equal(id,'trip-1');return trip;}},travelRenderer:async value=>{seen.push(value);return pdf('total');},tripRenderer:async value=>{seen.push(value);return pdf('trip');}});
  const totalFile=await service.getTravelPdf(),tripFile=await service.getTripPdf('trip-1');
  assert.equal(totalReads,1);assert.equal(tripReads,1);assert.deepEqual(seen,[total,trip]);
  assert.deepEqual(totalFile,{filename:'旅行总档案-截至2026-10-30.pdf',body:pdf('total')});
  assert.equal(tripFile.filename,'旅行档案-江南秋游X yes-2026-10-13.pdf');assert.deepEqual(tripFile.body,pdf('trip'));
});

test('HTTP downloads total and trip PDFs with exact MIME length no-store nosniff and RFC 5987 names',async t=>{
  const totalBody=pdf('total-body'),tripBody=pdf('trip-body'),current={archives:archivesStub,archivePdf:{async getTravelPdf(){return {filename:'旅行总档案-截至2026-10-30.pdf',body:totalBody};},async getTripPdf(id){assert.equal(id,'trip-1');return {filename:'旅行档案-金陵秋游-2026-10-13.pdf',body:tripBody};}}};
  const url=await serve(t,{current}),total=await request(url,{path:'/api/archive.pdf'}),trip=await request(url,{path:'/api/archive/trips/trip-1.pdf'});
  for(const [response,body,fallback] of [[total,totalBody,'travel-archive.pdf'],[trip,tripBody,'trip-archive.pdf']]) {
    assert.equal(response.status,200);assert.deepEqual(response.buffer,body);assert.equal(response.headers['content-type'],'application/pdf');assert.equal(response.headers['content-length'],String(body.length));assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');assert.match(response.headers['content-disposition'],new RegExp(`attachment; filename="${fallback.replace('.','\\.')}"; filename\\*=UTF-8''%E6`));
  }
});

test('HTTP rejects missing unfinished empty fontless failed and oversized PDFs before attachment headers',async t=>{
  const oversized=Buffer.alloc(PDF_LIMIT_BYTES+1);oversized.write('%PDF-');
  const archivePdf={
    async getTravelPdf(){throw new StoreError('ARCHIVE_EMPTY','raw empty secret');},
    async getTripPdf(id){
      if(id==='missing')throw new StoreError('NOT_FOUND','这趟行程不存在或已经删除');
      if(id==='unfinished')throw new StoreError('ARCHIVE_NOT_COMPLETED','行程结束后才能生成档案');
      if(id==='fontless')throw new StoreError('PDF_FONT_UNAVAILABLE','raw font path C:\\secret');
      if(id==='failed')throw new Error('renderer stack secret');
      if(id==='invalid')return {filename:'bad.pdf',body:Buffer.from('{"error":"not pdf"}')};
      if(id==='oversized')return {filename:'huge.pdf',body:oversized};
      throw new Error('unexpected');
    },
  };
  const url=await serve(t,{current:{archives:archivesStub,archivePdf}}),cases=[
    ['/api/archive.pdf',409,'ARCHIVE_EMPTY','还没有已经结束的行程'],
    ['/api/archive/trips/missing.pdf',404,'NOT_FOUND','这趟行程不存在或已经删除'],
    ['/api/archive/trips/unfinished.pdf',409,'ARCHIVE_NOT_COMPLETED','行程结束后才能生成档案'],
    ['/api/archive/trips/fontless.pdf',503,'PDF_FONT_UNAVAILABLE','当前电脑缺少生成中文 PDF 所需的字体'],
    ['/api/archive/trips/failed.pdf',503,'STORAGE_FAILED','本机服务暂时无法完成操作，请重试'],
    ['/api/archive/trips/invalid.pdf',503,'PDF_GENERATION_FAILED','暂时无法生成 PDF，请重试'],
    ['/api/archive/trips/oversized.pdf',413,'PDF_TOO_LARGE','PDF 内容过多，无法生成单个文件'],
  ];
  for(const [path,status,code,message] of cases) {
    const response=await request(url,{path});assert.equal(response.status,status,path);assert.deepEqual(response.json.error,{code,message},path);assert.match(response.headers['content-type'],/^application\/json/u);assert.equal(response.headers['content-disposition'],undefined);assert.equal(response.buffer.subarray(0,5).toString('ascii')==='%PDF-',false);assert.doesNotMatch(response.text,/secret|renderer stack|C:\\/u);
  }
});

test('download filename cannot inject a response header through Unicode controls or reserved characters',async t=>{
  const body=pdf('safe'),current={archives:archivesStub,archivePdf:{async getTripPdf(){return {filename:'旅行档案-坏\r\nX-Injected: yes/?.pdf',body};}}};
  const url=await serve(t,{current}),response=await request(url,{path:'/api/archive/trips/trip-1.pdf'});
  assert.equal(response.status,200);assert.equal(response.headers['x-injected'],undefined);assert.doesNotMatch(response.headers['content-disposition'],/[\r\n]/u);assert.match(response.headers['content-disposition'],/filename="trip-archive\.pdf"; filename\*=UTF-8''/u);
});

test('runtime restore context supplies the next PDF request instead of startup archive data',async t=>{
  const first={archives:archivesStub,archivePdf:{async getTravelPdf(){return {filename:'first.pdf',body:pdf('FIRST')};}}},second={archives:archivesStub,archivePdf:{async getTravelPdf(){return {filename:'second.pdf',body:pdf('SECOND')};}}};let active=first;
  const runtime={current:()=>active,coordinator:{runWrite(fn){return fn();}}},url=await serve(t,{runtime,current:first});
  assert.match((await request(url,{path:'/api/archive.pdf'})).text,/FIRST/u);active=second;assert.match((await request(url,{path:'/api/archive.pdf'})).text,/SECOND/u);
});

test('PDF GET routes retain host traversal and method guards',async t=>{
  let calls=0;const current={archives:archivesStub,archivePdf:{async getTravelPdf(){calls++;return {filename:'x.pdf',body:pdf('x')};},async getTripPdf(){calls++;return {filename:'x.pdf',body:pdf('x')};}}},url=await serve(t,{current});
  assert.equal((await request(url,{path:'/api/archive.pdf',method:'POST',body:{}})).status,404);
  assert.equal((await request(url,{path:'/api/archive.pdf',headers:{Host:'evil.test'}})).status,403);
  for(const path of ['/api/archive/trips/a%2Fb.pdf','/api/archive/trips/%252e%252e.pdf','/api/archive/trips/too.long.pdf'])assert.equal((await request(url,{path})).status,404,path);
  assert.equal(calls,0);
});
