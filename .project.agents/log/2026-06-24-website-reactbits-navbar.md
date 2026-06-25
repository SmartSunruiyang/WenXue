# 官网顶部导航复刻 React Bits 官网形态

- **日期**：2026-06-24
- **关联**：官网域 WebsiteSite；PRD 官网形态；ARCHITECTURE 官网域
- **会话上下文**：用户认为上一次 CardNav 效果不好，要求参考 `reactbits.dev` 官网导航实现，并保留问学自身颜色。

## 做了什么

- 将官网顶部导航从 React Bits CardNav 风格替换为 React Bits 官网 `ln-navbar` 风格固定胶囊导航。
- 左侧使用 `/assets/wenxue-slogan.png` 透明 slogan 图，logo 右侧仅保留 Docs 按钮。
- 右侧动作改为下载与 GitHub 两个按钮；移动端保留下载按钮，Docs/GitHub 进入下拉菜单。
- 移除官网导航中的中英切换入口与 CardNav/GSAP 组件依赖。
- 为新导航链接结构新增自动测试，确保导航只包含 Docs、Download、GitHub。
- 同步更新 `PRD.md` 与 `ARCHITECTURE.md` 中 WebsiteSite 导航描述。

## 提交

- 未提交，工作树状态：已有未提交官网与文档改动，本次继续叠加。

## 状态变更

- 架构文档：更新 WebsiteSite 职责与官网目录清单。
- 需求文档：更新 PRD 官网顶部导航描述。
- 测试：`pnpm -F website test` 通过。
- 构建：`pnpm -F website build` 通过。
- 渲染验证：用本机 Chrome + Playwright 验证桌面、滚动后、移动端闭合/展开菜单；截图写入 `/tmp/wenxue-reactbits-navbar-*.png`。

## 追加调整

- 默认导航态改为透明任务栏：无边框、无底色、无阴影，宽度接近整屏顶部。
- 保留滚动后的悬浮胶囊效果，并恢复滚动态毛玻璃。
- 放大左侧透明 slogan 图，移动端也同步放大但保留下载按钮与菜单按钮可用空间。
