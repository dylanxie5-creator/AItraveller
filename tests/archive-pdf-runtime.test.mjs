import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import PDFDocument from 'pdfkit';
import {
  PDF_LIMIT_BYTES,
  archivePdfFilename,
  createPdfBuffer,
  resolveArchiveFonts,
  sanitizePdfFilenamePart,
} from '../src/archive/pdf-runtime.mjs';

test('font resolver requires Microsoft YaHei regular and safely falls back bold',()=>{
  const seen=[];
  const fonts=resolveArchiveFonts({fontsDirectory:'D:\\Fonts',exists:path=>{seen.push(path);return path.endsWith('msyh.ttc');}});
  assert.deepEqual(fonts,{regular:'D:\\Fonts\\msyh.ttc',bold:'D:\\Fonts\\msyh.ttc'});
  assert.deepEqual(seen,['D:\\Fonts\\msyh.ttc','D:\\Fonts\\msyhbd.ttc']);
  assert.throws(
    ()=>resolveArchiveFonts({fontsDirectory:'D:\\private-fonts',exists:()=>false}),
    error=>error.code==='PDF_FONT_UNAVAILABLE'&&error.message==='当前电脑缺少生成中文 PDF 所需的字体'&&!error.message.includes('private-fonts'),
  );
});

test('filename sanitizer removes controls reserved characters trailing dots and bounds Unicode code points',()=>{
  assert.equal(sanitizePdfFilenamePart('  江南<秋>游:\r\n?* .  '),'江南秋游');
  assert.equal(sanitizePdfFilenamePart('😀甲乙丙丁',{maxCodePoints:3}),'😀甲乙');
  assert.equal(sanitizePdfFilenamePart('\u202E\u0000...'),'未命名行程');
});

test('archive filenames retain fixed Chinese prefix date and pdf suffix',()=>{
  assert.equal(archivePdfFilename({kind:'archive',cutoffDate:'2026-10-30'}),'旅行总档案-截至2026-10-30.pdf');
  const name=archivePdfFilename({kind:'trip',trip:{name:'江南/秋游\r\nX-Injected: yes.',endDate:'2026-10-13'}});
  assert.equal(name,'旅行档案-江南秋游X-Injected yes-2026-10-13.pdf');
  assert.ok(name.endsWith('.pdf'));
  assert.equal(/[\r\n<>:"/\\|?*]/u.test(name),false);
});

test('PDF buffer collector returns one complete bounded document',async()=>{
  const buffer=await createPdfBuffer({
    PDFDocumentClass:PDFDocument,
    documentOptions:{info:{Title:'边界测试'}},
    render(doc){doc.addPage({size:'A4'}).fontSize(12).text('hello PDF');},
  });
  assert.equal(buffer.subarray(0,5).toString('ascii'),'%PDF-');
  assert.ok(buffer.length>100);
  assert.ok(buffer.length<=PDF_LIMIT_BYTES);
  assert.match(buffer.toString('latin1'),/\/Type \/Page\b/u);
});

class FakeDocument extends EventEmitter {
  constructor(options={}) {super();this.options=options;this.pages=1;}
  bufferedPageRange() {return {start:0,count:this.pages};}
  end() {this.emit('data',Buffer.from('%PDF-1.7\n%%EOF'));this.emit('end');}
}
class InvalidMagicDocument extends FakeDocument {
  end() {this.emit('data',Buffer.from('not a pdf'));this.emit('end');}
}
class EmptyDocument extends FakeDocument {
  constructor(options) {super(options);this.pages=0;}
}
class OversizedDocument extends FakeDocument {
  end() {this.emit('data',Buffer.from('%PDF-123456789'));this.emit('end');}
}

test('PDF buffer collector converts renderer failure invalid magic empty pages and overflow into controlled errors',async()=>{
  const cases=[
    {PDFDocumentClass:FakeDocument,render(){throw new Error('raw renderer secret C:\\private');},code:'PDF_GENERATION_FAILED'},
    {PDFDocumentClass:InvalidMagicDocument,render(){},code:'PDF_GENERATION_FAILED'},
    {PDFDocumentClass:EmptyDocument,render(){},code:'PDF_GENERATION_FAILED'},
    {PDFDocumentClass:OversizedDocument,render(){},maxBytes:8,code:'PDF_TOO_LARGE'},
  ];
  for(const value of cases) {
    await assert.rejects(
      createPdfBuffer(value),
      error=>error.code===value.code&&['暂时无法生成 PDF，请重试','PDF 内容过多，无法生成单个文件'].includes(error.message)&&!error.message.includes('secret')&&!error.message.includes('private'),
      value.code,
    );
  }
});

test('PDF page budget aborts rendering before buffered pages can exhaust memory',async()=>{
  let rendered=0;
  await assert.rejects(
    createPdfBuffer({
      PDFDocumentClass:PDFDocument,
      maxPages:3,
      render(doc) {
        for(let index=0;index<100;index++) {
          rendered++;
          doc.addPage({size:'A4'}).fontSize(12).text(`page ${index+1}`);
        }
      },
    }),
    error=>error.code==='PDF_TOO_LARGE'&&error.message==='PDF 内容过多，无法生成单个文件',
  );
  assert.equal(rendered,4);
});
