# Windows One-Click Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows desktop shortcut that starts 智游足迹 in an isolated Edge app window and safely stops the local server when that window closes.

**Architecture:** A small Node lifecycle module reuses the existing `startServer()` object, spawns Edge with a dedicated profile, waits for that process, and always calls `close()` in `finally`. A hidden PowerShell wrapper supplies the double-click experience, while a separate idempotent installer creates the current user's desktop shortcut.

**Tech Stack:** Node.js 25.9+ ESM, `node:child_process`, Windows PowerShell/WScript Shell, Microsoft Edge app mode, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-02-windows-one-click-launcher-design.md`

## Global Constraints

- Support Windows only; resolve Edge from the three Program Files/LocalAppData candidates, including `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
- Require Node.js 25.9.0 or newer and preserve the existing `npm start` workflow.
- Keep the service on `127.0.0.1`, default port `3210`, and default database `runtime/travel.sqlite`.
- Handle Chinese and spaces in every project, script, profile, database, and shortcut path without shell string interpolation.
- Do not add Electron, Tauri, an installer framework, remote access, login, cloud sync, or new npm dependencies.
- Never log API keys, request bodies, database content, raw dependency errors, or environment dumps.
- Use `runtime/edge-app-profile` for the persistent isolated Edge profile; never add or delete it through Git.
- Use an isolated QA database, port, and Edge profile for acceptance; never start destructive QA against `runtime/travel.sqlite`.

## Review Focus

- Edge/project/profile paths containing spaces and Chinese must be passed as argument-array entries, never concatenated into a shell command; Task 1 tests exact arguments.
- Edge spawn failure after the server starts must close the server exactly once; Task 1 injects a child `error` event.
- Normal window exit, browser crash, abort, and repeated close signals must release the server exactly once; Task 1 exercises every path.
- Missing Node, missing launcher file, or PowerShell parse failure must show a bounded local message and must not start Edge; Task 2 covers preflight and syntax.
- A second instance, occupied port, or database lock error must not kill or modify the existing process; Task 1 verifies start rejection never invokes Edge or forced process termination.

---

### Task 1: Edge application lifecycle owner

**Files:**
- Create: `src/desktop/windows-app-launcher.mjs`
- Create: `tests/windows-app-launcher.test.mjs`

**Interfaces:**
- Consumes: `startServer(options) -> Promise<{url, close()}>` from `src/start.mjs`; injected `spawnImpl(executable,args,options) -> ChildProcess`.
- Produces: `resolveEdgeExecutable({env,existsSync}) -> string`; `buildEdgeArguments({url,profileDirectory}) -> string[]`; `runWindowsApp({startServerImpl,spawnImpl,edgePath,port,dbPath,profileDirectory,signal}) -> Promise<{edgeExitCode:number|null}>`; `DesktopLaunchError` with stable public `code` only.

- [ ] **Step 1: Write failing unit tests for path and argument construction**

  Add tests asserting candidate order, `EDGE_NOT_FOUND`, and exact Edge arguments: `--app=<url>`, one `--user-data-dir=<Chinese path>`, `--no-first-run`, `--disable-background-mode`, and the first-run suppression flag. Assert `shell:false` and no joined command string.

- [ ] **Step 2: Run the path tests to verify RED**

  Run: `node --test tests/windows-app-launcher.test.mjs --test-name-pattern="Edge path|Edge arguments"`

  Expected: FAIL because `src/desktop/windows-app-launcher.mjs` does not exist.

- [ ] **Step 3: Implement path resolution and Edge arguments**

  Implement `resolveEdgeExecutable` and `buildEdgeArguments` with injected filesystem checks and exact values from the spec. Do not inspect the registry or download a browser.

- [ ] **Step 4: Run the path tests to verify GREEN**

  Run: `node --test tests/windows-app-launcher.test.mjs --test-name-pattern="Edge path|Edge arguments"`

  Expected: PASS.

- [ ] **Step 5: Write failing lifecycle tests**

  Add injected fake server/child tests asserting: Edge starts only after `startServerImpl` resolves; normal `exit` closes once; child `error`, nonzero exit, and abort close once; rejected server start never spawns or closes an unrelated process; all listeners settle without hanging.

- [ ] **Step 6: Run lifecycle tests to verify RED**

  Run: `node --test tests/windows-app-launcher.test.mjs --test-name-pattern="lifecycle|failure|abort|second instance"`

  Expected: FAIL because `runWindowsApp` is missing.

- [ ] **Step 7: Implement `runWindowsApp` and `DesktopLaunchError`**

  Start the existing server, spawn the dedicated Edge process, await `error`/`exit`/abort through one settlement path, and call the captured server `close()` in `finally`. Wrap failures into stable codes without carrying raw messages into public output.

- [ ] **Step 8: Run Task 1 tests and focused server regressions**

  Run: `node --test tests/windows-app-launcher.test.mjs tests/database-lock.test.mjs tests/http.test.mjs`

  Expected: PASS with zero failures.

- [ ] **Step 9: Commit Task 1**

  ```powershell
  git add src/desktop/windows-app-launcher.mjs tests/windows-app-launcher.test.mjs
  git commit -m "feat: own server lifecycle from Edge app window"
  ```

