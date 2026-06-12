# 运行态边框重做：ai-motion 跑马灯 → 问学流体玻璃（Liquid Glass）

- **日期**：2026-06-12
- **关联**：插件域 SidepanelApp + vendor page-controller（UPSTREAM P11/P12，UIUX §5）
- **会话上下文**：用户不满意 ai-motion 的 WebGL 跑马灯（网页遮罩边框 + 侧栏/Hub 运行态包边），要求改为流体玻璃效果——主体黑灰白液态玻璃，柔和彩色光只沿边缘流动，果冻状光影。

## 做了什么
- **方案**：纯 CSS 四层结构替换 WebGL——①玻璃环带（`backdrop-filter` blur+saturate 折射页面 + 白→灰→黑中性渐变体，mask 环带裁切：`padding` + 双层 `linear-gradient` mask `mask-composite: exclude`）；②③彩色流光双层（conic-gradient 低饱和蓝/紫/青/橙色段 + 透明间隔，`@property` 注册角度变量驱动旋转动画，9s 正转 + 14s 反转异速叠加，blur 11/16px）；④内外 1px 玻璃高光描边。果冻感 = 0.35% 振幅缓慢缩放脉动。空闲时 `animation-play-state: paused`，`prefers-reduced-motion` 下流光静止。
- **侧栏/Hub**（fork 侧）：`assets/index.css` 新增 `.wx-liquid-frame` 体系；`misc.tsx` 的 `MotionOverlay` 重写为纯 CSS 四层 div（删除 ai-motion 实例化与 WebGL 生命周期管理），保持 `active` prop 契约，淡入淡出 600ms。
- **网页遮罩**（vendor 侧，登记 UPSTREAM P11/P12）：`SimulatorMask.module.css` 新增同款样式（自定义属性用 `--page-agent-*` 前缀防宿主页冲突；CSS modules 自动 hash keyframes/类名）；`SimulatorMask.ts` 删除 Motion 字段与调用，构造流体玻璃帧 + 暗色页面走 `liquidFrameDark` 玻璃体；show/hide 经 rAF 切类做透明度过渡（hide 沿用 800ms 延迟隐藏 wrapper）。
- **依赖**：`apps/extension` 与 `packages/page-controller` 均移除 `ai-motion`（后者原唯一运行时依赖，现 deps 为空），lockfile 已更新。
- **文档**：UIUX §5 新增「问学流体玻璃体系」规范条目；UPSTREAM.md 登记 P11（遮罩边框替换）/P12（依赖移除）。

## 补充：边缘羽化（同日）
- 用户反馈环带硬边太硬，要求羽化、像液态玻璃覆在界面上。根因：环带 mask（content-box exclude）内缘锐利 + 内侧 1px 描边强化了硬边。
- 改为羽化 mask：水平/垂直两条「边缘不透明→feather 距离处全透明」线性渐变取并集（mask 多层默认 add 合成），玻璃与彩光从边缘连续消散，无内边界；羽化距离侧栏 `--wx-feather: 64px`、网页 `--page-agent-feather: 128px`。
- 内侧 1px 描边（`liquidEdge::after` / `.wx-liquid-edge::after`）删除，换成大半径柔光内阴影（白色 sheen + 极淡暗部景深）；外缘 1px 玻璃高光保留。
- 仅 CSS 改动（两份样式 + UIUX §5 措辞），JS 不变；重建 + 双场景截图确认羽化连续、中心内容清晰。

## 补充 2：由实到虚（同日）
- 用户反馈纯羽化版「太虚」，要求由实到虚。改 mask 渐变停靠点：外侧先保留一段**全不透明实体玻璃带**（侧栏 `--wx-solid: 12px` / 网页 `--page-agent-solid: 18px`）→ 40% 透明度中停（30px / 60px）→ 完全消散（64px / 140px），形成缓出曲线。
- 玻璃体增强：blur 7→8px、saturate 135→140%、底色白/暗 alpha 上调（0.22→0.3 / 0.16→0.22）；外缘 1px 高光 0.4→0.55。
- 仅 CSS 停靠点与强度参数变化；重建 + 双场景截图确认实体边缘清晰、向内消散自然。

## 补充 3：收束到边框（同日）
- 用户要求效果只留在边框、不遮挡网页与插件内容：实体带与渐变保留，向内尾巴大幅收窄变淡。
- 参数：侧栏 solid 12→8px、mid 30→20px（透明度 0.4→0.25）、feather 64→40px；网页 solid 18→14px、mid 60→36px（0.25）、feather 140→80px；内里光泽内阴影半径同步收小（白 16/20px、暗 40/56px）。
- 网页端用户复核仍嫌宽，再收一档：solid 14→10px、mid 36→24px、feather 80→48px（侧栏不变）。
- 重建 + 双场景截图确认：内容区完全无遮挡，包边为实体玻璃圈 + 短渐变尾。

## 补充 4：最外缘流光玻璃环（同日）
- 收窄后特效不够明显，用户要求边缘加一圈清晰的边。新增第 5 层 `liquidRing` / `.wx-liquid-ring`：最外缘细环（侧栏 3px / 网页 4px，padding+content-box exclude mask），白玻璃底（65%）+ 高饱和彩色脉冲段（蓝/紫/青/珊瑚 ≈ 全不透明）conic 旋转（9s），不模糊、无果冻缩放（贴边不脱离）。
- 接线：`misc.tsx` MotionOverlay 与 `SimulatorMask.ts` 图层列表各加一层；reduced-motion 媒体查询纳入环。
- 首版环（2.5/3px、低饱和、白底 50%）肉眼几乎不可见——根因是宽度太细 + 白底在浅色页上对比不足；提宽提饱和后清晰。
- `pnpm -r test` 全绿（33/58/11）；双场景截图确认环清晰、内容不遮挡。

## 提交
- 未提交，工作树已有多处未提交改动；本段在现有改动上继续。

## 状态变更
- 架构文档：未变更；vendor 改动按 I5 走 UPSTREAM.md 登记，无新模块、无新依赖边。
- 需求/UI 文档：UIUX §5 已同步；PRD 无行为变化不动。
- 测试：`pnpm -r test` 全绿（desktop 33 / llms 58 / extension 11）。
- 构建：`pnpm -F extension build` 成功；产物验证 content.js 含 `@property` 与 liquid 样式、`ai-motion` 字符串零残留。
- 视觉验证：静态预览截图两场景通过——模拟网页（1100×700，玻璃环带 + 边缘彩光 + 内侧高光）与侧栏（400×640，运行态包边正常叠加在 UI 上）。

## 下一步
- Chrome 重新加载插件，跑一次真实任务观察动态效果（流光转速/彩色强度/果冻振幅如需调整，参数都在两份 CSS 的注释段内）。
- 已知小问题：侧栏运行中底部玻璃带会轻微虚化「内容由 AI 生成」小字（运行态短暂存在，可接受；如需要可把侧栏 `--wx-band` 调小或给 footer 加底部让位）。
