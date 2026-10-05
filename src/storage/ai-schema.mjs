export const aiTables={
  ai_settings:'CREATE TABLE ai_settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL)',
  ai_jobs:'CREATE TABLE ai_jobs(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL)',
  ai_plans:'CREATE TABLE ai_plans(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL)',
  ai_conversions:'CREATE TABLE ai_conversions(plan_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,payload TEXT NOT NULL)',
};
export const activeJobIndex="CREATE UNIQUE INDEX ai_one_active_job ON ai_jobs((1)) WHERE state IN ('queued','searching','generating')";
// Caller owns the transaction, including the metadata update.
export function applyAiSchema(db) {
  for(const sql of Object.values(aiTables))db.exec(sql);
  db.exec(activeJobIndex);db.exec('UPDATE metadata SET version=2');
}
