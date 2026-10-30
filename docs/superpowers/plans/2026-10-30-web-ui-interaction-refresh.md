# 智游足迹全站 UI／交互统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有本地旅行网站统一为已确认的“纸上旅程”年鉴视觉，并以无依赖原生 CSS／JavaScript 实现克制的 React Bits 风格导航、表面、计数、步骤条和淡入交互。

**Architecture:** 保留现有 hash 路由、控制器、服务端和 SQLite；新增共享 UI 元素模块与可销毁的 UI 交互运行时，视图仍由现有原生 DOM 渲染函数产生。全局设计令牌和页面规则继续由本地 CSS 管理，图标与水墨装饰全部同源静态提供，不增加 React、GSAP、WebGL、构建器或 CDN。

**Tech Stack:** Node.js v25.9.0、原生 HTML/CSS/JavaScript ES modules、`node:test`、现有假 DOM 测试、Codex 内置 Chromium 浏览器、SQLite 隔离 QA 数据库。

**Spec:** `docs/superpowers/specs/2026-10-30-web-ui-interaction-refresh-design.md`

## Global Constraints

- 不改变微信小程序、SQLite 模式、API、AI／地图外部调用次数、备份规则或旅行档案内容模型。
- 不增加 React、GSAP、WebGL、CSS 框架、构建器、远程字体、CDN 或其他运行时依赖。
- 正文保持 15–16px，说明文字最低 13px；按钮最小高度 44px；页面在 390px 与 200% 缩放时不得产生页面级横向滚动。
- 当前 Windows Codex 内置浏览器、当前稳定版 Chrome 与 Edge 是正式支持矩阵；不得宣称 Firefox／Safari 已完整验证。
- 页头最多一个主按钮；每个独立操作分组最多一个实心主按钮；花销仍只从概览摘要或具体行程进入。
- `prefers-reduced-motion: reduce` 和粗指针关闭邻近位移、聚光跟随、滚动数字与位移动画，不做性能 API／帧率探测。
- 所有动态最终值必须存在于 DOM 文本；活动状态、错误和禁用状态不能只依赖颜色或悬停。
- 屏幕版可以使用本地水墨装饰；打印版必须隐藏导航、交互层和装饰，继续使用现有 A4 分页规则。
- 每任务执行完整 RED→GREEN→相关回归→`git diff --check`→提交；正式 `runtime/travel.sqlite` 不得用于破坏性验收。

## Review Focus

- 重复路由渲染或 `refresh()` 不得累积监听器、重复包装 DOM 或让旧路由回调继续修改页面；Task 2 的幂等／`dispose()` 测试固定此边界。
- 390px 下长行程名、长备注、完整日期和多操作按钮不得重叠或横向溢出；Task 6 的布局守卫与实际浏览器截图固定此边界。
- 移动“更多”抽屉必须支持 Escape、焦点圈定与焦点返回，并且花销不被误做全局入口；Task 2 的键盘导航测试固定此边界。
- 减少动态效果或粗指针时，所有内容立即可见且功能不依赖 pointermove；Task 2 的媒体查询测试固定此边界。
- 打印旅行档案不得出现侧栏、底部导航、Spotlight 属性、水墨资产或路由入场状态；Task 6 的打印静态测试固定此边界。

---

### Task 1: 共享视觉基础、本地图标与装饰资产

**Files:**
- Create: `src/web/ui-elements.mjs`
- Create: `src/web/icons.svg`
- Create: `src/web/travel-wash.png`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `tests/web-ui.test.mjs`
- Modify: `src/web/views.mjs`
- Modify: `src/web/styles.css`
- Modify: `src/server/static-files.mjs`
- Modify: `tests/project.test.mjs`

**Interfaces:**
- Consumes: existing `document.createElement`, current `el()` and `button()` call shapes, same-origin `/web/*` static boundary.
- Produces: `el(tag, attributes = {}, ...children)`, `icon(name, {label = null, className = ''} = {})`, `button(text, action, kind = 'primary', attributes = {})`, `pageHeader({eyebrow, title, primaryAction = null, secondaryActions = []})`, and `statusBadge(text, tone = 'neutral')` from `ui-elements.mjs`; CSS tokens `--paper`, `--porcelain`, `--ink`, `--muted`, `--terracotta`, `--moss`, `--brass`, `--danger`, `--line`, `--focus`, `--radius-sm`, `--radius-md`, `--motion-fast`, and `--motion-base`.

