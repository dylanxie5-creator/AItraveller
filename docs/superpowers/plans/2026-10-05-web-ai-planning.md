# 网页版 AI 检索与旅游规划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立本机网站加入五平台自选模型、用户 Key 加密保存、智谱检索、可编辑攻略及可靠的新行程转换。

**Architecture:** 纯领域校验、凭据保护、外部 HTTPS 适配、SQLite 任务与攻略服务分离；前端只访问本机 API。持久化请求身份和调用预约，在外部网络等待期间不持有数据库事务；复用现有行程规则和存储，不绕过版本保护。

**Tech Stack:** 本机已验证 Node.js v25.9.0、原生 HTML/CSS/ES modules、`node:sqlite`、`node:test`；Windows PowerShell/.NET DPAPI 与排他文件句柄。不新增 npm 运行依赖。

**Spec:** `docs/superpowers/specs/2026-10-02-web-ai-planning-design.md`；用户于 2026-10-05 确认书面设计。本计划待用户审阅并确定执行方式，不是实施完成记录。

## Global Constraints

- 只改网站，不动小程序；沿用 `127.0.0.1`，不做花销、地图、账号、共享或部署。
- AI 单次 1～3 个城市、1～14 个自然日；偏好最多 1,000 字；手动行程不加这些上限。
- 最多三次智谱搜索、一次所选平台模型请求；无自动重试、续写、自动修复、代理工具或平台切换。
- 搜索 query ≤70 字，`search_std`、`search_intent=false`、`count=5`、`content_size=medium`；≤15 来源，摘要每条 ≤1,200 字。
- 模型非流式，输出 token 上限 8,192；搜索超时 30,000ms，模型超时 120,000ms，外部响应 ≤1 MiB。
- 每日 ≤5 活动，标题 ≤80 字、说明 ≤150 字；≤10 注意事项，每条 ≤200 字；编辑内容 UTF-8 JSON ≤48 KiB，本机请求 ≤64 KiB。
- Key 只供服务端使用，持久化 DPAPI CurrentUser 密文，不进日志、Git、命令行、环境变量或浏览器持久存储；GET 不返回明文、片段或密文。
- 只允许已核实官方 HTTPS 目的地，标准 443 端口，不跟随重定向；目的主机改变需重新输入 Key。
- SQLite 1→2 升级前一致备份，保留行程／草稿／保存回执；未知或损坏数据库拒绝覆盖。
- 每数据库一个执行进程、一个活动任务；设置在活动任务期间禁止改变；重启未完成任务标记 interrupted，不重发付费请求。
- 攻略版本受控；一次转换对应一个新行程；完整攻略快照保留，关联删除不复活，后续修改不双向同步。
- 测试默认模拟外部 API；真实付费联调须用户在本机配置 Key 并另行同意输入／调用上限。没有真实测试就标记未验证。
- 本轮不实现。实施每任务完整 RED→GREEN→回归→提交，停顿只落在已验证检查点；完成本 AI 阶段后问是否进入花销，不自动推进。

## Review Focus

1. 旧测试把版本 2 当“未来版本”：升级后改用版本 3，依然证明未知版本不覆盖；旧数据库所有回执和活草稿原样保留（任务 2）。
2. 原 POST 响应丢失且另一标签页修改了设置：以原 operationId／原配置版本查回执，不再收费，也不把新 Key 发往旧请求地址（任务 6、8）。
3. IPv4-mapped IPv6、混合 DNS 公私地址、重定向到另一个官方平台：不泄露 Key，不发第二请求，不绕过公网检查（任务 4）。
4. 攻略转行程之后编辑攻略、再删行程并重试：快照不变，旧转换返回 deleted，不制造第二趟或复活行程（任务 7）。
5. 查询旧来源时城市目录已变化或来源包含 HTML／javascript URL：历史快照可读，新编辑重新校验；页面文本不执行，非法链接不渲染（任务 1、7、9）。

## 执行位置与接口词汇

执行目录：`C:/Users/X/Documents/ChatGPT/智游足迹网页版/.worktrees/web-foundation`；基线 `b920e9f`，分支 `codex/web-foundation`，当前为已存在的 linked worktree。所有命令显式使用此目录，不因聊天 cwd 为“小程序”而操作错仓库。执行前检查 `git status`／适用 AGENTS.md；保留用户变化，不重建或删除现有 worktree。

共享类型（实现使用 JSDoc，非额外 TypeScript 构建）：

