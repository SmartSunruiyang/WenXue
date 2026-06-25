# 官网按钮与卡片 Tilt Hover 效果

- **日期**：2026-06-23
- **关联**：官网域 `apps/website`
- **会话上下文**：在已有未提交官网工作基础上，按用户要求迁移 React Bits TiltedCard 的 hover 质感，但不迁移跟随光标的小弹窗。

## 做了什么
- 新增 `TiltHover` 组件，复用 `motion` 的 spring motion value，实现鼠标位置驱动的 `rotateX` / `rotateY` / hover scale。
- 将官网 CTA、导航按钮、步骤 pill、文档按钮、目录按钮、演示区小按钮、任务 chip、题目卡、结果卡与 README 表格行接入 tilt hover。
- 明确不实现 React Bits 的 `figcaption` / tooltip 光标跟随弹窗。
- 移除了大浏览器窗口整体 tilt 包裹，避免父级 3D transform 影响内部按钮命中。
- 后续按用户反馈关闭卡片类 hover 的表面高光层，仅保留 tilt / scale；按钮类高光不受影响。
- 为 `calculateTiltTransform` 增加 Node 内置测试，并给 `website` 包补充 `test` 脚本。

## 提交
- 未提交，工作树已有未提交官网与文档改动；本次按用户确认继续叠加在当前工作区。

## 状态变更
- 架构文档：未改；本次归属既有官网域。
- 需求/UI 文档：未改；PRD/UIUX 已包含官网 hover/视觉方向，本次为实现层迁移。
- 测试：
  - `pnpm -F website test` 通过，3/3 pass。
  - `pnpm -F website build` 通过。
  - in-app Browser 验证 `http://localhost:5176/`：首页、演示区、Docs 页、移动首页、移动 Docs 均无横向溢出，控制台 warn/error 为 0。
  - 卡片 hover follow-up 验证：`.tilt-quiz-card .tilt-hover-inner::after` 为 `display: none`，hover 后 transform 仍从 `none` 变为 `matrix3d(...)`，控制台 warn/error 为 0。

## 下一步
- 如需提交，将官网目录作为一个整体与既有官网工作一起 review，避免把本次 hover 改动和未跟踪官网基线拆混。
