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
    for(const route of ['/',...['styles.css','app.mjs','api-client.mjs','router.mjs','views.mjs','form-controller.mjs','favicon.svg'].map(f=>'/web/'+f),...['date.mjs','money.mjs','trip-validation.mjs','trip-form-model.mjs','trip-presenter.mjs'].map(f=>'/shared/'+f)]) {
      const response=await request(running.url,{path:route});assert.equal(response.status,200,route);assert.ok(response.text.length>0,route);
    }
    for(const route of ['/runtime/travel.sqlite','/src/start.mjs','/storage/database.mjs','/.env','/package.json'])assert.equal((await request(running.url,{path:route})).status,404,route);
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
