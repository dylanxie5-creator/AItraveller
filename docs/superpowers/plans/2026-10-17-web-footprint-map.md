# 中国足迹地图实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为智游足迹本地网页版增加可自动同步、可手动补录、可独立管理的中国城市足迹，并使用高德地图合规呈现省级点亮和城市标记。

**Architecture:** 足迹记录、抑制和统计全部保存在本地 SQLite v4；行程生命周期在同一事务中同步或脱离足迹。网页始终提供完整省市列表，高德 JS API 2.0 只是可失败的显示适配器；JS Key 按需给浏览器，安全密钥通过固定本机代理使用。

**Tech Stack:** Node.js 25.9+、`node:http`、`node:sqlite`、原生 HTML/CSS/JavaScript、Windows DPAPI、高德地图 JS API 2.0、Node test runner。

**Spec:** `docs/superpowers/specs/2026-10-17-web-footprint-map-design.md`

## Global Constraints

- 只监听 `127.0.0.1`；小程序与网页数据独立，不增加登录、云同步、分享、定位或国外地图。
- 自动足迹仅在 `departureDate < 服务端今天` 时存在；今天离开和未来离开均不点亮。
- 删除行程前先在同一事务中将符合条件的自动足迹转为独立历史记录；撤销过的城市不复活。
- 手动记录保留年、月、日的原始精度；备注最多 200 个 Unicode 字符。
- “整个行程”花销不分摊；只有仍关联行程且明确归属城市的花销进入城市统计。
- 地图无 Key、断网或 SDK 失败时，统计、列表、详情和管理功能仍须完整可用。
- 地图只接入代码内固定的高德官方端点，不接受任意脚本/瓦片/代理上游，也不打包第三方边界数据。
- Key 与安全密钥使用 Windows CurrentUser DPAPI 分别加密；安全密钥不得返回浏览器或写入日志。
- 每个任务使用 TDD：先看到目标测试失败，再写最小实现，通过后提交；不顺手重构无关模块。

## Review Focus

- 从未打开足迹页就删除已结束行程：删除事务仍应先生成并脱离历史足迹，不丢城市记录（Task 4 的 `delete materializes and detaches eligible visits`）。
- 撤销响应丢失、随后编辑或删除行程：重试不得复活记录、重复抑制或留下孤立状态（Task 4/5 的幂等与事务测试）。
- 年/月精度位于当前周期、完整日期为今天或未来：允许已经开始的年/月，拒绝今天及未来的完整日期和未来周期（Task 1 的日期边界测试）。
- 地图设置更新竞态、损坏密文和代理错误：不得混用不同版本凭据，也不得在响应/日志泄漏任一秘密（Task 6 的设置与代理测试）。
- 高德脚本延迟或失败后切换路由：旧回调不得覆盖新页面，列表仍可操作，地图实例必须销毁（Task 8/9 的生命周期测试）。

---

### Task 1: 足迹领域规则、统计与表单模型

**Files:**
- Create: `src/footprints/validation.mjs`
- Create: `src/footprints/presentation.mjs`
- Create: `src/shared/footprint-form-model.mjs`
- Create: `tests/footprint-domain.test.mjs`
- Create: `tests/footprint-form.test.mjs`

**Interfaces:**
- Produces: `normalizeManualVisitInput(input,{resolveCity,today}) -> {cityCode,cityName,provinceCode,provinceName,datePrecision,dateStart,dateEnd:null,note}`.
- Produces: `validateStoredVisit(value)`, `formatVisitDate(visit)`, `compareVisits(a,b)`.
- Produces: `summarizeFootprints(visits) -> {provinceCount,cityCount,visitCount}` and `presentFootprintGroups({visits,expenses})`.
- Produces: `createFootprintForm({visit,today})` with `setField()`, `snapshot()`, `validate()`, `toInput()`.

- [ ] **Step 1: Write the failing domain tests**

Cover canonical city snapshots; trip/manual/detached stored shapes; 200-code-point notes; year/month/day precision; current year/month accepted when already started; future year/month and full date `>= today` rejected; stable reverse chronology; repeated city/province counts; city expenses keyed by linked trip and city, excluding `cityCode:null`.

- [ ] **Step 2: Run domain tests and verify missing-module failure**