- [ ] **Step 1: Establish the clean baseline**

Run: `npm test`

Expected: 585 tests, 584 pass, 0 fail, and only the existing Windows file-symlink permission skip. Record any count drift before editing.

- [ ] **Step 2: Write failing shared-element and static-boundary tests**

In `tests/web-ui.test.mjs`, add `shared UI elements expose stable button, icon, header and badge semantics` asserting:

```js
const save=button('保存',()=>{},'primary',{'aria-describedby':'save-help'});
assert.equal(save.getAttribute('type'),'button');
assert.match(save.className,/button primary/);
assert.equal(save.getAttribute('aria-describedby'),'save-help');
assert.equal(icon('map-pin').getAttribute('aria-hidden'),'true');
assert.equal(icon('shield',{label:'数据安全'}).getAttribute('aria-label'),'数据安全');
assert.equal(statusBadge('已结束','completed').dataset.tone,'completed');
```

In `tests/project.test.mjs`, extend `local startup serves all browser modules but not private project files` to require 200 responses and correct non-JavaScript content types for `/web/ui-elements.mjs`, `/web/icons.svg`, and `/web/travel-wash.png`.

- [ ] **Step 3: Run the focused tests and prove RED**

Run: `node --test tests/web-ui.test.mjs tests/project.test.mjs`

Expected: FAIL because `ui-elements.mjs` and the two assets are absent and the static allowlist does not serve them.

- [ ] **Step 4: Implement the shared UI element module and migrate the existing exports**

Create the exact exports listed in Interfaces. `icon()` must use `<svg><use href="/web/icons.svg#NAME"></use></svg>`; unlabeled icons are `aria-hidden`, labeled icons use `role="img"` and `aria-label`. Make `views.mjs` import and re-export `el` and `button` so untouched modules remain compatible during migration.

- [ ] **Step 5: Add local sourced assets and their legal notice**

Create one SVG sprite from Lucide Icons 1.63.0 containing exactly `home`, `briefcase`, `book-open`, `map-pin`, `settings`, `sparkles`, `sliders-horizontal`, `shield-check`, `more-horizontal`, `plus`, `chevron-left`, `chevron-right`, `calendar`, `users`, `wallet`, `route`, `download`, `upload`, `refresh-cw`, `trash-2`, `x`, and `check`. Record the pinned version, upstream URL, Lucide ISC notice and the Feather MIT notice in `THIRD_PARTY_NOTICES.md`. Generate one transparent, non-city-specific Chinese ink-wash travel header PNG with no words, brands, people or metadata derived from user records; preserve the selected file at `src/web/travel-wash.png`.

- [ ] **Step 6: Replace the root variables with the approved token set**

In `styles.css`, define the produced token names, system Chinese font stack, 15–16px body baseline, numeric alignment, focus ring, 44px control floor, danger/completed states and `prefers-reduced-motion` zero-duration fallback. Do not yet restyle individual pages.

- [ ] **Step 7: Extend the static allowlist and MIME mapping**

Serve `ui-elements.mjs`, `icons.svg`, and `travel-wash.png` from the fixed allowlist. Add explicit `image/png` handling; keep traversal and private-file behavior unchanged.

- [ ] **Step 8: Run GREEN and regression**

Run: `node --test tests/web-ui.test.mjs tests/project.test.mjs`

Expected: PASS.

Run: `npm test` and `git diff --check`

Expected: 0 failures; only the known symlink skip.

- [ ] **Step 9: Commit**

```bash
git add src/web/ui-elements.mjs src/web/icons.svg src/web/travel-wash.png src/web/views.mjs src/web/styles.css src/server/static-files.mjs tests/web-ui.test.mjs tests/project.test.mjs THIRD_PARTY_NOTICES.md
git commit -m "feat: establish unified travel journal design system"
```

### Task 2: 全局框架、移动导航与可销毁交互运行时

**Files:**
- Create: `src/web/ui-runtime.mjs`
- Modify: `src/web/index.html`
- Modify: `src/web/app.mjs`
- Modify: `src/web/styles.css`
- Modify: `src/server/static-files.mjs`
- Modify: `tests/web-ui.test.mjs`
- Modify: `tests/web-navigation.test.mjs`
- Modify: `tests/project.test.mjs`