- `ProviderId = 'deepseek'|'zhipu'|'mimo'|'kimi'|'qwen'`。
- `AiInput = {name,startDate,endDate,travelerCount,budgetYuan,cityCodes:string[],preferences}`。网页给名称填入“首城＋旅行”的可编辑默认值；用户不填每城日期，由模型分配。
- `AiRequest = {name,startDate,endDate,travelerCount,budgetCents:number|null,cities:CitySnapshot[],preferences}`。日期、整数金额、城市编码与标准名称从本机校验产生，模型不得改人数／预算／请求城市顺序。
- `Source = {sourceId,title,url,summary,publishedAt:string|null,retrievedAt}`，sourceId 从本机连续分配 `s1` 等，不能由模型创建。
- `PlanContent = {trip:TripContent,days:[{date,activities:[{cityCode,title,description,sourceIds:string[]}]}],cautions:string[]}`；TripContent 沿用标准 name／日期／人数／budgetCents／cities。
- `ProviderConfig = {model,endpoint,keyAction:'retain'|'replace'|'delete',apiKey?:string}`；endpoint 是**完整 Chat Completions POST 地址**而非 Base URL，避免二次拼接 `/v1`。读取设置删除 keyAction／apiKey，返回 `keyConfigured`。
- `SettingsCommand = {expectedRevision,providers:Partial<Record<ProviderId,ProviderConfig>>,search:{keyMode:'zhipu'|'separate',keyAction,apiKey?}}`；空密码输入映射 retain。
- `JobCommand = {operationId,settingsRevision,provider,input:AiInput}`；接收后使用固定配置快照，任务对外不返回任何 Key 或密文。
- `Job = {id,operationId,state,input,provider,model,endpoint,settingsRevision,searchCalls,modelCalls,sources,planId,error,createdAt,updatedAt}`；计数指已预约、可能收费的调用。
- `Plan = {id,revision,original:PlanContent,content:PlanContent,sources,provider,model,createdAt,updatedAt,edited,conversion}`。
- `Conversion = {planId,planRevision,tripId,status:'created'|'deleted',snapshot:PlanContent}`；同一攻略永久只有一个转换身份。

下列文件列表是新增／修改映射，各任务 Files 明确其所有权。不要为分层额外加入未被下一任务调用的抽象。

## Task 1: 规划输入、输出和来源的纯领域契约

**Files:** Create `src/ai/validation.mjs`, `src/ai/sources.mjs`, `src/ai/errors.mjs`, `tests/helpers/ai-fixtures.mjs`, `tests/ai-domain.test.mjs`。复用现有 shared date/money/trip-validation 和 city-catalog，不修改手动行程上限。

**Interfaces:**
- `normalizeAiInput(input:AiInput,resolveCity) -> AiRequest`；失败沿用 ValidationError.fields。
- `normalizePlanContent(raw,{request:AiRequest|null,sources:Source[],resolveCity}) -> PlanContent`；request 非空为首次生成、需匹配请求；编辑时为 null，仍校验全部结构与来源。
- `normalizeSearchResults(raw,{retrievedAt,priorSources:Source[]}) -> Source[]`：返回本次去重后新增来源；拒绝空有效结果，限制字数和 URL；不下载网页。
- `AiError(code,message,fields?)` 只保存本机受控消息，外部原文不挂 cause。
- 测试 fixtures 导出 `aiInput({cityCount=2,days=4}={})`、`sources()`、`planContent(request)`，用南京／苏州／杭州目录编码和固定真实日期；不含真实 Key。

- [ ] 写失败测试，断言：14 天／3 城通过，15 天／4 城拒绝；1001 字偏好拒绝，3200.50 精确为 320050 分；未知／重复城市拒绝；原手动 15 天依然合法。活动换城日可用两相邻城市，但缺一天、重复日期、异城活动、额外城市、来源 `s999`、第六活动、超过字数／48 KiB 拒绝，不裁切行程。历史名称快照不用于校验新编辑；非法来源 URL 过滤。

  代表性测试（其他列出的边界各单独命名）：

  ```js
  test('AI accepts 14 days but rejects 15 without changing money precision', () => {
    assert.equal(normalizeAiInput(aiInput({days:14}), getCityByCode).budgetCents, 320050);
    assert.throws(() => normalizeAiInput(aiInput({days:15}), getCityByCode), e => e.code === 'VALIDATION');
  });
  ```
- [ ] RED：`node --test tests/ai-domain.test.mjs`，须因未实现接口／断言失败，不因测试语法错误。
- [ ] 实现上述接口。以 UTC 日序号计算含首尾天数；按字段白名单组装，严格 JSON 对象，拒绝原型属性和额外输出字段；AI 日期路线另要求覆盖首尾且无空白旅行日。所有“字”按 Unicode code point 计数；来源摘要可明确限长，攻略内容不静默裁切。
- [ ] GREEN＋回归：`node --test tests/ai-domain.test.mjs tests/domain.test.mjs tests/trip-form.test.mjs`，0 failures。
- [ ] `git diff --check` 后仅提交本任务 Files：`feat: validate AI travel plans and retrieved sources`。

## Task 2: 数据库升级、迁移备份和进程独占

**Files:** Create `src/storage/ai-schema.mjs`, `src/storage/migration-backup.mjs`, `src/platform/database-lock.mjs`, `src/platform/database-lock.ps1`, `tests/ai-migration.test.mjs`, `tests/database-lock.test.mjs`；Modify `src/storage/database.mjs`, `src/start.mjs`, `tests/storage.test.mjs`。

