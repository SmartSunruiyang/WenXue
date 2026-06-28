# CloudBase LLM Gateway M4 tokens 云端计量读取完成

- **日期**：2026-06-28
- **关联**：CloudBase LLM Gateway 计划 M4 / PRD F8 / ARCHITECTURE `UsageCloudClient`、`CloudBaseLlmGateway`
- **会话上下文**：接续 M3 内置模型切网关后，推进 tokens 页读取真实网关计量；用户要求产品用户身份必须为 CloudBase Auth 注册/外部用户。

## 做了什么
- 网关新增 `GET /v1/usage/summary` Function target：校验 CloudBase access token，按当前 uid 查询 `token_usage`，返回脱敏 `TokenUsageSummary`。
- `recent.id` 改为 `requestId:ts`，不把服务端 `_id` 中的 uid 返回给桌面。
- 新增桌面 `UsageCloudClient`：用产品用户 access token 拉云端 summary，按 uid 写离线缓存；`tokens:getSummary` 云端失败时回退本地 `TokenUsageStore`。
- CloudBase Run `wenxue-llm-gateway` 部署到版本 `wenxue-llm-gateway-006`，100% 流量。
- 使用现有 CloudBase Auth 外部产品用户 `m2ext06290027` 做真实 smoke：`/auth/v1/user/me` 返回 `type=external`，`/v1/usage/summary` 返回 200。

## 提交
- 未提交，工作树仍包含 M0–M4 连续推进的多文件变更；用户要求“所有的全部推进”，待 M5/M6 收口后统一整理提交。

## 状态变更
- 架构文档：新增 `UsageCloudClient` 模块、依赖图、IPC 契约说明、summary 缓存持久化边界；更新 `CloudBaseLlmGateway` summary target。
- 需求/基础设施/路线图：PRD F8 改为登录后云端计量优先、本地/离线兜底；TECH-INFRA 记录 `/v1/usage/summary` 与 `UsageCloudClient`；ROADMAP 记录 M4 tokens 云端读取完成。
- CloudBase：线上版本 `006` 正常；环境变量未在日志中记录；服务仍为 `PUBLIC`、`MinNum=1`。
- 真环境 smoke：summary 总 tokens `6024`，模型聚合包含 `qwen-plus`、`qwen3.7-plus` 等，返回体敏感字段/uid 检查为 false。

## 验证
- `npx pnpm@9.15.0 -F llm-gateway test`：16 tests passed
- `npx pnpm@9.15.0 -F llm-gateway typecheck`：passed
- `npx pnpm@9.15.0 -F desktop exec vitest run src/main/UsageCloudClient.test.ts src/main/DesktopBridge.test.ts`：14 tests passed
- `npx pnpm@9.15.0 -F desktop exec tsc -p tsconfig.node.json --noEmit`：passed
- `npx pnpm@9.15.0 -F desktop exec tsc -p tsconfig.web.json --noEmit`：passed
- `npx pnpm@9.15.0 -F desktop test`：64 tests passed
- `npx pnpm@9.15.0 -F desktop build`：passed

## 下一步
- M5：删除扩展内置模型本地百炼 Key 与 `WenXueUseLocalBuiltinLlmFallback` 兜底开关，网关成为内置模型唯一路径；自定义 BYO-Key 继续保持本机直连。
- 后续单独推进 `usage-rollup` 与按价目表精确成本估算。
