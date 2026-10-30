# Direct PDF Archive Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every browser-print archive flow with a same-origin action that generates and directly downloads a fixed-layout Chinese A4 PDF for either one completed trip or the completed-trip archive.

**Architecture:** Keep the existing transactional archive read model as the single data source, add a PDFKit-based server renderer behind a runtime-scoped `archivePdf` service, and expose two attachment endpoints. A delegated browser download runtime validates the PDF response before creating a temporary Blob download; print routes, report DOM, and `window.print()` are removed.

**Tech Stack:** Node.js 25.9+, PDFKit 0.20.2, native HTTP server, SQLite v4 read model, vanilla JavaScript/CSS, Node test runner, Windows Chinese system fonts, Poppler for visual QA.

**Spec:** `docs/superpowers/specs/2026-10-30-direct-pdf-export-design.md`

## Global Constraints

- Windows and Node.js **v25.9.0 or newer** remain the supported runtime.
- Pin `pdfkit` at **0.20.2** and commit `package-lock.json`; add its MIT notice to `THIRD_PARTY_NOTICES.md`.
- Production Chinese font order is `C:\Windows\Fonts\msyh.ttc`, then `C:\Windows\Fonts\msyhbd.ttc` for bold with regular-font fallback; missing regular font is `PDF_FONT_UNAVAILABLE`.
- A generated PDF must be a complete in-memory `Buffer`, begin with `%PDF-`, contain at least one page, and be at most **67,108,864 bytes** before HTTP headers are written.
- Total archives contain only already-ended trips; single-trip export keeps the existing completed-trip rule.
- Generate from current data on every click; never write an export record, temporary production PDF, API credential, database path, or backup path.
- No external PDF service, remote font, remote image, source-page fetch, browser executable, system print UI, or `window.print()` call is allowed.
- PDF filenames are `旅行总档案-截至YYYY-MM-DD.pdf` and `旅行档案-<sanitized trip name>-<end date>.pdf`.
- Old `#/reports/archive/print` and `#/reports/trips/<id>/print` hashes parse to `archive-home`; they never render a report or open a print dialog.
- Work only in the existing isolated worktree and do not touch `runtime/travel.sqlite` during QA.
- Before the first command that creates a PDF, run the PDF skill marker exactly once with expected output count 2 and output format `pdf`.

## Review Focus

- Unicode/control/Windows-reserved characters in a trip name must not inject headers, create an invalid filename, or erase the `.pdf` suffix; Task 1 and Task 4 pin this.
- A renderer exception or a document over 64 MiB must return one controlled JSON error with no PDF headers or partial body; Task 1 and Task 4 pin this.
- Long CJK text, an unbroken URL, and 80+ expense rows must wrap and paginate with repeated table headers instead of clipping or overlapping; Task 2 pins this and Task 6 renders it.
- Double-clicking download while the first request is pending must create one request and one Blob download, then revoke its URL; Task 5 pins this.
- A database restore swaps the active runtime context; the next PDF request must use the new context rather than a startup-captured archive service; Task 4 pins this.

---

### Task 1: Lock the PDF Runtime, Fonts, Filenames, and Buffer Boundary

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `src/archive/pdf-runtime.mjs`
- Create: `tests/archive-pdf-runtime.test.mjs`

**Interfaces:**
- Consumes: PDFKit 0.20.2 default `PDFDocument` export and `StoreError` from `src/storage/errors.mjs`.
- Produces:
  - `PDF_LIMIT_BYTES = 67108864`
  - `resolveArchiveFonts({fontsDirectory='C:\\Windows\\Fonts', exists=existsSync}) -> {regular:string,bold:string}`
  - `sanitizePdfFilenamePart(value,{maxCodePoints=60}={}) -> string`
  - `archivePdfFilename(report) -> string`
  - `createPdfBuffer({render,PDFDocumentClass=PDFDocument,documentOptions={},maxBytes=PDF_LIMIT_BYTES}) -> Promise<Buffer>`

- [ ] **Step 1: Add the pinned dependency and license record**

Run: `npm install --save-exact pdfkit@0.20.2`

