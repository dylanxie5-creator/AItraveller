# 网页版行程花销 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本地网页版加入与正式行程绑定的人民币花销、行程内自定义分类、预算/分类/城市统计和可靠的增删改流程。

**Architecture:** 在现有 SQLite 数据库内增加花销、分类和操作回执关系表，把数据库升级到 v3；纯领域模块负责校验与统计，服务层在短事务中组合存储，前端只访问本机同源 API。所有写操作使用客户端实体 ID、操作 ID 和实体版本，支持响应丢失后的安全重试，并阻止多标签静默覆盖。

**Tech Stack:** Node.js v25.9.0、原生 HTML/CSS/ES modules、`node:sqlite`、`node:test`；不新增 npm 运行依赖。

**Spec:** `docs/superpowers/specs/2026-10-09-web-expense-tracking-design.md`；用户于 2026-10-09 确认书面设计。

## Global Constraints

- 只改独立网页版，不修改微信小程序；网站继续仅监听 `127.0.0.1`。
- 金额仅为人民币，必须大于 0、最多两位小数，持久化为正安全整数分。
- 花销日期必须位于所属行程首尾日期内；备注最多 200 个 Unicode code point。
- 默认分类固定为交通、住宿、餐饮、门票、购物、娱乐、其他；自定义分类仅在当前行程有效。
- 城市可为空（“整个行程”）或属于当前路线；编辑历史花销可保留该记录原有的已移出路线城市。
- 不实现 AA、付款人、分摊、小票、外币、退款/负数冲销、趋势图或跨行程分类。
- 不把花销、金额、备注、分类名称、城市选择发送给 AI/检索平台或写入日志。
- v1/v2 数据库升级到 v3 前生成并验证一次原始快照；迁移失败回滚且不覆盖旧库。
- 不增加全局记账导航；花销从具体正式行程进入，AI 转换行程与手工行程行为一致。
- 测试和浏览器验收使用独立 QA 数据库及模拟 AI 工厂，不调用真实或付费外部接口。
- 每个任务遵循 RED→GREEN→相关回归→`git diff --check`→单独提交；不在未验证状态停顿。

## Review Focus

1. 金额输入 `1e2`、`+1`、全角数字、前后空格、`.5`、`1.`、`0.001` 和超安全整数：只接受明确十进制元格式并精确转分（Task 1）。
2. 保存响应丢失后另一标签修改/删除同一记录，再用原操作重试：返回原回执或明确冲突，绝不重复新增或覆盖新版本（Task 3、4）。
3. 分类名称的大小写、NFKC 全半角和空白变体与默认分类冲突：按规范化名称拒绝；正在使用时重命名可见、删除不写入（Task 1、4）。
4. v2 库包含 AI 密文设置、活动任务、攻略、转换、草稿和保存回执：v3 迁移与备份逐值保留；未知 v4/坏库字节不变（Task 2）。
5. 行程移除城市且旧编辑页仍打开，或用户提交其他行程的分类/城市/花销 ID：历史原城市可保留，跨行程引用必须拒绝且不泄露记录（Task 1、3、4、5）。

---

## 执行位置与共享接口

执行目录：`C:/Users/X/Documents/ChatGPT/智游足迹网页版/.worktrees/web-foundation`；基线提交 `31f8e56`，分支 `codex/web-expense-tracking`。执行前检查 `git status` 和适用的 `AGENTS.md`；保留 `.superpowers/`、`runtime/` 等忽略文件，不重建或强制删除工作树。

共享类型使用 JSDoc 表达：