### Task 2: Hidden Windows wrapper and desktop shortcut installer

**Files:**
- Create: `scripts/windows-desktop-launcher.mjs`
- Create: `scripts/launch-windows.ps1`
- Create: `scripts/install-desktop-shortcut.ps1`
- Create: `tests/windows-launcher-scripts.test.mjs`

**Interfaces:**
- Consumes: `runWindowsApp()` and `resolveEdgeExecutable()` from Task 1; environment overrides `TRAVEL_PORT`, `TRAVEL_DB_PATH`, and `TRAVEL_EDGE_PROFILE` for isolated QA.
- Produces: `runDesktopEntry({runWindowsAppImpl,env,writeLog,signal}) -> Promise<number>` plus an executable Node entry returning exit code `0` on a normal window close and a nonzero code on bounded failure; hidden PowerShell entry; idempotent current-user desktop shortcut installer.

- [ ] **Step 1: Write failing entry and script contract tests**

  Test `runDesktopEntry` with injected launch/log functions. Assert it derives all default paths from `import.meta.url`, overwrites `runtime/launcher.log` with only timestamp/stage/stable code, honors the three QA environment overrides, maps `EADDRINUSE` and database-lock startup failures to `ALREADY_RUNNING`, and never serializes raw error messages. Assert the PowerShell wrapper checks Node and launcher presence before invocation and the shortcut installer uses WScript Shell with a quoted `-File` argument and the project root as working directory.

- [ ] **Step 2: Add PowerShell parser tests and verify RED**

  Use `System.Management.Automation.Language.Parser.ParseFile` from the test to assert both `.ps1` files have zero syntax errors, including their Chinese absolute-path use case.

  Run: `node --test tests/windows-launcher-scripts.test.mjs`

  Expected: FAIL because the entry and scripts do not exist.

- [ ] **Step 3: Implement the Node entry**

  Add an abort controller for SIGINT/SIGTERM, validate numeric port range, resolve default database/profile paths, create the runtime directory, overwrite the bounded launcher log, invoke Task 1, and set a nonzero `process.exitCode` for stable errors. Log no raw exception text.

- [ ] **Step 4: Implement the hidden PowerShell wrapper**

  Resolve the project from `$PSScriptRoot`, preflight `node.exe` and the Node entry, run it without `Invoke-Expression`, and show one localized WScript popup only for preflight or nonzero exit. The popup points to `runtime/launcher.log` without echoing its contents.

- [ ] **Step 5: Implement the idempotent shortcut installer**

  Create or update `智游足迹.lnk` on the current user's desktop, targeting Windows PowerShell with `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<wrapper>"`; set working directory and Edge icon. Keep profile/log files under the already ignored `runtime/` directory.

- [ ] **Step 6: Run Task 2 and Task 1 tests**

  Run: `node --test tests/windows-launcher-scripts.test.mjs tests/windows-app-launcher.test.mjs`

  Expected: PASS with zero failures and zero PowerShell parse errors.

- [ ] **Step 7: Commit Task 2**

  ```powershell
  git add scripts/windows-desktop-launcher.mjs scripts/launch-windows.ps1 scripts/install-desktop-shortcut.ps1 tests/windows-launcher-scripts.test.mjs
  git commit -m "feat: add hidden Windows desktop launcher"
  ```

### Task 3: Real Edge acceptance, shortcut installation, and documentation

**Files:**
- Modify: `README.md`
- Create: `docs/windows-launcher-acceptance.md`

**Interfaces:**
- Consumes: production scripts from Task 2 and `startServer()` lifecycle from the existing app.
- Produces: installed desktop shortcut outside Git plus reproducible acceptance evidence inside the repository.

- [ ] **Step 1: Run the shortcut installer and inspect the resulting `.lnk`**

  Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1`, then load the shortcut through WScript Shell and assert its target, arguments, working directory, and icon point to the current repository and installed Edge.

- [ ] **Step 2: Perform isolated real-window acceptance**

  Launch with `TRAVEL_PORT=3221`, `TRAVEL_DB_PATH=runtime/qa-windows-launcher.sqlite`, and `TRAVEL_EDGE_PROFILE=runtime/qa-edge-app-profile`. Verify a dedicated Edge app window reaches the overview, no visible console remains, and the QA database—not `runtime/travel.sqlite`—is used.

- [ ] **Step 3: Close the Edge app and verify clean shutdown**

  Close the dedicated app window, poll until `127.0.0.1:3221` refuses connections, confirm no launcher-owned Node process remains, and restart once against the same QA database to prove the database lock was released.

- [ ] **Step 4: Record acceptance and update user instructions**

  Document exact commands, paths, observable results, and any environmental limitation in `docs/windows-launcher-acceptance.md`. Update README startup/stop instructions to lead with the desktop shortcut and retain `npm start` as the maintenance path.

- [ ] **Step 5: Run final verification**

  Run: `npm test`

  Expected: all tests pass except the already documented Windows symlink-permission skip.

  Run: `git diff --check`

  Expected: exit 0.

- [ ] **Step 6: Commit Task 3**

  ```powershell
  git add README.md docs/windows-launcher-acceptance.md
  git commit -m "docs: verify Windows one-click launcher"
  ```

