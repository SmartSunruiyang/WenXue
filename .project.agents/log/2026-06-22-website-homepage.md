# 官网白色极简首页

- **日期**：2026-06-22
- **关联**：官网 PRD / WebsiteSite / `apps/website`
- **会话上下文**：用户选择 Product Design 方案 2，并要求只保留白色版本：首屏全屏 DotField、居中文案与两个按钮；下滑后出现浏览器 hero 演示；移除合规条、功能卖点网格与高信息密度内容。

## 做了什么
- 新增 `apps/website` React + Vite 静态官网应用。
- 实现白色极简首页：全屏 DotField 首屏、下载/看演示 CTA、浏览器中呼出/固定/输入任务演示、极简下载收尾。
- 复制透明品牌资产到官网 public assets，并保存选中参考图副本到 `.project.agents/assets/website-white-field-reference.png`。
- 删除旧的 `.project.agents/assets/design.md`，后续不再以该高能驾驶舱文档作为官网方向。
- 同步 `PRD.md`、`ARCHITECTURE.md` 与 `ROADMAP.md`，登记官网域 `WebsiteSite`，明确其与桌面/插件运行时无依赖边。

## 提交
- 未提交，工作树状态：官网新增应用、文档同步、QA 报告与日志均为未提交改动；等待用户确认是否继续迭代或提交。

## 状态变更
- 架构文档：新增官网域 `WebsiteSite`，更新依赖图与目录结构。
- 需求/UI 文档：`PRD.md` 新增官网形态说明；`ROADMAP.md` 新增官网并行轨道。
- 测试：`pnpm -F website build` 通过；`git diff --check` 通过；Playwright 使用本机 Chrome 截图验证桌面与移动视口；交互验证「看演示」滚动、步骤切换、任务选项更新均通过。

## 下一步
- 若视觉方向确认，补下载页/文档页或接 CloudBase 静态托管。
- 若要提交，按官网范围单独 commit，避免和其他路线图工作混在一起。
