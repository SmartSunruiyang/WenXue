# NewTab 白底与入场动效调整

- **日期**：2026-06-14
- **关联**：PRD F5 新标签引导页 / UIUX §12 / ARCHITECTURE NewTabHome
- **会话上下文**：在已有未提交历史/侧边栏相关改动的 main 工作区上接手；本次只追加 NewTabHome 相关改动，不回滚既有改动。

## 做了什么

- 将 newtab 背景固定为白色，移除页面四周跑马灯层，组件统一使用 `data-newtab-enter` 同步自下向上滑入。
- 右上角新增刷新按钮，与设置按钮共享同一入场动画。
- 默认快捷入口改为百度、学习通、必应中国，并增加单测锁定顺序。
- 快捷入口容器改为固定宽度磁贴 + flex wrap 居中，保证新增/删除后每一行仍居中。
- 首次 onboarding 的展开/收起改为局部魔法粒子与缩放/淡出动效，并支持 reduced motion 静态化。
- 同步更新 PRD、UIUX、ARCHITECTURE 中 NewTabHome 的行为与视觉描述。

## 提交

- 未提交，工作树中存在开工前已有的历史/侧边栏相关未提交改动，且用户本次要求直接在 main 分支修改。

## 状态变更

- 架构文档：更新 NewTabHome 职责描述，未新增模块或依赖边。
- 需求/UI 文档：更新 PRD F5 与 UIUX §12，移除旧 Liquid Glass / WebGL / 跑马灯描述。
- 测试：`pnpm -F extension test` 通过（13 files / 44 tests）；`pnpm -F extension build` 通过（保留既有 es2025 target 与 React Babel 建议警告）。
- 渲染验证：Browser QA harness 打开构建产物并注入最小扩展 API stub；桌面 1280x720 与移动 390x844 均为白底、无 `.wx-marquee-edge`、默认入口正确、无 4175 相关 console error；移动端两行快捷入口中心均等于视口中心，无横向溢出；onboarding 收起/展开状态切换正常。

## 下一步

- 若要提交，先与已有历史/侧边栏改动拆分 staging 范围，避免把不相关工作混入同一提交。