**Interfaces:**
- 保留同步 `openDatabase(path)`：全新空库初始化 v2；已有 v2 校验；已有 v1 抛 `STORAGE_MIGRATION_REQUIRED` 而不改写，生产路径由下列 prepareDatabase 升级。
- `prepareDatabase(path,{backupImpl=sqlite.backup,applyMigration=applyAiSchema}={}) -> Promise<DatabaseHandle>`；先验证 v1，使用原生 SQLite backup 写入数据库父目录下 `backups/pre-ai-v1-<唯一id>.sqlite`（默认即 `runtime/backups/`）并验证一致，再事务迁移；不拷贝正在写的主文件来冒充备份。测试数据库与其备份均留在独立临时目录。
- `acquireDatabaseLock(path) -> Promise<{release():Promise<void>,lost:Promise<void>}>`：Windows 固定脚本持有 canonical DB 路径旁 `.owner.lock` 的 `FileShare.None` 文件流；READY 后才算获得，关 stdin／进程结束释放。进程崩溃不需删除锁文件；lost 意外完成时服务器立即拒绝新请求、终止外部请求并退出。
- v2 新表 `ai_settings(id=1,revision,payload)`、`ai_jobs(id,operation_id UNIQUE,request_hash,state,payload)`、`ai_plans(id,revision,payload)`、`ai_conversions(plan_id PRIMARY KEY,trip_id UNIQUE,status,payload)`；以 partial UNIQUE index 对 queued/searching/generating 状态常量保证仅一活动任务；conversion 不级联删除攻略。

- [x] 写失败测试：v1 fixtures 包含正式行程、活草稿、关闭墓碑、save_receipts；升级备份中仍 v1，全部原值不变，新表／索引可用；备份或 DDL 失败不改原库；版本 3、非空无 metadata、坏文件字节不变。原 storage 测试的“未知版本 2”改为 3，仅改变预期版本意义。两个不同端口／等价路径同时启动第二者拒绝，首进程被杀后可取得锁；helper 退出后主服务不能继续收费。

  ```js
  test('version 3 is rejected without modifying its bytes', t => {
    const {path,database} = setup(t);
    database.db.exec('UPDATE metadata SET version=3'); database.close();
    const before = readFileSync(path);
    assert.throws(() => openDatabase(path), e => e.code === 'STORAGE_VERSION');
    assert.deepEqual(readFileSync(path), before);
  });
  ```
- [x] RED：`node --test tests/ai-migration.test.mjs tests/database-lock.test.mjs`。
- [x] 实现接口；规范化真实父目录和 Windows 路径大小写，防止等价路径取得两个锁。`startServer` 在打开数据库前获取锁，再 prepareDatabase；所有失败分支释放资源。release 幂等，预期主动释放不触发 lost 故障关闭；启动部分失败也必须关 helper。固定 PowerShell File 参数传路径但无 Key；禁止执行字符串拼接脚本。测试仅在独立 mkdtemp 内建库。
- [x] GREEN＋回归：`node --test tests/ai-migration.test.mjs tests/database-lock.test.mjs tests/storage.test.mjs tests/travel-service.test.mjs tests/http.test.mjs`。Windows 实机锁测试必须运行，不能用“不支持”跳过后声称通过。
- [x] `git diff --check`，提交本任务 Files：`feat: protect AI database migration and single-process ownership`。实际 runtime 数据只在后续启动时升级，不在此任务操作用户数据库。

2026-10-05 Task2 验证检查点：全量 147 项测试，146 通过、0 失败、1 个原有文件软链接权限跳过项；迁移与 Windows 实际进程独占测试未跳过。正式 runtime 未启动/升级，未调用 AI API。执行证据保存在本工作区的 `.superpowers/sdd/2026-10-05-web-ai-planning/`，后续先等待用户确认 Task3。

## Task 3: Windows Key 加密与脱敏设置仓库

**Files:** Create `src/platform/dpapi.mjs`, `src/platform/dpapi.ps1`, `src/ai/provider-config.mjs`, `src/storage/ai-settings-store.mjs`, `tests/dpapi.test.mjs`, `tests/ai-settings.test.mjs`。

**Interfaces:**
- `createDpapiProtector() -> {protect(plain):Promise<string>,unprotect(cipher):Promise<string>}`；固定 CurrentUser，固定脚本，通过标准输入传 JSON；不得把正文塞进 argv／env，失败固定错误码 `AI_CREDENTIALS_UNAVAILABLE`。
- `validateProviderConfig(provider,config,previous) -> {model,endpoint,keyAction,apiKey?}`；model 非空≤200 字，禁止控制字符；密钥 replace 必须非空≤4096 字且无控制字符，不截断；首次配置不能 retain 不存在的 Key。地址合法性由任务 4 的 endpoint 规则最终发送前复验。
- `createAiSettingsStore(database,{protector,isJobActive}) -> {getPublic(),update(command):Promise<PublicSettings>,resolveCredentials(provider,expectedRevision):Promise<{model,endpoint,modelKey,searchKey}>}`。resolveCredentials 只被任务服务调用，禁止 HTTP 直接暴露。

- [x] 写失败测试：假 Key 加密字节中无原文，同用户另起 helper 解密；不存在支持则报错而非明文；错误密文不被 retain／失败 replace 擦除，显式 replace 或 delete 可恢复。GET 不含 Key／密文／片段；空留存、明确删、复用智谱搜索、删除复用者状态失效、主机变更无新 Key 拒绝、旧 revision 冲突、活动任务所有设置变更拒绝。模拟日志／进程调用捕获不到假 Key。

  ```js
  test('CurrentUser fake key survives a separate protector instance', async () => {
    const cipher = await createDpapiProtector().protect('FAKE-QA-KEY-ONLY');
    assert.equal(cipher.includes('FAKE-QA-KEY-ONLY'), false);
    assert.equal(await createDpapiProtector().unprotect(cipher), 'FAKE-QA-KEY-ONLY');
  });
  ```