- `ExpenseInput = {amountYuan:string,categoryId:string,cityCode:string|null,spentDate:string,note:string}`。
- `ExpenseContent = {amountCents:number,categoryId:string,cityCode:string|null,cityName:string|null,spentDate:string,note:string}`。
- `Expense = ExpenseContent & {id,tripId,revision,createdAt,updatedAt}`。
- `ExpenseCategory = {id,tripId,revision,name,normalizedName,createdAt,updatedAt}`。
- `CategoryOption = {id,name,kind:'default'|'custom',revision:number|null,inUse:boolean}`。
- `PresentedExpense = Expense & {categoryName,cityState:'trip'|'current'|'removed'}`；`trip` 表示“整个行程”。
- `ExpenseCommand = {operationId:string,expectedRevision:number,input:ExpenseInput}`，新建的预期版本为 `0`。
- `CategoryCommand = {operationId:string,expectedRevision:number,name:string}`，新建的预期版本为 `0`。
- `DeleteCommand = {operationId:string,expectedRevision:number}`。
- 默认分类 ID：`default:transport`、`default:lodging`、`default:food`、`default:tickets`、`default:shopping`、`default:entertainment`、`default:other`。
- `ExpenseSummary = {hasExpenses,totalCents,budgetCents,budgetRemainingCents,budgetState,byCategory:{categoryId,name,totalCents,count}[],byCity:{cityCode,cityName,cityState,totalCents,count}[],recentExpenses:PresentedExpense[]}`；无预算时两个预算结果均为 `null`，`budgetState='unset'`。

## Task 1: 花销分类、字段校验与统计纯领域契约

**Files:**
- Create: `src/expenses/categories.mjs`
- Create: `src/expenses/validation.mjs`
- Create: `src/expenses/statistics.mjs`
- Create: `tests/expense-domain.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_EXPENSE_CATEGORIES`；`normalizeCategoryName(name) -> string` 使用 `trim()`、Unicode NFKC 和小写规范化。
- Produces: `createCategoryCatalog(customCategories) -> {list,byId,resolve(id)}`，默认分类在前，自定义分类按创建时间/ID 稳定排序。
- Produces: `normalizeExpenseInput(input,{trip,catalog,previous=null}) -> ExpenseContent`；`previous` 仅允许保留其原有历史城市。
- Produces: `computeExpenseSummary({trip,expenses,catalog,limitRecent=3}) -> ExpenseSummary`；明细按 `spentDate desc, updatedAt desc, id asc`。

- [ ] **Step 1: 写领域失败测试**

  在 `tests/expense-domain.test.mjs` 添加具名测试：

  ```js
  test('money accepts explicit two-decimal yuan and rejects ambiguous formats', () => {
    assert.equal(normalizeExpenseInput(validInput({amountYuan:'12.30'}), context()).amountCents,1230);
    for (const amountYuan of ['','0','-1','1e2','+1','１','1.001','90071992547409.92'])
      assert.throws(() => normalizeExpenseInput(validInput({amountYuan}), context()), hasField('amountYuan'));
  });

  test('normalization prevents default and custom category aliases', () => {
    assert.equal(normalizeCategoryName('  ＦＯＯ  '),'foo');
    assert.throws(() => createCategoryCatalog([custom(' 交通 ')]), hasField('name'));
  });

  test('only the previous removed city may survive an edit', () => {
    assert.equal(normalizeExpenseInput(validInput({cityCode:'330100'}), context({previous:oldExpense()})).cityName,'旧城');
    assert.throws(() => normalizeExpenseInput(validInput({cityCode:'999999'}), context()), hasField('cityCode'));
  });

  test('summary distinguishes no records no budget and overspending', () => {
    assert.deepEqual(computeExpenseSummary(emptySummaryInput()), expectedEmptySummary());
    assert.equal(computeExpenseSummary(overBudgetInput()).budgetState,'over');
    assert.equal(computeExpenseSummary(overBudgetInput()).budgetRemainingCents,-500);
  });
  ```

  同文件覆盖日期首尾边界、201 字备注、未知分类、城市/分类汇总、“整个行程”、稳定排序、重命名后历史显示和 recent 三条限制。

- [ ] **Step 2: 运行领域测试确认 RED**

  Run: `node --test tests/expense-domain.test.mjs`

  Expected: FAIL，原因是三个模块或导出尚不存在，而不是测试语法错误。

