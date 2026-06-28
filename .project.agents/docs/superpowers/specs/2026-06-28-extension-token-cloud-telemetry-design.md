# 扩展 Token 用量上云 + CloudBase 账户登录 — 设计

> ⚠️ **已废弃 / SUPERSEDED（2026-06-28）**：用户改为"全量大改动 = 自建 CloudBase LLM 网关"，网关服务端计量 token（权威/计费级），取代本"扩展自报遥测"方案。本文档仅留作历史。现行设计见 [cloudbase-llm-gateway-design.md](./2026-06-28-cloudbase-llm-gateway-design.md)。存活下来的部分（CloudBase 登录、tokens 页从云读）已并入新设计。

- 日期：2026-06-28
- 状态：已废弃（被 LLM 网关设计取代）
- 关联：上游 `PRD.md` / `ARCHITECTURE.md` / `TECH-INFRA.md`（本设计需同步修订，见 §9）

## 1. 背景与问题

启动器 tokens 页（[App.tsx `TokensPage`](../../../../apps/desktop/src/renderer/src/App.tsx)）读 [`TokenUsageStore`](../../../../apps/desktop/src/main/TokenUsageStore.ts) 的 `token-usage.json`，该文件只由 [`LauncherTelemetryIngest`](../../../../apps/desktop/src/main/LauncherTelemetryIngest.ts) 写，而后者只能经 `telemetry:ingest` 受控入口触发——目前**无人调用**，所以页面永远看不到扩展消耗。扩展的单次 token 用量其实已经现成（[`OpenAIClient.ts` 解析 `usage`](../../../../packages/llms/src/OpenAIClient.ts)），只是从未跨进程送出。

产品目标（用户确认）：**只把 tokens 上云**，并借此**为 M2 商业化网关铺路**；顺带把**用户登录用 CloudBase Auth** 做掉。日志与请求/响应正文**维持本地方案不上云**。

## 2. 目标 / 非目标

**目标**
- 扩展统计每次 LLM 调用的 token 用量（输入/输出/总量 + 模型 + 时间）。
- 这些 token 记录上报到 **CloudBase**，按**登录用户**归属。
- 启动器 tokens 页从 CloudBase 读取**按用户**的汇总。
- 引入 **CloudBase Auth 用户登录**（账户体系的第一步，M2 复用）。

**非目标**
- 不上传任何提示词/对话/请求响应正文/凭据（这些维持本地）。
- 云端 token 数为**展示/排障级，非计费级**；计费级计量待 M2 网关服务端接管（本设计是铺路，不是网关本身）。
- 不做订阅/计费/网关透传（M2）。

## 3. 硬约束影响（必须显式承担）

本设计触碰上游不变量，需在**同一批改动**内修订（`SELF_CONSTRAINTS §B3`）：

- **I2**（`ARCHITECTURE.md`）：当前"对话内容永不离开本机"。→ 微调为：**token 计数 + 元数据（模型/时间/browserId/uid）可上云；对话内容、提示词、请求响应正文、凭据仍永不离开本机**。上报体只含既有 `TokenUsageRecord` 字段（架构已声明其"不含提示词正文/Key/敏感头"）。
- **I3**：两域零运行时通信 + Native Messaging 单向豁免。→ tokens 路径不在两域间直连（见 §5 两方案）；需把 `TECH-INFRA.md` "Demo 不上报云端" 收窄为 "**仅 tokens 上报云端；日志/正文不上云**"。
- **范围/里程碑**：`PRD.md` 把"账户体系/云端后端"列为 M2。→ 把**"用户登录 + tokens 遥测上云"**这一窄切片提前为当前里程碑，标注其余 M2 能力（计费/网关/透传）仍未开始。

## 4. 技术栈（已定）

- 云端：**腾讯云开发 CloudBase**（国内可达，贴合超星用户；演进到 `gateway.wenxue.app` 网关同栈）。
- Auth：**CloudBase Web SDK v2**（`@cloudbase/js-sdk`，Supabase 风格 `{data,error}` API）。
- 数据：CloudBase **NoSQL 文档库**（`token_usage` 集合 + 滚动汇总）。
- 计算：CloudBase **云函数**（汇总查询 + 定时滚动/保留）。

## 5. 架构决策（⚠️ 待复审的关键分叉：上报路径 X vs Y）

两方案的"登录在启动器、tokens 进 CloudBase、启动器从云读"都一致，**区别只在 tokens 从扩展到云的那一段**。