- [x] RED：`node --test tests/dpapi.test.mjs tests/ai-settings.test.mjs`。
- [x] 实现；加密在事务外等待，提交前事务内再次检查 revision 和活动任务，避免等待期间生成启动。输入清空由网页任务完成，服务不声称已验证权限；decryption failure 不改已有密文。
- [x] GREEN：同一命令 0 failures；`npm test` 无新增失败。独立 Windows DPAPI 测试要真实加解密假 Key，不只 mock。
- [x] `git diff --check`，提交本任务 Files：`feat: store masked AI settings with Windows user encryption`。

2026-10-05 Task3 验证检查点：设置/DPAPI 39 项通过，包含 Windows 真加解密假 Key 与数据库重开；全量 186 项，185 通过、0 失败、1 个原有文件软链接权限跳过。未接入设置页、HTTP AI 接口或真实平台调用，正式数据未修改；等待用户确认 Task4。

## Task 4: 安全 HTTPS 传输与智谱独立搜索

**Files:** Create `src/ai/provider-registry.mjs`, `src/ai/https-transport.mjs`, `src/ai/zhipu-search.mjs`, `tests/ai-transport.test.mjs`, `tests/ai-search.test.mjs`；Modify `src/ai/provider-config.mjs` 以共用 registry 地址校验。

**Interfaces:**
- `validateEndpoint(provider,url,kind='model') -> URL`：完整地址的 HTTPS host/path 白名单；搜索固定 `https://open.bigmodel.cn/api/paas/v4/web_search`。
- `createHttpsTransport({lookup,requestImpl}={}) -> {postJson({provider,kind,url,headers,body,timeoutMs,maxBytes=1048576,signal}):Promise<object>}`；生产依赖 node:dns/promises 和 node:https，测试注入模拟网络，禁止真实网络。
- `createZhipuSearch({transport,now}) -> {search({query,key,priorSources,signal}):Promise<Source[]>}`，使用任务 1 来源接口；一次调用最多一次 POST，不重试。

- [x] 写失败测试：HTTPS 之外、userinfo、fragment、query、异常端口、官方域名后缀伪造、path 编码绕过都拒绝；纯公网 DNS 通过，127/10/172.16/192.168、link-local、IPv6 回环、IPv4-mapped 内网、任一混合私网结果拒绝。连接必须使用被校验 IP，TLS servername 仍原主机；30x 抛错误且第二主机收到 0 Key／0 请求。超过 1 MiB、30 秒超时、非 JSON、外部含假 Key 的错误，返回的安全错误不能带原文。
- [x] 写搜索失败测试：完整路径和 Bearer、`search_std/false/5/medium` 精确匹配，query 不超过 70 字；失效 Key、1703／空结果均失败；检索时间与 publish_date 分开；摘要限长、URL 去重／清洗；原响应 icon/media 不自动下载。

  ```js
  test('MiMo host suffix spoof is not an official endpoint', () => {
    assert.throws(() => validateEndpoint('mimo',
      'https://api.xiaomimimo.com.attacker.invalid/v1/chat/completions'),
      e => e.code === 'VALIDATION');
  });
  ```
- [x] RED：`node --test tests/ai-transport.test.mjs tests/ai-search.test.mjs`。
- [x] 实现 registry 精确 host/path（官方资料核实后才增加）。禁止 socket 再自行解析未经校验地址；遍历 DNS 结果拒绝私有／保留地址，明确只连接已核验公网 IP；总超时包含 DNS 和读取。`postJson` 禁止 retry 和 redirect，失败仅归类鉴权／限流／超时／响应／网络，不保存原始响应。
- [x] GREEN＋回归：`node --test tests/ai-transport.test.mjs tests/ai-search.test.mjs tests/ai-settings.test.mjs`，0 failures。
- [x] `git diff --check`，提交本任务 Files：`feat: add guarded HTTPS transport and independent Zhipu search`。

2026-10-05 Task4 验证检查点：专项加设置回归 125/125 通过；全量 277 项，276 通过、0 失败、1 个原有 Windows 文件软链接权限跳过。全部网络为模拟 DNS/HTTPS，未用真实 Key，未调用付费接口，未接页面或重启正式网站。仅完成安全传输和独立搜索底层，等待用户确认 Task5。

## Task 5: 五平台模型适配与单次 JSON 攻略生成

**Files:** Create `src/ai/model-adapters.mjs`, `src/ai/planning-prompt.mjs`, `tests/ai-models.test.mjs`, `docs/ai-provider-contracts.md`；Modify `src/ai/provider-registry.mjs`。

**Interfaces:**
- `buildPlanningMessages(request:AiRequest,sources:Source[]) -> [{role:'system',content},{role:'user',content}]`；资料作为分隔后的 JSON 数据，不引用其他行程；不包含 Key 或工具定义。
- `createModelAdapters({transport}) -> {generate({provider,model,endpoint,key,request,sources,signal}):Promise<{content:string,usage:object|null}>}`。不同平台配置对应合法 token 参数；只读 `choices[0].message.content`，非正常完成、工具输出或空正文拒绝，不把 reasoning_content 当攻略。

