# 补齐 Qwen3.7 内置模型成本估算

- 日期：2026-09-22
- 关联：`../docs/superpowers/plans/2026-09-22-token-cost-pricing.md`；当前运行时 CloudBaseLlmGateway / TokenUsageStore / ConsoleUI。
- 工作树：`/Users/outas/.codex/worktrees/token-cost-pricing/WenXue`，分支 `codex/token-cost-pricing`。
- 原工作区包含账号与界面相关未提交改动，本次在干净的独立工作树实施，未改动原工作区文件。

## 做了什么

- 按用户截图与确认的原价实现 Plus / Max 输入、输出、隐式命中、显式缓存创建及命中计价。Plus 超过 256,000 输入 tokens 的档位补充自官方文档，整次请求按总输入判档。
- JSON / SSE 用量读取缓存计数；显式模式由实际请求标记或非零创建计数判定。缓存命中/创建从总输入扣除后分项计价。
- 新云端记录保存计数、缓存模式、费用与价格版本；已有费用保持不变，历史缺少费用的记录按已有计数在读取时补算，缺少缓存明细按普通输入估算。
- 网关与本地记录汇总采用 0.0000001 元整数单位累加，完成总额/分组累计后再显示四位小数，防止小额费用及浮点临界舍入丢失。
- 桌面 Tokens 页新增可展开的价格、公式、阶梯、历史数据与覆盖范围说明。未新增批处理调用，不给 BYO-Key 日志套用内置供应商价格。
- 更新当前 `ARCHITECTURE.md` 的计量实体说明与计算契约，以及 `UIUX.md` 的规则查看交互。未新增架构模块/运行时依赖，目标产品已要求估算成本，本次为当前运行时补齐实现。
- 子代理只实现独立定价测试文件，主代理审阅并执行完整相关验证。

## 提交

- 基线：`f74986d` `feat(desktop): 完善浅色登录与两步注册界面`。
- `e2bbded` `feat(desktop): 估算内置模型调用成本并展示计价规则`：用户明确要求统一整理所有分支与未提交代码，定价功能、测试、架构与日志已一并提交到 `codex/token-cost-pricing`，由主工作区负责合并。

## 验证

- `pnpm -F llm-gateway test`：123/123 通过（含新增 36 个定价测试）。
- `pnpm -F desktop exec vitest run src/main/LauncherTelemetryIngest.test.ts src/main/UsageCloudClient.test.ts`：9/9 通过。
- `pnpm -F llm-gateway typecheck`、`pnpm -F desktop typecheck`：通过。
- `pnpm -F desktop build`：通过，包含 main/preload/renderer 构建。
- 涉及的源码/测试文件 ESLint 通过；Prettier 格式检查与 `git diff --check` 通过。
- 手工审阅 CloudBase 敏感运行时数据规则：新增记录只保存计数/模式/金额/价格版本，无提示词、响应正文或凭据；原有身份鉴权与上游透传边界保持。
- 未调用真实付费 LLM、未部署网关、未执行桌面真机视觉/交互验收；上述用量链路证据为自动化测试。
- 本次合并前复核重新运行网关 123 个测试、桌面相关 9 个测试、两包 typecheck，以及涉及源码/测试的 ESLint、Prettier 与 `git diff --check`，全部通过。未发现需要修改的功能缺陷；桌面 build 为原实施会话的验证证据，本次未重复构建。
- 审阅待提交文件清单与 diff：仅包含定价源码、测试、计划、规范和日志；无实际凭据、环境文件、构建产物或个人 IDE 文件。

## 下一步

- 发布网关代码后，在线 summary 才会返回新金额；桌面规则说明需使用更新后的桌面构建。
- 由主工作区合并 `codex/token-cost-pricing`；关注 `App.tsx`、`strings.ts`、`ARCHITECTURE.md` 与 `UIUX.md` 的相邻改动，保留定价说明及其他已授权界面功能。
