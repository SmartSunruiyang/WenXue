# CloudBase 自建 LLM 网关 — 设计

- 日期：2026-06-28
- 状态：草案（待用户复审）
- 取代：[扩展 Token 用量上云（自报遥测）](./2026-06-28-extension-token-cloud-telemetry-design.md)（已废弃）
- 关联上游：`PRD.md`（M2 商业化地基）、`TECH-INFRA.md`（§7 演进 / §M2 网关切换设计）、`ARCHITECTURE.md`（I2/I4）

## 1. 决策与背景

用户决定**一次完整大改动**：扩展不再直连百炼，**自建 CloudBase LLM 网关**承接所有内置模型调用——网关服务端持有百炼（DashScope）Key 并发起调用、按用户鉴权、**服务端计量 token**。这正是上游早已规划的 **M2 云端 LLM 网关**（`TECH-INFRA.md` "M2 网关切换设计"：插件 LLM 客户端只认 `baseURL + 鉴权头`，切网关只需把 `baseURL` 指向网关、`apiKey` 换成会话 token，**Agent 核心零改动**），现整体提前。

服务端计量是**权威/计费级**来源，因此**取代**上一版"扩展自报遥测"。tokens 页改读网关计量。

## 2. 目标 / 非目标

**目标**
- 扩展**内置模型**调用经 CloudBase 网关（OpenAI 兼容透传到百炼）。
- 百炼 **API Key 仅存网关服务端**，不再下发到插件/桌面/本地存储。
- **CloudBase Auth 登录**；会话 token 作为插件调用网关的凭据。
- 网关**服务端按 uid 计量 token**；启动器 tokens 页读网关计量。

**非目标（现阶段）**
- 不做收款/订阅/账单出账（现在只到"鉴权 + 计量 + 限流"）。
- **自定义 BYO-Key 模型**（用户自带 baseURL+Key）**维持直连**，不入网关（那是用户自己的 Key，非我方）。
- 网关**不持久化对话/提示词/响应正文**（仅计量 token）——搜题考题答案虽经过网关，但不落库。

## 3. 不变量影响（重大，必须修订）

- **I2 反转**（`ARCHITECTURE.md:35`）：当前"API Key 与对话内容永不离开本机"。→ 改为：**用户提示词/对话经自有网关转发至百炼；网关只转发与计量、不持久化正文；厂商 API Key 仅存网关服务端，永不下发插件/桌面；会话 token 作插件调网关的凭据。** 这是上游既定的 M2 模型（`TECH-INFRA.md:190/193`）。
- **I4 保留**：插件域仍只经 OpenAI 兼容 HTTP 调 LLM（网关即 OpenAI 兼容）。✓
- **范围/里程碑**：此即 **M2 商业化地基**的网关部分，整体提前。需改 `PRD.md`（范围/M2 表）与 `ROADMAP.md`。

## 4. 架构

### 4.1 网关（CloudBase Run，**Function 模式**，Node）
- **OpenAI 兼容入口** `/v1/chat/completions`（按需 `/v1/models`），**透传**到 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- **鉴权**：校验请求头里的 **CloudBase 会话 token → uid**；无效拒绝。
- **Key 托管**：百炼 Key 由网关从**环境变量**注入（仅服务端），永不外泄。
- **流式 SSE 透传**：逐块转发；**注入 `stream_options:{ include_usage:true }`**，否则 DashScope 流式响应**不返回 `usage`**、计量恒为 0（最隐蔽的坑，spike 必验）。
- **计量**：从（流式末块/非流式）`usage` 取数，按 uid 写 `token_usage`（**不写正文**）。
- **限流**：**后期再定**（本期不做）。⚠️ 公开多用户前**必须**补上——我方 Key 服务全员，会话 token 泄漏会刷爆账户。
- **透明性**：模型特定参数（`tool_choice`、思考开关、视觉图片）原样透传，保住搜题视觉/思考行为（见项目既有约定）。
- 部署：`OpenAccessTypes:["PUBLIC"]`、`MinNum≥1`（温实例降冷启延迟）、`Mem=2×CPU`、无状态。

### 4.2 鉴权 / 登录
- **CloudBase Auth Web SDK** 登录。**默认启动器为登录入口** + 把会话交接给扩展（扩展据此取 `access_token` 调网关）；扩展为登录入口为备选（见 §11）。
- 扩展调网关只需 `access_token` 放 `Authorization`，**不需要可写 DB 会话**（比上一版 setSession 直写门槛低）。

