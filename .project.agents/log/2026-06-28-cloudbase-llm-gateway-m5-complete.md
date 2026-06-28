# CloudBase LLM Gateway M5 删除内置本地 Key 完成

- **日期**：2026-06-28
- **关联**：CloudBase LLM Gateway 计划 M5 / PRD F4、F9 / ARCHITECTURE `ExtensionSettingsConfig`
- **会话上下文**：M4 已验证 tokens 页可读网关计量，满足删本地 Key 的前置条件。

## 做了什么
- 从扩展内置模型 constants 中移除本地 DashScope 直连配置、内置百炼 Key、文本/视觉 fallback config。
- 从 `runtimeModelConfig` 移除 `WenXueUseLocalBuiltinLlmFallback` 读取与 fallback 分支；内置模型现在必须有有效 CloudBase 外部产品用户 session，运行时只注入网关 baseURL + access token。
- 保留旧 DashScope baseURL 作为 legacy endpoint 识别，用于把历史直接配置迁移到网关默认配置；不包含 Key。
- 保持自定义 BYO-Key 模型直连逻辑不变。

## 提交
- 未提交，工作树仍在 M0–M5 连续推进状态；待 M6 全链路收口后统一整理提交。

## 状态变更
- 架构文档：`ModelConfig` / `ExtensionSettingsConfig` 去除有效 fallback 能力描述，明确历史 fallback 标志被忽略。
- 需求/基础设施/路线图：PRD F4 改为网关是内置模型唯一路径；TECH-INFRA 记录 M5 删除本地 Key；ROADMAP 与 CloudBase 计划 M5 复选框已勾选。
- 安全状态：扩展源码、扩展构建产物、桌面构建产物均未命中真实内置百炼 Key；旧 fallback 符号只保留在测试里作为“历史标志被忽略”的断言。

## 验证
- `npx pnpm@9.15.0 -F extension exec vitest run src/lib/runtimeModelConfig.test.ts src/lib/configStorage.test.ts src/lib/modelConfig.test.ts src/lib/settingsConfig.test.ts src/agent/useAgent.test.ts`：65 tests passed
- `npx pnpm@9.15.0 -F extension test`：360 tests passed
- `npx pnpm@9.15.0 -F extension build`：passed（仅既有 es2025 / react-babel 警告）
- 真实内置百炼 Key 指纹扫描（扩展源码 + 扩展构建产物）：无命中
- 真实内置百炼 Key 指纹扫描（桌面构建产物）：无命中

## 下一步
- M6：全链路联调与文档/日志收口；必要时补 `usage-rollup` 与精确成本估算的后续计划。