- [x] 只读核对设计 §9 的五个平台最新官方接口，写 `docs/ai-provider-contracts.md`，逐个平台记录核对日／URL、完整 path、鉴权、8,192 token 参数、非流式响应、已确认文本模型及是否明确禁用思考；无准确契约的一个平台停止其适配，不以其他四个平台通过宣告五平台完成。MiMo 的缺口已于 2026-10-05 从官方中文完整 Chat 文档核实：`https://api.xiaomimimo.com/v1/chat/completions`、`api-key`、`max_completion_tokens`、`stream=false`、`thinking.type=disabled`；重新核对后写入 fixture。Qwen 将官方地域／业务空间主机与 path 一起校验。
- [x] 写失败测试，五个平台 parameterized captures 断言：精确目的地、独立 Key、平台正确鉴权和 token 上限 8192、无 tools／搜索工具、只一次 request、用户自填 model 原样传递、stream false。MiMo 不盲用另一个平台的 max_tokens。Key 401／429、finish_reason=length/tool_calls/content_filter、无 choices／正文、非法 JSON 均不给第二次修复或回退调用；恶意搜索摘要只位于 user 数据，不变成 system 内容。normalizePlanContent 对真实内容的校验在任务 6 完成。

  ```js
  test('MiMo sends one capped nonstream request with its own header', async () => {
    const calls = [];
    const models = createModelAdapters({transport:{async postJson(c) {
      calls.push(c); return {choices:[{finish_reason:'stop',message:{content:'{}'}}]};
    }}});
    await models.generate({provider:'mimo',model:'mimo-v2.6-flash',
      endpoint:'https://api.xiaomimimo.com/v1/chat/completions',key:'FAKE',
      request:normalizeAiInput(aiInput(),getCityByCode),sources:sources()});
    assert.equal(calls.length,1);
    assert.equal(calls[0].headers['api-key'],'FAKE');
    assert.equal(calls[0].body.max_completion_tokens,8192);
    assert.equal(calls[0].body.stream,false);
    assert.equal(calls[0].body.tools,undefined);
  });
  ```
- [x] RED：`node --test tests/ai-models.test.mjs`。
- [x] 实现适配和固定 JSON schema 提示，明确信息不足可写保守建议、不能伪造引用；不承诺平台强制 JSON 支持，未核实的 response_format／temperature 参数不添加。每平台契约决定参数，使用同一 HTTPS 防护。usage 只提取有界数值摘要，缺失不伪造费用；自填非兼容模型报清晰错误。
- [x] GREEN：`node --test tests/ai-models.test.mjs tests/ai-domain.test.mjs tests/ai-transport.test.mjs`，每平台模拟协议结果分别记录。
- [x] `git diff --check`，提交本任务 Files：`feat: adapt five selectable text models for travel planning`；禁止在此任务要求聊天里提供 Key 或实发付费请求。

2026-10-05 Task5 验证检查点：五平台模型专项 55 项，结合领域/传输回归 211/211 通过；全量 332 项，331 通过、0 失败、1 个原有 Windows 文件软链接权限跳过。官方契约已写入 `docs/ai-provider-contracts.md`，Kimi 使用当前 `max_completion_tokens`，千问按已核实型号区分新旧字段。不使用真实 Key 或付费调用，不接 UI/任务运行；等待用户确认 Task6。

## Task 6: 持久化任务、调用预约与刷新／重启恢复

**Files:** Create `src/storage/ai-job-store.mjs`, `src/storage/ai-plan-store.mjs`, `src/services/ai-job-service.mjs`, `tests/helpers/ai-context.mjs`, `tests/ai-jobs.test.mjs`, `tests/ai-plan-store.test.mjs`。

**Interfaces:**
- `createAiJobStore(database,{now,createId}) -> {get(id),list(),findOperation(operationId),active(),create(command,requestHash,configSnapshot),reserveSearch(id),reserveModel(id),recordSources(id,sources),finish(id,planId),fail(id,error),interruptActive()}`；所有状态变更事务内比较当前状态。
- `createAiPlanStore(database,{now,createId}) -> {get(id),list(),insertGenerated({content,sources,provider,model}),update(id,{expectedRevision,content}),getConversion(id)}`；insertGenerated 初始 revision=1，原快照不可变。
- `createAiJobService({database,settingsStore,jobStore,planStore,search,models,resolveCity,runLater=queueMicrotask}) -> {submit(command):Promise<Job>,get(id),list(),recover(),settled():Promise<void>,shutdown():Promise<void>}`。submit 先检 operationId 回执，其次检查配置／领域规则并创建；后台只使用被接受的配置版本；runLater 可注入测试调度器。
- 测试 `makeAiContext(t,{searchImpl,modelImpl,runLater}={}) -> Promise<{dir,path,jobs,jobStore,settingsStore,planStore,database,networkCalls}>`：独立临时库、假保护器、默认假 Key、正确 fixtures；networkCalls 为 `{search:number,model:number}`。此 helper 没有生产传输或真实联网路径；t.after 先 await jobs.shutdown，再关库和清理已确认在临时目录内的文件。