Expected: `package.json` contains exact version `0.20.2`, `package-lock.json` is created, and `npm ls pdfkit` reports one valid 0.20.2 installation. Append PDFKit 0.20.2 / MIT / official repository to `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 2: Write failing runtime tests**

Add tests named:

- `font resolver requires Microsoft YaHei regular and safely falls back bold`
- `filename sanitizer removes controls reserved characters trailing dots and bounds Unicode code points`
- `archive filenames retain fixed Chinese prefix date and pdf suffix`
- `PDF buffer collector returns one complete bounded document`
- `PDF buffer collector converts renderer failure invalid magic empty pages and overflow into controlled errors`

Use injected `exists` for font resolution; use a tiny real PDFKit document for the successful collector and fake stream/document classes for each failure boundary. Assert no raw dependency message or path appears in thrown public messages.

- [ ] **Step 3: Run the focused test and prove RED**

Run: `node --test tests/archive-pdf-runtime.test.mjs`

Expected: FAIL because `src/archive/pdf-runtime.mjs` does not exist.

- [ ] **Step 4: Mark the PDF authoring operation exactly once**

Run:

```powershell
node 'C:\Users\X\.codex\plugins\cache\openai-primary-runtime\pdf\26.1029.11837\skills\pdf\container_tools\mark_artifact_operation_started.mjs' --operation-kind create --expected-output-count 2 --output-format pdf
```

Expected: exit 0. Do not run this marker again in later tasks.

- [ ] **Step 5: Implement the runtime boundary**

Implement the exact exported interfaces. `createPdfBuffer` constructs one document with `autoFirstPage:false`, `bufferPages:true`, `compress:true`, and metadata supplied by the renderer; it collects chunks, rejects immediately on overflow, calls `render(doc)`, ends the document once, and validates `%PDF-` plus at least one buffered page before resolving. Convert unexpected errors to `StoreError('PDF_GENERATION_FAILED','暂时无法生成 PDF，请重试')`; preserve only the three known PDF codes.

- [ ] **Step 6: Run GREEN and dependency checks**

Run:

```powershell
node --test tests/archive-pdf-runtime.test.mjs
npm ls pdfkit
git diff --check
```

Expected: all tests pass; PDFKit is exactly 0.20.2; diff check exits 0.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json THIRD_PARTY_NOTICES.md src/archive/pdf-runtime.mjs tests/archive-pdf-runtime.test.mjs
git commit -m "feat: establish bounded PDF archive runtime"
```

### Task 2: Render a Complete Single-Trip A4 PDF

**Files:**
- Create: `src/archive/pdf-layout.mjs`
- Create: `src/archive/trip-pdf.mjs`
- Create: `tests/archive-trip-pdf.test.mjs`

**Interfaces:**
- Consumes: Task 1 `resolveArchiveFonts` and `createPdfBuffer`; existing trip archive read model from `archive-service`.
- Produces:
  - `createArchivePdfLayout(doc,{fonts}) -> {addPage,ensureSpace,title,heading,paragraph,facts,list,source,expenseTable,finalize}`
  - `renderTripArchivePdf(layout,report,{standalone=true}={}) -> void`
  - `createTripArchivePdf(report,options={}) -> Promise<Buffer>`

- [ ] **Step 1: Write failing layout and trip tests**

Add tests named:

- `layout uses A4 margins registered Chinese fonts warm palette and numbered footers`
- `space guard starts a new page before an indivisible block`
- `expense table measures wrapped cells repeats its header and emits every row`
- `trip PDF includes cover route three guide versions sources expenses and footprints`
- `trip PDF keeps explicit empty chapters without fabricating guide or expense data`
- `trip PDF handles long CJK note and unbroken source URL without clipping`

Use a recording PDF document for exact layout calls and a real generated PDF smoke assertion for `%PDF-`, multiple `/Type /Page` objects, and bounded size. Use at least 80 expense rows in the pagination test.

- [ ] **Step 2: Run the focused test and prove RED**

Run: `node --test tests/archive-trip-pdf.test.mjs`

Expected: FAIL because the layout and trip renderer modules do not exist.