**Interfaces:**
- Consumes: Task 1 tokens, icons and shared elements; existing `navigationSection(route)`.
- Produces: `createUiRuntime({document, window, root, raf = window.requestAnimationFrame})` returning `{refresh(section), openMore(), closeMore({restoreFocus = true} = {}), dispose()}`. `refresh(section)` sets desktop/mobile `aria-current`, enhances new `[data-spotlight]` and `[data-counter]` nodes exactly once, applies one route-entry class, and focuses the first `h1` only when the route identity changed.

- [ ] **Step 1: Write failing runtime lifecycle tests**

Add these tests to `tests/web-ui.test.mjs`:

- `refresh marks one active destination and never binds an enhanced node twice`.
- `mobile more drawer traps focus closes with Escape and restores the trigger`.
- `skip link focuses content without changing the hash route`.
- `reduced motion and coarse pointer keep content visible without pointer tracking`.
- `dispose removes global listeners and late refresh has no effect`.

Use injected fake `matchMedia`, RAF and event targets; assert listener counts, `aria-current`, `aria-expanded`, `hidden`, focus target and unchanged `location.hash` rather than timing pixels.

- [ ] **Step 2: Extend navigation tests for the mobile information architecture**

In `tests/web-navigation.test.mjs`, assert the shell contains exactly four bottom destinations (`home`, `trips`, `footprints`, `more`); the More drawer contains archive, AI, map settings, model settings and data security; no global expense destination exists.

- [ ] **Step 3: Run focused tests and prove RED**

Run: `node --test tests/web-ui.test.mjs tests/web-navigation.test.mjs tests/project.test.mjs`

Expected: FAIL because `ui-runtime.mjs`, the new shell markup and the new static module are absent.

- [ ] **Step 4: Implement `createUiRuntime`**

Use WeakSets for enhanced nodes and owned listener cleanup. Spotlight updates only CSS variables; Counter retains its final number as text／accessible label; route fade is one class transition. Do not use Canvas, timers longer than `--motion-base`, performance detection or persistent animation loops.

- [ ] **Step 5: Replace the application shell markup**

Update `index.html` with the approved line-sidebar structure, local sprite icons, desktop navigation, four-item bottom navigation, labeled More trigger, hidden modal-like drawer, backdrop and close button. Keep every existing route reachable and preserve the local-only identity copy.

- [ ] **Step 6: Integrate one runtime instance into `app.mjs`**

Create it once during bootstrap; call `refresh(navigationSection(route))` after every renderer／controller render wrapper; call `dispose()` only when the app is torn down. Replace the duplicated direct `.active` toggles with runtime synchronization. Intercept the skip link through the runtime so `#/...` does not become `#content`.

- [ ] **Step 7: Implement responsive shell CSS**

Desktop uses the 248px line sidebar; 720–999px uses 208px; below 720px removes the sidebar, shows bottom navigation and drawer, adds safe bottom padding, and never uses horizontal navigation scrolling. Active state must use node, background and weight, not color alone.

- [ ] **Step 8: Run GREEN and regression**

Run: `node --test tests/web-ui.test.mjs tests/web-navigation.test.mjs tests/project.test.mjs`

Expected: PASS.

Run: `npm test` and `git diff --check`

Expected: 0 failures; no added skip.

- [ ] **Step 9: Commit**

```bash
git add src/web/ui-runtime.mjs src/web/index.html src/web/app.mjs src/web/styles.css src/server/static-files.mjs tests/web-ui.test.mjs tests/web-navigation.test.mjs tests/project.test.mjs
git commit -m "feat: add accessible journal navigation and motion runtime"
```

### Task 3: 共享表单、按钮状态与三步 Stepper

**Files:**
- Modify: `src/web/ui-elements.mjs`
- Modify: `src/web/views.mjs`
- Modify: `src/web/form-controller.mjs`
- Modify: `src/web/ai-plan-editor.mjs`
- Modify: `src/web/ai-views.mjs`
- Modify: `src/web/styles.css`
- Modify: `tests/web-ui.test.mjs`
- Modify: `tests/web-form.test.mjs`
- Modify: `tests/web-ai.test.mjs`

