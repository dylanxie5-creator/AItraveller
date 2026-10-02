# 网页版第一部分：基础与行程管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建仅本机运行的个人旅行网站，完成首页、多城市行程管理与可靠的草稿恢复。

**Architecture:** 浏览器前端调用同源 Node.js HTTP API；独立 SQLite 存储通过事务管理行程与草稿。共享纯函数用于表单规则，服务端独立执行权威校验；UI 不依赖小程序或微信运行时。

**Tech Stack:** 原生 HTML/CSS/JavaScript ES modules；已验证 Node.js v25.9.0、`node:http`、`node:sqlite`、`node:test`。首阶段无产品运行时第三方依赖。

**Spec:** `docs/superpowers/specs/2026-10-02-web-foundation-design.md`

## Global Constraints

- 仅个人、本地版本；服务仅监听 `127.0.0.1`，不购买域名、不公开部署、不设置登录。
- 独立项目及数据库；小程序仓库只可作为业务规则/城市目录参考，不读写其数据，不修改其保留分支。
- 本部分不实现 AI、花销、地图、分享、跨设备访问；不要求或保存任何 API Key。
- UI 由开发者自由发挥，暖色初稿、电脑和约 390px 窄屏可用；不制造未实现功能的统计或可点击假入口。
- 日期 `YYYY-MM-DD`，状态使用本机服务当天日期；结束日当天仍进行中。
- 金额输入为人民币字符串，持久化为安全整数分；可空预算、非空必须大于 0 且最多两位小数。
- 城市目录 344 项，搜索最多 20 项；行程至少一城，不重复、不逆序、不越界、不重叠，仅允许相邻正向同日交接。
- SQLite 损坏/非空但无版本/未知版本不自动覆盖；正式保存和草稿清理必须同一事务。
- JSON 请求体最多 64 KiB；静态资源白名单、不暴露数据目录；写操作验证 Host、Origin、JSON 类型。
- 每任务按 RED→GREEN 验证并提交；只实施本计划，结束后停下等待用户验收和下一部分指示。

## Review Focus

1. 保存已经成功但响应丢失：相同操作重试不新增、不覆盖之后的修改；覆盖 Task 2/4 的回执测试。
2. 保存/舍弃后旧的自动保存请求才抵达：关闭的草稿会话不能复活；覆盖 Task 2/5 的会话和乱序测试。
3. 两标签页编辑/删除同一行程：旧 revision 返回冲突，保留另一个标签页的更新；覆盖 Task 2/4/5。
4. 恶意本地网页或编码路径访问：不能跨源写旅行数据或下载数据库；覆盖 Task 3 的 HTTP 防护测试。
5. 旧行程城市目录变化、预算安全整数边界和非重叠逆序路线：历史可读、未知新编码拒绝、金额精确、逆序拒绝；覆盖 Task 1/2。

## 文件与接口布局

- `src/shared/{date,money,trip-validation,trip-form-model}.mjs`：浏览器和 Node 都可执行的纯规则；仅这些无秘密文件允许经 `/shared/` 提供。
- `src/domain/{city-catalog,trip-presenter}.mjs`、`src/data/china-cities.json`：网站独立城市目录与服务端展示数据。
- `src/storage/{database,trip-store,draft-store}.mjs`：版本/事务和持久化；`src/services/travel-service.mjs`：组合工作流。
- `src/server/{http-app,api-router,static-files,request-guards}.mjs`、`src/start.mjs`：本机启动、路由和安全边界。
- `src/web/index.html`、`src/web/styles.css`、`src/web/{app,api-client,router,views,form-controller}.mjs`：响应式界面及编辑交互。
- `tests/*.test.mjs`、`tests/helpers/{fixtures,http-client}.mjs`：隔离临时数据库、真实回环 HTTP 测试及可注入的前端控制器测试。
- `.gitignore`、`package.json`、`README.md`、`docs/web-foundation-acceptance.md`：忽略运行数据，启动/测试和实际验收记录。

### 跨任务精确契约

`Input` 为 `{name,startDate,endDate,travelerCount,budgetYuan,cities}`；城市输入只需 `{cityCode,arrivalDate,departureDate}`。服务端补全名称和 order。`Trip` 采用规格字段，revision 从 1 开始。

数据库 schemaVersion 为 1；表为 metadata、trips、trip_cities、drafts、save_receipts。最后两表保留草稿会话墓碑和操作回执，防止重试/乱序；不是新增用户功能。

