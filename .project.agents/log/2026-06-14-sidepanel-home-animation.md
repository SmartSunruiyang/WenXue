# Sidepanel 主页空态与新建对话动效

- **日期**：2026-06-14
- **关联**：PRD F3 / UIUX §6 侧边栏空态与新建对话
- **会话上下文**：用户要求只修改插件 sidepanel 主页，移除 logo / slogan 下方入口按钮，调整 logo 动效与右上角加号新建对话动效，并直接在 main 提交。

## 做了什么

- 将 sidepanel 空态收敛为居中的问字 logo 与 slogan，使用无底部光效的悬浮与呼吸动效。
- 将右上角加号的新建对话动画从下滑删除改为对话流收束进右上历史按钮，再显示品牌空态淡入。
- 增加 sidepanel 空态与新建对话动效的回归测试。
- 同步更新 PRD 与 UIUX 中的新建对话动效和 sidepanel 空态描述。

## 提交

- 本提交：`fix(ext): 调整 sidepanel 主页动效`

## 状态变更

- 架构文档：未改动；本次只在既有插件 SidepanelApp / EmptyState / 样式层内调整视觉与交互。
- 需求/UI 文档：更新 `PRD.md` F3 与 `UIUX.md` §6。
- 测试：
  - `pnpm -F extension test src/components/misc.test.ts src/entrypoints/sidepanel/App.test.ts` 通过，2 files / 4 tests。
  - `pnpm -F extension build` 通过，WXT 产出 chrome-mv3；保留既有 es2025 target 警告。
  - `pnpm -F extension test` 未全绿，失败来自本次未修改也未暂存的并行工作区变更：`useAgent.ts` / `useAgent.test.ts`、`HistoryList.tsx` / `HistoryList.test.ts`、`history-export.ts` / `history-export.test.ts`。

## 下一步

- 若继续处理历史列表、历史导出或恢复历史会话，应在独立任务中完成并修复对应测试。
