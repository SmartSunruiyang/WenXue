# 问学扩展可观测性 / 持久化日志 —— 设计（spec）

- 日期：2026-06-21
- 状态：草案（待评审）
- 关联实施计划：[../plans/2026-06-21-extension-observability.md](../plans/2026-06-21-extension-observability.md)
- 归属域：**插件域**（`apps/extension`）。不触桌面域（启动器已有自己的 `AppLogger`，两域零运行时通信，不变量 I3）。

---

## 1. 背景与目标

排查超星物理图片题低正确率时发现：解题流水线（`solve` / `llm` / `images`）**零请求日志**，用户「查不到做题日志」、真页只能靠 DevTools Network 临时看，上线后更无从复盘。

**目标**：给插件域一套**统一、持久化、可在设置里查看与导出**的日志系统，覆盖**所有插件操作**（不止超星），默认本地保留 3 天、超期与超量自动清理，方便开发期与上线后排查问题。

成功标准：
- 任一插件上下文（background / sidepanel / newtab / hub / content script）都能用同一 `logger` API 记日志。
- LLM 调用记录**请求与响应正文**（API Key 永不入库）。
- 设置里有「日志」入口，可按级别/来源/时间/关键词筛选、查看单条详情、一键导出、清空。
- 本地持久化，默认保留 3 天（可配）+ 总量上限，超出自动清理。

## 2. 范围

**纳入**：插件域全部运行时上下文的操作日志；设置内查看器；持久化与清理；导出。

**不纳入**（非目标 / YAGNI）：
- 桌面启动器日志（已有 `AppLogger`；跨域汇总会破 I3，本期不做）。
- 远程上报 / 云端日志（仅本地）。
- 日志告警 / 监控面板（仅查看与导出）。
- 修改 vendored `packages/*`（不变量 I5）——所有埋点只在 `apps/extension` 侧完成。

## 3. 决策摘要（已与用户对齐）

| 决策 | 选择 |
| --- | --- |
| 范围 | 仅插件域 |
| LLM 记录粒度 | **请求/响应正文**（API Key 强制脱敏；base64 截断） |
| 查看器 | 查看 + 筛选 + 导出 |
| 保留策略 | **时间 + 体积双上限**，均可配，默认 3 天 |

## 4. 架构

### 4.1 单写入者（background）+ 通用 logger + 消息通道

- **background 独占日志库**（IndexedDB），是**唯一写入者**：无并发竞争、retention 权威。
- **通用 `logger`**（任意上下文可用）：在 background 直接写库；在其它上下文经 `chrome.runtime.sendMessage({ type: 'LOG_APPEND', entries })` 送到 background。
- 查询/导出/清空同样走消息：`LOG_QUERY` / `LOG_EXPORT` / `LOG_CLEAR`，由 `background.ts` 的 `onMessage` 分派（与现有 `TAB_CONTROL` / `PAGE_CONTROL` / `CHAOXING_CONTROL` 完全平行）。

### 4.2 跨上下文约束（关键）

content script 运行在**页面源**，其 `IndexedDB` 是页面的、**够不到扩展源的库**。因此 content script（超星 extract/images/fill、RemotePageController.content 等）的日志**必须**经消息送 background 落库。这正是「单写入者」成立的硬原因。

### 4.3 批量与 Service Worker 生命周期

- emit 为 fire-and-forget；客户端**批量**：攒够 N 条（默认 20）或 N 毫秒（默认 1000ms）、或页面 `visibilitychange`/`pagehide` 时刷一批，减少唤醒 background 的频率。
- MV3 SW 可能被回收；`sendMessage` 会唤醒它。极端情况下 SW 被杀瞬间可能丢失尚未刷出的少量条目——日志可接受，不做强一致保证。
- background 自身的日志直接写库，不走消息。

## 5. 日志数据模型

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogSource = 'agent' | 'llm' | 'tabs' | 'page' | 'chaoxing' | 'config' | 'system'
type LogContext = 'background' | 'sidepanel' | 'newtab' | 'hub' | 'content'

interface LogEntry {
  id: number          // idb autoIncrement，由 background 落库时分配
  ts: number          // epoch ms（Date.now()）
  level: LogLevel
  source: LogSource
  context: LogContext // 哪个运行时发出的
  message: string
  data?: unknown      // 结构化细节，已脱敏 + base64/超长截断
}
```

LLM 条目的 `data` 约定：
```ts
{ phase: 'agent' | 'chaoxing-text' | 'chaoxing-vision',
  model: string, url: string,
  request: { messages, temperature, tool_choice, enable_thinking },  // 已脱敏
  response: { status: number, body?: unknown, toolCallArgs?: string }, // 正文截断
  durationMs: number }