- [ ] **Step 3: Implement reusable A4 layout primitives**

Use A4 portrait with fixed margins, embedded regular/bold fonts, selectable text, explicit page creation, `heightOfString` measurements, and `ensureSpace` before headings, facts, list entries, sources, and table rows. Draw the five-column expense table manually so row height is the maximum wrapped cell height; repeat its header after every automatic page break. `finalize` iterates buffered pages to add a small header and `第 N 页` footer outside the content box.

- [ ] **Step 4: Implement the trip chapter renderer**

Render the exact chapter order from the spec. Write source URLs with PDF link annotations but never fetch them. Preserve hostile-looking text as literal text. Treat missing current/snapshot/original guide versions, expenses, sources, and footprints as explicit `暂无相关记录` sections.

- [ ] **Step 5: Run GREEN and regression**

Run:

```powershell
node --test tests/archive-pdf-runtime.test.mjs tests/archive-trip-pdf.test.mjs
npm test
git diff --check
```

Expected: focused and full suites pass with no new skip.

- [ ] **Step 6: Commit**

```powershell
git add src/archive/pdf-layout.mjs src/archive/trip-pdf.mjs tests/archive-trip-pdf.test.mjs
git commit -m "feat: render single trip archives as PDF"
```

### Task 3: Render the Completed-Trip Travel Archive PDF

**Files:**
- Create: `src/archive/travel-archive-pdf.mjs`
- Create: `tests/archive-travel-pdf.test.mjs`

**Interfaces:**
- Consumes: Task 2 `createArchivePdfLayout` and `renderTripArchivePdf(layout,report,{standalone:false})`; existing total archive read model.
- Produces:
  - `renderTravelArchivePdf(layout,report) -> void`
  - `createTravelArchivePdf(report,options={}) -> Promise<Buffer>`

- [ ] **Step 1: Write failing total-archive tests**

Add tests named:

- `travel PDF includes cover six summary facts years categories city totals and directory`
- `travel PDF begins every trip on a new page and renders all trip chapters`
- `travel PDF finishes with the full precision-aware footprint index`
- `travel PDF rejects an archive with zero completed trips`
- `travel PDF does not serialize credentials paths private settings or fake sample content`

Use two trips from different years, repeated cities, a detached footprint date range, whole-trip expense cents, and marker strings for sensitive configuration that must not occur in any semantic render call.

- [ ] **Step 2: Run the focused test and prove RED**

Run: `node --test tests/archive-travel-pdf.test.mjs`

Expected: FAIL because `src/archive/travel-archive-pdf.mjs` does not exist.

- [ ] **Step 3: Implement the total archive renderer**

Render cover, summary facts, by-year and by-category lists, cross-trip city totals, whole-trip amount, directory, each Task 2 trip chapter on its own page, and the complete footprint index. Reject an empty `report.trips` with `StoreError('ARCHIVE_EMPTY','还没有已经结束的行程')` before a PDF document is created.

- [ ] **Step 4: Run GREEN and regression**

Run:

```powershell
node --test tests/archive-trip-pdf.test.mjs tests/archive-travel-pdf.test.mjs
npm test
git diff --check
```

Expected: all tests pass and no new skip appears.

- [ ] **Step 5: Commit**

```powershell
git add src/archive/travel-archive-pdf.mjs tests/archive-travel-pdf.test.mjs
git commit -m "feat: render complete travel archive PDF"
```

### Task 4: Expose Safe Runtime-Scoped PDF Attachment Endpoints

**Files:**
- Create: `src/services/archive-pdf-service.mjs`
- Modify: `src/services/data-runtime.mjs`
- Modify: `src/server/archive-api-router.mjs`
- Modify: `src/server/http-app.mjs`
- Modify: `src/start.mjs`
- Create: `tests/archive-pdf-http.test.mjs`
- Modify: `tests/archive-http.test.mjs`