- [ ] **Step 3: 实现纯领域模块**

  金额只接受正则 `^(?:0|[1-9]\d*)(?:\.\d{1,2})?$` 且转分后为正安全整数；字符串先去除首尾空格，不接受科学计数、符号、全角数字、`.5` 或 `1.`。备注按 Unicode code point 计数；统计累加每一步检查安全整数。所有返回对象重新组装，不修改输入。

- [ ] **Step 4: 运行 GREEN 与既有领域回归**

  Run: `node --test tests/expense-domain.test.mjs tests/domain.test.mjs tests/trip-form.test.mjs`

  Expected: 0 failures。

- [ ] **Step 5: 提交领域契约**

  Run: `git diff --check && git add src/expenses tests/expense-domain.test.mjs && git commit -m "feat: define expense validation and statistics"`

## Task 2: SQLite v3 结构、安全迁移与备份

**Files:**
- Create: `src/storage/expense-schema.mjs`
- Create: `tests/expense-migration.test.mjs`
- Modify: `src/storage/database.mjs`
- Modify: `src/storage/migration-backup.mjs`
- Modify: `tests/storage.test.mjs`
- Modify: `tests/ai-migration.test.mjs`

**Interfaces:**
- Consumes: Task 1 固定的实体字段和默认分类不入库规则。
- Produces: `expenseTables`、`expenseIndexes`、`applyExpenseSchema(db)`；调用者拥有事务，函数把 metadata 更新为 `3`。
- Produces: `databaseFingerprint(db) -> string`，覆盖源库全部用户表、索引、触发器和有序记录。
- Changes: `createMigrationBackup(db,path,{backupImpl,validateDatabase,sourceVersion}) -> Promise<{path,fingerprint}>`，文件名包含源版本但不假设只迁 v1。
- Changes: `prepareDatabase(path,options) -> Promise<DatabaseHandle>` 支持 v1→v2→v3 和 v2→v3；`openDatabase` 只直接打开空库或完整 v3。

- [ ] **Step 1: 写迁移失败测试**

  ```js
  test('v2 migrates to v3 after a verified snapshot without changing AI data', async t => {
    const before = await seedVersion2WithAiAndTrips(t);
    const database = await prepareDatabase(before.path);
    assert.equal(database.db.prepare('SELECT version FROM metadata').get().version,3);
    assert.deepEqual(readPreservedV2Rows(database.db),before.rows);
    assert.equal(listVerifiedBackups(before.dir).length,1);
  });

  test('failed v3 ddl rolls back and keeps source bytes usable', async t => {
    const fixture = await version2Fixture(t), rows = readAllRows(fixture.path);
    await assert.rejects(prepareDatabase(fixture.path,{applyExpenseMigration(){throw Error('fixture');}}),hasCode('STORAGE_MIGRATION_FAILED'));
    assert.deepEqual(readAllRows(fixture.path),rows);
  });
  ```

  另测：空库直接 v3；v1 一次备份后顺序迁到 v3；备份失败不执行 DDL；备份包含 WAL 提交；v4、坏 metadata、缺表、错索引和坏文件拒绝且字节不变；外键级联有效。把旧测试中“未来版本 3”调整为 `4`。

- [ ] **Step 2: 运行迁移测试确认 RED**

  Run: `node --test tests/expense-migration.test.mjs tests/ai-migration.test.mjs tests/storage.test.mjs`

  Expected: FAIL，明确缺少 v3 schema/迁移；现有 v2 数据保护断言仍可运行。

- [ ] **Step 3: 实现 v3 schema 与通用迁移**

  建立 `expenses`、`expense_categories`、`expense_operation_receipts`，外键均指向 `trips(id) ON DELETE CASCADE`；分类唯一索引为 `(trip_id,normalized_name)`，明细索引支持 `(trip_id,spent_date DESC,updated_at DESC,id)`。验证函数精确检查 v1/v2/v3 各自应有对象，迁移在同一 `BEGIN IMMEDIATE` 中顺序执行。