**Interfaces:**
- Consumes: Task 1 `button`, `pageHeader`, `statusBadge`; Task 2 `[data-counter]`, route fade and reduced-motion classes.
- Produces: `stepper({steps, currentStep})`, `fieldMessage({id, text, tone})`, and `actionGroup(...children)` from `ui-elements.mjs`. Step entries are `{id, label, state: 'upcoming'|'current'|'completed'}`.

- [ ] **Step 1: Write failing shared-state and stepper tests**

In `tests/web-ui.test.mjs`, assert current steps have `aria-current="step"`, completed steps include visible completion text, and upcoming steps are not exposed as clickable when the controller cannot navigate to them.

In `tests/web-form.test.mjs`, add `trip form keeps one semantic stepper and distinguishes disabled, busy and destructive actions`; assert the existing three labels, stable field IDs, `aria-describedby` links, and distinct `data-state` values.

In `tests/web-ai.test.mjs`, add `AI settings and plan editor share labeled controls and one primary action per group`; assert every editable input／select／textarea has an accessible label and Key actions remain explicit.

- [ ] **Step 2: Run focused tests and prove RED**

Run: `node --test tests/web-ui.test.mjs tests/web-form.test.mjs tests/web-ai.test.mjs`

Expected: FAIL because the shared stepper／message／action helpers and state attributes do not exist.

- [ ] **Step 3: Add the shared helpers and migrate the trip form**

Implement the exact produced helpers. Replace `.steps` in `renderForm()` with `stepper()` while preserving controller behavior, autosave identity and existing field focus recovery. Add a stable error summary region without moving focus on successful saves.

- [ ] **Step 4: Normalize button and form state CSS**

Define primary, secondary, quiet and danger hierarchy; separate `[disabled]` from `[aria-busy="true"]`; add visible labels/help/error spacing, autofill-safe input colors and obvious disabled route movement buttons. Do not change validation rules.

- [ ] **Step 5: Migrate AI forms without changing paid-call behavior**

Use the shared element helpers for settings, generation and plan editing controls. Keep exact operation IDs, confirmations, call budgets, Key clearing and polling behavior unchanged.

- [ ] **Step 6: Run GREEN and regression**

Run: `node --test tests/web-ui.test.mjs tests/web-form.test.mjs tests/web-ai.test.mjs`

Expected: PASS.

Run: `npm test` and `git diff --check`

Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/web/ui-elements.mjs src/web/views.mjs src/web/form-controller.mjs src/web/ai-plan-editor.mjs src/web/ai-views.mjs src/web/styles.css tests/web-ui.test.mjs tests/web-form.test.mjs tests/web-ai.test.mjs
git commit -m "feat: unify forms steps and action states"
```

### Task 4: 概览、行程详情与花销年鉴化

**Files:**
- Modify: `src/web/views.mjs`
- Modify: `src/web/expense-views.mjs`
- Modify: `src/web/styles.css`
- Modify: `tests/web-navigation.test.mjs`
- Modify: `tests/web-expense.test.mjs`
- Modify: `tests/web-form.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3 shared elements, shell, spotlight and counter attributes.
- Produces: overview／trip／expense DOM with `.journal-section`, `.journal-rule`, `.action-group`, `[data-spotlight]`, and integer-only `[data-counter]` hooks; no new domain data.

- [ ] **Step 1: Write failing page-structure tests**

Add these assertions:

- Home has one primary “新建行程”, one latest-trip narrative, one footprint band and one expense band; empty state never fabricates content.
- Trip detail action group orders export／edit／delete／return by hierarchy, and danger is not styled primary.
- Expense totals, budget state, category／city summaries and records remain complete; long notes stay text, not HTML.
- No global expense navigation is introduced.

- [ ] **Step 2: Run focused tests and prove RED**

Run: `node --test tests/web-navigation.test.mjs tests/web-expense.test.mjs tests/web-form.test.mjs`

Expected: FAIL on the new journal structure and action hierarchy.

- [ ] **Step 3: Recompose the overview and trip views**

Use continuous editorial sections and rules instead of stat-card grids. Keep all current status, date, traveler, budget and route text. Mark only the latest-trip／detail-summary surfaces for Spotlight and only province／city／visit small integers for Counter.

- [ ] **Step 4: Recompose expense views**

Turn total／budget／balance into one summary band; use aligned lightweight lists for categories, cities and records. Preserve every create, edit, delete, category-management and removed-city path.

- [ ] **Step 5: Add desktop and narrow layout rules**

