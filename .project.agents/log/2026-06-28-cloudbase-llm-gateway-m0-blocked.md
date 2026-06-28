# CloudBase LLM Gateway M0 本地雏形与 CloudRun 阻塞

- **日期**：2026-06-28
- **关联**：CloudBase LLM Gateway M0 spike / `.project.agents/docs/superpowers/plans/2026-06-28-cloudbase-llm-gateway.md`
- **会话上下文**：用户明确允许在当前脏工作区上继续修改，并授权使用扩展内现有内置 DashScope Key 作为服务端注入来源；本段只推进 M0 门。

## 做了什么

- 读取项目治理、CloudBase / CloudRun / Auth 技能与 M0 设计计划。
- 通过 CloudBase MCP 绑定并确认环境 `wenxue-d8gz76tacc3659f05`（ap-shanghai），Auth 管理侧登录 READY。
- 读取扩展内现有内置 DashScope Key，仅在 shell 进程内用于 CloudBase Run 环境变量注入，未写入仓库、日志或命令输出。
- 新增 `apps/llm-gateway` CloudBase Run Function mode 雏形，入口为 `/v1/chat/completions`。
- TDD 覆盖：CloudBase bearer token 缺失拒绝、token introspect→uid、DashScope 流式 `stream_options.include_usage` 注入、SSE usage 解析、uid 维度 usage record 无正文/Key/敏感头。
- 更新上游文档，登记 I2 反转、CloudBaseLlmGateway 模块、密钥边界、M0 spike 路线图。
- 尝试部署 `wenxue-llm-gateway` 到 CloudBase Run Function mode；MCP 返回 `[CreateCloudRunServer] 云托管资源未开通`。
- 使用 TCBR 官方 SDK + MCP 临时凭证检查资源状态：
  - `DescribeEnvBaseInfo`：环境存在，`Status=NORMAL`，`EnvType=baas`，`PackageType=Trial`。
  - `DescribeCloudRunEnvs`：同一 envId 在 TCBR 视图下 `Status=UNAVAILABLE`，`PackageId=baas_trial`。
  - `DescribeCloudRunServers`：服务数量 0。
- 调用 `CreateCloudRunEnv` 尝试开通：
  - `EnvType=tcbr` 请求被接受，返回 `EnvId`/`TranId`/`RequestId`，但 100 秒轮询后状态仍为 `UNAVAILABLE`。
  - 按环境实际 `EnvType=baas` 重试，返回 `FailedOperation: 环境信息入库失败`。

## 提交

- 未提交，工作树状态：本会话新增/修改文件尚未形成可通过 M0 门的提交；另有会话开始前已存在的 token telemetry 文档改动与 CloudBase 网关设计/计划未跟踪文件。

## 状态变更

- 架构文档：已更新 `ARCHITECTURE.md` 的 I2、模块清单、依赖图、接口契约、持久化边界、测试边界、目录结构。
- 需求/基础设施/路线图：已更新 `PRD.md`、`TECH-INFRA.md`、`ROADMAP.md`，描述内置模型经网关、自定义 BYO-Key 仍直连、M0 CloudBase Run Function mode spike。
- 测试：
  - `npx pnpm@9.15.0 -F llm-gateway test` 通过（7 tests）。
  - `npx pnpm@9.15.0 -F llm-gateway typecheck` 通过。

## M0 门状态

- **未通过**。
- 未能完成真实流式调用 `扩展/脚本 -> CloudBase Run 网关 -> DashScope -> SSE`，因此没有端到端 usage/延迟基线。
- 阻塞点不是本地代码、测试或 Key 注入，而是目标 CloudBase 环境的 CloudRun/TCBR 资源仍为 `UNAVAILABLE`，部署接口持续返回“云托管资源未开通”。
- 按计划硬规则：M0 未过前不得进入 M1+，不得切扩展内置模型 baseURL，不能删除本地百炼 Key。

## 下一步

- 需要在腾讯云/CloudBase 控制台确认并完成 `wenxue-d8gz76tacc3659f05` 的云托管/CloudBase Run 资源开通，使 TCBR 状态从 `UNAVAILABLE` 进入可创建服务状态。
- 资源就绪后：部署 `wenxue-llm-gateway`，创建/登录 M0 smoke 用户拿 CloudBase access_token，运行 `apps/llm-gateway/scripts/m0-stream-check.mjs`，验证 SSE chunks、末块 usage 非 0 与延迟基线。
- M0 通过前不得进入 M1+，不得切扩展内置模型 baseURL，不能删除本地百炼 Key。