- [ ] **Step 4: 运行迁移/存储/锁回归**

  Run: `node --test tests/expense-migration.test.mjs tests/ai-migration.test.mjs tests/storage.test.mjs tests/database-lock.test.mjs`

  Expected: 0 failures；Windows 实际锁测试除既有权限型 symlink 项外不得新增跳过。

- [ ] **Step 5: 提交数据库升级**

  Run: `git diff --check && git add src/storage/expense-schema.mjs src/storage/database.mjs src/storage/migration-backup.mjs tests/expense-migration.test.mjs tests/ai-migration.test.mjs tests/storage.test.mjs && git commit -m "feat: migrate local database to expense schema v3"`

## Task 3: 花销、分类与操作回执存储

**Files:**
- Create: `src/storage/expense-store.mjs`
- Create: `src/storage/expense-category-store.mjs`
- Create: `src/storage/expense-operation-store.mjs`
- Create: `tests/expense-storage.test.mjs`

**Interfaces:**
- Consumes: Task 1 `ExpenseContent`、分类规范化；Task 2 v3 表。
- Produces: `createExpenseStore(database) -> {get(tripId,id),list(tripId),put(tripId,id,content,{expectedRevision,now}),remove(tripId,id,expectedRevision)}`。
- Produces: `createExpenseCategoryStore(database) -> {get(tripId,id),list(tripId),put(tripId,id,name,{expectedRevision,now}),usageCount(tripId,id),remove(tripId,id,expectedRevision)}`。
- Produces: `createExpenseOperationStore(database) -> {find(operationId),insert({operationId,tripId,entityType,entityId,requestHash,response})}`；响应只含实体/删除结果，不含表单原文。

- [ ] **Step 1: 写存储失败测试**

  ```js
  test('expense put uses optimistic revisions and never crosses trips', t => {
    const c=expenseStorageContext(t), saved=c.expenses.put('trip-1','expense-1',content(),{expectedRevision:0,now:NOW});
    assert.equal(saved.revision,1);
    assert.equal(c.expenses.get('trip-2','expense-1'),null);
    assert.throws(() => c.expenses.put('trip-1','expense-1',content(),{expectedRevision:0,now:NOW}),hasCode('CONFLICT'));
  });

  test('used custom category cannot be deleted or orphan expenses', t => {
    const c=seedExpenseUsingCustomCategory(t);
    assert.throws(() => c.categories.remove('trip-1','custom-1',1),hasCode('CATEGORY_IN_USE'));
    assert.equal(c.expenses.get('trip-1','expense-1').categoryId,'custom-1');
  });
  ```

  另测损坏行、非法安全整数、深拷贝、稳定排序、分类唯一约束、跨行程实体 ID、行程删除级联、回执同操作读取和同 ID 不同请求拒绝。

- [ ] **Step 2: 运行存储测试确认 RED**

  Run: `node --test tests/expense-storage.test.mjs`

  Expected: FAIL，原因是 store 导出不存在。

- [ ] **Step 3: 实现三个小型 store**

  每次读取都校验数据库行并组装新对象；跨行程查询统一表现为不存在。`put/remove` 仅处理已经过领域校验的内容，但仍检查 ID、版本和数据库约束。分类删除在同一事务内检查 usage count 后删除；存储异常映射为受控错误，不泄露 SQL。

- [ ] **Step 4: 运行 GREEN 与存储回归**

  Run: `node --test tests/expense-storage.test.mjs tests/storage.test.mjs tests/ai-plan-store.test.mjs`

  Expected: 0 failures。

- [ ] **Step 5: 提交存储层**

  Run: `git diff --check && git add src/storage/expense-*.mjs tests/expense-storage.test.mjs && git commit -m "feat: persist trip expenses and categories"`

