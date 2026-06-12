# 插件品牌化：问学 slogan 字标 + 全量改名

- **日期**：2026-06-12
- **关联**：插件域 SidepanelApp / ExtensionEntrypoints 品牌化改造（UIUX §6/§7）
- **会话上下文**：用户要求侧栏顶部去分隔线、左上角换无底 slogan 字标、全插件 "Page Agent Ext" 改名「问学」、空状态标题换 slogan 图并移除打字机动效（保留 GitHub/文档/官网三链接与 logo 光晕）。

## 做了什么
- 确认 `.project.agents/assets/nobottomslogen.png` 与此前 logo 同病：RGB 无 alpha、棋盘格烘进像素。按 logo 先例原地转为真 RGBA（亮度 ≥232 视为底→alpha 0，文字反推 alpha），并裁切内容区 + 缩放生成 `apps/extension/public/assets/wenxue-slogan.png`（1024×136，33KB）。
- `sidepanel/App.tsx`：header 去掉 `border-b`；左上角 Logo+文字替换为 slogan 字标图（`h-5`），移除未用的 `Logo` import。
- `components/misc.tsx`：EmptyState 移除 `<h2>Page Agent Ext` 与 `TypingAnimation`（含 import 与 `useI18n` 调用），改为居中 slogan 图（`w-56`）；logo + 渐变呼吸光晕、三个外链按钮保持不动。
- 改名「问学」（仅用户可见文案，内部标识符不动）：`_locales/{en,zh_CN}/messages.json` 的 extName/extActionTitle、sidepanel/hub 页 `<title>`、hub 页头与描述段、i18n `hubLink`（中英）、hub-ws 授权确认弹窗、TabsController 标签组标题 `问学(任务名)`。
- `lib/i18n.tsx`：删除两语言中已无引用的 `tagline1–4`。
- 更新 `UIUX.md` §6 空闲态描述与 §7 侧边栏品牌头部规范（先改文档再改实现）。
- 保留不动：存储键 `PageAgentExtUserAuthToken`、IndexedDB 名 `page-agent-ext`、类名 `MultiPageAgent`/`PageAgentCore`、console 日志前缀、zip artifact 模板（均为内部标识，改了会破坏既有数据/构建）。

## 补充：slogan 清晰度优化（同日）
- 用户反馈字标发糊。根因：单一 1024px 资源被浏览器实时大比例缩放（头部 3.4 倍缩减）。
- 改为按显示位精确 2x 离线出图：`wenxue-slogan.png` 448×57（空状态 `w-56`）、`wenxue-slogan-header.png` 315×40（头部 `h-5`）；从全分辨率源单步 LANCZOS 缩放，alpha 走 smoothstep 曲线（≤6% 去雾、≥80% 实心）+ UnsharpMask 轻锐化。
- `sidepanel/App.tsx` 头部改用 `-header` 资源；重新构建并截图确认两处字标锐利。

## 提交
- 未提交，工作树已有多处未提交改动；本段只在现有改动上继续完成品牌化。

## 状态变更
- 架构文档：未变更；改动归属既有插件域 SidepanelApp / ExtensionEntrypoints。
- 需求/UI 文档：`UIUX.md` §6/§7 已同步（空闲态构成、品牌头部无分隔线、界面品牌名一律「问学」）。
- 测试：`pnpm -F extension test` 7/7 通过；`tsc --noEmit` 仅余 `extensionPages.test.ts` 既有类型错误（options 设置页会话遗留，与本段无关）。
- 构建：`pnpm -F extension build` 成功，`wenxue-slogan.png` 已入 `.output/chrome-mv3`。
- 视觉验证：用构建产物 CSS + 真实资源做 400px 宽静态预览截图，确认头部无分隔线、slogan 字标对齐、空状态 logo/slogan 居中、光晕与三链接正常。

## 下一步
- Chrome 扩展页重新加载 unpacked extension（或重启桌面端拉起的 CfT），确认侧栏与扩展管理页显示「问学」。
- 既有 `extensionPages.test.ts` 类型错误待该归属会话修复。
