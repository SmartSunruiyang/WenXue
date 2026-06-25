# 2026-06-23 官网顶部信息栏

## 变更

- 在 `apps/website` 首页增加固定顶部信息栏。
- 左侧使用透明 slogan 素材，支持 hover 浮起效果，点击回到主页顶部。
- 右侧增加文档子页入口、GitHub 仓库入口与中英文切换按钮。
- 增加轻量文档子页 `/#docs`，保持低信息密度并支持中英文文案。
- 同步更新官网 PRD 与 `design-qa.md`。

## 验证

- `pnpm -F website build` 通过。
- 浏览器实测：
  - 首页顶部栏桌面与移动端无横向溢出；
  - 文档按钮进入 `http://localhost:5175/#docs`；
  - GitHub 链接指向 `https://github.com/SmartSunruiyang/WenXue` 且新窗口打开；
  - 中英文切换更新导航、首页、演示与文档页主要文案；
  - 点击 slogan 可回到 `http://localhost:5175/` 首页顶部。
- 截图已保存到 `.project.agents/screenshots/`：
  - `website-home-header-desktop.png`
  - `website-docs-desktop.png`
  - `website-home-header-mobile.png`
  - `website-docs-mobile.png`