Run: `node --test tests/footprint-domain.test.mjs`

Expected: FAIL because `src/footprints/validation.mjs` does not exist.

- [ ] **Step 3: Implement the pure domain modules**

Use exact enums `trip_range | year | month | day` and `trip | manual | detached`; compare canonical strings without inventing missing month/day values. `presentFootprintGroups` returns province rows, city rows, visit rows and per-trip city expense subtotals without mutating inputs.

- [ ] **Step 4: Write and fail the form-model tests**

Assert raw input survives invalid submission, changing precision clears incompatible fields, first error is stable, edit initializes exact stored precision, and `toInput()` emits no city/province display names.

Run: `node --test tests/footprint-form.test.mjs`

Expected: FAIL because the model is absent.

- [ ] **Step 5: Implement the form model and run both suites**

Run: `node --test tests/footprint-domain.test.mjs tests/footprint-form.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/footprints src/shared/footprint-form-model.mjs tests/footprint-domain.test.mjs tests/footprint-form.test.mjs
git commit -m "feat: define footprint domain rules"
```

### Task 2: SQLite v4 架构与安全迁移

**Files:**
- Create: `src/storage/footprint-schema.mjs`
- Create: `tests/footprint-migration.test.mjs`
- Modify: `src/storage/database.mjs`
- Modify: `tests/ai-migration.test.mjs`
- Modify: `tests/expense-migration.test.mjs`

**Interfaces:**
- Produces: `footprintTables`, `footprintIndexes`, `applyFootprintSchema(db)`.
- Updates: `validateDatabase(db)` accepts exactly v1-v4 structures; `openDatabase()` requires v4; `prepareDatabase()` upgrades v1/v2/v3 to v4 after one verified original backup.

- [ ] **Step 1: Write the failing v4 migration tests**

Assert fresh v4 contains `footprint_visits`, `footprint_suppressions`, `footprint_operation_receipts`, `map_settings` and exact indexes; v3 upgrades after a verified `pre-migration-v3-*.sqlite`; v1/v2 pass through prior schemas with one original backup; failed v4 DDL rolls back; backup failure leaves source bytes unchanged; foreign keys enforce suppression cascade and visit delete restriction until detachment.

- [ ] **Step 2: Update prior version-ceiling tests and see the expected failures**

Change the old “v4 unsupported” fixture in `tests/ai-migration.test.mjs` to v5, and change fresh/current expectations in expense migration tests from v3 to v4.

Run: `node --test tests/footprint-migration.test.mjs tests/ai-migration.test.mjs tests/expense-migration.test.mjs`

Expected: FAIL on missing v4 schema/current version.

- [ ] **Step 3: Implement exact v4 tables and indexes**

`footprint_visits.linked_trip_id` references trips without cascade; use a partial unique index on non-null `(linked_trip_id,city_code)`. Suppressions reference trips with cascade. Operation receipts have no trip FK so detached/manual command history is stable. `map_settings` is a single-row revision/payload table.

- [ ] **Step 4: Extend migration sequencing and validation**

Apply only missing schemas in order: v1→AI→v2, v2→expenses→v3, v3→footprints→v4. Run target validation, `quick_check`, and foreign-key check before commit.

- [ ] **Step 5: Run migration suites**

Run: `node --test tests/footprint-migration.test.mjs tests/ai-migration.test.mjs tests/expense-migration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/footprint-schema.mjs src/storage/database.mjs tests/footprint-migration.test.mjs tests/ai-migration.test.mjs tests/expense-migration.test.mjs
git commit -m "feat: migrate local data to footprint schema"
```

### Task 3: 足迹、抑制与幂等回执存储

**Files:**
- Create: `src/storage/footprint-store.mjs`
- Create: `src/storage/footprint-operation-store.mjs`
- Create: `tests/footprint-storage.test.mjs`
- Modify: `tests/helpers/database.mjs`

**Interfaces:**
- Produces: `createFootprintStore(database)` with `get(id)`, `list()`, `listByTrip(tripId)`, `put(id,content,{expectedRevision,now})`, `remove(id,expectedRevision)`, `detachTrip(tripId,{now})`, `getSuppression(tripId,cityCode)`, `listSuppressions()`, `putSuppression()`, `removeSuppression()`.
- Produces: `createFootprintOperationStore(database)` with `find(operationId)` and `insert({operationId,action,scopeKey,requestHash,response})`.
- Updates test helper to expose `footprints` only after the production service exists; this task may expose stores directly for tests.

