# 合并现有改动与账号画像分支并清理工作树

- **日期**：2026-09-17
- **关联**：当前 Electron 运行时 / ROADMAP M2.1 / 现有代码审计

## 做了什么

- 将主工作区原有的桌面、扩展、Gateway、后台、发布配置和审计文档改动分组提交到 `main`。
- 合并 `codex/account-scoped-profiles`，保留账号归属、旧记录、全局画像 ID 去重与退出保护；同时保留审计修复的原子元数据写入、运行中画像操作保护和日常启动不开放 TCP 调试端口。
- 未跟踪但仍占用的 CfT 画像不能安全确认关闭时拒绝切号；重启后已占用画像不能重复启动。画像删除先持久化元数据，持久化失败时不删除 Profile；目录删除失败时尝试回滚元数据。应用退出前浏览器关闭失败时不再强制退出启动器。
- 确认 `codex/ocsjs-all-platform-solvers`、`codex/ai-browser-doc-system` 与旧 UI 历史快照都已包含在 `main`，随后删除三个附属工作树和三个已合入的本地分支引用。用户指定只处理当前工作区，两个 Git stash 均未恢复或删除。

## 提交

- `ddd0c09` `fix(desktop): harden profile lifecycle and local persistence`
- `0f5e162` `fix(ext): harden agent state, tab events, and content handling`
- `c8f49b9` `fix(infra): bound gateway requests and paginate usage safely`
- `22fb3c8` `fix(infra): make admin authorization and pagination fail closed`
- `0a17928` `build(infra): enforce one gateway origin in release artifacts`
- `1982816` `chore(infra): align lint contexts and package metadata`
- `95b0464` `docs: record existing-code audit integration`
- `9a48354` `feat(desktop): merge account-scoped browser profiles`（合并 `759e7e8`、`3bd2f04`）

## 状态变更与验证

- 当前运行时 ARCHITECTURE、ROADMAP 与账号画像设计稿同步了无 TCP CDP 的安全关闭策略、ProfileStore 接口和真实环境验收边界；目标迁移文档保留账号来源过滤要求。
- 合并后桌面 Vitest 20 files / 217 tests 全绿，发布脚本 14 tests 全绿；桌面 node/web typecheck、生产构建和桌面源码 ESLint 通过，`git diff --check` 通过。
- 扩展 709、Gateway 70、Admin API 74 项测试在合并前已通过；本次功能分支仅新增桌面代码与相关文档。
- `git worktree list` 只剩 `/Users/outas/WebstormProjects/WenXue`；本地只剩 `main`。三个被移除工作树没有未提交源码，额外内容仅依赖、构建产物或系统缓存；其源码提交均可从 `main` 追溯。被删除的生成缓存不再保留于这些目录。

## 下一步

- 推送 `main` 到 GitHub `origin/main`；当前宿主的 HTTPS GitHub 凭据不可用，SSH 身份也被拒绝，需要恢复 GitHub 认证后完成远端同步。
- 用真实 CfT 执行 A→B→A 登录、网站状态与插件 IndexedDB/AI 历史恢复验收；单测与构建不替代该验证。