## Task 4: 花销服务、幂等命令与行程集成

**Files:**
- Create: `src/services/expense-service.mjs`
- Create: `tests/expense-service.test.mjs`
- Modify: `src/services/travel-service.mjs`
- Modify: `tests/travel-service.test.mjs`
- Modify: `tests/ai-conversion.test.mjs`
- Modify: `tests/helpers/database.mjs`

**Interfaces:**
- Consumes: Task 1 领域接口、Task 3 三个 store。
- Produces: `createExpenseService({database,today,now}) -> {getOverview(tripId),getExpense(tripId,id),saveExpense(tripId,id,command),deleteExpense(tripId,id,command),listCategories(tripId),saveCategory(tripId,id,command),deleteCategory(tripId,id,command),getGlobalOverview()}`；`getOverview` 返回 `{trip,categories:CategoryOption[],summary:ExpenseSummary,expenses:PresentedExpense[]}`。
- Changes: `createTravelService(...).getOverview()` 增加 `expenses:{hasExpenses,totalCents}`；其他既有字段不变。
- Changes: `deleteTrip` 仍以行程版本控制，在同一现有事务中依靠外键级联花销/分类/回执并保留 AI conversion deleted 语义。

- [ ] **Step 1: 写服务失败测试**

  ```js
  test('lost create response replays one expense and never overwrites a newer edit', t => {
    const c=expenseServiceContext(t), command=newExpenseCommand('op-create');
    const first=c.expenses.saveExpense('trip-1','expense-1',command);
    c.expenses.saveExpense('trip-1','expense-1',editExpenseCommand(first));
    assert.deepEqual(c.expenses.saveExpense('trip-1','expense-1',command),first);
    assert.equal(c.expenses.getOverview('trip-1').expenses.length,1);
  });

  test('deleting a trip atomically removes expenses without reviving AI conversion', t => {
    const c=tripWithAiConversionAndExpense(t);
    c.travel.deleteTrip(c.trip.id,c.trip.revision);
    assert.throws(() => c.expenses.getOverview(c.trip.id),hasCode('NOT_FOUND'));
    assert.equal(c.plans.convert(c.plan.id,{expectedRevision:c.plan.revision}).status,'deleted');
  });
  ```

  另测：跨行程 category/expense ID；旧版本冲突保留旧值；相同 operationId 不同 payload 冲突；分类重命名更新统计；使用中删除；历史城市保留/改选；总览累计所有行程；无记录不伪造零状态；删除事务故障整体回滚。

- [ ] **Step 2: 运行服务测试确认 RED**

  Run: `node --test tests/expense-service.test.mjs tests/travel-service.test.mjs tests/ai-conversion.test.mjs`

  Expected: FAIL，缺少 expense service 和 overview 字段。

- [ ] **Step 3: 实现服务和既有行程接线**

  服务端从行程快照解析城市与日期，不信任客户端的 cityName、分类名、统计或预算结果。命令先计算规范化请求摘要；事务内先查回执，再检查预期版本、验证、写实体和回执。新建 ID 由前端生成但必须通过现有 `validId`。所有聚合从数据库记录重新计算。

- [ ] **Step 4: 运行 GREEN 与完整服务回归**

  Run: `node --test tests/expense-service.test.mjs tests/travel-service.test.mjs tests/ai-conversion.test.mjs tests/ai-jobs.test.mjs`

  Expected: 0 failures，AI 转换与删除行为无回归。

- [ ] **Step 5: 提交服务层**

  Run: `git diff --check && git add src/services/expense-service.mjs src/services/travel-service.mjs tests/expense-service.test.mjs tests/travel-service.test.mjs tests/ai-conversion.test.mjs tests/helpers/database.mjs && git commit -m "feat: add reliable expense commands and trip summaries"`

## Task 5: 本机花销 HTTP API

