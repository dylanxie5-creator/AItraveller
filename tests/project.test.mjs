import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../src/start.mjs';
import {setup,prepare} from './helpers/database.mjs';
import {request} from './helpers/http-client.mjs';

test('local startup serves all browser modules but not private project files',async t=>{
  const {path,database}=setup(t);database.close();
  const running=await startServer({dbPath:path,port:0});
  try {
    assert.equal(running.server.address().address,'127.0.0.1');
    for(const route of ['/',...['styles.css','footprint-styles.css','archive-styles.css','app.mjs','ui-runtime.mjs','pdf-download-runtime.mjs','api-client.mjs','router.mjs','views.mjs','ui-elements.mjs','form-controller.mjs','expense-controller.mjs','expense-views.mjs','footprint-controller.mjs','footprint-views.mjs','data-controller.mjs','data-views.mjs','archive-controller.mjs','archive-views.mjs','amap-adapter.mjs','favicon.svg','icons.svg','travel-wash.png'].map(f=>'/web/'+f),...['date.mjs','money.mjs','trip-validation.mjs','trip-form-model.mjs','expense-form-model.mjs','footprint-form-model.mjs','footprint-format.mjs','trip-presenter.mjs'].map(f=>'/shared/'+f)]) {
      const response=await request(running.url,{path:route});assert.equal(response.status,200,route);assert.ok(response.text.length>0,route);
    }
    assert.match((await request(running.url,{path:'/web/ui-elements.mjs'})).headers['content-type'],/^text\/javascript/);
    assert.match((await request(running.url,{path:'/web/icons.svg'})).headers['content-type'],/^image\/svg\+xml/);
    assert.match((await request(running.url,{path:'/web/travel-wash.png'})).headers['content-type'],/^image\/png/);
    assert.match((await request(running.url,{path:'/'})).text,/href="#\/data"[^>]*data-nav="data"/);
    assert.match((await request(running.url,{path:'/'})).text,/href="#\/archive"[^>]*data-nav="archive"/);
    assert.match((await request(running.url,{path:'/'})).text,/href="\/web\/archive-styles\.css"/);
    for(const route of ['/','/web/styles.css','/web/footprint-styles.css','/web/archive-styles.css']){const text=(await request(running.url,{path:route})).text;assert.doesNotMatch(text,/(?:src|href)=["']https?:|url\(\s*["']?https?:/i,route);}
    for(const route of ['/runtime/travel.sqlite','/src/start.mjs','/storage/database.mjs','/.env','/package.json'])assert.equal((await request(running.url,{path:route})).status,404,route);
  } finally {await running.close();}
});

test('served browser code contains no window.print print button or report DOM',async t=>{
  const {path,database}=setup(t);database.close();const running=await startServer({dbPath:path,port:0});
  try {
    for(const route of ['/web/app.mjs','/web/router.mjs','/web/views.mjs','/web/archive-controller.mjs','/web/archive-views.mjs','/web/archive-styles.css']) {
      const value=(await request(running.url,{path:route})).text;assert.doesNotMatch(value,/window\.print|打印\/保存为 PDF|archive-report|archive-document|archive-print-mode/u,route);
    }
  } finally {await running.close();}
});

test('browser CSP uses a fixed AMap allowlist without user-controlled values',async t=>{
  const {path,database}=setup(t);database.close();
  const running=await startServer({dbPath:path,port:0});
  try {
    const response=await request(running.url,{path:'/'}),csp=response.headers['content-security-policy'];
    assert.match(csp,/default-src 'self'/);
    assert.match(csp,/https:\/\/webapi\.amap\.com/);
    assert.match(csp,/https:\/\/\*\.amap\.com/);
    assert.match(csp,/script-src[^;]*'unsafe-eval'/);
    assert.match(csp,/connect-src 'self'/);
    assert.doesNotMatch(csp,/user-map-host|securityJsCode|api[_-]?key/i);
  } finally {await running.close();}
});

test('stopping and restarting the actual server preserves saved trips',async t=>{
  const {path,database,service}=setup(t);service.saveTrip('trip-1',prepare(service));database.close();
  const first=await startServer({dbPath:path,port:0});
  try {assert.equal((await request(first.url,{path:'/api/trips/trip-1'})).json.data.name,'江南小旅行');}finally {await first.close();}
  const restarted=await startServer({dbPath:path,port:0});
  try {assert.equal((await request(restarted.url,{path:'/api/trips'})).json.data.length,1);}finally {await restarted.close();}
});

test('startup never allows binding a public interface',async()=>{
  await assert.rejects(startServer({host:'0.0.0.0',port:0}),/loopback/);
});
