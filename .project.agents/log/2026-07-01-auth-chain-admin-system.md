# 2026-07-01 Auth Chain & Admin System

## 背景

用户要求在实现后台管理系统前，先保证 LLM 调用网关、machine token 鉴权、machine id 生成与桌面/插件交接链路可用，并 review 当前鉴权层混乱点。后台要求基于 CloudBase，公网访问，管理员只允许内部账号密码登录，机器账号权限默认自动开通，并提供 tokens 看板。

## 结论

- LLM 网关现在在调用 DashScope 前执行 machine token 鉴权与权限判断：
  - 校验 `wxm_` machine token 格式。
  - 由 token hash 派生 `machine_*` uid，避免信任客户端自报 uid。
  - 读取/自动创建 `machine_accounts`。
  - `status !== active` 或模型不在 `allowedModels` 时返回 403，不再调用上游模型。
- 桌面端 machine token 本地文件改为 `0600` 权限写入。
- 插件端 machine token session 增加来源与派生 id 校验，避免任意 `wxm_` token 或被污染的 gateway base URL 被直接接受。
- 插件 sidepanel 首次无 token 初始化失败后，收到桌面 handoff 写入 token 时会自动重建内置 agent 会话。
- 浏览器监督器在 profile 已运行时再次带 `startUrl` 启动，会用新的 URL 聚焦/打开，不再复用旧启动参数。
- 新增 `apps/admin-api`，提供 CloudBase 后台 API：
  - `/admin/v1/me`
  - `/admin/v1/usage/summary`
  - `/admin/v1/machines`
  - `/admin/v1/machines/permissions`
- 新增 `apps/admin`，提供后台管理前端：
  - 内部账号密码登录入口。
  - tokens 使用总览、日趋势、模型分布、最近调用。
  - machine 列表、状态筛选、模型授权、启停权限、审计原因。
- 已更新 PRD、ARCHITECTURE、ROADMAP、TECH-INFRA，记录后台系统、权限实体、API 合约和部署约束。

## 关键实现

- `apps/llm-gateway/src/gateway.mjs`
  - 新增 `authorizeMachineRequest`、`hashMachineToken`、`deriveMachineUid` 和 `machine_accounts` 权限检查。
  - usage 写入失败改为告警，不影响已成功的模型响应。
- `apps/extension/src/lib/machineTokenSession.ts`
  - 校验官方 gateway base URL。
  - 校验 `machineId === sha256(token).slice(0, 32)`。
- `apps/extension/src/agent/useAgent.ts`
  - 监听 machine token session storage 变化并重建 agent。
- `apps/desktop/src/main/MachineTokenStore.ts`
  - machine token 文件以 `0600` 写入。
- `apps/admin-api/src/adminApi.mjs`
  - 后台 API 入口、CloudBase Auth token introspection、`admin_users` 二次鉴权、敏感字段响应检查。
- `apps/admin/src/App.tsx`
  - 后台管理控制台主界面。

## 验证

通过：

- `pnpm -F admin-api test`
- `pnpm -F admin-api typecheck`
- `pnpm -F admin build`
- `node_modules/.bin/vitest run src/main/MachineTokenStore.test.ts src/main/MachineTokenHandoff.test.ts src/main/DesktopBridge.test.ts src/main/UsageCloudClient.test.ts src/main/BrowserSupervisor.test.ts`
- `node_modules/.bin/vitest run src/lib/machineTokenSession.test.ts src/lib/runtimeModelConfig.test.ts src/agent/useAgent.test.ts`
- `node_modules/.bin/vitest run src/gateway.test.ts`
- `pnpm -F llm-gateway typecheck`
- `pnpm -F desktop exec tsc --noEmit`

未通过但不属于本轮改动：

- `pnpm -F extension exec tsc --noEmit`
  - 失败点集中在既有文件：`MultiPageAgent.test.ts`、`cards.tsx`、`HistoryDetail.test.ts`、`LogViewer.tsx`、`misc.test.ts`、`db.ts`。
  - 本轮新增/修改的 machine token session、runtime model config、`useAgent` 定向测试均已通过。

