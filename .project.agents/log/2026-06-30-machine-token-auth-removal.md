# 取消账号登录并改为本机机器 token

- **日期**：2026-06-30
- **关联**：PRD F9 / M4.5 后续机器 token / ARCHITECTURE DesktopBridge + CloudBaseLlmGateway
- **会话上下文**：用户要求去掉所有账户登录逻辑，因为当前无法发送验证码，改为每台机器一串唯一 tokens，并在设置页可见。

## 做了什么
- 删除启动器 CloudBase Auth 登录、短信验证码、账号密码、登出与旧 access-token handoff 逻辑，替换为 `MachineTokenStore` 和 `MachineTokenHandoff`。
- 启动器首次生成并持久化 `wxm_` 机器 token，同一 `<userData>` 目录稳定复用；设置页展示 machineId、完整 token、生成时间和复制入口。
- DesktopBridge / preload / renderer 类型从 `auth:*` 改为 `machine-token:get` 与 `machine-token:handoffToExtension`。
- 插件删除 `cloudAuthSession` 和 options 账户区，新增 `machineTokenSession`，background 只接受 `WENXUE_MACHINE_TOKEN_SESSION` 外部消息。
- 内置模型运行时改用插件侧机器 token 调 CloudBase Gateway；自定义 BYO-Key 模型不变。
- LLM Gateway 去掉 CloudBase Auth introspection，改为校验机器 token 格式并用 SHA-256 派生 `machine_` uid。
- 同步更新 PRD、ARCHITECTURE、TECH-INFRA、ROADMAP、UIUX 和插件 API 文档。

## 提交
- 未提交，用户未要求提交；当前工作树包含源码、文档和 `pnpm -F desktop build` 生成的桌面 `out/` 产物。

## 状态变更
- 架构文档：更新领域模型、DesktopBridge IPC、MachineTokenStore/MachineTokenHandoff、UsageCloudClient、CloudBaseLlmGateway、依赖图、持久化与测试边界。
- 需求/UI 文档：F9 改为本机机器 token；插件 options 不再展示账户/认证令牌；桌面设置页承载机器 token 展示与同步入口。
- 测试：新增机器 token store/handoff、插件机器 token session、gateway 机器 token 鉴权等测试；删除旧 auth/cloudAuth 测试。

## 验证
- `npx pnpm@9.15.0 -F desktop test`：通过，63 tests。
- `npx pnpm@9.15.0 -F extension test`：通过，360 tests。
- `npx pnpm@9.15.0 -F llm-gateway test`：通过，16 tests。
- `npx pnpm@9.15.0 -F desktop build`：通过。
- `npx pnpm@9.15.0 -F extension build`：通过；保留既有 esbuild `es2025` target warning。
- `npx pnpm@9.15.0 exec tsc -p apps/desktop/tsconfig.node.json --noEmit --pretty false`：通过。
- `npx pnpm@9.15.0 exec tsc -p apps/desktop/tsconfig.web.json --noEmit --pretty false`：通过。
- `npx pnpm@9.15.0 -F llm-gateway typecheck`：通过。
- `npx pnpm@9.15.0 -F extension exec tsc --noEmit --pretty false`：未通过，剩余为既有无关类型债（MultiPageAgent.test `this` any、cards/info 可能 undefined、HistoryDetail.test 缺 conversationId/updatedAt、LogViewer 参数、misc.test unknown props、db upgrade store 类型）；本次 `account` section 相关错误已消失。

## 下一步
- 用真实启动器打开一个画像，点击“同步到插件”，确认 background 持久化 `WenXueMachineTokenSession` 后内置模型能通过网关调用。
- 如需发布，决定是否提交本次 `apps/desktop/out/` 生成产物。