- [ ] **Step 1: Write failing storage tests**

Assert defensive reads, partial-date round trips, linked identity uniqueness, cross-entity ID conflicts, optimistic revisions, stable order, suppression uniqueness/cascade, detachment snapshots, corruption rejection, and replayed operation responses returning defensive copies.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/footprint-storage.test.mjs`

Expected: FAIL on missing stores.

- [ ] **Step 3: Implement stores with application and database validation**

Every write is transaction-safe; translate unexpected constraint errors to controlled conflict/corruption errors. Do not silently repair malformed rows.

- [ ] **Step 4: Run storage and existing storage suites**

Run: `node --test tests/footprint-storage.test.mjs tests/storage.test.mjs tests/expense-storage.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/footprint-store.mjs src/storage/footprint-operation-store.mjs tests/footprint-storage.test.mjs tests/helpers/database.mjs
git commit -m "feat: persist footprint visits and suppressions"
```

### Task 4: 自动同步与行程生命周期事务

**Files:**
- Create: `src/services/footprint-lifecycle.mjs`
- Create: `tests/footprint-lifecycle.test.mjs`
- Modify: `src/services/travel-service.mjs`
- Modify: `tests/travel-service.test.mjs`

**Interfaces:**
- Produces: `createFootprintLifecycle({database,today,now})` with `syncTrip(tripId)`, `syncAll()`, `detachTrip(tripId)`.
- Updates: `createTravelService({... ,footprintLifecycle})`; default construction creates the real lifecycle, while tests can inject a failure spy.
- `syncTrip` uses `auto-` plus the first 32 hexadecimal characters of SHA-256 over ``${tripId}\n${cityCode}`` as the deterministic visit ID, preserves an existing note, and obeys suppressions.

- [ ] **Step 1: Write failing lifecycle tests**

Cover yesterday/today/tomorrow departure boundaries, repeat sync, trip rename/date changes, city removal, future rollback, suppression, restored eligibility, and separate trips visiting one city.

- [ ] **Step 2: Add Review Focus deletion and rollback tests**

`delete materializes and detaches eligible visits` must delete an eligible trip that has never opened the footprint page and leave detached visits. Inject failures in sync/detach/trip removal and assert trip, visits, expenses, conversions and drafts all roll back together.

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/footprint-lifecycle.test.mjs tests/travel-service.test.mjs`

Expected: FAIL before lifecycle integration.

- [ ] **Step 4: Implement lifecycle and integrate save/delete**

Call `syncTrip(id)` after `trips.put()` inside save transaction. On delete call `syncTrip(id)`, then `detachTrip(id)`, then existing trip removal/cleanup, all inside the outer transaction.

- [ ] **Step 5: Run focused suites**

Run: `node --test tests/footprint-lifecycle.test.mjs tests/travel-service.test.mjs tests/expense-service.test.mjs tests/ai-conversion.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/footprint-lifecycle.mjs src/services/travel-service.mjs tests/footprint-lifecycle.test.mjs tests/travel-service.test.mjs
git commit -m "feat: sync footprints with trip lifecycle"
```

### Task 5: 足迹业务服务与本机 API

**Files:**
- Create: `src/services/footprint-service.mjs`
- Create: `src/server/footprint-api-router.mjs`
- Create: `tests/footprint-service.test.mjs`
- Create: `tests/footprint-http.test.mjs`
- Modify: `src/server/http-app.mjs`
- Modify: `src/services/travel-service.mjs`
- Modify: `src/start.mjs`

**Interfaces:**
- Produces: `createFootprintService({database,today,now})` with `syncAll()`, `getSummary()`, `getOverview()`, `getProvince(code)`, `getCity(code)`, `getManagement()`, `getVisit(id)`, `saveVisit(id,command)`, `deleteVisit(id,command)`, `suppress(tripId,cityCode,command)`, `restore(tripId,cityCode,command)`.
- Produces API routes exactly as the spec plus `GET /api/footprints/provinces/:provinceCode`, `GET /api/footprints/manage`, and `GET /api/footprints/visits/:visitId`.
- Updates `GET /api/overview` to include `{footprints:{provinceCount,cityCount,visitCount}}`.

