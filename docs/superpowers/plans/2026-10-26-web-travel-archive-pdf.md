# Web Travel Archive PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only single-trip and all-completed-trips archive previews that print as fixed A4 PDFs through the browser.

**Architecture:** Build a sanitized report read model from the existing v4 SQLite stores inside one transaction, expose it through two GET APIs, then render dedicated print routes in the existing dependency-free SPA. Reports are generated from current data, never persisted, never fetch third-party resources, and use print CSS plus `window.print()` rather than a PDF runtime dependency.

**Tech Stack:** Node.js ESM, `node:sqlite`, native HTTP server, browser DOM/CSS paged media, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-26-web-travel-archive-pdf-design.md`

## Global Constraints

- Do not add runtime dependencies, database tables, migrations, export-history records, or generated PDF files.
- A trip is exportable only when `trip.endDate < today`; an end date equal to `today` is still ongoing.
- Single and total reports are read-only snapshots generated from one database transaction; refresh is the only way to read newer data.
- Total reports contain only completed formal trips, ordered by start date descending and then stable trip identity; each trip chapter starts on a new page.
- Preserve current guide, conversion-time snapshot, model original output, expenses, linked footprints, sources, and accurate empty states.
- Total footprint index includes current automatic, manual, and detached historical visits; per-trip chapters include only visits linked to that trip.
- Never expose API keys, ciphertext, filesystem paths, backup IDs, operation IDs, revisions, internal trip/expense/visit UUIDs, SQL, or stack diagnostics.
- Render untrusted business text with DOM text nodes only; only validated HTTP(S) source URLs may become links, with `noopener noreferrer`.
- Print uses local system fonts and no remote font, image, map, source-site, or AMap request.
- The print action must remain user initiated; cancelling printing creates no write and no success claim.

## Review Focus

- Boundary/status input: a trip ending today, a future trip, and an unknown trip must not leak into or bypass archive eligibility; Task 2 pins all three.
- Version divergence: current guide, conversion snapshot, and model original output may all differ and must retain their labels and values; Tasks 1 and 2 pin this.
- Aggregation hazards: same-named categories, whole-trip expenses, overlapping trip dates, and safe-integer overflow must produce deterministic totals or a controlled failure; Task 1 pins these.
- Hostile/oversized presentation data: markup-looking notes, very long URLs, long tables, and missing optional sections must remain text, paginate, and never enable partial printing; Task 5 pins these.
- Runtime replacement: after data restore, a new report request must use the replacement archive service while an already-rendered tab remains static; Task 3 pins the server side and Task 4 pins the client snapshot behavior.

---

### Task 1: Pure Archive Read Model

**Files:**
- Create: `src/reports/archive-model.mjs`
- Create: `tests/archive-domain.test.mjs`

**Interfaces:**
- Consumes: existing validated trip objects, `ExpenseService#getOverview(tripId)` output, validated footprint rows, and sanitized AI plan/conversion data.
- Produces: `isCompletedTrip(trip, today) -> boolean`, `buildTripArchive(input) -> TripArchive`, and `buildTravelArchive(input) -> TravelArchive`.
- `TripArchive` contains only `kind`, `generatedAt`, `cutoffDate`, `databaseVersion`, `trip`, `expenses`, `footprints`, and `guide`. Its nested business fields follow the spec and omit storage identity/revision fields. Each guide source keeps display `url` plus nullable `href`; `href` is present only for an exact HTTP(S) URL.
- `TravelArchive` contains only `kind`, `generatedAt`, `cutoffDate`, `databaseVersion`, `summary`, `byYear`, `byCategory`, `byCity`, `wholeTripExpenseCents`, `directory`, `trips`, and `footprints`.

- [x] **Step 1: Write failing completion and trip-model tests**

  Add tests named `completed boundary requires end date before today` and `trip archive strips storage identities and preserves three guide versions`. Assert `2026-10-25` is completed for `today='2026-10-26'`, `2026-10-26` is not, and the output contains current guide, conversion snapshot, original model output and source dates. Assert an HTTPS source has matching `url`/`href`, a `javascript:` source keeps display `url` but has `href:null`, and JSON output excludes fixture UUIDs, revisions, `operationId`, `keyCipher`, paths and unrelated properties.

