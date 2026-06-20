# 问学扩展可观测性 / 持久化日志

- **日期**：2026-06-21
- **关联**：[设计 spec](../docs/superpowers/specs/2026-06-21-extension-observability-design.md) / [实施计划](../docs/superpowers/plans/2026-06-21-extension-observability.md)
- **会话上下文**：codex 完成了 Task 1–3 + 部分 Task 13（types、redaction、db v2、logStore 基础读写、文档更新），本次接力完成剩余 Task 4–12。

## 做了什么

### 新增模块（均在 `apps/extension/src/`）

| 文件 | 功能 |
|---|---|
| `lib/logTypes.ts` | LogLevel/LogSource/LogContext/LogEntry/LogDraft/LogQueryFilter/LogControlMessage 类型 |
| `lib/logRedaction.ts` | `redact()` 密钥剥离 + base64/超长截断 + 循环引用检测 + 体积上限 |
| `lib/logStore.ts` | background 侧 idb 读写：`appendBatch`/`query`/`exportAll`/`clear`/`purge`（时间+体积清理） |
| `lib/logger.ts` | 通用 emit API + 批量缓冲（flushSize=20 / flushMs=1000）+ direct/message 双路由 + visibilitychange/pagehide 刷盘 |
| `lib/log.background.ts` | `handleLogControlMessage`：LOG_APPEND/QUERY/EXPORT/CLEAR 消息分派 |
| `lib/loggingFetch.ts` | `installLlmFetchLogging()`：scoped fetch 拦截器，仅 LLM URL 记录，流式 tee 不破坏消费 |
| `components/LogViewer.tsx` | 设置内日志查看器：级别/来源多选筛选 + 关键词搜索 + 详情展开 + JSON 导出 + 清空 |

### 修改的文件

| 文件 | 变更 |
|---|---|
| `lib/db.ts` | v1→v2：新增 `logs` 对象库（autoIncrement）+ `by-ts` 索引 |
| `entrypoints/background.ts` | 注册 `LOG_*` 分派 + 启动/定时 purge（chrome.alarms 每 30 分）+ `configureLogger({context:'background',sink:'direct'})` |
| `wxt.config.js` | permissions 加 `alarms` |
| `agent/useAgent.ts` | `AdvancedConfig` 加 `logRetentionDays?`/`logMaxEntries?` |
| `lib/configStorage.ts` | load/save 透传 logRetentionDays/logMaxEntries |
| `lib/settingsConfig.ts` | `SettingsFormValues`/`buildSettingsConfig`/`settingsConfigKey` 纳入两字段 |
| `components/SettingsForm.tsx` | `SETTINGS_SECTIONS` 加 `logs` 节 + 挂 `<LogViewer/>` + 保留天数/最大条数输入 |
| `lib/i18n.tsx` | 中英文文案：settingsSectionLogs* + logViewer* + logRetentionDays + logMaxEntries |
| `entrypoints/sidepanel/main.tsx` | `configureLogger({context:'sidepanel',sink:'message'})` + `installLlmFetchLogging()` |
| `entrypoints/hub/main.tsx` | 同上，context 为 `hub` |
| `agent/chaoxing/solve.ts` | 埋点：solve 开始/结束、每题路由 text/vision、needsReview 原因、LLM 错误、每页统计 |
| `agent/chaoxing/images.ts` | 埋点：图片解析成功/失败计数（失败时 warn） |
| `agent/MultiPageAgent.ts` | 埋点：task 开始/结束、每步 action+reflection、dispose 原因 |

### 测试（新增 24 个）

| 测试文件 | 覆盖 |
|---|---|
| `logRedaction.test.ts` | API Key/Authorization/Bearer 被抹、data: URI 截断、数组非变异、循环引用、嵌套对象（codex 已有，本次未改） |
| `logStore.test.ts` | appendBatch/query/clear + **purge**：过期删除、超量裁剪、组合清理、无操作返回 0 |
| `log.background.test.ts` | LOG_APPEND/QUERY/EXPORT/CLEAR 分派、非 LOG 消息返回 undefined、错误回传 |
| `logger.test.ts` | flushSize 触发、flushMs 超时、redact 调用、message sink、错误吞没、ts 注入、手动 flushLogger |
| `loggingFetch.test.ts` | LLM URL 记录 + 响应透传、非 LLM 不记、fetch 错误记 error、卸载还原、自定义 isLlmUrl、非 JSON 响应 |
| `settingsConfig.test.ts` | 更新：加入 logRetentionDays/logMaxEntries |
| `configStorage.test.ts` | 更新：advancedConfig 含 logRetentionDays/logMaxEntries |

### 超星 bugfix（codex 前序，与日志无关但已包含在工作树中）

- `extract.ts`：alt/title 图不再转文本（保留为 visual 发给视觉模型，避免受力图/电路图被丢）
- `images.ts`：**任何**图（含题干图）抓取失败都置 needsReview（宁缺勿猜）
- `llm.ts`：Qwen 开思考 + 纯文本题放宽 tool_choice 为 auto + 含图题保留强制

## 提交

- 未提交，工作树包含全部改动。建议按计划分 commit 提交（见下方建议）。

## 状态变更

- 架构文档：codex 已更新 ARCHITECTURE.md（新增 Logging/LogViewer 模块、LOG_* 消息通道、idb v2）
- 需求文档：codex 已更新 PRD.md（新增日志查看/导出/保留策略功能条目）
- 测试：**326 个全部通过**，构建成功，类型检查通过（仅剩预存的 misc.test.ts / cards.tsx / MultiPageAgent.test.ts 已知错误）

## 建议提交顺序

```
feat(ext): add log types + secret redaction
feat(ext): bump idb to v2 with logs store
feat(ext): log store append/query/clear/purge
feat(ext): LOG_* message handlers
feat(ext): universal batched logger
feat(ext): wire LOG_* dispatch + scheduled purge
feat(ext): log retention settings
feat(ext): scoped LLM fetch logging
feat(ext): instrument agent/chaoxing with logger
feat(ext): log viewer component + logs section in settings
fix(chaoxing): keep alt/title images as visual + needsReview on any image failure + enable qwen thinking
docs: register logging module + retention feature
```

或一次性提交：
```
feat(ext): persistent logging system with viewer, retention, and LLM capture
```

## 下一步

- 在真实扩展上下文（Chrome 加载 `.output/chrome-mv3`）验证：设置页日志节渲染、LLM 调用日志捕获、purge 定时器生效
- 考虑是否需要 `unlimitedStorage` 权限（当前靠体积上限 5000 条控量）