**Files:**
- Create: `src/server/expense-api-router.mjs`
- Create: `tests/expense-http.test.mjs`
- Modify: `src/server/http-app.mjs`
- Modify: `src/start.mjs`
- Modify: `src/server/api-router.mjs`
- Modify: `tests/http.test.mjs`

**Interfaces:**
- Consumes: Task 4 `ExpenseService`。
- Produces: `routeExpenseApi(expenses,method,path,body) -> {status,data}`，仅识别规格中的行程嵌套路由；未知路由返回 `NOT_FOUND`。
- Changes: `createHttpApp({service,expenses,ai,...})` 在普通 trip router 前分派花销嵌套路由；写请求继续经过 Host/Origin/Content-Type/64 KiB 保护。
- Changes: `startServer` 创建一个共享 database 上的 expense service 并注入 HTTP app。

- [ ] **Step 1: 写真实 HTTP 失败测试**

  ```js
  test('expense endpoints create list edit and delete one trip-scoped record', async t => {
    const c=await expenseHttpApp(t), command=newExpenseCommand('op-1');
    assert.equal((await request(c.url,{path:'/api/trips/trip-1/expenses/expense-1',method:'PUT',body:command})).status,200);
    assert.equal((await request(c.url,{path:'/api/trips/trip-1/expenses'})).json.data.expenses.length,1);
    assert.equal((await request(c.url,{path:'/api/trips/trip-2/expenses/expense-1'})).status,404);
  });
  ```

  同文件测试分类 CRUD、使用中删除 409、字段 422、版本 409、未知行程/实体 404、重复操作回执、恶意 Host/Origin、非 JSON、超大 body、编码路径和响应不含 SQL/备注原文。

- [ ] **Step 2: 运行 HTTP 测试确认 RED**

  Run: `node --test tests/expense-http.test.mjs tests/http.test.mjs`

  Expected: FAIL，花销路由为 404；既有 HTTP 测试仍通过。

- [ ] **Step 3: 实现 router、错误映射和启动接线**

  `CATEGORY_IN_USE` 映射 409；字段校验映射 422；冲突 409；不存在 404。错误响应只使用本机受控中文消息和字段错误，不序列化异常栈、SQL、请求体或数据库记录。

- [ ] **Step 4: 运行 GREEN 与 HTTP/启动回归**

  Run: `node --test tests/expense-http.test.mjs tests/http.test.mjs tests/ai-http.test.mjs tests/project.test.mjs`

  Expected: 0 failures。

- [ ] **Step 5: 提交 API**

  Run: `git diff --check && git add src/server/expense-api-router.mjs src/server/http-app.mjs src/server/api-router.mjs src/start.mjs tests/expense-http.test.mjs tests/http.test.mjs && git commit -m "feat: expose local trip expense APIs"`

## Task 6: 前端路由、API 客户端与表单控制器

**Files:**
- Create: `src/shared/expense-form-model.mjs`
- Create: `src/web/expense-controller.mjs`
- Create: `tests/expense-form.test.mjs`
- Create: `tests/web-expense.test.mjs`
- Modify: `src/web/api-client.mjs`
- Modify: `src/web/router.mjs`
- Modify: `tests/web-navigation.test.mjs`

**Interfaces:**
- Consumes: Task 1 字段规则、Task 5 HTTP 路由。
- Produces: `createExpenseForm({trip,expense=null,categories,today}) -> {snapshot(),setField(name,value),validate(),toInput()}`。
- Produces: `createExpenseController({api,render,navigate,confirm,today,createId}) -> {load(route),setField(name,value),save(),retrySave(),deleteExpense(expense),saveCategory(command),deleteCategory(category),dispose(),snapshot()}`。
- Changes: `parseRoute`/`routeToHash` 支持 `expenses`、`expense-new`、`expense-edit`、`expense-categories` 四类 route。
- Changes: API client 增加 `expenseOverview`、`expense`、`saveExpense`、`deleteExpense`、`expenseCategories`、`saveExpenseCategory`、`deleteExpenseCategory`。