- [x] **Step 2: Run the focused tests and verify RED**

  Run: `node --test tests/archive-domain.test.mjs`

  Expected: FAIL because `src/reports/archive-model.mjs` does not exist.

- [x] **Step 3: Implement completion and `buildTripArchive`**

  Implement exact exports:

  ```js
  export function isCompletedTrip(trip, today)
  export function buildTripArchive({trip, expenseOverview, visits, guide, generatedAt, cutoffDate, databaseVersion = 4})
  ```

  The returned `trip` keeps names, dates, traveler count, budget, inclusive `durationDays`, and city snapshots; expense rows keep date/category/city state/amount/note but no IDs; footprint rows keep city/province/date precision/range/source/note but no IDs or linked IDs. `guide` is `null` or keeps provider/model/edit metadata, `current`, `conversionSnapshot`, `original`, and sanitized sources.

- [x] **Step 4: Write failing total-archive aggregation tests**

  Add tests named `travel archive sorts completed chapters and computes exact totals` and `archive aggregation handles collisions boundaries and overflow`. Use two overlapping completed trips plus one non-completed input. Assert durations are added per trip, chapters and yearly directory are newest first, same display category names merge, whole-trip amounts stay separate, city amounts exclude whole-trip amounts, all footprint sources appear in the global index, and a sum above `Number.MAX_SAFE_INTEGER` throws a controlled `RangeError`.

- [x] **Step 5: Implement `buildTravelArchive` and run GREEN**

  Implement:

  ```js
  export function buildTravelArchive({tripArchives, allVisits, generatedAt, cutoffDate, databaseVersion = 4})
  ```

  Use safe integer addition throughout. Group category totals by display name, city totals by province/city display pair, yearly totals by trip start year, and preserve the global visit ordering supplied by the validated footprint presentation layer.

  Run: `node --test tests/archive-domain.test.mjs tests/expense-domain.test.mjs tests/footprint-domain.test.mjs`

  Expected: all tests PASS.

- [x] **Step 6: Commit the pure model**

  ```powershell
  git add src/reports/archive-model.mjs tests/archive-domain.test.mjs
  git commit -m "feat: build sanitized travel archive reports"
  ```

---

### Task 2: Transactional Archive Service

**Files:**
- Create: `src/services/archive-service.mjs`
- Create: `tests/archive-service.test.mjs`
- Modify: `tests/helpers/database.mjs`

**Interfaces:**
- Consumes: Task 1 model builders; existing trip, expense, footprint, AI plan and conversion stores.
- Produces: `createArchiveService({database, today, now, storeFactory}) -> {getTripArchive(tripId), getTravelArchive()}`. `storeFactory` is optional dependency injection for tests and returns `{trips, expenses, footprints, plans, conversions}` using the existing stores/services by default.
- `getTripArchive` returns one `TripArchive`; `getTravelArchive` returns one `TravelArchive`. Both execute all reads inside `database.transaction(...)` and capture `today()`/`now()` once per call.

- [x] **Step 1: Write failing service fixture and eligibility tests**

  Extend `tests/helpers/database.mjs` only with a reusable archive setup that creates completed, ending-today, future, expense, footprint, converted-plan and edited-plan fixtures in an isolated database. Add service tests asserting unknown trip throws `NOT_FOUND`, ending-today/future throw `ARCHIVE_NOT_COMPLETED`, and the total report contains only the completed fixture.

- [x] **Step 2: Run service tests and verify RED**

  Run: `node --test tests/archive-service.test.mjs`

  Expected: FAIL because `createArchiveService` is missing.

- [x] **Step 3: Implement store aggregation and three-version AI lookup**

  Implement:

  ```js
  export function createArchiveService({database, today = todayDateOnly, now = () => new Date().toISOString(), storeFactory = createArchiveStores})
  ```

  Instantiate the existing stores/services once. For a linked conversion, load its current plan by `planId`, preserve `conversion.snapshot`, `plan.original`, `plan.content`, and plan sources; a trip without a conversion gets `guide:null`. Convert storage `NOT_FOUND` and validation failures using existing error classes, and add `StoreError('ARCHIVE_NOT_COMPLETED', '行程结束后才能生成档案')` for the eligibility boundary.