- [ ] **Step 1: Write failing service tests**

Assert manual create/edit/delete, detached edit, auto-note-only edit, auto ordinary delete refusal, explicit suppress/restore, all operation replays, changed-payload conflicts, province/city/management projections, multi-trip city expense totals, and whole-trip expense exclusion.

- [ ] **Step 2: Write failing HTTP tests**

Assert paths/methods, `POST /api/footprints/sync`, status mapping, ID encoding, same-origin/content-type/body-size guards, and no note/amount/database text in errors or receipts.

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/footprint-service.test.mjs tests/footprint-http.test.mjs`

Expected: FAIL on absent service/router.

- [ ] **Step 4: Implement service, router and startup sync**

Construct the footprint service before listening, call `syncAll()` before the server accepts requests, inject it into `createHttpApp`, and keep every command transaction/idempotency boundary in the service.

- [ ] **Step 5: Run focused server suites**

Run: `node --test tests/footprint-service.test.mjs tests/footprint-http.test.mjs tests/http.test.mjs tests/project.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/footprint-service.mjs src/server/footprint-api-router.mjs src/server/http-app.mjs src/services/travel-service.mjs src/start.mjs tests/footprint-service.test.mjs tests/footprint-http.test.mjs
git commit -m "feat: expose local footprint APIs"
```

### Task 6: 高德凭据设置与受限安全代理

**Files:**
- Create: `src/storage/map-settings-store.mjs`
- Create: `src/server/map-api-router.mjs`
- Create: `src/server/amap-proxy.mjs`
- Create: `tests/map-settings.test.mjs`
- Create: `tests/amap-proxy.test.mjs`
- Modify: `src/server/http-app.mjs`
- Modify: `src/start.mjs`

**Interfaces:**
- Produces: `createMapSettingsStore(database,{protector})` with `getPublic()`, `update(command)`, `resolveSession()`, `resolveSecurityCode(expectedRevision)`.
- `update(command)` accepts `{expectedRevision,key:{action,value},security:{action,value}}`, where actions are `retain | replace | delete`.
- `resolveSession()` returns `{provider:'amap',revision,key,serviceHost:'/_AMapService/<revision>'}` only when both credentials decrypt at one unchanged revision.
- Produces: `createAmapProxy({settingsStore,lookup,requestImpl,timeoutMs,maxBytes})` handling only `GET /_AMapService/:revision/v3/config/district` to fixed `restapi.amap.com`.

- [ ] **Step 1: Write failing map-settings tests**

Cover first-time paired replacement, independent configured flags, retain/delete, stale revision, mutation during async protect/unprotect, damaged cipher recovery, real DPAPI restart, no plaintext/ciphertext in public reads, and no console leakage.

- [ ] **Step 2: Write failing proxy tests**

Assert fixed TLS host/SNI, allowed path only, query cap and rejection of supplied `jscode`, server-appended security code, one request/no redirect/no retry, timeout/abort/1 MiB response cap, settings-revision mismatch, JSON content type, and sanitized errors/logs.

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/map-settings.test.mjs tests/amap-proxy.test.mjs`

Expected: FAIL on missing modules.

- [ ] **Step 4: Implement encrypted settings, API and proxy**

Expose `GET/PUT /api/map-settings` and `GET /api/map-session`; the latter may return JS Key but never the security key. Route `/_AMapService/*` before static handling and return the upstream JSON body without the normal `{data}` envelope expected by高德 SDK.

- [ ] **Step 5: Run security-focused suites**

Run: `node --test tests/map-settings.test.mjs tests/amap-proxy.test.mjs tests/dpapi.test.mjs tests/ai-settings.test.mjs tests/ai-transport.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/map-settings-store.mjs src/server/map-api-router.mjs src/server/amap-proxy.mjs src/server/http-app.mjs src/start.mjs tests/map-settings.test.mjs tests/amap-proxy.test.mjs
git commit -m "feat: secure amap credentials and proxy"
```

### Task 7: 足迹列表、详情、补录与管理界面

