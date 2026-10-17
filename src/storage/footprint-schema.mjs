export const footprintTables={
  footprint_visits:'CREATE TABLE footprint_visits(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,city_code TEXT NOT NULL,city_name TEXT NOT NULL,province_code TEXT NOT NULL,province_name TEXT NOT NULL,date_precision TEXT NOT NULL,date_start TEXT NOT NULL,date_end TEXT,source TEXT NOT NULL,linked_trip_id TEXT REFERENCES trips(id),trip_name_snapshot TEXT,note TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)',
  footprint_suppressions:'CREATE TABLE footprint_suppressions(trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,city_code TEXT NOT NULL,created_at TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(trip_id,city_code))',
  footprint_operation_receipts:'CREATE TABLE footprint_operation_receipts(operation_id TEXT PRIMARY KEY,action TEXT NOT NULL,scope_key TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL)',
  map_settings:'CREATE TABLE map_settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL)',
};

export const footprintIndexes={
  footprint_visits_linked_trip_city:'CREATE UNIQUE INDEX footprint_visits_linked_trip_city ON footprint_visits(linked_trip_id,city_code) WHERE linked_trip_id IS NOT NULL',
  footprint_visits_date_updated:'CREATE INDEX footprint_visits_date_updated ON footprint_visits(date_start DESC,updated_at DESC,id)',
  footprint_suppressions_trip:'CREATE INDEX footprint_suppressions_trip ON footprint_suppressions(trip_id,city_code)',
};

// Caller owns the transaction, including rollback on any failed statement.
export function applyFootprintSchema(db) {
  for(const sql of Object.values(footprintTables))db.exec(sql);
  for(const sql of Object.values(footprintIndexes))db.exec(sql);
  db.exec('UPDATE metadata SET version=4');
}