- [ ] 写失败测试：1／2／3 城成功请求分别为 n＋1；第三搜索失败为 3＋0；第一空结果 1＋0；模型失败 n＋1 且无攻略；预约成功后 socket 失败仍计数、不重发；同操作重复且设置之后改变返回同一 id，不解密新 Key；同 id 异内容 409，两不同操作并发只有一个进入 search；settings update 加密等待期间提交任务仍使设置提交冲突。
- [ ] 写故障失败测试：task 状态和 sources 重开后可读；重启把 queued/searching/generating 标 interrupted 并发起 0 外部调用；原始 JSON 拒绝、未知 sourceId、日期缺失不成功；攻略插入和任务 succeeded 原子，写失败回滚后保留失败任务及输入，不能消失；任务互斥／预约持久化失败必须在联网前停止。

  ```js
  test('same accepted operation performs two searches and one generation only', async t => {
    const c = await makeAiContext(t);
    const command = {operationId:'op-1',settingsRevision:c.settingsStore.getPublic().revision,
      provider:'deepseek',input:aiInput({cityCount:2})};
    const first = await c.jobs.submit(command); await c.jobs.settled();
    assert.equal((await c.jobs.submit(command)).id,first.id);
    assert.deepEqual(c.networkCalls,{search:2,model:1});
    assert.equal(c.jobs.get(first.id).state,'succeeded');
  });
  ```
- [ ] RED：`node --test tests/ai-jobs.test.mjs tests/ai-plan-store.test.mjs`。
- [ ] 实现短事务、网络等待在外；settings 在最终提交任务时再次 revision 校验。reserve* 在调用前计数，超过上限拒绝；search 顺序每城一词，绝不模型生成搜索词。成功 JSON 解析后用任务 1 校验。shutdown 中止传输，等待任务状态落盘，禁止自动恢复 paid workflow。
- [ ] GREEN＋回归：`node --test tests/ai-jobs.test.mjs tests/ai-plan-store.test.mjs tests/ai-settings.test.mjs tests/ai-models.test.mjs`；注入 transport 捕获数而不是靠 UI 按钮禁用证明次数。
- [ ] `git diff --check`，提交本任务 Files：`feat: persist bounded AI jobs without automatic paid retries`。

## Task 7: 攻略人工编辑、幂等转换和删除生命周期

**Files:** Create `src/services/ai-plan-service.mjs`, `src/storage/ai-conversion-store.mjs`, `tests/ai-conversion.test.mjs`；Modify `src/storage/ai-plan-store.mjs`, `src/services/travel-service.mjs`, `tests/helpers/ai-context.mjs`。

**Interfaces:**
- `createAiPlanService({database,planStore,conversionStore,tripStore,resolveCity,now,createId}) -> {list(),get(id),update(id,{expectedRevision,content}),convert(id,{expectedRevision}),forTrip(tripId)}`；forTrip 返回冻结的 Conversion 或 null。
- `createAiConversionStore(database) -> {getByPlan(planId),getByTrip(tripId),insert(conversion),markDeleted(tripId)}`。`travelService.deleteTrip` 同事务调用 markDeleted，但不把完整 guide 挂到所有 trip 列表对象。
- 扩展 makeAiContext 返回 `plans`（此计划服务）和 `travel`（原行程服务）；其余字段及模拟网络不变。

- [ ] 写失败测试：人工编辑无任何外部调用、revision递增，旧标签 409，original/sources 不变；城市目录变化后历史 get 不被最新目录擦除，新 update 拒绝未知城市。首次转换新 trip revision1，与当前 new 草稿、已有 trip 无交叉写；第二次转换／保存响应丢失返回同 trip；转换后改攻略仅改攻略，正式 trip／snapshot 不变；删 trip 后 repeat convert status=deleted、总 trips=0，plan 仍存在。事务中模拟关联 insert 或删除标记失败必须全部回滚。

  ```js
  test('repeated conversion after deletion never resurrects a trip', async t => {
    const c = await makeAiContext(t), request = normalizeAiInput(aiInput(),getCityByCode);
    const plan = c.planStore.insertGenerated({content:planContent(request),sources:sources(),
      provider:'deepseek',model:'fixture-model'});
    const conversion = c.plans.convert(plan.id,{expectedRevision:1});
    assert.equal(c.plans.convert(plan.id,{expectedRevision:1}).tripId,conversion.tripId);
    c.travel.deleteTrip(conversion.tripId,1);
    assert.equal(c.plans.convert(plan.id,{expectedRevision:1}).status,'deleted');
    assert.equal(c.travel.listTrips().length,0);
    assert.equal(c.plans.get(plan.id).id,plan.id);
  });
  ```
- [ ] RED：`node --test tests/ai-conversion.test.mjs`。
- [ ] 实现：首次转换在事务内先验证 plan revision，然后 `tripStore.put(newId,content.trip,{expectedRevision:0,now})`、保存关联快照／回执；已有转换先返回原回执，不被新 revision 引出第二次创建。trip id 使用服务端随机 UUID，冲突时失败不覆盖。读取历史快照用保存名称，不重新生成当前目录名称；新写校验用最新目录。
- [ ] GREEN＋回归：`node --test tests/ai-conversion.test.mjs tests/ai-plan-store.test.mjs tests/travel-service.test.mjs tests/storage.test.mjs`。
- [ ] `git diff --check`，提交本任务 Files：`feat: edit saved AI guides and convert them into one new trip`。

