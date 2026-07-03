# 修复注册接口 CORS 预检

- **日期**：2026-07-03
- **关联**：CloudBase LLM Gateway 注册入口 `/v1/auth/register`
- **会话上下文**：用户反馈桌面端注册提示 `Failed to fetch`。

## 做了什么
- 复现线上 `OPTIONS /v1/auth/register`：返回业务 400 且最初缺少 CORS 头，浏览器会把注册请求拦成 `Failed to fetch`。
- 在 `apps/llm-gateway/src/index.mjs` 给注册入口增加 CORS 响应头。
- 增加 `OPTIONS` / `Access-Control-Request-Method` 两种预检识别，避免 CloudBase Run 未透出 `httpMethod` 时仍走注册校验。
- 部署 CloudBase Run `wenxue-llm-gateway` 到版本 `014`，确认 100% 承流。

## 提交
- 未提交，工作树在本任务前已有大量既有改动；本次只追加注册 CORS 修复、测试和执行日志。

## 状态变更
- 架构文档：未改，属于既有注册入口的边界行为修复。
- 需求/UI 文档：未改。
- 测试：
  - `pnpm -F llm-gateway test -- --runInBand`：26 个测试通过。
  - `pnpm -F llm-gateway typecheck`：通过。
  - 线上 `OPTIONS /v1/auth/register` 返回 `204`，带 `access-control-allow-origin: *`。
  - 线上临时真实注册 `corsprobe1783020429040` 返回 `201`，CloudBase Auth 中为 `externalUser/ACTIVE`，`user_accounts` 中同步为 `active`。
  - 验证后已删除临时 Auth 用户与 `user_accounts` 记录，回读均为空。

## 下一步
- 用户重新打开桌面端注册页再注册；若仍失败，优先看实际错误消息而不是 `Failed to fetch`。
