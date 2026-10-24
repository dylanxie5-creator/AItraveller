# Web Data Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe same-computer automatic, manual, downloadable, importable, and rollback-capable SQLite backup and restore to the local web app.

**Architecture:** A focused backup store owns verified snapshot files and metadata, while a runtime coordinator owns the live database/services and performs exclusive atomic replacement with rollback. The HTTP layer streams imports/downloads and delegates all writes through a mutation gate; a dedicated `#/data` controller/view exposes the workflow without revealing credentials.

**Tech Stack:** Node.js 25.9+ built-ins (`node:sqlite`, `node:http`, `node:fs`), ECMAScript modules, SQLite, browser DOM APIs, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-24-web-data-backup-restore-design.md`

## Global Constraints

- Same-computer, same-Windows-user recovery only; no cloud sync or account system.
- Current supported application database schema is exactly version 4.
- Automatic backup checks at startup, runs only when the latest successful automatic backup is at least 24 hours old, and retains exactly the newest 14 automatic backups.
- Manual and pre-restore backups are never removed by automatic rotation.
- Imported SQLite bodies are streamed with a hard 256 MiB limit and `application/vnd.sqlite3` content type.
- API/map credentials remain DPAPI CurrentUser ciphertext and must never appear in API responses, logs, or metadata.
- The server remains bound to `127.0.0.1`, keeps its database ownership lock during restore, and continues enforcing Host and same-origin write guards.
- Use only Node.js built-ins; do not add production dependencies.

## Review Focus

- A valid SQLite database from another application must fail project schema validation without changing live data; pin in Task 1 storage tests.
- A backup whose JSON metadata ID/fingerprint/size disagrees with its file must be omitted or rejected; pin in Task 1 catalog tests.
- A restore failure after the live database has been moved must put the original database and any WAL/SHM files back and reopen services; pin in Task 2 runtime tests.
- A write request racing with restore must either finish before exclusivity or receive `DATA_RESTORE_IN_PROGRESS`, never mutate the replacement database; pin in Task 3 HTTP tests.
- An upload that exceeds 256 MiB or disconnects mid-stream must delete its partial file and leave the live database untouched; pin with an injectable lower test limit in Task 3 HTTP tests.

---

### Task 1: Verified backup catalog and rotation

**Files:**
- Create: `src/storage/data-backup-store.mjs`
- Create: `tests/data-backup-store.test.mjs`
- Modify: `src/storage/migration-backup.mjs`

**Interfaces:**
- Consumes: `validateDatabase(db) -> 4` and `databaseFingerprint(db) -> string`.
- Produces: `createDataBackupStore({dbPath, getDatabase, backupImpl, clock, createId})` with `list()`, `create(kind, {note})`, `importFile(path, {note})`, `resolve(id)`, `remove(id)`, and `ensureAutomatic()`.
- Produces: backup records `{id, kind, createdAt, sizeBytes, note, fingerprint}` where `kind` is `auto | manual | pre-restore`.

- [ ] **Step 1: Write failing catalog and snapshot tests**

  Cover complete committed-data snapshots, strict project/version validation, notes capped at 80 characters, opaque IDs, persistent list ordering, metadata/file mismatch rejection, non-project SQLite rejection, and cleanup of partial files.

- [ ] **Step 2: Run the focused tests and verify failure**

  Run: `node --test tests/data-backup-store.test.mjs`
  Expected: FAIL because `data-backup-store.mjs` does not exist.

- [ ] **Step 3: Implement the backup store**

  Keep the managed directory at `<db-dir>/backups/data`; reserve unique `.partial` names with exclusive creation, use `node:sqlite.backup`, validate read-only copies, write metadata through a temporary file, and atomically rename both artifacts. Export only the factory interface above; share fingerprint logic from `migration-backup.mjs` without changing migration behavior.

- [ ] **Step 4: Add failing time/rotation tests**

  Assert startup creates the first automatic backup, skips at 23:59:59, creates at 24:00:00, retains newest 14 autos, and leaves all manual/pre-restore/migration files untouched.

- [ ] **Step 5: Implement `ensureAutomatic()` and verify Task 1**

  Run: `node --test tests/data-backup-store.test.mjs tests/*migration.test.mjs`
  Expected: all selected tests PASS.

- [ ] **Step 6: Commit Task 1**

  Commit: `feat: add verified local backup catalog`

### Task 2: Live runtime restore with rollback

**Files:**
- Create: `src/services/data-runtime.mjs`
- Create: `src/services/mutation-coordinator.mjs`
- Create: `tests/data-runtime.test.mjs`
- Modify: `src/start.mjs`

**Interfaces:**
- Consumes: Task 1 `createDataBackupStore` and existing service/store factories.
- Produces: `createMutationCoordinator()` with `runWrite(fn)`, `runRestore(fn)`, and `isRestoring()`.
- Produces: `createDataRuntime({dbPath, aiFactory, protectorFactory, backupStoreFactory, fileOps})` with `start({signal})`, `current()`, `restore(backupId)`, `ensureAutomaticBackup()`, and `close()`.
- `current()` returns the current `{database, service, expenses, footprints, mapSettings, amapProxy, ai, backups}` context.

- [ ] **Step 1: Write failing mutation-coordinator tests**

  Assert ordinary writes serialize through active restore state, new writes fail with `DATA_RESTORE_IN_PROGRESS`, concurrent restore attempts fail, and exclusive state always clears after rejection.

- [ ] **Step 2: Implement `createMutationCoordinator()` and run its tests**

  Run: `node --test tests/data-runtime.test.mjs --test-name-pattern="mutation coordinator"`
  Expected: matching tests PASS.

- [ ] **Step 3: Write failing successful-restore tests**

  Create data A, make a manual backup, change to data B, restore A, then assert rebuilt travel/expense/footprint/AI settings services observe A and that a persistent `pre-restore` backup contains B.

- [ ] **Step 4: Implement runtime construction and atomic restore**

  `restore(backupId)` must revalidate a fresh staged copy, enter exclusive mode, stop AI jobs, create/verify `pre-restore`, close the database, move the live DB plus exact `-wal`/`-shm` siblings to random rollback names, promote the staged DB, reopen version 4, rebuild services, and sync footprints.

- [ ] **Step 5: Write and pass rollback/startup tests**

  Inject failure after promotion and assert the original DB and sidecars are restored and usable; assert the database lock remains held; assert `start()` runs the 24-hour automatic check without preventing startup when backup creation fails with a safe surfaced status.

  Run: `node --test tests/data-runtime.test.mjs tests/database-lock.test.mjs tests/storage.test.mjs`
  Expected: all selected tests PASS.

- [ ] **Step 6: Refactor `startServer()` to use the runtime and commit**

  Preserve `startServer({dbPath, port, host, lockFactory, aiFactory})` compatibility, keep the HTTP server alive during database replacement, and keep shutdown idempotent.

  Commit: `feat: restore data through replaceable runtime`

### Task 3: Safe backup HTTP API and streaming files

**Files:**
- Create: `src/server/data-api-router.mjs`
- Create: `tests/data-http.test.mjs`
- Modify: `src/server/request-guards.mjs`
- Modify: `src/server/http-app.mjs`
- Modify: `tests/helpers/http-client.mjs`
- Modify: `tests/http.test.mjs`

**Interfaces:**
- Consumes: Task 2 runtime `current()`, `restore(id)`, and mutation coordinator.
- Produces API routes: `GET /api/data/backups`, `POST /api/data/backups`, `POST /api/data/backups/import`, `GET /api/data/backups/:id/download`, and `POST /api/data/backups/:id/restore`.
- Produces: `streamUpload(req, {directory, maxBytes, createId}) -> Promise<{path, bytes}>` and download result `{path, filename, sizeBytes}`.

- [ ] **Step 1: Write failing JSON API and download tests**

  Assert list/create/restore response shapes, notes validation, unknown/unsafe IDs returning 404, exact SQLite download headers, no path leakage, Host/Origin rejection, and no credential fields in serialized responses.

- [ ] **Step 2: Implement JSON routes and streamed downloads**

  Resolve download paths only through the catalog record. Set `Content-Type: application/vnd.sqlite3`, `Content-Disposition` with a server-generated ASCII filename, `Content-Length`, `Cache-Control: no-store`, and stream the file without buffering it wholly.

- [ ] **Step 3: Write failing binary import tests**

  Assert only `application/vnd.sqlite3` is accepted, the body is streamed to an opaque temporary path, legal export re-import works, invalid/truncated/foreign/oversized bodies are rejected, and all partial files are removed on failure or disconnect.

- [ ] **Step 4: Implement binary request guarding and import**

  Preserve JSON-only behavior for every other write route. Use an injectable upload limit in tests and the exact 256 MiB production limit.

- [ ] **Step 5: Add and pass restore concurrency/error tests**

  Assert writes racing with restore receive HTTP 503/code `DATA_RESTORE_IN_PROGRESS`, restore failure returns a safe code/message, the original database remains queryable, and raw filesystem/SQLite errors never reach the response.

  Run: `node --test tests/data-http.test.mjs tests/http.test.mjs`
  Expected: all selected tests PASS.

- [ ] **Step 6: Commit Task 3**

  Commit: `feat: expose safe local backup APIs`

### Task 4: Data Safety browser page

**Files:**
- Create: `src/web/data-controller.mjs`
- Create: `src/web/data-views.mjs`
- Create: `tests/web-data.test.mjs`
- Modify: `src/web/api-client.mjs`
- Modify: `src/web/router.mjs`
- Modify: `src/web/app.mjs`
- Modify: `src/web/index.html`
- Modify: `src/web/styles.css`
- Modify: `tests/web-navigation.test.mjs`

**Interfaces:**
- Consumes API routes from Task 3.
- Produces route `{type: 'data'}` at `#/data` and navigation section `data`.
- Produces `createDataController({api, render, confirm, reload, download})` with `load()`, `setNote(value)`, `createBackup()`, `importBackup(file)`, `restore(record)`, `download(record)`, `dispose()`, and `snapshot()`.

- [ ] **Step 1: Write failing route, client, and state tests**

  Assert `#/data` round-trips, the nav section is active, API methods use correct method/content type/body, late responses are ignored, note input is capped, and every mutation exposes a busy state that participates in unload protection.

- [ ] **Step 2: Implement route, API client, and controller**

  Keep binary upload separate from the JSON `call()` helper; use a same-origin download URL rather than exposing a disk path. Restore must require the supplied confirmation callback and call `reload()` only after success.

- [ ] **Step 3: Write failing view tests**

  Assert summary values, empty state, type labels, notes, formatted byte sizes/timestamps, manual create form, hidden `.sqlite` file input, per-record download/restore actions, two-stage restore wording, busy disabled controls, success/error status regions, and absence of any key/secret value.

- [ ] **Step 4: Implement and style the data page**

  Follow the existing warm visual system, keyboard/focus conventions, `role=status`/`role=alert`, and responsive behavior. Add “数据安全” to the sidebar settings area.

- [ ] **Step 5: Pass browser-unit tests and commit**

  Run: `node --test tests/web-data.test.mjs tests/web-navigation.test.mjs`
  Expected: all selected tests PASS.

  Commit: `feat: add data safety page`

### Task 5: Documentation, full regression, and browser acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/web-foundation-acceptance.md`
- Modify: `docs/superpowers/plans/2026-10-24-web-data-backup-restore.md`

**Interfaces:**
- Consumes the completed storage, runtime, HTTP, and UI features.
- Produces user instructions and recorded acceptance evidence; no new runtime API.

- [ ] **Step 1: Update operating and recovery documentation**

  Document automatic/manual/pre-restore behavior, on-disk location, same-Windows-user DPAPI limitation, download/import workflow, 256 MiB limit, and the rule never to copy over the live database manually.

- [ ] **Step 2: Run the complete automated suite**

  Run: `npm test`
  Expected: all tests PASS, with only the already-documented Windows symlink permission skip allowed.

- [ ] **Step 3: Perform real browser acceptance**

  In the built-in browser: create identifiable trip/expense/footprint data; create and download a manual backup; change/delete that data; restore from history and verify after reload; import the downloaded backup; confirm invalid-file rejection; restart the server and confirm catalog/data persistence.

- [ ] **Step 4: Record exact evidence and update plan checkboxes**

  Add the test command/results and browser scenarios to `docs/web-foundation-acceptance.md`. Mark only actually completed checklist items.

- [ ] **Step 5: Review the final diff and commit**

  Run: `git diff --check` and `git status --short`
  Expected: no whitespace errors; only intentional files changed before commit.

  Commit: `docs: complete data backup acceptance`
