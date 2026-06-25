# 2026-06-23 官网 README 文档与 Hover 动效

- **日期**：2026-06-23
- **关联**：官网域 `apps/website`

## 做了什么

- 顶部信息栏改为贴顶毛玻璃任务栏。
- 左上角 slogan 改为无底透明图片本体展示，hover 时仅图片上浮与投影，不再出现长方形底。
- GitHub 入口改用 GitHub mark SVG 图标，链接保持 `https://github.com/SmartSunruiyang/WenXue`。
- 集成 React Bits `VariableProximity` 效果，用于首页主标题鼠标邻近字重 hover。
- 文档子页改为 GitHub README 风格，包含快速开始、逐步操作流程、功能特性、故障排查与能力边界。
- 同步更新 `PRD.md`、`ARCHITECTURE.md` 与 `design-qa.md`。

## 提交

- 未提交，工作树状态包含本轮官网迭代及上一轮官网新建文件，等待用户确认后统一提交。

## 状态变更

- 架构文档：更新 WebsiteSite 职责，记录 `motion` 动效依赖与 README 文档页。
- 需求文档：更新官网首页、导航、文档页与 Hero hover 要求。
- 测试：`pnpm -F website build` 通过。
- 视觉验证：
  - 桌面顶部栏 y=0，宽度覆盖视口，无横向溢出；
  - 移动顶部栏 y=0，宽度覆盖视口，无横向溢出；
  - Hero `font-variation-settings` hover 从约 `wght 934` 变化至 `wght 1000`；
  - slogan hover 产生 transform；
  - README 文档页渲染 5 个主段落、6 条功能特性、5 条故障排查。

## 下一步

- 如需上线前精修，可继续补真实下载链接、README 内视频占位与完整安装包说明。
