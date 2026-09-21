# 恢复原首页与导航设计，仅调整背景颜色和指定文案

- 日期：2026-09-22
- 关联：WebsiteSite；用户对本轮官网改造的范围纠正
- 上一记录：`2026-09-22-website-ui-privacy.md`，其中首页与动效状态由本记录覆盖

## 变更

- 用户明确要求不改变顶部 tabs、首页动效与字体动效。恢复 HEAD 中原顶部导航结构和样式、滚动收束为悬浮胶囊、高亮滑动、GitHub / 下载按钮及原手机菜单；仅追加文档右侧隐私项。
- 恢复原首页版式、字号、字体、版本标记、说明文字、按钮样式与 TiltHover；恢复 DotField、VariableProximity、GSAP ScrollTrigger 标题入场、自动循环演示视频与自动切换的教学步骤。原动效组件文件没有改动。
- 首页背景相关底色改为 `#ffffff`，标题保持用户指定的「Agent，直接操作浏览器」。粒子的视觉及鼠标响应参数保持原值。
- 保留已完成的文档 / 隐私新页面、协议文案及路由。用户此前确认暂无下载地址，因此下载区保留「下载入口准备中」和指南入口，复用原按钮设计。
- 更新 UIUX §12，将用户要求的首页 / 导航动效明确为例外；同步 ARCHITECTURE §2.5 和执行计划。

## 验证

- `pnpm -F website build`：类型与生产构建通过。
- `pnpm -F website test`：6 项通过。
- 修改文件 Prettier 检查、`git diff --check` 通过。
- `git diff --exit-code HEAD` 确认 DotField.tsx、TiltHover.tsx、VariableProximity.tsx、VariableProximity.css 与原版一致。
- 浏览器实测：首页底色为 `rgb(255, 255, 255)`，存在粒子 canvas；13 个标题字符保留独立动画，鼠标移入时字符的 translateY / scale 随距离变化。
- 点击「看演示」后导航从 max-width 1680px 收束为 980px，样式为原 `site-navbar-scrolled`；演示标题完成入场，两个视频恢复 autoplay / muted / loop。
- 390px 手机预览保留原上下按钮及导航布局；原菜单可展开并从隐私项进入新页。教学步骤定时从第一步切至第二步。
- 预览没有 warn / error；视口恢复默认，首页预览保留在 `http://127.0.0.1:5176/`。

## 提交与后续

- 未提交：本轮为同一未提交官网任务的修正，用户未要求提交或部署。
- 改动仍位于 `/Users/outas/.codex/worktrees/website-ui-privacy/WenXue`；原工作区未修改。
- 文档与隐私页沿用上一记录的功能与待发布核对事项。未部署生产站。