**Interfaces:**
- Consumes: Task 1 `archivePdfFilename`; Task 2 `createTripArchivePdf`; Task 3 `createTravelArchivePdf`; runtime-current `archives` service.
- Produces:
  - `createArchivePdfService({archives,tripRenderer=createTripArchivePdf,travelRenderer=createTravelArchivePdf}) -> {getTripPdf(id),getTravelPdf()}`
  - async `routeArchiveApi({archives,archivePdf},method,path) -> {status,data?}|{status,download:{filename,body}}`
  - endpoints `GET /api/archive.pdf` and `GET /api/archive/trips/:id.pdf`

- [ ] **Step 1: Write failing service and HTTP tests**

Add tests named:

- `PDF service snapshots current total and trip archives and returns safe names`
- `HTTP downloads total and trip PDFs with exact MIME length no-store nosniff and RFC 5987 names`
- `HTTP rejects missing unfinished empty fontless failed and oversized PDFs before attachment headers`
- `download filename cannot inject a response header through Unicode controls or reserved characters`
- `runtime restore context supplies the next PDF request instead of startup archive data`
- `PDF GET routes retain host traversal and method guards`

Assert successful bodies start `%PDF-` and match `Content-Length`. For each failure assert JSON content type, one safe code/message, no `Content-Disposition`, and no PDF bytes. Inject two `runtime.current()` contexts for the restore-context test.

- [ ] **Step 2: Run the focused test and prove RED**

Run: `node --test tests/archive-pdf-http.test.mjs tests/archive-http.test.mjs`

Expected: FAIL because the PDF service and routes do not exist.

- [ ] **Step 3: Implement the runtime-scoped service**

Create `archivePdf` beside `archives` inside every `createDataRuntime` active context so restore replaces both together. `getTravelPdf` and `getTripPdf` obtain exactly one archive snapshot, await the correct renderer, and return `{filename,body}` without writing storage.

- [ ] **Step 4: Implement attachment routing and safe headers**

Make `routeArchiveApi` async while preserving existing JSON routes. In `http-app`, await it; for downloads validate the Buffer again, then write `application/pdf`, exact length, `no-store`, and `Content-Disposition: attachment; filename="travel-archive.pdf"; filename*=UTF-8''...` (single-trip fallback `trip-archive.pdf`). Add `PDF_FONT_UNAVAILABLE`, `PDF_GENERATION_FAILED`, `PDF_TOO_LARGE`, and `ARCHIVE_EMPTY` to the controlled status/message map. Never send PDF headers until generation and validation finish.

- [ ] **Step 5: Run GREEN and full regression**

Run:

```powershell
node --test tests/archive-pdf-http.test.mjs tests/archive-http.test.mjs
npm test
git diff --check
```

Expected: all tests pass; no new skip; diff check exits 0.

- [ ] **Step 6: Commit**

```powershell
git add src/services/archive-pdf-service.mjs src/services/data-runtime.mjs src/server/archive-api-router.mjs src/server/http-app.mjs src/start.mjs tests/archive-pdf-http.test.mjs tests/archive-http.test.mjs
git commit -m "feat: serve current archives as PDF downloads"
```

### Task 5: Replace Print Preview with Verified Direct Downloads

**Files:**
- Create: `src/web/pdf-download-runtime.mjs`
- Modify: `src/server/static-files.mjs`
- Modify: `src/web/index.html`
- Modify: `src/web/app.mjs`
- Modify: `src/web/router.mjs`
- Modify: `src/web/views.mjs`
- Modify: `src/web/archive-controller.mjs`
- Modify: `src/web/archive-views.mjs`
- Modify: `src/web/archive-styles.css`
- Modify: `tests/web-archive.test.mjs`
- Modify: `tests/web-navigation.test.mjs`
- Modify: `tests/project.test.mjs`

**Interfaces:**
- Consumes: Task 4 attachment URLs and existing `archive-home` JSON state.
- Produces:
  - `createPdfDownloadRuntime({document,fetchImpl=fetch,urlApi=URL,queueMicrotaskImpl=queueMicrotask}) -> {dispose()}`
  - DOM contract: `[data-pdf-download]`, `[data-pdf-download-scope]`, `[data-pdf-download-status]`, `[data-pdf-download-error]`

