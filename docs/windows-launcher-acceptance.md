# Windows 一键启动验收记录

验收日期：2026-11-02

## 验收边界

- 系统：Windows，Windows PowerShell 5.1，Node.js 25.9.0。
- 浏览器：本机 Microsoft Edge，路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。
- 项目：隔离分支工作区，不修改微信小程序。
- 端口：`3221`，不是正式默认端口 `3210`。
- 数据库：`runtime/qa-windows-launcher.sqlite`。
- Edge 配置：`runtime/qa-edge-app-profile`，与日常 Edge 配置隔离。
- 正式数据库 `runtime/travel.sqlite` 在验收前后都不存在，未被创建或读取。

## 自动化证据

`tests/windows-app-launcher.test.mjs` 覆盖：

- 三个 Edge 安装候选路径和 `EDGE_NOT_FOUND`。
- 含中文和空格的配置目录作为单独参数传递，`shell:false`。
- 服务器完全启动后才打开 Edge。
- 正常退出、非零退出、启动失败和中止均只关闭服务一次。
- 第二实例或数据库锁冲突不启动 Edge，也不结束其他进程。

`tests/windows-launcher-scripts.test.mjs` 覆盖：

- 默认端口、数据库和 Edge 配置目录。
- 三个 QA 环境变量覆盖。
- 无效端口、端口占用、数据库占用和脱敏日志。
- Windows PowerShell 5.1 对两个 UTF-8 BOM 脚本的实际语法解析。
- 找不到 Node 时的预检退出。
- 在含中文和空格的临时路径中连续两次创建同一快捷方式，并通过 WScript Shell 读取目标、参数、工作目录和图标。

Task 2 完成时专项测试 17/17 通过；当时完整回归 643 项，642 通过、0 失败、1 项因当前 Windows 账户不能创建文件符号链接而跳过。

## 快捷方式验收

为避免把用户桌面图标指向合并后会删除的临时 worktree，本轮在 ignored 的 QA 目录创建并读取：

`runtime/qa-shortcut/智游足迹.lnk`

实际读取结果：

- Target：`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
- Arguments：`-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<项目>\scripts\launch-windows.ps1"`
- WorkingDirectory：当前项目根目录。
- IconLocation：已安装的 Edge `msedge.exe,0`。

安装脚本可重复运行，更新同名快捷方式而不产生重复文件。正式桌面快捷方式应在功能合并到稳定主目录后从 `main` 运行安装脚本创建。

## 真实 Edge 生命周期验收

以以下隔离变量运行真实包装器：

```powershell
$env:TRAVEL_PORT='3221'
$env:TRAVEL_DB_PATH='runtime/qa-windows-launcher.sqlite'
$env:TRAVEL_EDGE_PROFILE='runtime/qa-edge-app-profile'
& '.\scripts\launch-windows.ps1' -NoPopup
```

第一轮实际结果：

- `http://127.0.0.1:3221/` 返回 HTTP 200。
- QA 数据库创建成功。
- 专用配置目录下共有 9 个 Edge 进程，其中唯一不带 `--type=` 的浏览器主进程为窗口所有者。
- 启动器对应 1 个 Node 进程。
- 对已再次核对名称、命令行配置目录和 PID 的唯一主进程调用 `CloseMainWindow()`，返回 `True`。
- 关闭后端口不再监听、QA Edge 进程为 0、启动器 Node 进程为 0。
- `runtime/launcher.log` 最终记录 `stage=stopped`、`code=OK`，不包含数据库内容、API Key 或底层错误正文。

第二轮使用同一 QA 数据库和配置目录立即重启：

- 页面再次返回 HTTP 200，证明上轮数据库锁已释放。
- 再次正常关闭主窗口后，端口、Edge 和 Node 进程均归零。

## UI 自动化限制

Windows UI 自动化能够枚举到标题为“智游足迹 · 我的旅行手账”的独立 Edge 窗口，但因无法高置信确认该原生应用窗口的当前 URL 而触发安全停止。本轮没有绕过该保护，也没有使用坐标点击关闭按钮；改为严格限定 QA 配置目录、名称、PID 和主进程类型后调用 Windows `CloseMainWindow()`，验证与用户点击窗口关闭按钮相同的窗口关闭消息和后续进程退出链路。

因此，本记录证明真实 Edge 应用窗口存在、页面可访问、正常窗口关闭消息会停止服务，但不把被安全机制阻止的截图或坐标点击写成已完成证据。
