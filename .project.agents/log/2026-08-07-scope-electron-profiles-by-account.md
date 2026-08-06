# 完成 Electron 浏览器画像账号隔离

- **日期**：2026-08-07
- **关联**：ROADMAP M2.1 / BrowserProfileStore / DesktopBridge / UserSessionStore / ConsoleUI
- **会话上下文**：原仓库存在用户未提交改动，本任务在独立 worktree
  `/Users/outas/WebstormProjects/WenXue-account-scoped-profiles` 与分支
  `codex/account-scoped-profiles` 完成。用户明确授权放弃现有浏览器画像；旧画像已移动到废纸篓，未永久删除。

## 做了什么

- 明确当前浏览器历史、Cookie、扩展 IndexedDB、AI 会话与记忆仍保存在 Electron `userData` 下的本地
  Chromium Profile 中；本功能提供同一设备上的账号隔离和恢复体验，不宣称云同步或跨设备恢复。
- 为 `browsers.json` 增加只在主进程使用的 `accountNamespace`，所有画像查询、创建、复制、重命名、
  删除、启动和状态事件均按网关验证后的当前用户 id 过滤。旧无归属记录和畸形元数据失败关闭，不会被
  新账号自动认领；物理画像 id 在所有账号和现存目录间保持全局唯一。
- `BrowserProfileStore` 串行化全部元数据操作并使用排他目录创建，避免并发写覆盖和目录复用。
- `UserSessionStore` 只接受受信网关 `/v1/auth/activate` 验证为 token→uid 精确匹配的 session；有效或
  过期的既有账号都不能被另一个账号直接覆盖，必须经过完整退出事务。
- `DesktopBridge` 增加账号 transition 锁、按画像生命周期队列和两阶段退出协议。首次登录先停止其他
  账号或无归属画像；退出按 prepare → CloudBase signOut → clear 执行，停止失败或 Cloud 状态未知时
  保持主进程保护，防止跨账号暴露。
- `BrowserSupervisor` 保留仍存活的异常进程句柄，关闭 untracked Profile 时二次确认锁状态；通过 Electron
  单实例、跨进程启动 marker、marker 清理 single-flight 和重启等待，覆盖 CfT spawn 到 Chromium 建锁前
  的竞态窗口。主窗口关闭浏览器失败时保持窗口并反馈错误。
- 同步运行时架构、UI/UX、迁移、测试与后续 Chromium fork 交付文档。

## 本地数据清理

以下旧数据按用户授权从原位置移出，均可从废纸篓恢复：

- `~/Library/Application Support/@wenxue/desktop/profiles` →
  `~/.Trash/WenXue-legacy-profiles-20260807-005107`
- `~/Library/Application Support/desktop/profiles` →
  `~/.Trash/WenXue-dev-profiles-20260807-005107`
- `~/Library/Application Support/desktop/browsers.json` →
  `~/.Trash/WenXue-dev-browsers-20260807-005107.json`

## 提交

- `759e7e8 feat(desktop): scope browser profiles by account`

## 状态变更与验证

- ROADMAP：M2.1 标记完成。
- 账号隔离聚焦测试：8 files / 143 tests 全部通过。
- 类型检查：`pnpm -F desktop typecheck` 通过。
- 生产构建：`pnpm -F desktop build` 通过。
- 代码质量：修改范围 ESLint 通过；仅保留仓库既有 `MODULE_TYPELESS_PACKAGE_JSON` 警告；
  `git diff --check` 通过。
- 最终只读边界复核未发现剩余高置信 P1/P2 问题。
- 全量 desktop Vitest：18 files 通过、1 file 失败，191/194 tests 通过。3 个失败均在本次未修改的
  `DesktopAnnouncementService.test.ts`（消息排序、十条窗口补充、过期 token 刷新），属于当前分支基线
  的独立公告服务问题；由于 Vitest 阶段失败，命令未继续执行其后的 `scripts/*.test.mjs`。

## 边界

- 本功能不上传浏览器画像、AI 对话或记忆，也不提供跨设备同步；切回原账号仅能在同一台设备恢复。
- 启动器日志、全局设置和本地 token fallback 仍按现有全局策略保存，不属于本次账号画像隔离范围。
