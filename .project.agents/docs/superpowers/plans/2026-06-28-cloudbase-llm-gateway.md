# CloudBase 自建 LLM 网关 — 实施计划（里程碑级）

> **For agentic workers:** 关联设计：[../specs/2026-06-28-cloudbase-llm-gateway-design.md](../specs/2026-06-28-cloudbase-llm-gateway-design.md)。取代已废弃的 token-telemetry 计划。里程碑级：每个里程碑在执行时展开为 TDD 逐步任务，按 `SELF_CONSTRAINTS §B6` 写执行日志。**M0 spike 是全计划的门；删本地 Key 是最后一步。**

**Goal:** 扩展内置模型调用经自建 CloudBase 网关（OpenAI 兼容透传百炼），百炼 Key 仅存服务端，CloudBase Auth 登录，网关服务端按 uid 计量 token，启动器 tokens 页读网关计量。

**Architecture:** CloudBase Run（Function 模式，Node）做 OpenAI 兼容流式透传网关，持 DashScope Key、校验会话 token→uid、注入 `stream_options.include_usage` 计量；扩展把内置模型 `baseURL`→网关、`apiKey`→会话 token（vendor `OpenAIClient` 不改）；启动器登录 + 读计量。

**Tech Stack:** CloudBase Run / NoSQL / 云函数 / Auth · `@cloudbase/js-sdk` v2 · DashScope OpenAI 兼容（百炼）· Electron · WXT/MV3。

## Global Constraints（每个任务隐含遵守）

- **I2（已反转）**：提示词/对话经网关转发百炼；**网关只转发+计量、不持久化正文**；**百炼 Key 仅存网关环境变量**，永不下发插件/桌面/本地。
- **流式必injectinclude_usage**：网关对流式请求注入 `stream_options:{include_usage:true}`，否则计量恒 0。
- **限流后期再定**（本计划不实现）；但**公开多用户前必须补上**（我方 Key 服务全员，会话 token 泄漏会刷爆账户）。预留 uid 维度便于后续加。
- **删本地 Key = 最后一步**：切换期保留本地直连兜底，验证通过才删；切 baseURL 与删 Key **不同提交**。
- **自定义 BYO-Key 模型维持直连**，不入网关、不动其本地 Key 逻辑。
- **计量/上报无正文**：`token_usage` 不含 prompt/正文/Key/敏感头；配无泄漏断言。
- CloudBase `EnvId` 显式；不用 `any`；文档同提交（`§B3`）；命名禁 Manager/Helper/Util；每里程碑写 `.project.agents/log/` 日志。

## 文件地图

**网关（新建 `apps/llm-gateway/`，CloudBase Run Function 模式）**
- OpenAI 兼容 `/v1/chat/completions`（+ `/v1/models`）透传 DashScope。
- token 校验→uid；DashScope Key 读 env；SSE 注入 `include_usage` + 逐块转发；usage→计量；按 uid 限流。
- 部署/权限脚本（CloudBase MCP）。

**CloudBase（云函数 + 集合）**
- 集合 `token_usage`/`token_usage_rollup`（`PRIVATE`）。
- 云函数 `usage-summary`/`usage-rollup`。

**插件域**
- 改 `apps/extension/src/agent/constants.ts`：`DEMO_CONFIG`/`DEMO_VISION_CONFIG` 的 `baseURL`→网关、`apiKey`→运行时会话 token；M3 切换期曾保留兜底开关，M5 已删除。
- 改扩展组装根：注入会话 token、网关地址。
- `modelConfig.ts` 自定义模型：**不动**。

**桌面域**
- 新建 `apps/desktop/src/main/LauncherAuthSession.ts`、`UsageCloudClient.ts`。
- 改 `DesktopBridge.ts`（`tokens:getSummary` 改读云 + auth IPC）、`MainBootstrap.ts`、`preload/index.ts`、`renderer/src/`（登录 UI）。

**上游文档**：`PRD.md`/`ARCHITECTURE.md`/`TECH-INFRA.md`/`ROADMAP.md`（设计 §9）。

---

## 里程碑

### M0 — 端到端薄切片 Spike（**全计划的门**）
**前置**：用户复审设计、敲定 §11 五项。
- [x] 配 CloudBase MCP；建/解析 env（完整 `EnvId`+region）。
- [x] CloudBase Run（container-backed functions-framework）建 `wenxue-llm-gateway` 雏形：env 注入 DashScope Key；`/v1/chat/completions` 透传百炼；校验一个 CloudBase 会话 token→uid。
- [x] **流式打通**：脚本带 `access_token` 发**流式**请求 → 网关注入 `stream_options.include_usage` → 百炼 → SSE 逐块回传。
- [x] **验证三件事**：流式逐块正常；**末块 `usage` 非 0**（含 include_usage）；端到端延迟基线 1075ms。
**验收/门**：流式+鉴权+计量+延迟全部 OK → 进 M1；任一不行 → 回设计（改 host/区域/方案）。

