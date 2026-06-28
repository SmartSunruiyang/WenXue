# CloudBase LLM Gateway M3 完成

- **日期**：2026-06-28
- **关联**：CloudBase 自建 LLM 网关计划 M3
- **会话上下文**：接续 M2 会话交接后，把插件内置模型运行时链路切到 CloudBase LLM Gateway；遵守“删本地 Key 是最后一步”，M3 只保留直连兜底。

## 做了什么

- 将内置模型默认 baseURL 改为 CloudBase LLM Gateway OpenAI base；默认配置不再携带本地厂商 API Key。
- 新增 `runtimeModelConfig`：运行时读取插件侧 `WenXueCloudAuthSession`，仅对内置模型把 `apiKey` 注入为 CloudBase access token；自定义 BYO-Key 模型保持用户配置直连。
- 新增 `WenXueUseLocalBuiltinLlmFallback` 临时开关，可在 M5 前把内置模型回退到本地直连配置。
- `useAgent` 创建/重配 Agent 时加载运行时模型凭据；渲染层保存的配置不包含 access token。
- 真实验证发现 `qwen3.7-max` 会拒绝 Agent 默认 `tool_choice=required/object`，因此内置文本默认改为已验证支持 tools 的 `qwen-plus`；视觉默认 `qwen3.7-plus` 保持不变。

## 提交

- 未提交，工作树状态：当前分支仍在连续推进 M0–M3 与后续 M4/M5，用户要求“所有的全部推进”，暂不切分提交。

## 状态变更

- 架构文档：更新 `ARCHITECTURE.md`，登记 `runtimeModelConfig`、运行时模型解析、fallback storage key 与目录布局。
- 需求/UI/技术文档：更新 `PRD.md`、`TECH-INFRA.md`、`UIUX.md`、`ROADMAP.md`，默认文本模型为 `qwen-plus`，视觉为 `qwen3.7-plus`，内置模型经网关使用产品用户 access token。
- 计划：`.project.agents/docs/superpowers/plans/2026-06-28-cloudbase-llm-gateway.md` 的 M3 复选框已完成。
- 测试：
  - `npx pnpm@9.15.0 -F extension exec vitest run src/lib/runtimeModelConfig.test.ts src/lib/configStorage.test.ts src/lib/modelConfig.test.ts src/lib/settingsConfig.test.ts src/agent/useAgent.test.ts`
  - `npx pnpm@9.15.0 -F extension test`
  - `npx pnpm@9.15.0 -F extension build`
- 真实 CloudBase 验证：
  - 使用现有 M2 smoke 外部产品用户 `m2ext06290027`（uid `2071269274834309122`）重置测试密码后登录；`/auth/v1/user/me` 返回产品侧 `external` 身份。
  - 默认文本 `qwen-plus`：流式请求经网关成功，SSE usage 非 0；`tool_choice=required` tool-call 请求成功。
  - 默认视觉 `qwen3.7-plus`：公网图片 URL 多模态请求经网关成功，usage 非 0；data URL 被上游拒绝，不作为 M3 验收输入。
  - `token_usage` 最新记录确认按 uid/model 写入，仅含 tokens、latency、requestId、时间戳等计量字段。

## 下一步

- 进入 M4：实现 `usage-summary` / `usage-rollup` 云函数与桌面 `UsageCloudClient`，让 tokens 页读取网关计量并保留离线缓存兜底。
- M5 才删除本地直连 fallback 和内置模型本地厂商 Key。