- [ ] **Step 1: Write failing browser-runtime and route tests**

Add tests named:

- `archive and completed-trip views expose same-origin PDF download actions without print targets`
- `PDF download validates status content type magic and RFC 5987 filename before clicking a Blob URL`
- `PDF download prevents duplicate pending requests revokes its URL and restores ready state`
- `PDF download keeps a controlled inline error and supports an explicit retry`
- `old report print hashes resolve to archive home and no print route round trips`
- `served browser code contains no window.print print button or report DOM`

The runtime test must use a real `Blob` and fake response headers, assert one request for a double click, one hidden anchor click, one `revokeObjectURL`, and no download on JSON/invalid-magic responses.

- [ ] **Step 2: Run the focused test and prove RED**

Run: `node --test tests/web-archive.test.mjs tests/web-navigation.test.mjs tests/project.test.mjs`

Expected: FAIL on old preview links/routes and missing download runtime.

- [ ] **Step 3: Implement the delegated download runtime**

Listen once on `document` for same-origin anchors carrying `data-pdf-download`. Prevent duplicate pending work, set visible busy state, fetch with `cache:'no-store'`, require success, `application/pdf`, non-empty Blob, and `%PDF-` prefix, decode only the fixed `filename*` response value, create/click/remove a temporary anchor, then revoke the object URL in the injected microtask. Sanitize every displayed error and leave a retryable action.

- [ ] **Step 4: Replace every print surface**

Change archive landing and completed-trip detail to PDF download anchors and add status/error regions. Simplify the archive controller to `archive-home` only. Remove print report rendering, `archive-print-mode`, report CSS, `window.print()`, and report route generation. Parse both legacy print hashes to `{type:'archive-home'}`. Register and instantiate `pdf-download-runtime.mjs` exactly once and dispose it on unload.

- [ ] **Step 5: Run GREEN and full regression**

Run:

```powershell
node --test tests/web-archive.test.mjs tests/web-navigation.test.mjs tests/project.test.mjs
npm test
git diff --check
```

Expected: all tests pass; grep of served browser code finds no `window.print` or “打印/保存为 PDF”.

- [ ] **Step 6: Commit**

```powershell
git add src/web/pdf-download-runtime.mjs src/server/static-files.mjs src/web/index.html src/web/app.mjs src/web/router.mjs src/web/views.mjs src/web/archive-controller.mjs src/web/archive-views.mjs src/web/archive-styles.css tests/web-archive.test.mjs tests/web-navigation.test.mjs tests/project.test.mjs
git commit -m "feat: download archive PDFs without print preview"
```

### Task 6: Render, Inspect, Document, and Regress the Direct PDF Flow

**Files:**
- Modify: `README.md`
- Modify: `docs/web-archive-acceptance.md`
- Modify: `docs/web-ui-acceptance.md`
- Create: `docs/direct-pdf-acceptance.md`

**Interfaces:**
- Consumes: complete Task 1-5 direct download flow and the existing fixed simulated QA launcher.
- Produces: current-run PDF structure, visual, browser-download, and no-production-data evidence.

- [ ] **Step 1: Update operating documentation before final QA**

Document `npm install`, direct-download behavior, current-data generation, no history, two filenames, font requirement, controlled failure, and removal of system printing. Mark the older print acceptance record as superseded and link `docs/direct-pdf-acceptance.md` from README and the UI acceptance record.

- [ ] **Step 2: Create isolated long-content QA data and start the simulated server**

Use a fresh non-production database under `runtime/qa-direct-pdf.sqlite` on fixed port 3221. Seed at least two completed trips in different years, 80 expenses, one long CJK note, one long URL source, guide current/snapshot/original versions, repeated-city footprints, and one detached footprint. Start:

```powershell
node scripts/start-ai-qa.mjs --port 3221 --db runtime/qa-direct-pdf.sqlite
```

Expected: banner states simulated/no external transport and URL is `http://127.0.0.1:3221`.

- [ ] **Step 3: Download both PDFs without a browser print dialog**

Save only QA evidence under `tmp/pdfs/`:

