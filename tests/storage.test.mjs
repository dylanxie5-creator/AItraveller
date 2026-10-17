import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/storage/database.mjs';
import {createTravelService} from '../src/services/travel-service.mjs';
import {setup,prepare} from './helpers/database.mjs';

test('trip cities and drafts survive database close and reopen',t=>{
  const {path,database,service}=setup(t);
  service.saveTrip('trip-1',prepare(service)); database.close();
  const reopened=openDatabase(path);
  const next=createTravelService({database:reopened});
  assert.equal(next.getTrip('trip-1').cities[1].cityName,'苏州市'); assert.equal(next.getTrip('trip-1').budgetCents,320050);
  assert.equal(next.getDraft('new').state,'closed');reopened.close();
});
test('corrupt newer and unversioned databases remain untouched',t=>{
  const {path,database}=setup(t); database.close();
  const raw=new DatabaseSync(path); raw.prepare('UPDATE metadata SET version=5').run();raw.close();
  const before=readFileSync(path);assert.throws(()=>openDatabase(path),e=>e.code==='STORAGE_VERSION');assert.deepEqual(readFileSync(path),before);
  writeFileSync(path,'not a database'); const corrupt=readFileSync(path);assert.throws(()=>openDatabase(path),e=>e.code==='STORAGE_CORRUPT');assert.deepEqual(readFileSync(path),corrupt);
});
test('nonempty unversioned SQLite is not initialized',t=>{
  const {path,database}=setup(t);database.close();
  const raw=new DatabaseSync(path);raw.exec('DROP TABLE metadata');raw.close(); const before=readFileSync(path);
  assert.throws(()=>openDatabase(path),e=>e.code==='STORAGE_CORRUPT');assert.deepEqual(readFileSync(path),before);
});
test('transaction cleanup failure rolls back trip cities draft and receipt',t=>{
  const {database,service}=setup(t);const command=prepare(service);
  database.db.exec("CREATE TRIGGER fail_close BEFORE UPDATE ON drafts WHEN NEW.state='closed' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  assert.throws(()=>service.saveTrip('trip-1',command));
  assert.equal(service.listTrips().length,0);assert.equal(service.getDraft('new').revision,1);assert.equal(service.getDraft('new').state,'active');
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM save_receipts').get().n,0);
  database.db.exec('DROP TRIGGER fail_close');assert.equal(service.saveTrip('trip-1',command).revision,1);
});