`DraftSlot` 为 `{key,revision,state,sessionId,targetTripId,baseTripRevision,step,input}`，state 为 active/closed；不存在时 `{key,revision:0,state:'closed'}`。key 为 `new` 或 `edit:<tripId>`；step 为 basic/route/confirm；编辑起点版本固定不随自动保存改变。关闭仅清空 input、保留 sessionId/revision；重新开始必须新 sessionId，且提供当前 slot revision。自动保存只能更新同一 active session；正式提交或舍弃后到达的旧 session 写入返回 409。删除目标行程后禁止再写其编辑草稿。

`DraftCommand` 为 `{expectedRevision,sessionId,targetTripId,baseTripRevision,step,input}`，新建 baseTripRevision 为 0；每次有效写入 slot revision+1。closed slot 只接受不同 sessionId 的新会话且 expectedRevision 匹配；active slot 只接受同 sessionId 的匹配版本更新，不暗中抢占另一个标签页。`DiscardCommand` 为 `{sessionId,revision}`；关闭已 closed 的相同会话可返回现状，不能关闭之后新开的会话。

`SaveCommand` 为 `{operationId,expectedTripRevision,input,draft:{key,sessionId,revision}}`；新建 expectedTripRevision 为 0。每次提交冻结 operationId、input 和草稿版本，网络失败按原命令重试；字段变化生成新 operationId。回执绑定 operationId、tripId、规范化请求哈希及首次响应；同 ID 不同请求返回 409；相同请求不再次写入。若回执行程随后已删除，返回 409，不复活行程。成功提交关闭对应草稿，会话墓碑 revision 增加。

JSON 成功返回 `{data:...}`，失败返回 `{error:{code,message,fields?}}`；缺失 404、冲突 409、校验 422、请求过大 413、写来源不合法 403、内容类型不合法 415、损坏/版本/存储失败 503。GET 草稿返回 slot（closed 时不提示有可恢复内容）。DELETE 草稿以匹配的 sessionId/revision 关闭，DELETE 行程带 expectedTripRevision。写 body 均采用 JSON。

---

### Task 1: 独立城市目录与行程领域规则

**Files:** Create `package.json`、`.gitignore`、`src/shared/date.mjs`、`src/shared/money.mjs`、`src/shared/trip-validation.mjs`、`src/domain/city-catalog.mjs`、`src/data/china-cities.json`、`tests/domain.test.mjs`、`tests/helpers/fixtures.mjs`。

**Interfaces:**
- Produces `isDateOnly(value)`、`todayDateOnly(date=new Date())`、`getTripStatus(trip,today)`；`yuanToCents(text)` 返回整数分/非法时 null；`formatCents(cents)`。
- Produces `getCityByCode(code)`、`searchCities(query,limit=20)`；返回独立对象，不依赖源仓库。
- Produces `validateBasicInfo(input)`、`validateCities(input,cities,resolveCity)` 返回字段错误映射；`normalizeTripInput(input,resolveCity)` 校验通过返回规范化 Trip 内容，失败抛 `ValidationError`（fields）。

- [ ] **Step 1: 写失败测试。** 基于明确 fixture 定义 `boundary_dates`、`exact_budget`、`city_route_rules`、`catalog_independence`；例如 `assert.equal(yuanToCents('90071992547409.91'),Number.MAX_SAFE_INTEGER)`、`assert.equal(yuanToCents('90071992547409.92'),null)`；预算 0、负数、科学记数、小数超两位拒绝；覆盖相邻交接合法、逆序不重叠也非法、非相邻共享日期非法、单日嵌套非法；目录长度 344、南京查询、港澳台、4 集合编码、空查询及 20 项上限。
- [ ] **Step 2: 红灯。** `node --test tests/domain.test.mjs`；Expected: 缺少领域模块失败，而非 fixture 语法错误。
- [ ] **Step 3: 实现接口和最小项目配置。** `package.json` 设置 type=module、test=`node --test tests/*.test.mjs`、start=`node src/start.mjs`；忽略 `/runtime/`、测试临时文件及凭据。用已有 JSON 目录制作独立副本；金额逐段 BigInt 转分，不能浮点乘法；服务端按目录补全名称，不信任客户端名称。对已有规则仅参考，不盲抄原来的零预算或逆序漏洞。
- [ ] **Step 4: 绿灯。** `node --test tests/domain.test.mjs`、`npm test`；Expected: 全通过，网站无跨项目 import。
- [ ] **Step 5: 提交。** `git add package.json .gitignore src/shared src/domain src/data tests`；`git commit -m "feat: add independent travel domain rules"`。

### Task 2: SQLite、版本保护与可靠的行程/草稿工作流

