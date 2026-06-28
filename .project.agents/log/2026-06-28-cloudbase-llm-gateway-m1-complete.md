# CloudBase LLM Gateway M1 网关硬化通过

- **日期**：2026-06-28
- **关联**：CloudBase LLM Gateway M1 / `2026-06-28-cloudbase-llm-gateway.md`
- **会话上下文**：M0 已真实通过，用户要求继续推进全部后续里程碑；本段只完成 M1 网关硬化 gate。

## 做了什么

- 新增网关服务端 usage 落库：成功拿到 DashScope `usage` 后，通过服务端 `CLOUDBASE_USAGE_API_KEY` 写入 NoSQL 集合 `token_usage`。
- `token_usage` 写入记录只包含 uid、model、token 数、latency、requestId、时间戳；无 prompt/正文/API key/authorization。
- 上游缺少 `usage` 时不再写 0 记录，改为明确失败，避免计量假通过。
- 增加 DashScope 请求超时控制，默认 60s。
- 保持文本、视觉、tools、`tool_choice`、思考开关等 OpenAI 兼容参数原样透传；流式继续注入 `stream_options.include_usage=true`。
- 使用服务端 API key 本地探针验证 NoSQL REST 插入/删除可用。
- 部署 `wenxue-llm-gateway-005`，100% 流量，PUBLIC/OA/MINIAPP 访问，MinNum=1。

## 提交

- 未提交，工作树状态：当前分支已有多项未提交/未跟踪改动；本段继续在同一脏工作区推进网关 M1。

## 状态变更

- 计划文档：M1 勾选完成。
- 网关代码：`gateway.mjs` 增加 `writeUsageRecord`、超时请求、usage 缺失拒绝；`index.mjs` 增加 `CLOUDBASE_USAGE_API_KEY` 与 timeout env。
- 测试：`gateway.test.ts` 从 8 tests 增至 12 tests。
- 云资源：创建服务端 API key `wenxue-llm-gateway-usage-writer` 并注入 CloudRun 环境变量；未写入仓库。

## 验证

- `npx pnpm@9.15.0 -F llm-gateway test` 通过：12 tests。
- `npx pnpm@9.15.0 -F llm-gateway typecheck` 通过。
- NoSQL REST 探针：`token_usage` 插入 201，删除 200。
- 真实外部产品用户 `m0ext06281932` M1 smoke：
  - 流式文本：8 SSE events，814ms，`total_tokens=41`，已落库。
  - 非流式文本：`total_tokens=12`，已落库。
  - tools + `tool_choice=auto`：646ms，`total_tokens=155`，已落库。
  - vision `qwen-vl-plus`：716ms，`total_tokens=1280`，已落库。
  - 缺 bearer token：网关返回 `Missing bearer token`，status 401。
  - 上游错误透传：DashScope 对 `tool_choice="none"` 返回 400，网关透传为 `DashScope upstream failed with 400`。
- `token_usage` 最新记录确认只有 uid/model/tokens/latency/requestId/createdAt 等计量字段。

## 下一步

- 进入 M2：启动器 CloudBase Auth 登录、`LauncherAuthSession`、preload/renderer auth API、扩展会话交接。
- M2 之后才允许 M3 把扩展内置模型切到网关；M5 之前仍保留本地直连兜底和本地百炼 Key。