## Task 8: 本机异步 API 与现有服务接线

**Files:** Create `src/server/ai-api-router.mjs`, `tests/ai-http.test.mjs`；Modify `src/server/http-app.mjs`, `src/start.mjs`, `src/server/static-files.mjs`。

**Interfaces:**
- `routeAiApi({settings,jobs,plans},method,path,body) -> Promise<{status,data}>`，精确实现规格 §7 路由；未知路由返回 404。
- `createHttpApp` 增加可选 `ai` 服务；已有 routeApi 的 sync 200 不变，AI route await 返回 status，接受异步 reject。POST jobs 202；增加只读 `GET /api/ai/trips/:tripId/guide` 给详情读取转换快照，不动原 trip 响应结构。
- `startServer` 可接 `aiFactory` 测试依赖，默认组装生产保护器和适配；API 测试注入 mock transport，默认测试不能意外联网。lock 丢失或 close 时先 jobs.shutdown 再 DB close 和 lock.release。

- [ ] 写失败 HTTP 测试：所有设置／jobs／plans／convert 方法、202 polling、422 fields、409、404、503安全消息；POST 已提交但响应丢失、设置改变后重发同 command 返回同任务且 paid captures 不增长；GET 全部路径无 paid capture；正在生成时 overview／trips 立即响应。Key、密文、外部原始错误、数据库／backup／ps1 均不能经静态或 API 输出；不合 Host／Origin、穿越、>64 KiB 仍拒绝。

  该测试先用 makeAiContext 的独立 DB 建立带 aiFactory 的端口0服务；服务用 finally 先关闭，再让 helper 的 t.after 清理文件，不能访问正式数据库：

  ```js
  test('readonly local AI endpoints never invoke a provider', async t => {
    const c = await makeAiContext(t);
    const running = await startServer({dbPath:c.path,port:0,
      aiFactory:() => ({settings:c.settingsStore,jobs:c.jobs,plans:c.plans})});
    try {
      const response = await fetch(running.url+'/api/ai/settings');
      assert.equal(response.status,200);
      assert.equal(JSON.stringify(await response.json()).includes('apiKey'),false);
      assert.deepEqual(c.networkCalls,{search:0,model:0});
    } finally { await running.close(); }
  });
  ```
- [ ] RED：`node --test tests/ai-http.test.mjs`。
- [ ] 实现完整路由与异步错误边界；错误白名单映射 AI_* 为受控 503，不把 error.message／cause 无条件透传。静态 whitelist 只在任务 9 加入实际前端模块，不扩大目录暴露。
- [ ] GREEN＋回归：`node --test tests/ai-http.test.mjs tests/http.test.mjs`；`npm test`，0 failures，逐项解释已有跳过项。
- [ ] `git diff --check`，提交本任务 Files：`feat: expose secure local AI planning APIs`。

## Task 9: 设置、规划、攻略页面和真实浏览器验收

**Files:** Create `src/web/ai-controller.mjs`, `src/web/ai-views.mjs`, `src/web/ai-plan-editor.mjs`, `tests/web-ai.test.mjs`, `scripts/start-ai-qa.mjs`, `docs/web-ai-acceptance.md`；Modify `src/web/api-client.mjs`, `src/web/app.mjs`, `src/web/router.mjs`, `src/web/index.html`, `src/web/styles.css`, `src/server/static-files.mjs`, `README.md`。

**Interfaces:**
- API client 添加 `aiSettings/saveAiSettings/aiJobs/aiJob/startAiJob/aiPlans/aiPlan/updateAiPlan/convertAiPlan/tripGuide`，与任务 8 methods／body 一致。
- 路由 `#/ai/settings`、`#/ai/new`、`#/ai/jobs/:id`、`#/ai/plans`、`#/ai/plans/:id`、`#/ai/plans/:id/edit`；对应 route types ai-settings／ai-new／ai-job／ai-plans／ai-plan／ai-plan-edit。
- `createAiController({api,render,navigate,confirm,clock,createId}) -> {load(route),submit({settingsRevision,provider,input}),retrySubmit(),poll(),dispose()}`；仅在显式 submit 产生 stable operationId 并组装 JobCommand，不随 render／poll 生成；请求不确定时冻结原 command，仅用同命令恢复任务，禁止改输入造成重复收费。
- `createAiPlanEditor({api,plan,render,navigate,confirm}) -> {change(path,value),save(),leave(),snapshot(),dispose()}`；人工编辑不自动 AI；离开未保存提醒，字段错保留、revision conflict不覆盖。
- `renderAiView(root,state,actions)`／`renderAiEditor(root,state,actions)` 用 textContent 和 DOM，不执行任何模型 HTML。

