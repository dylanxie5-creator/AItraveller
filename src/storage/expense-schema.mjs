export const expenseTables={
  expenses:'CREATE TABLE expenses(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,revision INTEGER NOT NULL,amount_cents INTEGER NOT NULL,category_id TEXT NOT NULL,city_code TEXT,city_name TEXT,spent_date TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)',
  expense_categories:'CREATE TABLE expense_categories(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,revision INTEGER NOT NULL,name TEXT NOT NULL,normalized_name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)',
  expense_operation_receipts:'CREATE TABLE expense_operation_receipts(operation_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL)',
};
export const expenseIndexes={
  expense_categories_trip_name:'CREATE UNIQUE INDEX expense_categories_trip_name ON expense_categories(trip_id,normalized_name)',
  expenses_trip_date_updated:'CREATE INDEX expenses_trip_date_updated ON expenses(trip_id,spent_date DESC,updated_at DESC,id)',
};

// Caller owns the transaction, including rollback on any failed statement.
export function applyExpenseSchema(db) {
  for(const sql of Object.values(expenseTables))db.exec(sql);
  for(const sql of Object.values(expenseIndexes))db.exec(sql);
  db.exec('UPDATE metadata SET version=3');
}