- [x] **Step 4: Add transaction-boundary and no-write tests**

  Wrap the test database's `transaction` method with a counter/active flag and inject store factories whose reads assert that flag is true. Assert each public service call enters exactly one outer transaction and every store read occurs inside it. Capture `databaseFingerprint` and all business table row counts before repeated reads and assert they are unchanged. Assert returned JSON has no internal UUID/revision/secret/path field from fixtures.

- [x] **Step 5: Run focused and storage regression tests**

  Run: `node --test tests/archive-service.test.mjs tests/archive-domain.test.mjs tests/storage.test.mjs tests/expense-service.test.mjs tests/footprint-service.test.mjs tests/ai-conversion.test.mjs`

  Expected: all tests PASS with zero database writes from archive reads.

- [x] **Step 6: Commit the service**

  ```powershell
  git add src/services/archive-service.mjs tests/archive-service.test.mjs tests/helpers/database.mjs
  git commit -m "feat: aggregate travel archives transactionally"
  ```

---

### Task 3: Read-Only Archive HTTP APIs and Runtime Replacement

**Files:**
- Create: `src/server/archive-api-router.mjs`
- Create: `tests/archive-http.test.mjs`
- Modify: `src/services/data-runtime.mjs`
- Modify: `src/server/http-app.mjs`
- Modify: `src/start.mjs`
- Modify: `tests/data-runtime.test.mjs`

**Interfaces:**
- Consumes: Task 2 `archiveService` methods.
- Produces: GET `/api/archive`, GET `/api/archive/trips/:tripId`, and `runtime.current().archives`.
- HTTP success shape remains `{data: TravelArchive|TripArchive}`. `ARCHIVE_NOT_COMPLETED` maps to HTTP 409 with the fixed safe message `行程结束后才能生成档案`.

- [x] **Step 1: Write failing router and HTTP contract tests**

  Test the two exact GET paths, malformed/encoded/traversal IDs, unsupported methods, unknown trips, end-date boundary, disallowed Host, absence of permissive CORS headers, response `no-store`, and absence of internal IDs, `apiKey`, `keyCipher`, `securityCipher`, paths and SQL text. Assert archive reads never invoke a mutation coordinator write path.

- [x] **Step 2: Run HTTP tests and verify RED**

  Run: `node --test tests/archive-http.test.mjs`

  Expected: FAIL with archive routes returning 404.

- [x] **Step 3: Implement router, error mapping and runtime wiring**

  Export:

  ```js
  export function routeArchiveApi(archives, method, path)
  ```

  Build `archives:createArchiveService({database})` in every `data-runtime` context, dispatch archive GET routes before the generic `/api/` router, and keep fixed-service construction available for isolated HTTP tests. Add `archives` to `startServer` wiring without introducing a write coordinator call.

- [x] **Step 4: Write and pass replacement-runtime tests**

  Extend `tests/data-runtime.test.mjs`: prepare two databases with different completed trip names, restore the second, and assert `runtime.current().archives.getTravelArchive()` and the next HTTP GET return only the replacement name. Assert a report object fetched before restore remains unchanged as a detached plain value.

- [x] **Step 5: Run focused and server regressions**

  Run: `node --test tests/archive-http.test.mjs tests/data-runtime.test.mjs tests/http.test.mjs tests/data-http.test.mjs`

  Expected: all tests PASS; restore/write behavior remains unchanged.

- [x] **Step 6: Commit the API layer**

  ```powershell
  git add src/server/archive-api-router.mjs src/server/http-app.mjs src/services/data-runtime.mjs src/start.mjs tests/archive-http.test.mjs tests/data-runtime.test.mjs
  git commit -m "feat: expose read-only travel archive APIs"
  ```

---

### Task 4: Client Routing and Snapshot Loading

**Files:**
- Create: `src/web/archive-controller.mjs`
- Create: `tests/web-archive.test.mjs`
- Modify: `src/web/api-client.mjs`
- Modify: `src/web/router.mjs`
- Modify: `tests/web-navigation.test.mjs`