```powershell
Invoke-WebRequest 'http://127.0.0.1:3221/api/archive.pdf' -OutFile 'tmp/pdfs/direct-total.pdf'
Invoke-WebRequest 'http://127.0.0.1:3221/api/archive/trips/<completed-id>.pdf' -OutFile 'tmp/pdfs/direct-trip.pdf'
```

Then use the Codex in-app browser to click both user-facing actions with its download event, confirm `.pdf` filenames and successful downloads, and verify no `chrome://print` surface appears.

- [ ] **Step 4: Verify PDF structure and text**

Run with bundled Poppler:

```powershell
pdfinfo 'tmp/pdfs/direct-total.pdf'
pdfinfo 'tmp/pdfs/direct-trip.pdf'
pdftotext -layout 'tmp/pdfs/direct-total.pdf' 'tmp/pdfs/direct-total.txt'
pdftotext -layout 'tmp/pdfs/direct-trip.pdf' 'tmp/pdfs/direct-trip.txt'
rg '我的旅行足迹|卷首总览|年度目录|花销统计与明细|卷末' tmp/pdfs/direct-total.txt
rg '行程概览|攻略与每日安排|花销统计与明细|足迹与备注' tmp/pdfs/direct-trip.txt
```

Expected: both are A4 PDFs with at least one page; Chinese headings and long-note tail are extractable; total and trip sections are complete.

- [ ] **Step 5: Render every page and visually inspect**

Run:

```powershell
pdftoppm -png -r 144 'tmp/pdfs/direct-total.pdf' 'tmp/pdfs/total-page'
pdftoppm -png -r 144 'tmp/pdfs/direct-trip.pdf' 'tmp/pdfs/trip-page'
```

Open every PNG with `view_image`. Require zero black squares, clipped text, overlaps, orphaned headings, missing repeated expense headers, or footer collisions. Fix any defect under TDD, regenerate, and repeat the complete render.

- [ ] **Step 6: Record acceptance evidence**

Write exact URL/port, QA database path, commands, dependency/font versions, file names, sizes, page counts, screenshot names, extracted-heading checks, browser download results, and the explicit limits: no physical printing, no real AI call, no external PDF service, and no production database access.

- [ ] **Step 7: Final verification**

Run:

```powershell
npm test
git diff --check
git status --short
```

Expected: 0 failures; only the pre-existing Windows file-symlink permission skip is allowed; status contains only Task 6 documentation before commit.

- [ ] **Step 8: Remove temporary QA PDF/text/PNG files and stop the QA server**

Verify every target resolves under the worktree `tmp/pdfs` directory, then remove only that directory. Stop the port-3221 simulated server. Keep the isolated QA SQLite file ignored for reproducibility; never remove or modify `runtime/travel.sqlite`.

- [ ] **Step 9: Commit**

```powershell
git add README.md docs/web-archive-acceptance.md docs/web-ui-acceptance.md docs/direct-pdf-acceptance.md
git commit -m "docs: verify direct PDF archive downloads"
```

## Plan Self-Review

- **Spec coverage:** Tasks 1-3 cover the chosen server renderer, font/size constraints, single and total fixed layouts; Task 4 covers current runtime data, safe attachment headers, and failures; Task 5 removes every print surface and adds verified downloads; Task 6 covers structure, text, visual rendering, browser behavior, documentation, and cleanup. No spec requirement is unassigned.
- **Step scan:** Each task has one RED gate, bounded implementation steps, focused GREEN, full regression where integration risk begins, and an independent commit. The only complete command block beyond verification is the required PDF marker and QA tooling.
- **Type consistency:** Task 2 exports `renderTripArchivePdf` and `createTripArchivePdf`; Task 3 consumes the former and exports `createTravelArchivePdf`; Task 4 injects both exact creators into `createArchivePdfService`; Task 5 consumes only the Task 4 URLs.
- **Review Focus:** All five named failures have explicit tests in their owning tasks and the long-content case also has a real rendered artifact gate.
- **Proportion:** The plan fixes signatures, observable behavior, test names, and commands without transcribing renderer bodies; layout decisions remain with the implementer inside the approved design.