- [ ] **Step 1: 写模型与控制器失败测试**

  ```js
  test('new form picks today inside trip and start date outside trip', () => {
    assert.equal(createExpenseForm({trip,categories,today:()=> '2026-10-10'}).snapshot().values.spentDate,'2026-10-10');
    assert.equal(createExpenseForm({trip,categories,today:()=> '2027-01-01'}).snapshot().values.spentDate,trip.startDate);
  });

  test('failed or conflicting save preserves every typed field and retry identity', async () => {
    const c=expenseControllerFixture({saveError:conflict()});
    c.controller.setField('note','保留这段输入'); await c.controller.save();
    assert.equal(c.controller.snapshot().values.note,'保留这段输入');
    assert.equal(c.calls[0].command.operationId,c.controller.snapshot().pendingCommand.operationId);
  });
  ```

  另测所有路由往返、历史城市 option、字段错误聚焦、重复点击只发一次、响应丢失重试同命令、旧 route 延迟响应不渲染、dispose 后不渲染、删除取消/确认、分类使用中错误和不安全 ID 编码。

- [ ] **Step 2: 运行前端逻辑测试确认 RED**

  Run: `node --test tests/expense-form.test.mjs tests/web-expense.test.mjs tests/web-navigation.test.mjs`

  Expected: FAIL，缺少模型/controller/client 路由。

- [ ] **Step 3: 实现模型、客户端和控制器**

  客户端为新建实体生成随机 ID 和 operationId；只有不确定结果的重试复用 pending command。明确字段失败允许修改后生成新命令；冲突保留值并要求重新加载/确认，不偷偷改 expectedRevision。controller 使用序列 token 隔离过期响应，`dispose()` 使后续 render 失效。

- [ ] **Step 4: 运行 GREEN 与现有前端控制器回归**

  Run: `node --test tests/expense-form.test.mjs tests/web-expense.test.mjs tests/web-navigation.test.mjs tests/web-form.test.mjs tests/web-ai.test.mjs`

  Expected: 0 failures。

- [ ] **Step 5: 提交前端逻辑**

  Run: `git diff --check && git add src/shared/expense-form-model.mjs src/web/expense-controller.mjs src/web/api-client.mjs src/web/router.mjs tests/expense-form.test.mjs tests/web-expense.test.mjs tests/web-navigation.test.mjs && git commit -m "feat: add expense web flows and form state"`

## Task 7: 暖色响应式页面、现有页面集成与安全渲染

**Files:**
- Create: `src/web/expense-views.mjs`
- Modify: `src/web/app.mjs`
- Modify: `src/web/views.mjs`
- Modify: `src/web/styles.css`
- Modify: `src/web/index.html`
- Modify: `tests/web-expense.test.mjs`
- Modify: `tests/project.test.mjs`

**Interfaces:**
- Consumes: Task 6 controller state 与 route；Task 4 overview 新字段。
- Produces: `renderExpenseView(root,state,actions)` 和 `renderExpenseForm(root,state,controller)`；只通过 DOM `textContent`/属性白名单插入用户数据。
- Changes: `createApp` 的 home/detail load 同时获取相应花销摘要；全局 hash 生命周期创建/销毁 expense controller，并把未完成保存纳入 `beforeunload`。

- [ ] **Step 1: 扩展前端失败测试**

  在 `tests/web-expense.test.mjs` 添加：行程详情空态/最近三笔、首页累计、总览四区、无预算、超支文字、已移出路线、分类管理、恶意备注作为文本、字段 label/id 唯一、删除确认摘要截断、窄屏所需 class/DOM 结构。`tests/project.test.mjs` 断言新模块只从允许的 web/shared URL 提供。

- [ ] **Step 2: 运行视图测试确认 RED**

  Run: `node --test tests/web-expense.test.mjs tests/project.test.mjs`

  Expected: FAIL，缺少 expense views 与页面接线。