### 方案 X（默认，贴合"扩展自报 + 扩展→云"的既定取向）
扩展持有用户会话，直接写 CloudBase。
- 启动器渲染层登录 CloudBase Auth → 取 `refresh_token`。
- 启动器经现有 `externally_connectable` 通道把 `refresh_token` 交给扩展（复用 background.ts 外部消息）。
- 扩展 `auth.setSession({ refresh_token })` 取得**同一 uid** 会话，之后 Web SDK 自动续期。
- 扩展把 `TokenUsageRecord` 直接 `db.collection('token_usage').add(...)`，由 **`PRIVATE` 权限**保证只能读写自己的记录。
- **⚠️ 未验证的承重假设**：`setSession({refresh_token})` 能否在扩展这个**独立 SDK 实例/上下文**里建立**可写**的同 uid 会话（参考文档只把它列为"外部/SSR hydration"，并非跨进程直写的证明）。此假设若不成立，X 整体不可行、退 Y。→ 必须先在 M0 做可行性 spike 验证（启动器登录→交接→扩展 `setSession`→`PRIVATE` 下成功写一条并由启动器读回）。
- **取舍**：扩展引入 CloudBase SDK 且**常驻持有用户 refresh_token**。务必分清两件事：**记录**低敏感（仅 token 计数）**≠ 凭据**低敏感——这个 refresh_token 对应的账户，按"为网关铺路"正是将来的**计费身份**；而 MV3 扩展带内容脚本注入任意页面，其**账户接管面远大于** Electron 主进程。故在本目标下，"风险可接受"是被低估的。优点：最贴近"扩展→云"设想、启动器改动小。

### 方案 Y（备选，更干净/更复用，但启动器多干活）
扩展只把 tokens 经 **Native Messaging** 报给启动器，由启动器上云。
- 复用**已建好**的 `telemetry:ingest` / `LauncherTelemetryIngest`（其 `tokenUsage[]` 入口正好接收 token 记录）。
- 扩展不碰 CloudBase（无 SDK、无凭据）；CloudBase Auth 只在启动器一处。
- 命中 I3 的 Native Messaging 豁免；但需**新建 NM 宿主**（架构已为此预留 `telemetry:ingest`）。
- **取舍**：安全面更小、复用最多、最合规；但偏离"扩展→云"的设想，且要建 NM 宿主。

> **这一项比"默认 X"看起来更接近五五开，需要你拍板：**
> - **X** 贴合你"扩展→云"的表述、启动器改动小；但把（未来的）**计费账户凭据放进扩展**，且依赖上面那条**未验证的跨进程会话假设**。
> - **Y** 是项目**自己预留**的路：I3 豁免点名 Native Messaging 做 tokens 遥测，且 `telemetry:ingest` + `LauncherTelemetryIngest.tokenUsage[]` **已建好等着接**；扩展零云凭据、最合规；代价是建 NM 宿主。
>
> 建议次序：先用 **M0 可行性 spike** 验证 X 的会话假设——**通过则 X 可选，不通过则锁 Y**。数据模型/登录/汇总/保留各节两者通用，切换成本低。

下文除 §6.1 / §6.3 标注处外，X 与 Y 通用。

## 6. 组件

### 6.1 插件域

- **UsageReporter（新模块）** — 把 [`OpenAIClient`](../../../../packages/llms/src/OpenAIClient.ts) 已解析的单次 `usage` 归一为 `TokenUsageRecord`，缓冲、按量/时长 flush、断网入队重试、按 `id` 幂等。
  - 搜题路径（[`chaoxing/llm.ts`](../../../../apps/extension/src/agent/chaoxing/llm.ts)）补一处 `usage` 提取（其响应含 usage，目前未取）。
  - 上报体**只含** `{ id, ts, browserId, model, inputTokens, outputTokens, totalTokens }`；附"无泄漏"断言（见 §10）。
  - **方案 X**：内置 CloudBase Web SDK，`setSession` 后直接 `add` 到 `token_usage`。
  - **方案 Y**：把记录塞进发往启动器的 NM 遥测 `tokenUsage[]`，不引入 CloudBase。
- 既有 [`loggingFetch`](../../../../apps/extension/src/lib/loggingFetch.ts) / 日志 / 正文：**不变**，仍只进本机 IndexedDB。

### 6.2 CloudBase 后端（greenfield）

- **环境**：单独 CloudBase env（`EnvId` 显式写入配置，不依赖默认）。
- **Auth providers**：开用户名+密码 与/或 手机号 OTP（`auth-tool` 配置 + publishable key）。匿名登录保持关闭。
- **集合 `token_usage`**：权限 **`PRIVATE`**（仅创建者+管理员读写）→ 天然按 uid 隔离。文档：
  ```
  { _id: <reporter 生成的 id，幂等>, ts, browserId, model,
    inputTokens, outputTokens, totalTokens, createdAt }
  ```
  （只存 token 计数与元数据，**不存** `estimatedCostCny`——成本由 §6.2 云函数按价目表算，避免价格变动后历史记录失真。`_openid` 由 SDK 按登录身份自动写，不手填。）索引：`ts`、`model`。