**Files:**
- Create: `src/web/footprint-controller.mjs`
- Create: `src/web/footprint-views.mjs`
- Create: `tests/web-footprint.test.mjs`
- Modify: `src/web/router.mjs`
- Modify: `src/web/api-client.mjs`

**Interfaces:**
- Adds routes: `footprints`, `footprint-province`, `footprint-city`, `footprint-new`, `footprint-edit`, `footprint-manage`, `footprint-settings`.
- Produces: `createFootprintController({api,render,navigate,confirm,today,createId,mapAdapter})` with `load(route)`, `setField()`, `save()`, `deleteVisit()`, `suppress()`, `restore()`, `saveSettings()`, `dispose()`, `snapshot()`.
- API client adds one method per Task 5/6 endpoint and sends unchanged command envelopes.

- [ ] **Step 1: Write failing route/API-client tests**

Assert every hash round trip, malformed identities fall back safely, encoded IDs cannot change path ownership, and all client methods use exact method/path/body.

- [ ] **Step 2: Write failing controller/view tests**

Cover sync-before-overview, searchable province/city list, city visits and expense labels, manual form precision, retained input and operation ID after failure, edit/delete, explicit revoke/restore confirmations, map/settings errors remaining local, hostile names/notes rendered as text, and disposed/late requests ignored.

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/web-footprint.test.mjs tests/web-navigation.test.mjs`

Expected: FAIL before routes/controller exist.

- [ ] **Step 4: Implement non-map UI flow**

The overview must be fully usable without `mapAdapter`; render stats, province groups, city search, management, city details, partial-date form and fixed AMap settings. Auto records expose note/revoke only; manual/detached expose edit/delete.

- [ ] **Step 5: Run web suites**

Run: `node --test tests/web-footprint.test.mjs tests/web-navigation.test.mjs tests/web-expense.test.mjs tests/web-form.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/footprint-controller.mjs src/web/footprint-views.mjs src/web/router.mjs src/web/api-client.mjs tests/web-footprint.test.mjs tests/web-navigation.test.mjs
git commit -m "feat: add footprint management interface"
```

### Task 8: 高德地图适配器与可失败的图形层

**Files:**
- Create: `src/web/amap-adapter.mjs`
- Create: `tests/web-amap.test.mjs`
- Modify: `src/web/footprint-controller.mjs`
- Modify: `src/web/footprint-views.mjs`

**Interfaces:**
- Produces: `createAmapAdapter({window,document,scriptUrl,timeoutMs})` with `mount(container,{session,provinces,onProvince,onCity})` and `destroy()`.
- `provinces` contains only public `{provinceCode,provinceName,cities:[{cityCode,cityName}]}`; no visit dates, notes, trip IDs or amounts enter the adapter.
- Adapter loads `https://webapi.amap.com/loader.js` once, sets `serviceHost` before load, requests JS API `2.0` plus `AMap.DistrictSearch`, queries visited province `adcode`, draws clickable polygons, and uses returned child centers or a direct city-code query for unmatched municipalities/cities.

- [ ] **Step 1: Write failing adapter contract tests with a fake AMap runtime**

Assert one loader, exact version/plugin, visited codes only, warm fill/unvisited base map, polygon→province and marker→city callbacks, municipality fallback, partial provider failure, timeout, repeated mount, and `destroy()` removing map/listeners.

- [ ] **Step 2: Add privacy and stale-callback tests**

Walk every value passed to the fake SDK and assert it contains no trip name, dates, note, visit count or amount. Resolve an old district search after route disposal and assert no render/navigation.

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/web-amap.test.mjs tests/web-footprint.test.mjs`

Expected: FAIL on missing adapter.

- [ ] **Step 4: Implement adapter and map error state**

Do not write or cache boundary data locally. A failed province query reports that province in a bounded map warning while other overlays remain; total loader failure leaves the list untouched and exposes a retry/settings action.

- [ ] **Step 5: Run adapter/web suites**

Run: `node --test tests/web-amap.test.mjs tests/web-footprint.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/amap-adapter.mjs src/web/footprint-controller.mjs src/web/footprint-views.mjs tests/web-amap.test.mjs tests/web-footprint.test.mjs
git commit -m "feat: render footprints with amap"
```

### Task 9: 应用接线、首页摘要、样式和静态安全策略

**Files:**
- Create: `src/web/footprint-styles.css`
- Modify: `src/web/app.mjs`
- Modify: `src/web/views.mjs`
- Modify: `src/web/index.html`
- Modify: `src/web/styles.css`
- Modify: `src/server/static-files.mjs`
- Modify: `src/server/http-app.mjs`
- Modify: `tests/project.test.mjs`
- Modify: `tests/web-navigation.test.mjs`

**Interfaces:**
- App owns one footprint controller/map adapter per footprint route and disposes both before navigation.
- Home overview renders real province/city/visit counts and links to `#/footprints`.
- CSP keeps `default-src 'self'`; adds only the fixed AMap loader and SDK-owned HTTPS domain patterns required by the official runtime, while `/_AMapService` remains same-origin. No arbitrary host comes from settings.