**Files:** Create `src/storage/database.mjs`、`src/storage/trip-store.mjs`、`src/storage/draft-store.mjs`、`src/services/travel-service.mjs`、`tests/storage.test.mjs`、`tests/travel-service.test.mjs`。

**Interfaces:**
- Consumes Task 1 标准化和校验。Produces `openDatabase(path)` → `{db,transaction(fn),close()}`；事务异常 rollback；版本/损坏使用专用错误，不暴露数据内容。
- Produces `createTripStore(database)` → `list(),get(id),put(id,normalized,{expectedRevision,now}),remove(id,expectedRevision)`；`createDraftStore(database)` → `get(key),put(key,command),close(key,{sessionId,revision})`，遵守上述 slot 规则。
- Produces `createTravelService({database,today,now})` → `listTrips(),getTrip(id),getOverview(),getDraft(key),saveDraft(key,command),discardDraft(key,command),saveTrip(id,SaveCommand),deleteTrip(id,expectedRevision)`；事务含所有受影响表，回执检查在草稿 active 检查之前以支持提交后重试。

- [ ] **Step 1: 写失败测试。** `persistent_roundtrip` 打开临时数据库保存并关闭重开；`protect_corrupt_or_newer_database` 比较失败前后文件内容；`trip_revision_conflict` 第二次旧版本更新/删除失败但新数据不变；`commit_closes_draft_atomically` 注入清理阶段异常后行程、城市、草稿均不变；`late_autosave_does_not_revive_closed_session`；`idempotent_lost_response` 同命令重放只一条行程和一次 revision；同 operationId 不同 payload 冲突、删除后旧保存不复活；旧城市名称快照仍可读，新未知编码拒绝。
- [ ] **Step 2: 红灯。** `node --test tests/storage.test.mjs tests/travel-service.test.mjs`；Expected: 新模块缺失失败。
- [ ] **Step 3: 实现接口。** 所有 SQL 用参数绑定；开启外键；只对全新/真正空库初始化 metadata 版本 1；非空无版本不初始化。Trip 与城市子行写同事务。drafts tombstone 行不删除；新会话要匹配 slot revision；编辑 key 与 targetTripId 必须一致；草稿接收部分/非法输入但严格验证封装结构与步骤。哈希按规范化 SaveCommand 稳定序列化（不包含 operationId）后 SHA-256；回执、Trip 和关闭草稿一起提交；保留 createdAt，更新时 revision+1。
- [ ] **Step 4: 绿灯。** 上述定向命令、`npm test`；Expected: 所有失败注入均无部分写入，全部通过。
- [ ] **Step 5: 提交。** `git add src/storage src/services tests`；`git commit -m "feat: persist trips and drafts transactionally"`。

### Task 3: 本机 HTTP API 和静态安全边界

**Files:** Create `src/server/http-app.mjs`、`src/server/api-router.mjs`、`src/server/static-files.mjs`、`src/server/request-guards.mjs`、`src/start.mjs`、`tests/http.test.mjs`、`tests/helpers/http-client.mjs`。

**Interfaces:**
- Consumes Task 2 service 和 Task 1 cities。Produces `createHttpApp({service,webRoot,sharedRoot,allowedHosts})` → Node request listener；`async startServer({dbPath,port=3210,host='127.0.0.1'})` → `Promise<{server,url,close()}>`，禁止 host 改为非回环；测试 port=0；async close 等待关闭 server 和数据库。
- Routes 使用规格路径和上文 JSON 契约；URL 编辑草稿 key 经 encodeURIComponent，解码后校验 new/edit:<id>。GET /api/overview 返回 `{today,counts:{total,upcoming,ongoing,completed},recentTrip}`。
- 静态 allowlist 只 `/`、`/web/` 的已知文件以及 `/shared/` 的已知无秘密模块；未知资源 404。前端采用 hash 路由，不需要任意路径 SPA fallback。

