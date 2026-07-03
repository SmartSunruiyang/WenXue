# 2026-07-02 User Session Auth Refactor

## 背景

按新共识移除机器 token 鉴权链路，桌面端改为 CloudBase username/password 用户账号登录，插件自动接收并刷新用户 session，网关和后台管理均按 CloudBase 用户 id 授权、计量与展示。

## 变更

- 新增 spec 与实施计划：
  - `.project.agents/docs/superpowers/specs/2026-07-02-user-session-auth-design.md`
  - `.project.agents/docs/superpowers/plans/2026-07-02-user-session-auth.md`
- 更新源文档：PRD、ARCHITECTURE、ROADMAP、TECH-INFRA、UIUX，明确用户 session、`user_accounts`、用户维度 token_usage 与后台用户管理。
- 桌面端：
  - 新增 `UserSessionStore`、`UserSessionHandoff` 与 renderer CloudBase auth wrapper。
  - 登录/注册页使用用户 id + 密码，不使用验证码；未登录不能进入主工作台或启动浏览器。
  - 浏览器启动时通过一次性 localhost 页面向扩展发送 `WENXUE_USER_SESSION`，包含 `userId/accessToken/refreshToken/expiresAt`。
  - `UsageCloudClient` 使用当前用户 access token 读取云端 summary，并按 userId 缓存。
- 插件：
  - 新增 `userSession` 存储与刷新模块，存储 key 为 `WenXueUserSession`。
  - background 接受 localhost external message `WENXUE_USER_SESSION`，并提供用户 session load/clear 内部消息。
  - 内置模型运行配置使用 `accessToken` 作为 gateway bearer；session 缺失或刷新失败时仍能初始化聊天 UI，发送时由网关返回鉴权错误。
- 网关：
  - 删除机器 token 派生、哈希、自动创建机器账号与模型 allowlist 授权路径。
  - 请求前 introspect CloudBase Auth access token，解析 uid，读取 `user_accounts[_id=uid]`，仅 `status=active` 放行。
  - `token_usage.uid` 保持为 CloudBase 用户 id，usage 记录继续做敏感字段断言。
- 后台：
  - Admin API 路由改为 `GET /admin/v1/users` 与 `PATCH /admin/v1/users/status`。
  - CloudBase store 改读写 `user_accounts` 与 `user_permission_audit`。
  - Admin Console 改为用户列表、用户状态过滤、用户状态编辑、按用户聚合与最近调用展示。

## 验证

- `pnpm install --lockfile-only`
- `pnpm -F extension test`：43 files / 366 tests passed
- `pnpm -F extension build`：passed；保留既有 esbuild `es2025` target warning
- `pnpm -F desktop test`：15 files / 69 tests passed
- `pnpm -F desktop build`：passed
- `pnpm -F llm-gateway test`：1 file / 18 tests passed
- `pnpm -F llm-gateway typecheck`：passed
- `pnpm -F admin-api test`：3 files / 13 tests passed
- `pnpm -F admin-api typecheck`：passed
- `pnpm -F admin build`：passed；Vite chunk size warning only
- Source search over desktop/extension/gateway/admin/admin-api found no remaining runtime machine-token authorization fields (`wxm_`, `machine_accounts`, `machineId`, `tokenHash`, old machine IPC/messages/routes).

## 备注

- CloudBase 侧仍需确认 Auth username/password provider 与 publishable key 已启用/配置。
- `user_accounts` 的创建/初始化不由网关自动完成，暂由后台管理/控制台或初始化脚本控制。