**Interfaces:**
- Consumes: Task 3 APIs.
- Produces routes `archive-home`, `archive-print`, `trip-archive-print`; API methods `travelArchive()` and `tripArchive(id)`; `createArchiveController({api, render, print})` with `load(route)`, `print()`, `dispose()`, and `snapshot()`.
- The controller emits `archive-loading`, `archive-home`, `archive-report`, `archive-empty`, or `archive-error` states and never mutates report data after a successful load.

- [x] **Step 1: Write failing route and API-client tests**

  Assert round trips for `#/archive`, `#/reports/archive/print`, and `#/reports/trips/<encoded-safe-id>/print`; reject malformed identities back to home. Assert API client GETs `/api/archive` and the encoded trip endpoint with no request body.

- [x] **Step 2: Write failing controller lifecycle tests**

  Test late response suppression after navigation/disposal, `archive-empty` for zero trips, error/retry retention, print ignored while loading/error, exactly one injected `print()` call after a complete report, and that mutating the API fixture after load does not change `snapshot().report`.

- [x] **Step 3: Run web logic tests and verify RED**

  Run: `node --test tests/web-archive.test.mjs tests/web-navigation.test.mjs`

  Expected: FAIL because routes, client methods and controller do not exist.

- [x] **Step 4: Implement API, routes and controller**

  Add exact client methods and controller interface above. Clone/freeze the received read model at successful load, increment a sequence token on every load/dispose, and call the injected print function only when the state is a complete `archive-report`.

- [x] **Step 5: Run client snapshot and routing regressions**

  Run: `node --test tests/web-archive.test.mjs tests/web-navigation.test.mjs tests/web-data.test.mjs tests/web-form.test.mjs`

  Expected: all tests PASS.

- [x] **Step 6: Commit client logic**

  ```powershell
  git add src/web/archive-controller.mjs src/web/api-client.mjs src/web/router.mjs tests/web-archive.test.mjs tests/web-navigation.test.mjs
  git commit -m "feat: load immutable travel archive previews"
  ```

---

### Task 5: Archive Views and A4 Print Styles

**Files:**
- Create: `src/web/archive-views.mjs`
- Create: `src/web/archive-styles.css`
- Modify: `src/web/app.mjs`
- Modify: `src/web/index.html`
- Modify: `src/web/views.mjs`
- Modify: `src/server/static-files.mjs`
- Modify: `tests/web-archive.test.mjs`
- Modify: `tests/project.test.mjs`

**Interfaces:**
- Consumes: Task 4 archive controller states and report shapes.
- Produces: `renderArchiveView(root, state, actions)` and helpers that render the archive landing page, single-trip report, total report, empty/loading/error states, suggested filename, and print controls.
- `actions` is `{print(), retry(route)}`; preview links are plain safe anchors to Task 4 hashes.

- [x] **Step 1: Write failing landing/detail integration view tests**

  Assert the sidebar has “旅行档案”; archive landing shows completed count/cutoff and a new-tab total-preview link; completed trip detail has a new-tab single-preview link; ending-today/upcoming detail shows the non-exportable explanation and no print link.

- [x] **Step 2: Write failing report DOM safety and completeness tests**

  Render fixtures containing `<script>`, an `onerror` image string, a very long HTTP URL, a `javascript:` display URL with `href:null`, empty expenses/guide/footprints, and three divergent guide versions. Assert hostile strings exist only as text nodes, only non-null HTTP(S) `href` values are anchors with `noopener noreferrer`, every empty chapter remains visible, all guide labels/values render, and the print button exists only for complete `archive-report` state.

- [x] **Step 3: Add failing static/print CSS tests**

  Assert both new assets are on the static allowlist and `index.html` links `archive-styles.css`. Assert CSS contains `@page` A4 portrait rules, print-only hiding for shell/actions, repeated table headers, `break-before` for chapters, `break-inside` protection for entries, and overflow wrapping for URLs. Include a long-table DOM fixture with at least 80 expenses to guard against accidental client truncation.

