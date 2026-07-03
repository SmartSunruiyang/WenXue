# 修复插件内置模型网关鉴权链路

- **日期**：2026-07-01
- **关联**：F4 模型配置 / F8 Tokens 消耗统计 / F9 本机机器 token 与网关会话 / F10 后台管理系统
- **会话上下文**：用户反馈此前“插件内 LLM 调用走网关”后，插件无法使用、历史会话不可查看、消息无法发出、默认模型被改错、侧边栏模型按钮置灰、设置页默认模型不联动。

## 做了什么
- 修复插件启动时因缺少机器 token 直接初始化失败的问题：内置模型在无 token 时仍生成可用运行时配置，用户发送后进入聊天 UI；网关 401/403 会以「无权限」错误进入对话错误提示。
- 恢复默认内置模型：主模型 `qwen3.7-max`，视觉模型 `qwen3.7-plus`；网关首次自动创建 `machine_accounts` 时默认允许这两个模型。
- 修复 options 设置页与侧边栏 agent 的联动：监听默认模型、自定义模型、视觉模型、语言、高级配置和机器 token 的 storage 变化并重载空闲 agent。
- 修复网关鉴权链路：插件继续请求 CloudBase LLM Gateway，由网关请求 DashScope；成功的机器/模型授权在暖实例内短期缓存，避免同一轮 Agent 多次 LLM 调用反复读 `machine_accounts`；tokens usage 仍逐次写入。
- 同步 PRD / TECH-INFRA / ROADMAP / UIUX / ARCHITECTURE 中默认模型与网关授权描述。

## 提交
- 未提交；工作树已有大量未提交的桌面、后台、网关和机器 token 迁移改动，本次只追加针对插件可用性和网关鉴权链路的修复。

## 状态变更
- 架构文档：更新 CloudBaseLlmGateway 的授权缓存状态与默认 `machine_accounts` allowlist。
- 需求/UI 文档：更新默认主模型、视觉模型、发消息后进入聊天 UI 与鉴权失败提示。
- 测试：`pnpm -F llm-gateway typecheck` 通过；`pnpm -F llm-gateway test -- --run src/gateway.test.ts` 通过，21 tests passed；`pnpm -F extension test -- --run src/lib/runtimeModelConfig.test.ts src/lib/modelConfig.test.ts src/agent/useAgent.test.ts` 通过，43 files / 365 tests passed。
- 构建：`pnpm -F extension build` 通过并刷新 `.output/chrome-mv3`；构建日志仍有既有 es2025 target 警告。

## 下一步
- 如后续需要严格“每个新对话只鉴权一次”的协议语义，应给 OpenAI-compatible 请求增加会话 id 头并让网关按会话缓存；当前修复的边界是机器/模型维度的暖实例授权缓存。

## 追加修复：CloudBase 401 envelope 被误报为 invalid_schema
- **触发**：用户发送后看到 `type=invalid_schema`，rawError 为 `{ statusCode: 401, body: "{\"error\":{\"message\":\"Missing bearer token\",\"status\":401}}" }`。
- **根因**：CloudBase Function mode 把网关 401 包成 200 JSON envelope，`OpenAIClient` 在 HTTP 层没有识别这个 envelope，继续按 OpenAI chat completion schema 校验，最终误报 `No choices in response` / `invalid_schema`，且该错误可重试。
- **修复**：`packages/llms/src/OpenAIClient.ts` 在 schema 校验前识别 `{ statusCode, body }` 错误 envelope，并按 status 映射为原 HTTP 错误；`Missing bearer token` 映射为中文「无权限：请先在问学启动器同步本机 token。」的 `auth_error`，不可重试。
- **验证**：新增 `packages/llms/src/OpenAIClient.test.ts` 回归测试，先看到红灯，再修复通过；`pnpm -F @page-agent/llms test -- --run src/OpenAIClient.test.ts` 通过，59 tests passed；`pnpm -F @page-agent/llms build` 通过（仍有既有 `@microsoft/api-extractor` 缺失警告）；`pnpm -F extension build` 通过（仍有既有 es2025 target 警告）。
