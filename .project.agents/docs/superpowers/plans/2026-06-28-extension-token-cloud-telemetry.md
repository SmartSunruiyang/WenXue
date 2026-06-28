# 扩展 Token 用量上云 + CloudBase 登录 — 实施计划（里程碑级）

> ⚠️ **已废弃 / SUPERSEDED（2026-06-28）**：被 [cloudbase-llm-gateway.md](./2026-06-28-cloudbase-llm-gateway.md) 取代（用户改为自建 LLM 网关，服务端计量）。本计划仅留作历史。

> **For agentic workers:** 关联设计：[../specs/2026-06-28-extension-token-cloud-telemetry-design.md](../specs/2026-06-28-extension-token-cloud-telemetry-design.md)。本计划为**里程碑级**：每个里程碑在执行时（X/Y 锁定 + CloudBase env 就绪后）再用 `superpowers:subagent-driven-development` 展开为 TDD 逐步任务，并按 `SELF_CONSTRAINTS §B6` 写执行日志。Steps 用 `- [ ]` 跟踪。

**Goal:** 让启动器 tokens 页显示**按登录用户**归属的扩展 token 消耗——扩展统计单次用量、上报到 CloudBase、启动器从云端读；并引入 CloudBase Auth 登录。

**Architecture:** 登录在启动器（CloudBase Web SDK）；tokens 进 CloudBase `token_usage`（`PRIVATE` 按 uid 隔离）；云函数算汇总/滚动/保留；启动器从云端读 summary。上报路径**默认方案 X**（扩展持会话直写云），方案 Y（扩展→NM→启动器→云）为可切备选。

**Tech Stack:** 腾讯云 CloudBase（NoSQL + 云函数 + Auth）· `@cloudbase/js-sdk` v2 · Electron（desktop）· WXT/MV3（extension）· packages/llms。

## Global Constraints（每个任务都隐含遵守）

- **只 token 计数+元数据出本机**：上报体仅 `{ id, ts, browserId, model, inputTokens, outputTokens, totalTokens }`；**严禁**正文/提示词/`Authorization`/`Bearer`/API Key。每个产数据的模块配"无泄漏"断言测试。
- **展示级非计费级**：云端数字用于展示/排障，不作计费依据（计费待 M2 网关）。
- **CloudBase `EnvId` 显式**写入代码/配置，不依赖 CLI 默认。
- **不用 `any` 绕类型**（CloudBase 工程宪法）：用 `unknown`+守卫/精确接口。
- **文档同步同提交**（`SELF_CONSTRAINTS §B3`）：功能改 `PRD.md`、模块/依赖改 `ARCHITECTURE.md`、供应链/选型改 `TECH-INFRA.md`。
- **命名**：动词+名词真实职责，禁 Manager/Helper/Util/Common/Misc/Tools。
- **每里程碑写执行日志**到 `.project.agents/log/`，含提交列表。

## 文件地图

**插件域**
- 新建 `apps/extension/src/lib/usageReporter.ts` — 单次 usage 归一、缓冲、断网入队、幂等、（X）CloudBase 直传 /（Y）塞入 NM 遥测。
- 改 `apps/extension/src/agent/chaoxing/llm.ts` — 提取响应 `usage`。
- 改扩展组装根（entrypoints）— 装配 UsageReporter；（X）注入 CloudBase env/publishable key、接收 `refresh_token`。

**云端（CloudBase，新建 `apps/cloud/` 工作区或 functions 目录）**
- `token_usage` / `token_usage_rollup` 集合 + `PRIVATE` 权限。
- 云函数 `usage-summary`（按 uid 聚合 → `TokenUsageSummary`）。
- 云函数 `usage-rollup`（定时：滚动汇总 + 保留裁剪）。
- 部署/权限脚本（经 CloudBase MCP）。

**桌面域**
- 新建 `apps/desktop/src/main/LauncherAuthSession.ts` — 持登录态/会话/uid/refresh_token。
- 新建 `apps/desktop/src/main/UsageCloudClient.ts` — 调 `usage-summary`，离线兜底。
- 改 `apps/desktop/src/main/DesktopBridge.ts` — `tokens:getSummary` 改由 UsageCloudClient 供数；新增 auth 相关 IPC。
- 改 `apps/desktop/src/main/MainBootstrap.ts` — 装配新模块。
- 改 `apps/desktop/src/preload/index.ts` + `apps/desktop/src/renderer/src/` — 暴露 auth API + 登录 UI 组件。
- （Y）新建 Native Messaging 宿主 + 清单注册。

**上游文档**：`PRD.md` / `ARCHITECTURE.md` / `TECH-INFRA.md`（见设计 §9）。

---

## 里程碑