## 公网部署

2026-07-01 已完成公网发布：

- AdminConsole：
  - `https://wenxue-admin-web-4037646-1427406869.ap-shanghai.run.tcloudbase.com/`
  - 发布到 CloudBase Run 静态容器 `wenxue-admin-web`；`OpenAccessTypes:["PUBLIC"]`、`MinNum:1`、`Cpu:0.25`、`Mem:0.5`。
  - 构建期配置了 `VITE_CLOUDBASE_ENV_ID`、`VITE_CLOUDBASE_REGION`、真实 Publishable Key、`VITE_WENXUE_ADMIN_API_BASE_URL`。
  - 曾上传到 CloudBase 共享静态托管 `admin/` 路径，但该共享域返回 `content-disposition: attachment`；该目录已删除，不作为正式入口。
- AdminApi：
  - `https://wenxue-admin-api-4037646-1427406869.ap-shanghai.run.tcloudbase.com`
  - CloudBase Run 容器服务 `wenxue-admin-api`，`OpenAccessTypes:["PUBLIC"]`、`MinNum:1`、`Cpu:0.5`、`Mem:1`。
  - 未登录访问 `/admin/v1/me` 返回 401，符合预期。
- LLM Gateway：
  - `wenxue-llm-gateway` 已重新部署至 `wenxue-llm-gateway-007`，100% 流量。
  - 公网 `GET /v1/usage/summary` 使用新 machine token 返回 200，并自动创建 active `machine_accounts` 记录。
- CloudBase 配置：
  - username/password 登录已开启。
  - Publishable Key 已存在。
  - `admin_users`、`machine_accounts`、`machine_permission_audit` 已创建。
  - `admin_users` 已写入 `administrator`、`outas`、`spike2801` 三个内部账号的 active admin 授权。
  - `admin_users`、`machine_accounts`、`machine_permission_audit` 权限已设为 `ADMINONLY`。
- 验证：
  - AdminConsole 首页、JS、CSS 均返回 200，且无 `content-disposition: attachment`。
  - AdminApi 未登录访问 `/admin/v1/me` 返回 401。
  - LLM Gateway `GET /v1/usage/summary` 使用新 machine token 返回 200，并自动创建 active `machine_accounts`。
  - 2026-07-01 21:59 修复并重新部署 `wenxue-admin-api-002`：CloudBase 事件适配层现在能从 `access-control-request-method` 识别浏览器 CORS 预检请求；公网 `OPTIONS /admin/v1/me` 与 `OPTIONS /admin/v1/machines/permissions` 均返回 204，避免登录后浏览器显示 `Failed to fetch`。
  - 2026-07-01 22:13 修复并重新部署 `wenxue-admin-api-003`：AdminApi 数据访问层从 `@cloudbase/node-sdk` 改为 CloudBase NoSQL REST API + 服务端 API Key，避免 CloudRun 容器内缺少 SecretId/SecretKey 时触发 `SIGN_PARAM_INVALID / secret id error`。本地真实读库验证可读取 `admin_users` 与 `machine_accounts`；公网 `OPTIONS /admin/v1/me` 返回 204，未登录 `GET /admin/v1/me` 返回 401，后台页面返回 200。

未完成的验证缺口：

- 因当前环境授权用户数已达体验版上限，无法新建临时管理员账号。
- 未掌握已有内部账号密码或登录态，因此没有完成真实账号密码登录后的浏览器端到端验证；公网页面、静态资源、AdminApi 未登录鉴权、AdminApi 真实读库、machine token 自动开户链路均已验证。

后续风险：

- 因用户要求机器权限默认自动开通，任何格式正确的新 machine token 会首次请求时自动入库为 `active`。若后续要防滥用，需要增加服务端签发/注册审批、速率限制或组织级 invite code。
