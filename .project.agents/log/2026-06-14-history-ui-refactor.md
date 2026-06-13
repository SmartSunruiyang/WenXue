# 历史记录 UI 重构

- **日期**：2026-06-14
- **关联**：PRD F3 / UIUX §6 侧边栏历史记录
- **会话上下文**：用户授权本次可在已有脏工作区上叠加改动。

## 做了什么

- 历史记录页改为从右上角历史按钮坐标展开的 `clip-path` / 缩放动效，支持减少动态效果退化。
- 历史记录列表改为卡片式记录，移除列表分割线，保留状态、时间、步骤数与操作按钮。
- 增加「前往会话」入口：从历史列表或详情页恢复该记录的 task、history 与终态，并返回当前侧栏对话流。
- 导出 JSON 文件名前缀从 `page-agent-history` 改为 `wenxue-history`。
- 同步更新 `PRD.md` 与 `UIUX.md`，补充历史记录卡片、前往会话和导出命名要求。
- 增加回归测试覆盖历史导出命名、历史会话恢复状态与历史列表卡片/按钮结构。

## 提交

- 未提交；工作树包含本次改动，以及会话中已存在或并行出现的其他未提交改动。

## 状态变更

- 架构文档：未修改；改动仍归属既有 SidepanelApp / 插件域，不新增模块或依赖边。
- 需求/UI 文档：已更新 `.project.agents/docs/context/PRD.md` 与 `.project.agents/docs/context/UIUX.md`。
- 测试：
  - `pnpm -F extension exec vitest run src/lib/history-export.test.ts src/agent/useAgent.test.ts src/components/HistoryList.test.ts`：通过，3 files / 6 tests。
  - `pnpm -F extension test`：通过，13 files / 44 tests。
  - `pnpm -F extension build`：通过；保留既有 WXT/Vite warning（`es2025` target 提示与 React Babel 性能建议）。
  - Browser QA：通过本地 harness 打开构建后的 sidepanel，种入一条历史记录；验证历史卡片、无 `border-b` 分割线、「前往会话」恢复对话、390px 窄视口无横向溢出，相关页面无 console error/warn。

## 下一步

- 若需要真实扩展运行态最终验收，加载 `.output/chrome-mv3` 到 Chromium/CfT 后在实际 sidepanel 中重复历史记录流程。
