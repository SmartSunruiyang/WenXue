# CloudBase LLM Gateway M2 完成

- **日期**：2026-06-28
- **关联**：CloudBase 自建 LLM 网关计划 M2
- **会话上下文**：接续 M0/M1 后，按用户新增要求确认产品用户身份必须是 CloudBase Auth 注册/外部用户（`type=external`），不是企业成员或管理侧账号。

## 做了什么

- 确认 CloudBase Auth provider 状态：用户名密码与手机登录开启，匿名关闭；产品侧 HTTP 登录可用。
- 新增启动器 `LauncherAuthSession`，用 CloudBase Auth HTTP API 登录、刷新、登出，并通过 `/auth/v1/user/me` 强制校验 `type=external`。
- 新增 `ExtensionSessionHandoff`，通过一次性 localhost handoff 页面与 `externally_connectable` 把 access token 交给插件；refresh token 不交给渲染层或插件。
- 更新 DesktopBridge / preload / renderer 登录面板，支持产品用户登录、退出与交接插件。
- 新增插件侧 `cloudAuthSession` 存储与 background 消息处理，只接受 localhost/127.0.0.1/[::1] 交接来源。
- 使用真实 CloudBase 外部产品用户完成登录与 handoff 冒烟；验证插件能取得有效 access token。

## 提交

- 未提交，工作树状态：当前分支仍包含 M0/M1/M2 连续推进改动、用户要求继续全部推进，暂不切分提交。

## 状态变更

- 架构文档：更新 `PRD.md`、`ARCHITECTURE.md`、`TECH-INFRA.md`、`ROADMAP.md`，登记 `LauncherAuthSession`、`ExtensionSessionHandoff`、auth IPC 与一次性 access-token handoff 豁免。
- 需求文档：明确登录身份必须是 CloudBase Auth 产品侧注册/外部用户（`type=external`）。
- 测试：
  - `npx pnpm@9.15.0 -F desktop exec vitest run src/main/LauncherAuthSession.test.ts src/main/ExtensionSessionHandoff.test.ts src/main/DesktopBridge.test.ts`
  - `npx pnpm@9.15.0 -F desktop exec tsc -p tsconfig.node.json --noEmit`
  - `npx pnpm@9.15.0 -F desktop exec tsc -p tsconfig.web.json --noEmit`
  - `npx pnpm@9.15.0 -F desktop test`
  - `npx pnpm@9.15.0 -F desktop build`
  - `npx pnpm@9.15.0 -F extension exec vitest run src/lib/cloudAuthSession.test.ts`
  - `npx pnpm@9.15.0 -F extension test`
  - `npx pnpm@9.15.0 -F extension build`

## 下一步

- 进入 M3：把内置模型运行时配置切到 CloudBase LLM Gateway，apiKey 字段使用插件侧 CloudBase access token；保留本地直连兜底开关；自定义 BYO-Key 模型维持直连。