### M0 — 决策锁定 + CloudBase 开通 + 文档修订
**前置**：用户复审设计；敲定登录入口/保留/成本/读取四项（**X/Y 由本里程碑的 spike 决定**）。
- [ ] 配 CloudBase MCP（`npx mcporter`），创建/解析 env（拿到完整 `EnvId` + region）。
- [ ] 开启 Auth providers（用户名密码 / 手机 OTP），关匿名；取 publishable key。
- [ ] 建 `token_usage` / `token_usage_rollup` 集合，设 `PRIVATE` 权限，建 `ts`/`model` 索引。
- [ ] **X 可行性 spike（决定 X/Y 的关键证据，整个设计最高风险未知项）**：启动器登录 → 交接 `refresh_token` → 扩展 `setSession` → 在 `PRIVATE` 的 `token_usage` 成功写一条、并由**启动器会话读回**（验证"同 uid = 同创建者"）。**通过 → X 可选；失败 → 锁定 Y**。
- [ ] 据 spike 结论锁定 X/Y。
- [ ] 修订 `PRD.md`/`ARCHITECTURE.md`/`TECH-INFRA.md`（I2 措辞、新模块登记、范围提前、选型 ADR）+ 提交。
**验收**：env/集合/`PRIVATE` 权限就绪；**X 可行性 spike 有明确结论（X 可选 / 锁 Y）**；X/Y 与 4 项可否决已定；上游文档与设计一致并已提交。

### M1 — 扩展单次 usage 统计（本地，先不上云）
**前置**：M0 文档部分（模块已登记）。
- [ ] `usageReporter.ts`：归一 `OpenAIClient` 的 `usage` → `TokenUsageRecord`；缓冲/flush/断网入队/按 id 幂等。
- [ ] `chaoxing/llm.ts`：提取响应 `usage`。
- [ ] **无泄漏测试**：断言产出仅 token 字段，无正文/凭据。
- [ ] 单测：归一、批量、断网重试、幂等、搜题取数。
**验收**：扩展能在内存/队列中正确产出 token 记录并通过无泄漏测试；尚未联网上云。

### M2 — CloudBase 后端（集合 + 云函数）
**前置**：M0。
- [ ] `usage-summary` 云函数：按调用者 uid 聚合 totals/byBrowser/byModel/daily/recent，成本按价目表算。
- [ ] `usage-rollup` 定时函数：滚动汇总 + 保留裁剪（默认 90 天原始 + 永久汇总）。
- [ ] 部署 + `PRIVATE` 跨 uid 拒绝验证。
**验收**：以两个测试 uid 写入样本 → `usage-summary` 各自只见自己的数据；rollup/保留按期运行。

### M3 — CloudBase Auth 登录（启动器）
**前置**：M0（providers + publishable key）。
- [ ] `LauncherAuthSession.ts`：`init/login/logout/getSession/uid/refreshToken`；用 `auth.getSession()` 判真实登录。
- [ ] preload 暴露 auth API；渲染层登录面板 + 登录态守卫。
- [ ] 单测：登录态判定（含"仅 accessKey 的假登录"必须判为未登录）。
**验收**：启动器可登录/登出，正确反映真实登录态。

### M4 — 上报联通（X 或 Y，由 M0 spike 决定）
**前置**：M1、M2、M3，且 **M0 spike 已给出 X/Y 结论**。
- [ ] **X（仅当 M0 spike 通过）**：扩展内置 CloudBase SDK；启动器经 `externally_connectable` 交接 `refresh_token`；扩展 `setSession` 后直写 `token_usage`；失效重交接。
- [ ] **（Y 备选）**：建 NM 宿主 → 转 `telemetry:ingest`；启动器以登录 uid 上云；复用 `LauncherTelemetryIngest.tokenUsage[]`。
- [ ] 端到端：一次真实 LLM 调用 → 记录出现在 CloudBase，归属正确 uid。
**验收**：真实调用后云端可见对应 token 记录，且只含允许字段。

### M5 — 启动器从云端读
**前置**：M2、M3。
- [ ] `UsageCloudClient.ts`：调 `usage-summary`；在线为数据源，断网回退本地缓存。
- [ ] `tokens:getSummary` 切到 UsageCloudClient；`token-usage.json` 降为缓存；契约不破。
- [ ] tokens 页显示"离线/未登录"态。
- [ ] 单测：summary 映射、离线兜底。
**验收**：登录后 tokens 页显示云端按用户汇总；断网显示缓存 + 明确状态。

### M6 — 集成、文档收口、日志
- [ ] 全链路联调（登录→调用→上报→汇总→展示）。
- [ ] 复核 `PRD/ARCHITECTURE/TECH-INFRA` 与最终实现一致。
- [ ] 写 `.project.agents/log/` 执行日志（含提交列表）。
**验收**：端到端可用；文档与代码零漂移；日志完成。

## 依赖图
```
M0 ──┬─> M1 ─┐
     ├─> M2 ─┼─> M4 ─┐
     └─> M3 ─┴─> M5 ─┴─> M6
```

## 自检（计划 vs 设计）
- 设计 §6 各模块 → M1（UsageReporter/搜题）、M2（集合/函数）、M3（Auth）、M4（上报）、M5（读取）均有对应。✓
- 无泄漏/脱敏（设计 §10）→ M1 显式任务。✓
- 文档修订（设计 §9）→ M0 + M6。✓
- X/Y 与 5 项可否决（设计 §5/§11）→ M0 锁定，M4 分支。✓
- 未含计费/网关透传（非目标）。✓