```

## 6. 日志来源与级别

| source | 记录内容 | 主要埋点 |
| --- | --- | --- |
| `agent` | 任务开始/结束、每步 action + reflection、工具调用、用户接管、stuck | `MultiPageAgent` 的 `onBeforeTask/onAfterTask/onBeforeStep/onAfterStep` 钩子 + `HistoricalEvent` |
| `llm` | 请求/响应正文、模型、是否开思考、HTTP 状态、耗时 | LLM fetch 拦截器（§7）+ `askStructured` |
| `tabs` | 标签/分组创建、激活、关闭、分组事件 | `TabsController` / `TabsController.background` |
| `page` | RemotePageController 动作与错误 | `RemotePageController*` |
| `chaoxing` | extract 题数/题型、图片内联成功/失败数、solve 路由(text/vision)与 needsReview、fill 结果 | `solve.ts` / `images.ts` / `adapter.content.ts` |
| `config` | 设置变更（不含密钥值） | `useAgent.configure` / `configStorage` |
| `system` | 未捕获异常、SW 启动、retention 清理统计 | `background.ts` + 全局错误处理 |

级别约定：常规流程 `info`；可跳过细节 `debug`；可恢复异常/降级 `warn`；失败/抛错 `error`。

## 7. LLM 全文捕获

agent 主循环的 LLM 请求发生在 vendored `PageAgentCore` 内（**不能改 `packages/*`**）。为「连主循环一起、抓到全文」且不动上游：

- **作用域限定在 LLM 端点的 fetch 拦截器**（`lib/loggingFetch.ts`），在 agent 运行的上下文（sidepanel/hub）安装，包裹 `globalThis.fetch`：
  - 仅当 URL 命中 chat/completions（或已知 LLM baseURL）时记录；其余 fetch 原样放过。
  - 记录前**脱敏**请求（§8）；响应若为**流式**则 `tee` 复制一份，组装最终文本后记录，不影响原始消费。
  - 同时覆盖 agent 主循环与超星 `askStructured`（二者都走 `fetch`），无需动上游。
- 超星 `askStructured` 同样跑在 agent 上下文（solve 作为 agent 工具被调用，运行于 sidepanel/hub），其 `fetch` **被同一拦截器自动覆盖** → LLM 只有拦截器**一个**记录来源，无重复、无需 askStructured 自记。
- content script 内**无** LLM 调用（超星 `images.ts` 抓的是图片，非 LLM），故拦截器只装在 agent 上下文（sidepanel / hub）。

> 实现待确认（见 §17）：核对 `@page-agent/llms` 是否流式、是否暴露可注入 fetch / 请求事件——若暴露则优先用其干净注入点替代全局包裹（仍是单一来源）。

## 8. 脱敏（硬要求，守 I2）

写入前对 `data` 深度处理（`lib/logRedaction.ts`）：
- **剥离**任何 `Authorization` 头、`Bearer <token>`、`apiKey` / `api_key` 字段值 → 替换为 `***`。**API Key 永不入库**。
- 截断 `data:` URI 与超长 base64/字符串（保留前缀 + 长度标记，如 `data:image/png;base64,…[12345字符]`）。
- 单字段与单条整体设上限（如单条 ≤ 64KB），超出截断并标注。

脱敏在 **emit 边界**与 **fetch 拦截器**两处执行，确保密钥在离开内存进入持久层前已抹除。

## 9. 存储（IndexedDB v2）

- 复用现有 `page-agent-ext` 库（`lib/db.ts`），**版本号 1 → 2**，`upgrade` 新增对象库 `logs`：
  - `keyPath: 'id'`，`autoIncrement: true`。
  - 索引 `by-ts`（`ts`）：时序查询 + 范围清理。
- 升级幂等、不动既有 `sessions` 库。
- 体积上限通过 §10 维护；如默认配额不足再评估 `unlimitedStorage` 权限（默认先不加，靠上限控量）。

## 10. 保留策略（时间 + 体积，均可配）

- 新增设置：`logRetentionDays`（默认 **3**）、`logMaxEntries`（默认 **5000**，可换算为约定字节上限）。
- 清理触发：
  1. background **启动时**清一次。
  2. `chrome.alarms` **定时**（每 ~30 分）清过期 + 超量裁剪。
  3. （可选）`appendBatch` 后若条数明显超限做一次轻量裁剪。
- 实现：按 `by-ts` 索引范围删除 `ts < now - retentionDays`；再按最旧优先删至 `maxEntries` 以内。
- 需在 manifest 增加 `alarms` 权限。

## 11. 设置查看器（LogViewer）

- `SETTINGS_SECTIONS` 增加一节 `{ id: 'logs', labelKey: 'settingsSectionLogs', descriptionKey: 'settingsSectionLogsDesc' }`。
- 渲染**独立组件** `components/LogViewer.tsx`（不塞进已 955 行的 `SettingsForm`）：
  - 筛选：级别（多选）、来源（多选）、时间范围、关键词搜索。
  - 列表：时序倒序、虚拟滚动/分页（量大）；每行 时间 / 级别 / 来源 / message 摘要。
  - 详情：点开看单条完整 `data`（含 LLM 正文，等宽展示）。
  - 操作：**导出**（按当前筛选导出 `.json`，可选 `.txt`）、**清空**（二次确认）。
  - 数据经 `LOG_QUERY` / `LOG_EXPORT` / `LOG_CLEAR` 向 background 取。
- i18n：`lib/i18n.tsx` 增加 `settingsSectionLogs*` 及查看器文案键（中英）。

## 12. 模块清单与文件（插件域，命名守 B1）

新增：
- `lib/logger.ts` —— 通用 emit API（`debug/info/warn/error(source, message, data)`）+ 客户端批量 + 路由（background 直写 / 他处发消息）。
- `lib/logStore.ts` —— background 侧 idb 读写：`appendBatch(entries)` / `query(filter: { level?, source?, sinceTs?, untilTs?, text?, limit?, beforeId? })` / `exportAll(filter?)` / `clear()` / `purge({ retentionDays, maxEntries })`。
- `lib/logRedaction.ts` —— `redact(data): unknown`（密钥剥离 + 截断）。
- `lib/log.background.ts` —— `handleLogControlMessage`（`LOG_APPEND/QUERY/EXPORT/CLEAR`）。
- `lib/loggingFetch.ts` —— `installLlmFetchLogging()`（LLM 端点 fetch 拦截 + 脱敏 + 流式 tee）。
- `components/LogViewer.tsx` —— 设置内查看器 UI。

改动：
- `lib/db.ts` —— 升 v2，加 `logs` 库与 `by-ts` 索引。
- `entrypoints/background.ts` —— 注册 `LOG_*` 分派；启动清理 + 注册 `chrome.alarms`。
- `components/SettingsForm.tsx` —— 加 `logs` 节，挂 `LogViewer`。
- `lib/settingsConfig.ts` / `agent/useAgent.ts`（`ExtConfig`）—— 加 `logRetentionDays` / `logMaxEntries`。
- `lib/i18n.tsx` —— 文案键。
- `wxt.config.js` —— `permissions` 增 `alarms`。
- 安装拦截器 + 接 logger 的入口：sidepanel/hub 启动处装 `installLlmFetchLogging`；`solve.ts`/`images.ts`/`adapter.content.ts`/`Tabs/RemotePageController`/`MultiPageAgent` 钩子接 `logger`，逐步替换/补充现有 `console.*`。

接口签名（草案）见 §5、§12 各模块描述，细化到计划阶段。

## 13. 权限（manifest）

- 现有：`['tabs','tabGroups','sidePanel','storage']`，`host_permissions: ['<all_urls>']`。
- 新增：`alarms`（定时清理）。`unlimitedStorage` 暂不加，靠体积上限控量；若实测配额不足再加。

## 14. 架构与上游文档影响（实现时同步，B3）

- `ARCHITECTURE.md`：插件域新增「Logging」（logStore + logger + redaction + loggingFetch）与「LogViewer」模块；新增 `LOG_*` 消息通道；IndexedDB 升 v2（+`logs`）。与实现**同一 commit** 更新模块清单与依赖图。
- `PRD.md`：新增「日志查看与导出 + 本地保留策略」功能条目。
- 派生文档（本 spec / 计划）不反向修改上游。

## 15. 测试策略

- `logRedaction`：API Key / Authorization / Bearer **一定被抹**；base64/超长截断；嵌套对象深度处理。
- `logger`：批量阈值（条数/时间/可见性）触发刷新；background 直写 vs 他处发消息的路由分支。
- `logStore`（fake-indexeddb）：`appendBatch` 落库；`query` 各筛选维度；`purge` 时间清理 + 体积裁剪（最旧优先）；v1→v2 升级幂等不动 `sessions`。
- `loggingFetch`：仅命中 LLM URL 才记；非 LLM fetch 原样放过；流式 tee 不破坏原始消费；脱敏生效。
- `LogViewer`：筛选/详情/导出渲染（注入 fake 查询）。

## 16. 边界情况与失败模式

- background 被回收：emit 经 `sendMessage` 唤醒；刷新前被杀可能丢极少量条目（可接受）。
- 日志库写入失败：吞掉、绝不影响主流程（日志是旁路，失败不抛给业务）。
- 自引用风险：`loggingFetch` / `logStore` 自身的 fetch/写库**不得**再触发日志（避免递归风暴）——拦截器按 URL 过滤、内部写库不经 logger。
- 高频日志：批量 + 体积上限兜底；`debug` 级默认可由设置关闭以降量（可选）。
- 导出体积：大日志导出走一次性 `exportAll` + 浏览器下载，避免卡 UI。

## 17. 实现待确认项（计划阶段核对）

- `@page-agent/llms` 是否流式、是否暴露可注入 fetch / 请求-响应事件；决定 §7 用注入点还是全局包裹（均为单一来源）。
- `chrome.alarms` 最小周期与权限影响；或退化为「启动清理 + append 触发裁剪」免 alarms。
- 默认 idb 配额是否够「全文」量级；不够再评估 `unlimitedStorage`。
- LogViewer 在 `panel` 与 `page` 两种 settings 模式下的布局（量大时优先 `page` 模式或独立滚动区）。

## 18. 非目标 / YAGNI

不做远程上报、日志告警、跨域（桌面）汇总、日志级别的运行时热重载之外的复杂配置。保持「本地、可看、可导、自动清理」四件事做扎实。
