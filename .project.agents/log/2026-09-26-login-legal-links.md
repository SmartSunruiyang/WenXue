# 登录页接入正式隐私协议与用户须知

- **日期**：2026-09-26
- **关联**：PRD F9、UIUX §7、ConsoleUI / EmailAuthScreen；[实施计划](../docs/superpowers/plans/2026-09-26-login-legal-links.md)

## 做了什么

- 隐私协议从 CloudBase 默认域名首页改为 `https://askwenxue.com/#privacy/privacy-policy`。
- 同一说明增加「和用户须知」，链接为 `https://askwenxue.com/#privacy/terms-of-use`。
- 两个链接复用现有 `onOpenExternal` 意图、HTTPS IPC 通道与链接样式；打开失败文案改为适用于两种协议的通用提示。
- 文案集中在 `strings.ts`；同步 PRD F9 与登录页 UI 规范，更新既有展示和点击测试。

## 提交

- 未提交：用户未要求提交；完整改动保留在 `codex/login-legal-links` 工作树中待审阅。
- 工作树：`/Users/outas/.codex/worktrees/login-legal-links/WenXue`，基于 `782743f`。
- 原工作区已有并持续增加邮箱验证任务的未提交改动，未修改、暂存或合并原工作区。

## 状态变更与验证

- 架构：归属现有 ConsoleUI，不新增模块、依赖或 IPC，不涉及认证流程变更。
- `pnpm -F desktop exec vitest run src/renderer/src/EmailAuthScreen.test.ts`：28 项通过，含两个链接各自通过桌面意图打开的验证。
- `pnpm -F desktop typecheck`：通过。
- `pnpm -F desktop build`：通过；输出位于隔离工作树的 `apps/desktop/out/`。
- 修改的三个 TypeScript 文件通过 ESLint 和 Prettier 检查，`git diff --check` 通过。
- 浏览器实际访问正式隐私协议页面并切换到用户须知，确认两者 URL、标题和对应正文正确。网页当前的草案标识未作修改。
- 本地预览使用实际 `EmailAuthScreen` 与现有 CSS，在 1280×720 下确认说明完整、两个下划线链接可辨认；桌面系统浏览器的打开意图由组件测试覆盖，未宣称安装包实机验收。
- 本地预览文件位于被忽略的 `.project.agents/tmp/login-legal-links/`，未纳入交付代码。

## 下一步

- 本任务实现与检查完成；后续合并此工作树时保留原工作区邮箱验证任务的文档改动。
- 未推送、发布或部署。