- [ ] **Step 3: 实现页面和响应式样式**

  详情卡显示累计、预算和最近三笔；总览按规格顺序渲染；桌面统计网格、窄屏单列。超支同时输出负数和“已超预算”；无记录输出“— / 尚无记录”；无预算输出“未设置预算”。不添加图表库或全局记账导航。

- [ ] **Step 4: 运行 GREEN 与全部前端测试**

  Run: `node --test tests/web-expense.test.mjs tests/project.test.mjs tests/web-navigation.test.mjs tests/web-form.test.mjs tests/web-ai.test.mjs`

  Expected: 0 failures。

- [ ] **Step 5: 提交页面**

  Run: `git diff --check && git add src/web/expense-views.mjs src/web/app.mjs src/web/views.mjs src/web/styles.css src/web/index.html tests/web-expense.test.mjs tests/project.test.mjs && git commit -m "feat: add warm responsive expense pages"`

## Task 8: 全量回归、真实浏览器验收与文档收尾

**Files:**
- Create: `docs/web-expense-acceptance.md`
- Modify: `README.md`
- Modify: preceding task files only when a verified defect requires a focused fix and regression test

**Interfaces:**
- Consumes: Tasks 1–7 完整功能。
- Produces: 可复现的自动化/浏览器验收记录；README 从项目主目录启动且说明 v3、花销边界与备份行为。

- [ ] **Step 1: 运行完整自动化与静态检查**

  Run: `npm test`

  Expected: 0 failures；仅允许记录已知 Windows 文件 symlink 权限跳过，任何新增跳过都视为未完成。

  Run: `git diff --check`

  Expected: 无输出，exit 0。

- [ ] **Step 2: 启动隔离 QA 服务**

  Run: `node scripts/start-ai-qa.mjs --port 3211 --db runtime/qa-expense.sqlite`

  Expected: 只打开显式 QA 数据库，AI 使用固定本地假实现，无外部请求；正式 `runtime/travel.sqlite` 不被打开或升级。

- [ ] **Step 3: 在浏览器逐项验收**

  使用一趟有预算的多城市行程验证：不同默认/自定义分类、具体城市/整个行程、日期首尾、编辑、分类重命名、使用中删除阻止、超支、删除取消/确认、刷新持久化。再移除一个有关联花销的城市，确认历史城市标记；验证桌面宽屏和约 390px 窄屏；Console 无应用错误。保存截图到忽略的 `runtime/qa-screenshots/`，不提交数据库或图片。

- [ ] **Step 4: 修复验收发现的问题并锁定回归**

  每个真实缺陷先在拥有该逻辑的测试文件添加失败测试，再做最小修复；重复 Step 1 与受影响浏览器流程。不要借此扩展 AA、图表或地图范围。

- [ ] **Step 5: 写验收记录与 README**

  `docs/web-expense-acceptance.md` 记录日期、提交、命令结果、桌面/窄屏实测项、跳过项、截图路径、未使用真实 API 的限制。README 改为 `cd C:\Users\X\Documents\ChatGPT\智游足迹网页版` 后 `npm start`，删除“尚未合并”说明，补充花销使用方法和 v3 迁移备份提示。

- [ ] **Step 6: 再跑全量并提交收尾**

  Run: `npm test && git diff --check`

  Expected: 0 failures；测试总数和唯一允许的权限跳过数写入验收文档。

  Run: `git add README.md docs/web-expense-acceptance.md <verified-fix-files> && git commit -m "docs: verify web expense tracking"`

- [ ] **Step 7: 进行整分支审查并处理发现**

  审查范围为 `31f8e56..HEAD`，重点核对规格覆盖、迁移可恢复性、跨行程授权、幂等/冲突、敏感数据和响应式可访问性。每个修复必须有测试；审查通过后重新运行 `npm test` 和 `git diff --check`，再交给用户决定是否合并。
