# 官网顶部导航切换为 CardNav

- **日期**：2026-06-24
- **关联**：官网域 WebsiteSite；PRD 官网形态；ARCHITECTURE 官网域
- **会话上下文**：在已有未提交官网工作区上继续迭代，用户确认允许叠加修改。

## 做了什么
- 将官网顶部导航从全宽 GlassSurface 任务栏改为 React Bits CardNav 风格卡片导航。
- 中间保留透明无底 slogan 图片 `/assets/wenxue-slogan.png`，点击回到主页。
- 展开卡片提供文档、GitHub 与语言切换；右侧 CTA 保留语言切换快捷按钮。
- 为 CardNav 导航项与 slogan 资产路径新增自动测试，并将官网测试脚本扩展为运行所有 `src/*.test.ts`。
- 同步更新 `PRD.md` 与 `ARCHITECTURE.md` 中官网导航描述。

## 提交
- 未提交，工作树状态：已有未提交官网与文档改动，本次按用户确认继续叠加。

## 状态变更
- 架构文档：更新 WebsiteSite 职责与官网目录清单。
- 需求/UI 文档：更新 PRD 官网顶部导航描述；UIUX 未触发单独规则变更。
- 测试：`pnpm -F website test` 通过；`pnpm -F website build` 通过。
- 渲染验证：Browser/IAB 因 URL policy 阻止访问 `127.0.0.1:5175`，改用本地 Python Playwright 验证桌面与移动视口；截图写入 `/tmp/wenxue-cardnav-*.png`。

## 下一步
- 若准备提交，先与用户确认是否要把既有官网未提交改动一起纳入同一提交或拆分提交。
