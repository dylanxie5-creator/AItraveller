import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createTravelService} from '../../src/services/travel-service.mjs';
import {createExpenseService} from '../../src/services/expense-service.mjs';
import {createFootprintService} from '../../src/services/footprint-service.mjs';
import {input} from './fixtures.mjs';
export function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'travel-web-test-'));
  const path=join(dir,'travel.sqlite'); const database=openDatabase(path);
  t.after(()=>{database.close();rmSync(dir,{recursive:true,force:true});});
  const service=createTravelService({database,today:()=> '2026-10-02',now:()=> '2026-10-02T12:00:00.000Z'});
  const expenses=createExpenseService({database,today:()=> '2026-10-02',now:()=> '2026-10-02T12:00:00.000Z'});
  const footprints=createFootprintService({database,today:()=> '2026-10-02',now:()=> '2026-10-02T12:00:00.000Z'});
  return {dir,path,database,service,expenses,footprints};
}
export function prepare(service,id='trip-1',key='new',baseTripRevision=0) {
  const prior=service.getDraft(key);
  const slot=service.saveDraft(key,{expectedRevision:prior.revision,sessionId:'session-'+id+'-'+prior.revision,targetTripId:id,baseTripRevision,step:'confirm',input:input()});
  return {operationId:'operation-'+id+'-'+baseTripRevision+'-'+slot.revision,expectedTripRevision:baseTripRevision,input:input(),draft:{key,sessionId:slot.sessionId,revision:slot.revision}};
}
