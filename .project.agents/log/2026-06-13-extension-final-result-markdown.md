# 最终结果输出按 Markdown 渲染

- **日期**：2026-06-13
- **关联**：PRD F3 侧边栏对话 / UIUX §6 完成态（行64）+ 横向不溢出不变量（行61）/ 模块 SidepanelApp (L5)
- **会话上下文**：用户反馈"插件最后结果输出有很多符号"——`done` 结果是 Markdown，但直出成了字面量（`**`、`#`、表格符号）。

## 做了什么

- 新增 [`apps/extension/src/components/markdown.tsx`](../../apps/extension/src/components/markdown.tsx)：`<Markdown>` 组件，`react-markdown` + `remark-gfm`，自定义组件映射套现有 Tailwind token。不引 `rehype-raw`（不渲染裸 HTML）→ LLM 输出 XSS 安全；链接 `target=_blank rel=noopener noreferrer`。
- 强制 UIUX §6 行61 横向不溢出：`pre` 代码块 `overflow-x-auto`、`table` 外包滚动容器、`p/li/a/code` `[overflow-wrap:anywhere]`——面板宽度不被长内容撑宽，超长在各自框内横向滚动。
- 改 [`conversation.tsx`](../../apps/extension/src/components/conversation.tsx) `FinalText`：去掉按段落 `line-clamp` 折叠，整段交 `<Markdown>` 完整渲染（用户选择"完整展示不折叠"）。`ExpandableText` 其余 4 处调用保留，无死代码。
- 范围限定"仅最终结果"：步骤 / 观察 / 错误 / 原始调试仍纯文本。因历史详情与 Hub 复用同一 `Conversation`，三处一并生效（UIUX §6 行67）。
- 依赖：`apps/extension/package.json` 加 `react-markdown@^10.1.0` + `remark-gfm@^4.0.1`（devDependencies，与本包 react/radix 同处一致，wxt 全量打包）。
- 文档同步（同一改动）：PRD F3「执行结果总结（结果正文按 Markdown 渲染）」；UIUX §6 行64 结果正文规格由「保留换行」改为「Markdown(GFM) 渲染、完整展示、横向严格不溢出、链接新标签打开」，行61 补「最终结果正文例外：完整展示、不截断」消除文档内矛盾。

## 提交

- **未提交**。工作树状态：已改 `package.json` / `pnpm-lock.yaml` / `conversation.tsx` / `PRD.md` / `UIUX.md`，新增 `markdown.tsx`、本日志。按 harness 规则待用户确认后再提交。
- 计划提交主题：`feat(ext): 最终结果按 Markdown 渲染`
- 注意：工作树另有两份**非本任务**的未跟踪文件 `.project.agents/assets/{design.md,launcher-uiux-prompt.md}`，不纳入本次提交。

## 状态变更

- 架构文档：未动。未新增架构模块或模块间依赖边（`react-markdown` 为叶子 npm 依赖，不进 ARCHITECTURE §2/§3 的模块 DAG）。
- 需求/UI 文档：PRD F3、UIUX §6 已回写（见上）。
- 测试：`pnpm -F extension build` 通过（conversation chunk 645KB，含 markdown 生态，符合所选依赖代价）；`tsc --noEmit` 退出 0。
- 真机验收（CONVENTIONS §4.3，未完成）：尚需在 CfT 侧边栏跑一条会输出 Markdown 的任务，确认渲染正常且对话列无横向滚动。

## 下一步

- 真机走查：加载 `.output/chrome-mv3`，触发一个返回 Markdown（标题/列表/表格/代码块/链接）的任务，确认渲染与无横向溢出。
- 用户确认后提交（含代码 + 文档 + 本日志，同一 commit）。