- [ ] **Step 1: Write failing integration/static tests**

Assert sidebar active state, homepage real counts/empty state, footprint controller disposal, before-unload only for pending writes, new modules/styles are served, private files remain blocked, and CSP contains the fixed AMap allowlist but not user values or secrets.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/project.test.mjs tests/web-navigation.test.mjs tests/web-footprint.test.mjs`

Expected: FAIL before app/static integration.

- [ ] **Step 3: Wire app, navigation and static allowlists**

Add “足迹地图” and “地图设置” destinations, instantiate `createAmapAdapter` only for the footprint controller, and ensure list rendering precedes optional map mounting.

- [ ] **Step 4: Add focused responsive styles**

Use `footprint-styles.css` for map/list split layout, province/city cards, visit timeline, management rows, local map error, settings warning and 390px single-column mode. Preserve keyboard focus, text equivalents and minimum touch size.

- [ ] **Step 5: Run all automated tests**

Run: `npm test`

Expected: all tests pass except the existing documented Windows symlink-permission skip.

- [ ] **Step 6: Commit**

```bash
git add src/web/app.mjs src/web/views.mjs src/web/index.html src/web/styles.css src/web/footprint-styles.css src/server/static-files.mjs src/server/http-app.mjs tests/project.test.mjs tests/web-navigation.test.mjs tests/web-footprint.test.mjs
git commit -m "feat: integrate footprint map experience"
```

### Task 10: 真实浏览器验收、合规记录与交付文档

**Files:**
- Create: `docs/web-footprint-acceptance.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-17-web-footprint-map-design.md` only if real AMap evidence changes a documented assumption

**Interfaces:**
- Acceptance uses a separate QA database and a fixed QA date/data factory; production database and AI providers are untouched.
- Real map checks require the user's AMap Web 端 JS API Key and安全密钥. If unavailable, record map status as pending and do not claim graphical acceptance.

- [ ] **Step 1: Run the full clean verification**

Run: `npm test` and `git diff --check`

Expected: zero failures; only the previously documented Windows symlink-permission skip is allowed.

- [ ] **Step 2: Browser-accept the data/list workflow without a map Key**

Verify empty state; ended/today/future trips; repeat city; manual year/month/day; edit/delete trip; detached preservation; revoke/restore; city vs whole-trip expenses; refresh/restart persistence; no-Key local error; wide and 390px layouts; no Console application errors.

- [ ] **Step 3: Obtain the user's test AMap credentials and accept the real map**

Configure through the UI, never source files or shell history. Verify national extent, all visited province overlays, polygon/marker clicks, municipalities,港澳台及附属岛屿 display, visible AMap attribution/current审图信息, allowed-domain behavior, invalid-Key degradation, and no security key in browser responses/Console.

- [ ] **Step 4: Record exact evidence and update README**

Document test totals, QA database isolation, browser sizes, screenshots/observations, map provider/date, attribution/审图 display, credential handling, failures and release gate. README explains setup, AMap Key requirements, list fallback, local-only boundary and backup behavior.

- [ ] **Step 5: Request final code review and fix only verified findings**

Use `superpowers:requesting-code-review`, rerun affected focused tests after each fix, then rerun `npm test` and `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/web-footprint-acceptance.md docs/superpowers/specs/2026-10-17-web-footprint-map-design.md
git commit -m "docs: verify web footprint map"
```

Completion requires both the data/list workflow and real AMap map gate. If credentials or compliance evidence are unavailable, stop with an explicit pending item instead of merging or claiming completion.