- [ ] **Step 1: 写失败测试。** 用真实回环端口而非 mock router 检查 CRUD/草稿流程、404/409/422/503；`assert.equal(response.status,413)` 对 65537 字节请求且原数据未变；wrong Host、cross-origin、缺 Origin、text/plain 写入各拒绝；GET /runtime/travel.sqlite、编码 ../、双编码路径、点目录、符号链接泄露均不得返回私有内容；正常静态 MIME 与安全响应头。
- [ ] **Step 2: 红灯。** `node --test tests/http.test.mjs`；Expected: http-app 不存在失败。
- [ ] **Step 3: 实现。** 服务只绑定回环；Host 精确限制 localhost/127.0.0.1 加实际端口，Origin 要同一合法 host+port；不启用 CORS。JSON 超限立即停止读取并返回 413。URL 解码一次、拒绝 dot traversal/额外编码分隔符；白名单路径对应真实文件且 realpath 仍在允许目录。提供 CSP（self scripts/styles/connect、no frames）、nosniff、Cache-Control no-store；统一 safe 错误映射。用 hostname 和 port 正常处理临时测试端口。资源暂缺时返回 404，不先造页面。
- [ ] **Step 4: 绿灯。** `node --test tests/http.test.mjs`、`npm test`；Expected: 全通过，非白名单文件不可下载。
- [ ] **Step 5: 提交。** `git add src/server src/start.mjs tests`；`git commit -m "feat: serve guarded local travel APIs"`。

### Task 4: 首页、列表与详情网页

**Files:** Create `src/domain/trip-presenter.mjs`、`src/web/index.html`、`src/web/styles.css`、`src/web/app.mjs`、`src/web/api-client.mjs`、`src/web/router.mjs`、`src/web/views.mjs`、`tests/web-navigation.test.mjs`；Modify Task 3 静态白名单。

**Interfaces:**
- Produces `createApiClient({fetchImpl,baseUrl=''})` → `overview(),trips(),trip(id),cities(q),draft(key),saveDraft(key,command),discardDraft(key,command),saveTrip(id,command),deleteTrip(id,revision)`；解析错误为 `{status,code,message,fields}`，不把失败转成空数组。
- Produces `parseRoute(hash)` → home/trips/new/detail/edit，`navigate(route)` 设置 hash；`createApp({api,render,navigate,confirm})` → `load(route),deleteTrip(trip)`，陈旧异步 load 不覆盖新 route。
- `presentTrip(trip,today)` 衍生状态/预算/城市摘要；列表按状态和相关日期排序；近期优先进行中，再最近待出发，再最近已结束。

- [ ] **Step 1: 写失败测试。** 注入 api/render/confirm 检查无记录真实零统计、加载失败不显示空、列表与详情、新建/编辑路由、旧请求晚返回不改新页；`cancel_delete_keeps_trip`、确认带 revision 删除、冲突保留页面和提示；HTML/CSS 合同有导航、main、焦点样式、语义 label，无 AI/地图伪链接。
- [ ] **Step 2: 红灯。** `node --test tests/web-navigation.test.mjs`；Expected: 页面模块缺失失败。
- [ ] **Step 3: 实现。** 自由设计暖色响应式框架；使用安全 textContent/DOM 构建用户文本，不把行程名拼入 innerHTML；首页/列表/详情/缺失/失败/重试状态完整。桌面侧栏、窄屏紧凑导航；不依赖远程图片字体。新建/编辑先显示明确“编辑器待载入”状态，Task 5 接上，不使用可提交假表单。
- [ ] **Step 4: 绿灯。** `node --test tests/web-navigation.test.mjs tests/http.test.mjs`、`npm test`；Expected: 页面和静态路由通过。
- [ ] **Step 5: 提交。** `git add src/domain src/web src/server/static-files.mjs tests`；`git commit -m "feat: add responsive travel dashboard and trip views"`。

### Task 5: 三步编辑与抗乱序草稿恢复

**Files:** Create `src/shared/trip-form-model.mjs`、`src/web/form-controller.mjs`、`tests/trip-form.test.mjs`、`tests/web-form.test.mjs`；Modify `src/web/views.mjs`、`src/web/app.mjs`、`src/web/styles.css`、静态白名单。

**Interfaces:**
- Consumes Task 1 validation、Task 4 api、Task 2 drafts。Produces `createTripForm({trip=null,slot=null,createId})` → `snapshot(),change(field,value),addCity(city),changeCity(index,field,value),moveCity(from,to),removeCity(index),next(),previous(),setStep(step),toInput()`；model 不直接写网络。
- Produces `createFormController({api,model,draftKey,slot,render,navigate,confirm,clock,createId})` → `start(),change(...),addCity(...),changeCity(...),moveCity(...),removeCity(...),next(),previous(),save(),retrySave(),discard(),dispose()`；注入 clock 支持 debounce 400ms 确定性测试。草稿保存队列串行，响应确认后才更新 slot revision；所有后台失败为可见状态。