### M1 — 网关硬化
**前置**：M0 通过。
- [x] 完整 OpenAI 兼容透传：文本+视觉模型、`tool_choice`、思考开关、视觉图片**原样透传**（搜题行为不回归）。
- [x] 计量：从流式末块/非流式 `usage` 取数 → 写 `token_usage(uid)`，**无正文**（无泄漏断言）。
- [x] token 无效/缺失拒绝（**限流后期再定，本里程碑不做**；预留 uid 维度便于后续加）。
- [x] 错误/超时处理；`MinNum≥1` 部署、PUBLIC 访问。
**验收**：真实文本/视觉/搜题流式调用稳定计量；token 无效拒绝；无正文落库。

### M2 — CloudBase Auth 登录（启动器）+ 会话交接
**前置**：M0（env+providers）。
- [x] 开 Auth providers（用户名密码/手机 OTP），关匿名，取 publishable key。
- [x] `LauncherAuthSession`：login/logout/getSession/uid/access_token；真实登录后用 `/auth/v1/user/me` 判 `type=external` 产品用户。
- [x] preload 暴露 auth API + 渲染层登录面板。
- [x] 会话交接扩展（经 `externally_connectable`）：扩展据此取 `access_token`。
**验收**：启动器可登录登出；扩展能拿到有效 `access_token`。

### M3 — 内置模型切到网关（**保留本地直连兜底**）
**前置**：M1、M2。
- [x] 改 `constants.ts`：内置模型 `baseURL`→网关、`apiKey`→会话 token；**加兜底开关**（可切回本地直连）。
- [x] 扩展组装根注入会话 token + 网关地址。
- [x] **真实使用验证**：Agent tools + 视觉 + 流式经网关全部正常，计量正确归 uid；默认文本模型改为已验证支持 `tool_choice=required` 的 `qwen-plus`。
**验收**：内置模型经网关稳定工作；本地直连兜底仍可用（尚未删 Key）。

### M4 — tokens 页读网关计量
**前置**：M1（计量）、M2（登录）。
- [x] `usage-summary` CloudBase Run target：`GET /v1/usage/summary` 实时聚合当前产品用户 `token_usage`，返回脱敏 `TokenUsageSummary`（不含 uid/Key/敏感头）。
- [x] `UsageCloudClient` + `tokens:getSummary` 改读云；按 uid 写离线缓存，云端失败回退本地 `TokenUsageStore`，契约不破。
- [ ] `usage-rollup`/按价目表成本估算：当前 M4 先以实时 summary 满足 tokens 页可见计量，rollup 与精确成本后续单独推进。
**验收**：登录后 tokens 页显示网关计量的按用户用量；断网兜底。

### M5 — 删除本地 Key（**切换收尾，最后一步**）
**前置**：M3 验证通过、M4 可见计量。
- [x] 移除扩展内置模型的本地 demo API Key（打包产物 + `chrome.storage`）。
- [x] 移除内置模型的本地直连兜底，网关成为内置模型唯一路径。
- [x] **无本地 Key 残留断言**测试；自定义 BYO-Key 模型路径不受影响。
**验收**：内置模型本地无任何百炼 Key；网关为唯一通路；自定义模型仍直连自带 Key。

### M6 — 文档收口 + 集成 + 日志
- [x] 全链路联调（登录→网关调用→计量→tokens 展示）。
- [x] 改 `PRD/ARCHITECTURE/TECH-INFRA/ROADMAP`（I2 反转、新模块、M2 网关推进、密钥矩阵）。
- [x] 写 `.project.agents/log/` 执行日志（含提交列表）。
**验收**：端到端可用；文档与实现零漂移；日志完成。

## 依赖图
```
M0(门) ─> M1 ─┬─> M3 ─┐
              │        ├─> M5 ─> M6
        M2 ───┴─> M4 ──┘
   (M2 前置仅需 M0；M3 需 M1+M2；M4 需 M1+M2；M5 需 M3+M4)
```

## 自检（计划 vs 设计）
- 网关透传/鉴权/Key 托管/流式/计量/限流（设计 §4.1）→ M0+M1。✓
- `include_usage` 注入（设计 §4.1 坑）→ M0 验、M1 固化。✓
- 登录 + 会话交接（设计 §4.2）→ M2。✓
- 扩展 baseURL/凭据切换、vendor 不改、自定义直连（设计 §4.3）→ M3 + Global Constraints。✓
- tokens 读云（设计 §4.4/4.5）→ M4。✓
- 硬依赖/分阶段切换/删 Key 最后（设计 §5）→ M3 兜底验证 + M5 删除。✓
- I2 反转 + 文档（设计 §3/§9）→ M6（且每里程碑同提交）。✓
- 不落正文（设计 §6）→ M1 无泄漏断言。✓
- 非目标（收款、自定义入网关）未纳入。✓
