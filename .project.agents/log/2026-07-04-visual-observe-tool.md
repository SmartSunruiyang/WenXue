# 完成 visual_observe 截图观察工具

- **日期**：2026-07-04
- **关联**：`docs/superpowers/specs/2026-07-04-visual-observe-tool-design.md` / `docs/superpowers/plans/2026-07-04-visual-observe-tool.md`
- **会话上下文**：按用户确认的计划实现问学 Agent 截图确认机制，要求由主 Agent 决策调用、不自动触发、不保存图片本体。

## 做了什么
- 新增插件域 Agent 工具 `visual_observe`，支持 `observe` / `confirm` / `audit` 三类用途，返回结构化 JSON 字符串而非自然语言摘要。
- 新增 background 截图桥，仅截当前窗口活动 tab 的可见视口；截图 data URL 只在内存中用于一次视觉模型请求，失败时返回结构化错误。
- 将 `RuntimeAgentModels.vision` 接入 `MultiPageAgent.visualObservationModel`，同时保留 `chaoxingModels.vision` 兼容路径。
- 在 `MultiPageAgent` 注册工具但不接入生命周期 hook、不自动 `pushObservation`。
- 补充 LLM fetch 日志隐私防护：含 `data:image/` 的视觉请求体只记录省略概要，不记录 base64 图片本体。
- 同步 system prompt、PRD、ARCHITECTURE、TECH-INFRA 与本次 spec/plan。

## 提交
- 未提交。本次在 `codex/visual-observe-tool` 分支完成实现与验证；工作树中另有 `apps/admin`、`apps/admin-api`、`apps/llm-gateway`、`ROADMAP.md` 等非本次视觉工具范围改动，未处理也未回退。

## 状态变更
- ARCHITECTURE：新增 `VisualObservation` 模块说明、插件域依赖图节点与工具契约，注明图片不入历史/IndexedDB/日志。
- PRD：补充 Agent 可主动调用 `visual_observe` 做页面观察、确认与审计，动作仍通过 DOM 工具完成。
- TECH-INFRA：补充 `chrome.tabs.captureVisibleTab` 用途、权限审计与日志脱敏要求；首版不扩大 manifest 权限面。
- 测试：先运行目标测试得到 RED；实现后 `pnpm -F extension test` 通过，45 个测试文件、376 个测试通过；`pnpm -F extension build` 通过；`pnpm -r test` 通过全部 workspace 测试；静态检查确认无视觉工具自动生命周期调用、manifest 仍为既有 `tabs` 与 `<all_urls>` 权限。

## 下一步
- 可在真实扩展运行时打开表单页，让主 Agent 主动调用 `visual_observe`，确认返回控件 JSON 且任务历史与日志不包含 `data:image/`。
