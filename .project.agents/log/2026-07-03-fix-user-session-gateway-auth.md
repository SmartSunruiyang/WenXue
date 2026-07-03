# 修复用户 session 调网关仍走机器 token 鉴权

- **日期**：2026-07-03
- **关联**：F9 用户账号与网关会话 / CloudBaseLlmGateway / `@page-agent/llms`
- **会话上下文**：用户反馈桌面端登录后显示同步成功，但插件发送消息时报 `Invalid machine token` 和 `No choices in response`。

## 做了什么
- 复现公网网关行为：无 `Authorization` 返回缺少 bearer；携带任意 bearer 返回旧 `Invalid machine token`，确认线上网关仍在旧鉴权路径。
- 将 `packages/core` 对 `@page-agent/llms`、`@page-agent/page-controller` 的依赖改为 `workspace:*`，避免扩展经 `@page-agent/core` 打包到发布版旧依赖。
- 收紧 `OpenAIClient` CloudBase envelope 错误测试，并把缺少 bearer 的文案改为用户账号/session 语义。
- 重新构建 `@page-agent/llms` 与 `apps/extension`，确认扩展 bundle 已包含 `throwIfCloudBaseErrorEnvelope`。
- 通过 CloudBase MCP 部署 `wenxue-llm-gateway` 版本 `008` 到 `wenxue-d8gz76tacc3659f05`，并确认 100% 承流。

## 提交
- 未提交，工作树已有大量本任务前的未提交改动；本次只在相关文件上继续修复并保留现状。

## 状态变更
- 架构文档：未改。
- 需求/UI 文档：未改。
- 测试：
  - `pnpm -F llm-gateway test -- --runInBand`
  - `pnpm -F llm-gateway typecheck`
  - `pnpm -F @page-agent/llms test -- OpenAIClient.test.ts`
  - `pnpm -F extension test -- runtimeModelConfig.test.ts userSession.test.ts useAgent.test.ts`
  - `pnpm -F @page-agent/core test`
  - `pnpm -F @page-agent/llms build`（JS 构建成功；dts bundle 提示缺少可选 `@microsoft/api-extractor`）
  - `pnpm -F extension build`
- 线上验证：部署后对 `/v1/chat/completions` 和 `/v1/usage/summary` 使用无真实凭据请求，均返回“登录已过期/无权限，请回到桌面端登录或重新启动浏览器。”，不再返回 `Invalid machine token`。

## 下一步
- 重启桌面端和已启动的问学浏览器实例，确保加载最新扩展构建和新 handoff session。
- 若真实登录用户仍 401，下一步检查该 CloudBase 用户在 `user_accounts` 中是否为 `active`。