- **集合 `token_usage_rollup`**：日×模型滚动汇总（`PRIVATE`），供快速 summary。
- **云函数 `usage-rollup`（定时触发）**：聚合 `token_usage` → 写 `token_usage_rollup`；按保留策略裁剪原始记录。函数态绕过安全规则，按 uid 分组处理。
- **云函数 `usage-summary`（被启动器调用）**：按调用者 uid 聚合，返回与渲染层一致的 `TokenUsageSummary`（totals / byBrowser / byModel / daily / recent）。`estimatedCostCny` 由函数按**模型价目表**计算（定价集中维护，贴合网关）。

### 6.3 桌面域

- **LauncherAuthSession（新模块，主进程）** — 持有 CloudBase 登录态/会话，暴露登录、登出、当前 uid、`refresh_token`。
- **登录 UI（渲染层，新组件）** — CloudBase Auth 登录面板；用 `auth.getSession()`（非废弃 `getLoginState`）判真实登录态。
- **UsageCloudClient（新模块，主进程）** — 调 `usage-summary` 取汇总；`tokens:getSummary` 改由它供数（在线为数据源，断网回退本地缓存的上次汇总）。本地 `token-usage.json` 降级为离线缓存。
- **方案 X**：登录后经 `externally_connectable` 把 `refresh_token` 推给扩展；token 失效时重推。
- **方案 Y**：另建 **Native Messaging 宿主**，把扩展遥测 `{browserId, tokenUsage[]}` 转 `telemetry:ingest`，由启动器以登录 uid 上云。

## 7. 鉴权与数据流

```
登录（启动器渲染层，CloudBase Web SDK）→ getSession() → {access,refresh,uid}
  [X] refresh_token --externally_connectable--> 扩展 setSession() → 扩展以 uid 写 token_usage
  [Y] 扩展 tokens --Native Messaging--> 启动器 telemetry:ingest → 启动器以 uid 写 token_usage
定时：usage-rollup 聚合 + 保留裁剪
读取：tokens 页 → tokens:getSummary → UsageCloudClient → usage-summary(uid) → TokenUsageSummary
        （断网 → 本地缓存兜底）
```

## 8. 失败与边界

- **断网/未登录**：UsageReporter 本机入队，登录且在线后补传；tokens 页在无云数据时显示本地缓存 + 明确"离线/未登录"态。
- **幂等**：以 reporter 生成的 `id` 作 `_id`，重复上报命中既有文档不重复计。
- **登录态过期**：SDK 自动续期；X 中扩展续期失败则暂存待启动器重推 `refresh_token`。
- **只在系统边界做防御**（`SELF_CONSTRAINTS §B5`）：上云入参、云函数入参、IPC 入参校验；内部模块互信。

## 9. 上游文档修订（与代码同提交）

- **PRD.md**：新增"tokens 上云 + CloudBase 登录"功能；明确正文/日志仍本地；统计来源加"云端 tokens 遥测"；把该窄切片从 M2 提前并注明其余 M2 未启。
- **ARCHITECTURE.md**：登记新模块（UsageReporter / LauncherAuthSession / UsageCloudClient［+ 方案 Y 的 NM 宿主］/ CloudBase 集合与云函数）与依赖图；微调 I2 措辞（§3）；更新 `TokenUsageStore` / tokens 页数据来源。
- **TECH-INFRA.md**：把"Demo 不上报云端"改为"仅 tokens 上云"；补 CloudBase 选型 ADR + env/部署说明。

## 10. 测试

- **UsageReporter**：归一、批量/flush、断网重试、幂等、**无泄漏断言**（上报体只含 token 字段，无 prompt/正文/Key）——对齐 `PRD.md` 既有脱敏测试纪律。
- **搜题 usage 提取**：从含 usage 的响应正确取数。
- **CloudBase**：`token_usage` 的 `PRIVATE` 规则（跨 uid 拒绝）、`usage-summary` 聚合形状、`usage-rollup` 汇总与保留。
- **桌面**：LauncherAuthSession 登录态、UsageCloudClient summary 映射与离线兜底；`tokens:getSummary` 契约不破。
- **方案 Y**：NM 宿主 → `telemetry:ingest` 透传与 browserId 校验。

## 11. 待复审/可否决清单

1. **方案 X vs Y**（§5）——默认 X。
2. **登录入口**：默认仅启动器登录 + 向扩展交接会话；是否也要扩展内登录 UI？
3. **保留策略**：默认原始记录 90 天 + 永久日/模型滚动汇总。
4. **成本计算**：默认云端按模型价目表算 `estimatedCostCny`。
5. **启动器读取**：默认云端为数据源、本地降为离线缓存；是否要本地+云端合并视图？

## 12. 模块命名（`SELF_CONSTRAINTS §B1`，避免空语义名）

UsageReporter（插件）· LauncherAuthSession · UsageCloudClient（桌面）· 云函数 `usage-summary` / `usage-rollup` · 集合 `token_usage` / `token_usage_rollup`。均为"动词+名词/真实职责"，无 Manager/Helper/Util。