- [x] **Step 4: Run view tests and verify RED**

  Run: `node --test tests/web-archive.test.mjs tests/project.test.mjs`

  Expected: FAIL because archive views/assets are absent.

- [x] **Step 5: Implement views, navigation entry and print stylesheet**

  Use existing `el`/`button` DOM helpers or move them to a shared web helper only if tests require reuse; do not use `innerHTML`. Render the accepted cover, overview, daily guide, expense summaries/table, linked footprint chapter, source appendix, total cover/directory/global indexes, generated time and cutoff. In print mode hide sidebar/topbar/footer/actions and expand the report to A4 width; use paged-media counters where supported and a truthful fallback without fake total pages. Wire archive route types into `app.mjs`: select the archive navigation section, create/dispose one controller per archive route, inject `window.print`, keep it outside `hasPendingWrites`, and open previews only through normal `target="_blank" rel="noopener"` anchors.

- [x] **Step 6: Run front-end and static regressions**

  Run: `node --test tests/web-archive.test.mjs tests/web-navigation.test.mjs tests/project.test.mjs tests/web-ai.test.mjs tests/web-expense.test.mjs tests/web-footprint.test.mjs`

  Expected: all tests PASS; existing navigation and pages remain intact.

- [x] **Step 7: Commit the printable UI**

  ```powershell
  git add src/web/archive-views.mjs src/web/archive-styles.css src/web/app.mjs src/web/index.html src/web/views.mjs src/server/static-files.mjs tests/web-archive.test.mjs tests/project.test.mjs
  git commit -m "feat: add printable travel archive pages"
  ```

---

### Task 6: Full Verification, Browser Acceptance and Documentation

**Files:**
- Create: `docs/web-archive-acceptance.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-10-26-web-travel-archive-pdf.md`
- Test: all `tests/*.test.mjs`

**Interfaces:**
- Consumes: complete Tasks 1–5 feature.
- Produces: reproducible user instructions and acceptance evidence; no new product interface.

- [x] **Step 1: Run the complete automated suite and static check**

  Run:

  ```powershell
  npm test
  git diff --check
  ```

  Expected: zero failures; document every intentional skip instead of calling it a pass.

- [x] **Step 2: Start an isolated archive QA database**

  Use a non-default `TRAVEL_DB_PATH` and a free loopback port. Seed at least: one completed converted-AI trip whose current guide differs from conversion/original, one completed trip without AI, one trip ending today, one future trip, 80+ expense rows including whole-trip and removed-city records, linked/manual/detached footprints, long notes and long safe/unsafe source URLs. Do not use real API calls or the formal database.

- [x] **Step 3: Complete browser acceptance**

  In the built-in browser verify: archive navigation; only completed trips counted; non-completed detail explanation; new-tab single and total previews; all accepted chapters and three AI versions; accurate totals; safe links; no map request; print preview A4 pagination; repeated expense headers; long URL wrapping; hidden shell/actions in print; cancelling print changes no data; refresh reflects a seeded change while the already-open report stays unchanged.

- [x] **Step 4: Repair defects with focused RED→GREEN tests**

  For every defect found, first add the smallest failing test to the owning suite, run it to observe the expected failure, implement the correction, and rerun both the focused suite and affected regressions. Do not broaden UI redesign beyond the accepted warm draft.

- [x] **Step 5: Document use and exact evidence**

  Update `README.md` with entry points, completed-only rule, current-data/no-history behavior, browser print steps, suggested filenames, lack of map/remote resources, and the fact that the website cannot confirm the PDF was saved. Record test counts, browser cases, QA database path, date, screenshots and any unverified printer-specific behavior in `docs/web-archive-acceptance.md`.

- [x] **Step 6: Re-run final verification and commit**

  Run:

  ```powershell
  npm test
  git diff --check
  git status --short
  ```

  Expected: zero failures, only intended feature/docs changes, and no QA database, PDF or screenshot staged.

  ```powershell
  git add README.md docs/web-archive-acceptance.md docs/superpowers/plans/2026-10-26-web-travel-archive-pdf.md
  git commit -m "docs: verify travel archive PDF workflow"
  ```