- [ ] **Step 1: 写失败测试。** 覆盖三个步骤校验/定位、恢复当前步骤/城市顺序、金额原字符串、固定 tripId、草稿无效字段仍可恢复；fake deferred promise 模拟先前保存晚返回、快速输入、切步骤等待落盘失败不前进、提交先 flush 队列、失败重试完全相同 SaveCommand、再次编辑生成新 operationId；舍弃先等待队列并关闭会话、离开页面晚响应不 render；编辑冲突保留输入；城市搜索改 query 不保留上一选项，移除/上下移动不丢日期。
- [ ] **Step 2: 红灯。** `node --test tests/trip-form.test.mjs tests/web-form.test.mjs`；Expected: 新模块缺失失败。
- [ ] **Step 3: 实现。** 原生有 label 的表单、三个步骤、城市搜索结果与日期、上下移动、确认摘要。恢复/舍弃需要明确用户选择；先持久化固定 targetTripId/sessionId 才可进入正式提交；next/previous 等待当前草稿保存，不谎报步骤进度。正式 save 冻结命令、防重复点击、同输入 retry 保持身份；load 冲突/网络错不清输入；成功刷新服务端详情再导航。disposal 取消未发 debounce，已发请求只能更新会话同步信息、不更新离开的 UI；会话墓碑最终防线在服务端。
- [ ] **Step 4: 绿灯。** 上述定向命令、`npm test`；Expected: 测试全部通过；没有直接数据库或小程序引用。
- [ ] **Step 5: 提交。** `git add src/shared src/web src/server/static-files.mjs tests`；`git commit -m "feat: add reliable three-step trip editor"`。

### Task 6: 真浏览器验收、启动说明与完整交付

**Files:** Create `README.md`、`docs/web-foundation-acceptance.md`、`tests/project.test.mjs`；Modify 确有缺陷的文件前先加对应失败测试。

**Interfaces:** Consumes Tasks 1–5 整体；Produces 可重复的个人本机启动/停止、数据路径和当前限制说明，以及真实浏览器验收证据，不上传数据/截图中的私人信息。

- [ ] **Step 1: 写失败测试。** `project_is_independent` 禁止 wx、CloudBase、DeepSeek、跨项目绝对 import 或 symlink；`documentation_and_static_contract` 验证启动/停止/数据路径/仅本机说明和静态白名单，无提交数据库或凭据；README/验收文档尚不存在时失败。
- [ ] **Step 2: 红灯。** `node --test tests/project.test.mjs`；Expected: 新的文档/合同断言失败。
- [ ] **Step 3: 启动并真实操作。** 使用隔离的测试数据库，打开本机 URL；执行空状态→南京/苏州多城创建→三个步骤确认→首页/列表/详情一致→编辑排序→重开恢复草稿→取消删除/确认删除→停止重启数据仍在；再测非法预算/重叠日期提示、一次请求失败重试。检查桌面及约 390px 窄屏、键盘焦点、滚动和控制台。使用当前产品提供的浏览器自动化技能；若浏览器工具不支持 viewport，另录可验证的窄屏证据，不宣称未测项通过。
- [ ] **Step 4: 保存截图与验收记录。** 记录实际 URL、测试命令/结果、使用数据库位置、截图、仍未通过项。README 说明 Node v25.9.0、`npm start`、Ctrl+C 停止、数据库不随停止删除、只供本机访问、UI 可调整、AI 等留到后续。临时验收库放 ignored runtime/qa-*，不把真实用户库用于删除测试。
- [ ] **Step 5: 最终验证。** `npm test`、`git diff --check`、`git status --short`；Expected: 全通过、无空白错误、无运行库/密钥入库；若可视验收受阻如实列出。`git add README.md docs/web-foundation-acceptance.md tests/project.test.mjs`；`git commit -m "docs: record local web foundation acceptance"`。

## 计划自检与执行交接

规格 1–2 产品边界→所有任务全局约束；规格 3 架构→Tasks 1–3；规格 4 页面/草稿→Tasks 4–5；规格 5 数据/API→Tasks 1–3；规格 6 测试/验收→Tasks 1–6；规格 7 环境/限制→Tasks 1/6。接口名称、草稿版本和 API 字段使用同一契约；没有未指定的存储或互通功能。

实施前使用 using-git-worktrees 创建/确认本网站的隔离工作区（不要调用仍绑定小程序仓库的 App 工作树工具来创建网站工作树），分支使用 `codex/` 前缀。沿用用户此前节省 token、逐项推进的偏好，推荐 Native：本人执行全部六个任务，最后进行一次独立全分支审查；本文件经用户审阅确认后才实施。临时执行 ledger 在本网站的本计划目录中维护，不混入小程序计划。

完成后只交付网页版第一部分及验收证据，等待用户查看与决定；不自动开始 AI 第二部分，也不替小程序启动下一阶段。
