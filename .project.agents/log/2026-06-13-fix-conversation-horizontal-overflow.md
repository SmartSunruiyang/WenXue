# 修复对话流横向撑宽与长内容展开

- **日期**：2026-06-13
- **关联**：SidepanelApp / Conversation / UIUX §6
- **会话上下文**：接续 2026-06-12 未提交基线；用户要求对话页水平方向固定，超长元素点击展开。

## 做了什么
- 在 `Conversation` 根、sidepanel、历史详情、Hub 对话列增加 `min-w-0` / `max-w-full` / `overflow-x-hidden` 约束，防止长内容撑出横向滚动。
- 新增 `ExpandableText` 局部组件，用于用户气泡、观察文本、错误信息、步骤详情和最终结果段落的默认截断与点击展开/收起。
- 将 raw request/response JSON 从横向滚动改为换行展示；长 JSON 默认压缩高度，点击后在原位展开并保持垂直滚动。
- 补充中英文 `展开/收起` 文案键，并在 `UIUX.md` 记录对话页横向固定与超长内容点击展开规则。

## 提交
- 未提交，工作树状态：用户确认的未提交基线 + 本次 UI 修复改动仍处于未提交状态。

## 状态变更
- 架构文档：未修改；不新增模块、不改变依赖方向。
- 需求/UI 文档：更新 `UIUX.md` 侧边栏对话流约束。
- 测试：
  - `pnpm -F extension exec tsc --noEmit` 通过。
  - `pnpm -F extension test` 通过（3 files / 11 tests）。
  - `pnpm -F extension build` 通过；保留既有 WXT/Vite 构建警告（`es2025` target warning、React Babel 性能建议、Node `module.register()` deprecation）。
  - `pnpm -F extension exec prettier --check ...` 通过。

## 下一步
- 在真实扩展 sidepanel 中用长 URL、长 JSON 工具输出和多段最终结果手动走查，确认没有横向滚动条，点击展开/收起符合预期。