At 390px, use one column, wrap long names／notes, stack action groups and reserve bottom-nav space. No fixed action bar or overlay may cover content.

- [ ] **Step 6: Run GREEN and regression**

Run: `node --test tests/web-navigation.test.mjs tests/web-expense.test.mjs tests/web-form.test.mjs`

Expected: PASS.

Run: `npm test` and `git diff --check`

Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/web/views.mjs src/web/expense-views.mjs src/web/styles.css tests/web-navigation.test.mjs tests/web-expense.test.mjs tests/web-form.test.mjs
git commit -m "feat: redesign trips and expenses as a travel journal"
```

### Task 5: AI、足迹、数据安全与档案入口统一

**Files:**
- Modify: `src/web/ai-views.mjs`
- Modify: `src/web/ai-plan-editor.mjs`
- Modify: `src/web/footprint-views.mjs`
- Modify: `src/web/data-views.mjs`
- Modify: `src/web/archive-views.mjs`
- Modify: `src/web/styles.css`
- Modify: `src/web/footprint-styles.css`
- Modify: `src/web/archive-styles.css`
- Modify: `tests/web-ai.test.mjs`
- Modify: `tests/web-footprint.test.mjs`
- Modify: `tests/web-data.test.mjs`
- Modify: `tests/web-archive.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4 component hierarchy and hooks; existing controllers and API responses unchanged.
- Produces: consistent journal sections and fully labeled controls across the four remaining product areas; print document DOM remains structurally unchanged.

- [ ] **Step 1: Write failing module accessibility and hierarchy tests**

Add named tests proving:

- AI plan／job／source status remains explicit and settings never reveal a Key.
- Footprint map failure keeps the list and all three final count texts; Counter hooks wrap only the numeric text.
- Data safety headings, note input, create／import／download／restore buttons all have accessible names and each operation group has one primary action.
- Archive landing heading and preview link have meaningful names; print rendering contains no UI-runtime hooks or decoration asset.

- [ ] **Step 2: Run focused tests and prove RED**

Run: `node --test tests/web-ai.test.mjs tests/web-footprint.test.mjs tests/web-data.test.mjs tests/web-archive.test.mjs`

Expected: FAIL on shared hierarchy／accessibility attributes while all domain assertions remain unchanged.

- [ ] **Step 3: Restyle AI plans, jobs, sources and settings**

Use yearbook chapters, consistent status badges and grouped provider sections. Retain all source URLs, cautions, original snapshots, task states and controlled errors; no route animation may replay on polling updates.

- [ ] **Step 4: Restyle footprint overview, lists, management and settings**

Keep map container identity stable across rerenders. Make map the primary surface on desktop, retain full list fallback, and use shared timeline language for provinces／cities／visits.

- [ ] **Step 5: Restyle data safety and fix accessible names**

Use a trust note plus separate create/import and backup-record groups. Keep restore visibly dangerous, preserve confirmations and never place disk paths or credentials in DOM labels.

- [ ] **Step 6: Restyle archive landing only and isolate print DOM**

Apply the yearbook cover language to archive entry／preview controls. Do not add Spotlight, Counter, Fade hooks or decorative images under `.archive-document`.

- [ ] **Step 7: Run GREEN and regression**

Run: `node --test tests/web-ai.test.mjs tests/web-footprint.test.mjs tests/web-data.test.mjs tests/web-archive.test.mjs`

Expected: PASS.

Run: `npm test` and `git diff --check`

Expected: 0 failures.

- [ ] **Step 8: Commit**

```bash
git add src/web/ai-views.mjs src/web/ai-plan-editor.mjs src/web/footprint-views.mjs src/web/data-views.mjs src/web/archive-views.mjs src/web/styles.css src/web/footprint-styles.css src/web/archive-styles.css tests/web-ai.test.mjs tests/web-footprint.test.mjs tests/web-data.test.mjs tests/web-archive.test.mjs
git commit -m "feat: unify AI footprints data and archive experiences"
```

### Task 6: 响应式、打印隔离、全站无障碍与最终验收