### 4.3 插件域
- 改 `apps/extension/src/agent/constants.ts` 的 `DEMO_CONFIG`/`DEMO_VISION_CONFIG`：`baseURL` → 网关；`apiKey` 字段 → 运行时注入的**会话 token**。
- vendor `@page-agent/llms` `OpenAIClient` **不改**（I5）。
- **自定义模型**（`modelConfig.ts`）：维持直连用户自带 Key，**不经网关**。

### 4.4 桌面域
- 登录 UI + `LauncherAuthSession`（持会话/uid）。
- tokens 页经 `usage-summary` 读网关计量（取代本地 `token-usage.json` 作为数据源；本地降为离线缓存）。

### 4.5 计量存储
- `token_usage`（`PRIVATE`，按 uid）：`{ _id, ts, uid, model, inputTokens, outputTokens, totalTokens, createdAt }`，**无正文**。
- `usage-summary` / `usage-rollup` 云函数：聚合/滚动/保留（同前设计），成本按价目表算。

## 5. 可靠性（硬依赖！）

去掉本地 Key 后，**网关挂 = 内置模型全不可用**。对策：
- `MinNum≥1` 温实例 + 健康检查；网关错误→扩展明确报错 UX。
- **切换分阶段**：先把内置模型指向网关、**保留本地直连兜底开关**，真实使用验证通过后，**最后一步**才删本地 Key（见计划 M5）。绝不"切 baseURL"和"删 Key"同提交。

## 6. 隐私

网关看得到全部提示词（含搜题考题答案），但**只计量 token、不落库正文**（本机也不再存——正文留在插件 IndexedDB 的本地日志仍按原方案，受 §11 复核）。计量记录不含正文/Key/敏感头。

## 7. 数据流

```
登录（CloudBase Auth）→ 会话(access_token, uid)；扩展取得 access_token
扩展 LLM 调用（OpenAIClient，baseURL=网关，Authorization=access_token）
  → 网关校验 token→uid → 注入百炼 Key + stream_options.include_usage → 转发百炼
  → SSE 逐块回传扩展（Agent 照常流式消费）
  → 网关从 usage 计量 → 写 token_usage(uid)
tokens 页 → tokens:getSummary → usage-summary(uid) → TokenUsageSummary
```

## 8. 失败与边界

- **未登录/会话过期**：扩展先续期；失败则提示重登，调用前置拦截。
- **网关 5xx/超时**：扩展明确错误态；切换期可回退本地直连（M5 前）。
- **限流命中**：网关返回 429，扩展提示。
- 仅在系统边界做防御（`SELF_CONSTRAINTS §B5`）：网关入参、token 校验、上游响应。

## 9. 上游文档修订（同提交，`§B3`）

- **PRD.md**：M2 网关 + 登录 + 计量提前为当前里程碑；范围/能力表更新；统计来源=网关计量。
- **ARCHITECTURE.md**：I2 改写（§3）；登记新模块（网关服务 / LauncherAuthSession / UsageCloudClient / 集合 + 云函数）+ 依赖图；插件 LLM baseURL/凭据来源变更。
- **TECH-INFRA.md**：网关选型 ADR（CloudBase Run Function 模式 + DashScope 透传 + Key 托管 + 限流）；把"M2 网关切换设计"标为执行中；密钥矩阵更新。
- **ROADMAP.md**：M2 网关切片打勾推进。

## 10. 测试

- **网关**：token 校验（无效拒）、透传正确性、**流式注入 include_usage 后 usage 非 0**、按 uid 计量、限流、不落正文断言。
- **扩展**：内置模型走网关（文本/视觉/搜题/流式/工具调用行为不回归）；自定义模型仍直连；无本地 Key 残留断言（M5）。
- **桌面**：登录态、tokens 页读云、离线兜底。

## 11. 决策（已定 2026-06-28）

1. **登录入口**：启动器登录 + 交接扩展（采纳默认）。
2. **自定义 BYO-Key 模型**：维持直连，不入网关。
3. **限流**：**后期再定**（本期不做；公开多用户前必须补，见 §4.1）。
4. **保留/成本**：原始 90 天 + 永久汇总；成本云端按价目表。
5. **本地日志/正文**：**留本机**（插件 IndexedDB 不变，不随网关改动）。

## 12. 模块命名（`§B1`）

网关服务 `wenxue-llm-gateway`（CloudBase Run）· 云函数 `usage-summary` / `usage-rollup` · 集合 `token_usage` / `token_usage_rollup` · `LauncherAuthSession` / `UsageCloudClient`（桌面）。无 Manager/Helper/Util。
