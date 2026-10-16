# 网页花销功能验收记录

验收日期：2026-10-16

分支：`codex/web-expense-tracking`

浏览器验收基线：`5e0a6c1`，另含本次验收发现并以回归测试锁定的删除后即时刷新修复。

## 自动化结果

- `npm test`：442 个测试，441 个通过，0 个失败，1 个跳过。
- 唯一跳过项是当前 Windows 账户不能创建文件符号链接，因此静态文件真实路径边界中的 symlink 场景未在本机执行；现有 realpath 边界逻辑仍由其余测试覆盖。
- `git diff --check`：exit 0，无空白错误；Git 仅提示工作区 LF 将在后续操作按本机配置转换为 CRLF。
- 自动化覆盖花销领域校验、v1/v2 到 v3 迁移与一致备份、行程归属、乐观版本、幂等回执、级联删除、HTTP 边界、表单、控制器和响应式页面结构。

## 隔离方式

使用以下命令启动本机 QA 服务：

```powershell
node scripts/start-ai-qa.mjs --port 3211 --db runtime/qa-expense.sqlite
```

QA 数据仅写入被 Git 忽略的 `runtime/qa-expense.sqlite`。该入口拒绝正式数据库路径，AI 搜索与模型均为固定本地假实现；本次验收没有读取、升级或写入 `runtime/travel.sqlite`，也没有发起真实或付费的外部 API 请求。

## 真实浏览器验收

在一趟预算 ¥300.00、南京与苏州两站的测试行程中完成：

- 新增默认“餐饮”分类的南京花销 ¥120.50，并新增行程内自定义分类后记录“整个行程”花销 ¥250.00；日期分别覆盖行程首日与末日。
- 编辑花销金额归属之外的已填字段，确认备注和修改结果保留；把自定义分类重命名为“咖啡茶饮”，历史记录与分类汇总同步显示新名称。
- 总额 ¥370.50 时显示超预算 ¥70.50；主页累计、行程详情摘要、分类汇总和城市汇总一致，刷新后仍存在。
- 删除花销的取消分支保持记录不变；确认删除后数据库仅保留 ¥120.50，预算显示剩余 ¥179.50，刷新后结果一致。
- 使用中的自定义分类确认删除后被阻止，页面显示“该分类正在使用，请先修改相关花销”，分类与花销均保留。
- 从路线中移除南京后，行程仅保留苏州；南京花销仍存在，并在行程详情、按城市汇总和全部记录中标记“南京市（已移出路线）”。
- 桌面视口（1101px）为双栏花销布局；390px 窄屏为单栏，页面没有横向溢出。
- 浏览器 Console 最终检查为 0 条 warning、0 条 error。

验收过程中发现“在花销列表删除后，同一 hash 路由不会触发页面重新加载”。根因是控制器成功删除后导航回当前相同路由；现改为在控制器内重新读取当前行程花销概览，并增加 `deleting an expense reloads the current overview when the route is unchanged` 回归测试。

## 截图与未覆盖项

截图保存在被 Git 忽略的目录，不随代码提交：

- `runtime/qa-screenshots/expense-desktop.png`
- `runtime/qa-screenshots/expense-narrow-390.png`
- `runtime/qa-screenshots/expense-historical-city.png`
- `runtime/qa-screenshots/expense-after-delete.png`

未使用真实 AI 平台 Key，因此本记录不能证明任何平台账户权限、余额、模型质量或当日服务可用性。足迹地图、登录、分享和互联网部署不属于本次花销功能验收范围。