**Files:**
- Create: `docs/web-ui-acceptance.md`
- Modify: `src/web/styles.css`
- Modify: `src/web/footprint-styles.css`
- Modify: `src/web/archive-styles.css`
- Modify: `src/web/ui-runtime.mjs`
- Modify: `tests/web-ui.test.mjs`
- Modify: `tests/web-navigation.test.mjs`
- Modify: `tests/web-archive.test.mjs`
- Modify: `tests/project.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete UI from Tasks 1–5 and the existing QA launcher／isolated database boundary.
- Produces: final 1440／768／390 responsive behavior, keyboard and reduced-motion evidence, static print isolation and acceptance record.

- [ ] **Step 1: Write failing final guard tests**

Add:

- `narrow layout reserves bottom navigation space and wraps long content` by asserting the 390px media block covers `.workspace`, `main`, `.detail-actions`, `.action-group`, long text and bottom safe padding.
- `print mode removes every interactive and decorative layer` by asserting print selectors hide `.sidebar`, `.mobile-nav`, `.more-drawer`, `.topbar`, `.page-footer`, `[data-spotlight]` effects and `.travel-wash`.
- `route refresh keeps one h1 focus target and no duplicate runtime listeners`.
- `all served modules and assets remain fixed allowlist entries with no remote UI origins`.

- [ ] **Step 2: Run guard tests and prove RED**

Run: `node --test tests/web-ui.test.mjs tests/web-navigation.test.mjs tests/web-archive.test.mjs tests/project.test.mjs`

Expected: FAIL until final responsive／print selectors and runtime focus behavior are complete.

- [ ] **Step 3: Complete the three responsive tiers and print isolation**

Resolve visible overflow and action wrapping at 1440, 768 and 390 without changing domain markup. Ensure 200% zoom remains usable. Print rules must remove every screen-only asset and leave existing A4 breaks intact.

- [ ] **Step 4: Run automated GREEN**

Run: `node --test tests/web-ui.test.mjs tests/web-navigation.test.mjs tests/web-archive.test.mjs tests/project.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: 0 failures and no new skips.

- [ ] **Step 5: Run actual browser acceptance with isolated data**

Start the fixed simulated QA server on a non-production database. Capture and inspect current-run screenshots for:

1. 1440px overview, trip detail, trip form Stepper, AI guide, footprint, data safety and archive landing.
2. 768px sidebar, single-column detail and map/list reflow.
3. 390px bottom navigation, More drawer, long trip name, long expense note and non-overlapping detail actions.
4. Keyboard-only navigation, drawer Escape／focus return, trip three-step progression and form error recovery.
5. Reduced-motion mode with immediate content and no pointer-following visuals.
6. Print preview with A4 content and no shell／decoration.

Do not touch `runtime/travel.sqlite`, use real API Keys, call external AI platforms or claim physical-printer success.

- [ ] **Step 6: Record evidence and operating notes**

Write `docs/web-ui-acceptance.md` with exact URL／port, QA database path, commands, viewport sizes, screenshot names, keyboard／motion results, test totals, known external limits and any deferred cosmetic issues. Update README with the new navigation, motion-reduction behavior and acceptance link.

- [ ] **Step 7: Final verification**

Run: `npm test`

Expected: 0 failures; only the pre-existing Windows file-symlink permission skip is allowed.

Run: `git diff --check`

Expected: exit 0.

Run: `git status --short`

Expected: only Task 6 intended files before commit.

- [ ] **Step 8: Commit**

```bash
git add docs/web-ui-acceptance.md README.md src/web/styles.css src/web/footprint-styles.css src/web/archive-styles.css src/web/ui-runtime.mjs tests/web-ui.test.mjs tests/web-navigation.test.mjs tests/web-archive.test.mjs tests/project.test.mjs
git commit -m "docs: verify unified web journal experience"
```

## Plan Self-Review

- Spec coverage: Tasks 1–6 cover design tokens/assets, shell/navigation, all component families, every route group, print isolation, accessibility, responsiveness and browser evidence; no database／API requirement is assigned a UI mutation.
- Step scan: each task has one RED set, one bounded implementation deliverable, focused GREEN, regression and commit; asset generation is isolated from product data.
- Type consistency: later tasks consume only the exact Task 1 helpers and Task 2 runtime hooks named in their Interfaces sections; `refresh(section)` and `dispose()` keep the same signatures throughout.
- Review Focus: listener lifecycle and motion fallbacks belong to Task 2, narrow overflow and print isolation to Task 6, and each has an explicit test.
- Proportion: implementation bodies are intentionally omitted; tests state required semantics and the engineer retains freedom over internal CSS organization and minimal DOM mechanics.
