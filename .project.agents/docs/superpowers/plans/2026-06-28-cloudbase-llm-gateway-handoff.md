# 执行交接提示词 — CloudBase 自建 LLM 网关

> 把下面 `---` 之间的内容整段交给执行 agent（新会话、无上下文）。它自带必读清单与硬规则。

---

你将为 **问学 WenXue** 项目实现一个**自建 CloudBase LLM 网关**。严格按既有 spec + plan 执行，不要自由发挥架构。

## 0. 工作区
- 项目根目录：`问学 WenXue` 仓库根（先 `cd` 到仓库根，下列路径均相对它）。
- 这是 pnpm monorepo（`apps/desktop`、`apps/extension`、vendor `packages/*`）。

## 1. 动手前必读（按序，读完再动）
**项目治理（优先级高于一切，含硬约束）**
- `.project.agents/CLAUDE.md`
- `.project.agents/SELF_CONSTRAINTS.md` —— 任何编辑前先跑 **§A 开工自检**
- `.project.agents/VIBECODING_GUIDE.md`

**本任务的真理来源**
- 设计：`.project.agents/docs/superpowers/specs/2026-06-28-cloudbase-llm-gateway-design.md`
- 计划：`.project.agents/docs/superpowers/plans/2026-06-28-cloudbase-llm-gateway.md`

**相关上游章节**
- `.project.agents/docs/context/PRD.md`（M2 商业化地基）
- `.project.agents/docs/context/TECH-INFRA.md`（§7 演进、"M2 网关切换设计"、密钥矩阵）
- `.project.agents/docs/context/ARCHITECTURE.md`（不变量 I2/I4/I5）

**CloudBase**：本项目用 cloudbase 技能 + CloudBase MCP。任何 CloudBase 管理/部署前，先配 MCP（`npx mcporter`）并用设备码登录；按需读 cloudbase 技能的 `cloudrun-development` / `auth-web` / `no-sql-web-sdk` / `cloud-functions` 参考。

## 2. 已定决策（不要再问）
- **登录**：启动器登录 + 把会话交接给扩展（扩展据此取 `access_token` 调网关）。
- **自定义 BYO-Key 模型**：维持直连，不入网关、不动其本地 Key 逻辑。
- **限流**：后期再定，本期不做（但公开多用户前必须补——我方 Key 服务全员，token 泄漏会刷爆账户）。
- **保留/成本**：原始记录 90 天 + 永久日/模型汇总；成本云端按模型价目表算。
- **本地日志/正文**：留本机（插件 IndexedDB 不变，不随网关改动）。

## 3. 不可逾越的硬规则（错了会出大事）
1. **M0 端到端薄切片 spike 是全计划的门**。先只做 M0：跑通一条**真实流式**调用 `扩展 → CloudBase Run 网关(持百炼 Key) → 百炼 → SSE 流式回传`，调用方用 CloudBase 会话 token 鉴权、网关解析出 uid、捕获 token 用量、量出端到端延迟。**spike 通过 → 停下，把结果回报发起人、等放行再做 M1+；spike 不通过 → 不要继续，回报问题**（可能要改 host/区域/方案）。
2. **流式计量坑**：网关对流式请求**必须注入 `stream_options:{ include_usage:true }`**，否则 DashScope 流式响应**不返回 `usage`**、计量恒为 0。M0 就要验证末块 usage 非 0。
3. **删本地百炼 Key 是最后一步（M5）**。切换期保留本地直连兜底；**绝不把"切 baseURL"和"删 Key"放进同一提交**——否则网关一抖产品瘫痪、无法回滚。
4. **不改 vendored `packages/*`（I5）**。扩展切换是 **config-only**：只改 `apps/extension/src/agent/constants.ts` 里内置模型的 `baseURL`（→网关）和 `apiKey`（→运行时会话 token）。vendor `@page-agent/llms` 的 `OpenAIClient` 不动。
5. **网关只转发 + 计量，不持久化提示词/响应正文**（搜题考题虽过网关也不落库）。`token_usage` 集合不含正文/Key/敏感头，并加"无泄漏"断言测试。
6. **百炼（DashScope）API Key 仅存网关环境变量**，永不下发插件/桌面/打包产物/本地存储。
7. **I2 已反转**（提示词经网关离开本机）。按 `SELF_CONSTRAINTS §B3`，模块/行为变更**同提交**更新 `PRD/ARCHITECTURE/TECH-INFRA/ROADMAP`。

## 4. 执行纪律
- 严格按计划里程碑顺序：**M0(门) → M1 → M2 → M3 → M4 → M5(删 Key 收尾) → M6**。
- 每个里程碑走 **TDD**：先写失败测试 → 跑挂 → 最小实现 → 跑过 → commit，小步频繁提交。
- 每完成一个可独立验收的里程碑：在 `.project.agents/log/` 写执行日志（含本段提交列表），并**同提交**勾选 plan/ROADMAP 对应项。
- 越界/顺手的改动单独提交并明确告知；遇到与 `SELF_CONSTRAINTS`/上游文档冲突 → 先停下对齐，不要默默选边。
- 大块实现优先派子代理；主线负责拆解、复核、勾选。

## 5. M0 前需发起人提供/确认
- CloudBase 账号与环境访问（MCP 设备码登录）。
- **百炼（DashScope）API Key**（注入网关环境变量，仅服务端）。
- CloudBase 环境区域（尽量贴近百炼以降延迟）。

## 6. 构建/测试已知坑（自行核实，命令以仓库文档为准）
- 改扩展源码后必须 `pnpm -F extension build`（或 `pnpm -F extension dev`）；根 `dev` 不 watch 扩展。
- `pnpm -F extension build`（esbuild）**不做类型检查**；要查类型错误另跑 `tsc --noEmit`。
- `pnpm -r test` 在受限环境里因 desktop 缺 Electron 二进制可能假失败；扩展测试用 `pnpm -F extension test`。

## 7. 起步动作
1. 读完 §1 必读 + §2/§3 规则。
2. 跑 `SELF_CONSTRAINTS §A` 自检（仓库是否干净、归属模块是否清楚等）。
3. 向发起人要 §5 的前置（CloudBase 访问 + 百炼 Key）。
4. 执行 plan **M0**：配 CloudBase MCP/env → 起最小 CloudBase Run（Function 模式）网关雏形 → 跑通一条流式调用，验证 **usage 非 0** 与延迟基线。
5. **在 M0 门停下**，回报：流式是否正常、usage 是否非 0、延迟基线、是否建议继续。

---