- [ ] 写失败页面状态测试：平台／模型可选，retain空框／保存后清空、搜索复用状态、明确 Key 删除；发起前实际主机和成本披露；operationId 不确定响应同命令重试，dirty input 不被 polling 抹掉；poll 每2秒只GET、离页停止，无伪百分比；失败保留输入，新生成需明确动作／新id；旧路由慢响应不覆盖新页面。手工编辑仅PUT、冲突保留，转换确认取消0调用、确认返回trip，已删除明确展示。恶意 `<script>` 标题和 javascript 来源不执行／不链接，合法链接 noopener noreferrer；首次字段错误聚焦，键盘可达。

  ```js
  test('AI routes are distinct from existing trip editor routes', () => {
    assert.deepEqual(parseRoute('#/ai/settings'),{type:'ai-settings'});
    assert.deepEqual(parseRoute('#/ai/plans/plan-1/edit'),{type:'ai-plan-edit',id:'plan-1'});
    assert.deepEqual(parseRoute('#/trips/trip-1/edit'),{type:'edit',id:'trip-1'});
  });
  ```
- [ ] RED：`node --test tests/web-ai.test.mjs`。
- [ ] 实现暖色页面和两个导航入口“AI 攻略／模型设置”。日程编辑逐日可增删 ≤5 活动和来源编号选择，原快照／资料区不可编辑。首页不再说“AI 尚未实现”；行程详情关联入口从 tripGuide 获取，区分冻结快照与当前原攻略。页面空状态不伪造攻略；设置提交后失败也清掉 Key 框并提示重输，不回填秘密。
- [ ] GREEN＋回归：`node --test tests/web-ai.test.mjs tests/web-form.test.mjs tests/web-navigation.test.mjs`；`npm test`；`git diff --check`，记录实际输出，不能只引用早期测试数。
- [ ] 实现仅作验收的 `scripts/start-ai-qa.mjs`，固定注入 mock 搜索／模型、使用测试 fixtures，无真实传输 fallback；禁止指定默认 `runtime/travel.sqlite`。运行 `node scripts/start-ai-qa.mjs --port 3211 --db runtime/qa-ai.sqlite`，不覆盖或连接正式库；假的 Key 仍可经过真实 DPAPI 验证设置流程。QA 启动说明醒目标记模拟模式，生产 `npm start` 不载入此脚本。
- [ ] 浏览器走设置→生成→来源→重启恢复→编辑→转换→删除后旧转换；检查桌面、390px、键盘／焦点、失败刷新和版本冲突。不得把“取消付费网络”当作 mock；QA 服务必须根本没有真实外部传输。截图存被忽略的 `runtime/qa-screenshots/`，不能含 Key。按 computer-use 技能操作，受原生弹窗阻挡时请用户解除，不伪造测试通过。
- [ ] 收敛第一部分浏览器欠项：取消删除、键盘焦点、真实本机请求失败重试、修复后的编辑交互。未解除阻挡的项在验收文档继续列待验，不自动写“所有功能完成”。本期如需修改旧页面，只做影响此次验收的明确缺陷，先补失败测试，不顺带大改UI。
- [ ] 更新 README 和 docs/web-ai-acceptance，记录五个平台的“官方契约／模拟协议／真实联调”三种证据及限制、DPAPI换账户需重填、迁移备份位置、恢复任务规则。真实 paid smoke 单独请求用户同意，没同意不调用；没 Key 标未验证。
- [ ] `git diff --check`，提交本任务 Files：`feat: add warm AI planning pages and acceptance records`。

## 检查点、评审与交接

任务 1～9 顺序执行；任务内部只完成最小可验证变更，每次 Green 后提交。若额度或会话不足，保存任务状态、最后命令及未完成项，不把半成品勉强合入，不自动继续下一产品阶段；不用每个小测试都重新向用户问同一问题。

Native 执行方案建议：本会话逐项实现，最后一次完整分支独立评审；评审发现的重要缺陷使用同一修复者收敛后运行回归。子代理逐任务方案只在用户选择时采用，不能为本计划自查派代理。实现前仍须计划批准及执行方式选择。

最终完整验证 `npm test`、`git diff --check`、全部实际浏览器项和契约覆盖；测试数量以新运行输出为准。安全检查明确关注 Key／header泄露、调用预算、数据升级和转换幂等；模拟成功不替代真实API成功。未完成的视觉或真实平台验证如实列出。保持分支，不擅自 merge／push／清理 worktree；是否集成由用户在完成后决定。

## 自查与技术依据

覆盖矩阵：规格 §1～2 页面／流程→任务1、3、6、7、9；§3 适配与边界→任务4、5、8；§4凭据→任务3、4、8、9；§5检索验证→任务1、4、5、6；§6迁移／幂等→任务2、6、7；§7API→任务8；§8验收→各任务RED/GREEN及任务9；§9核对→任务5。本计划无产品代码，所有实施框待执行。

- [Node.js v25.9.0 SQLite backup](https://nodejs.org/download/release/v25.9.0/docs/api/sqlite.html#sqlitebackupsourcedb-path-options)：该固定版本已有异步一致备份接口，迁移后保留同步领域仓库；核对于2026-10-05。
- [MiMo 官方完整 Chat 文档](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)：今天已能读取地址、鉴权、token 参数、非流式完成状态和响应正文；纠正设计日“动态正文未取得”的研究状态，不宣称已经真实接入。
- 其余平台及 Windows DPAPI 的官方依据沿用已确认规格 §9，任务5实施前核对必要契约，不使用第三方转载替代。
