# 完成新标签引导页 NewTabHome（液态玻璃之门入场 + 快捷入口 + onboarding + 设置入口）

- **日期**：2026-06-13
- **关联**：实施计划 `.project.agents/plans/2026-06-13-newtab-home.md`、设计稿 `.project.agents/specs/2026-06-13-newtab-home-design.md`
- **会话上下文**：实现期间用户在并行做桌面启动器重构，工作区有大量无关未提交改动；本功能各提交仅暂存自身文件，未触碰这些改动。

## 做了什么

- newtab 入口接管新标签页（`chrome_url_overrides.newtab`，由 WXT 根据入口自动注册）。
- 两态（炫酷首屏 · 克制日常）：每会话首个新标签跑 Three.js 折射 + GSAP 入场，其余新标签零 WebGL 常态。
- 快捷入口磁贴（增删改 + 拖拽排序 + 自定义图标）持久化于 `chrome.storage.local`。
- 4 步 onboarding 可折叠清单。
- 设置齿轮复用 `openExtensionOptionsPage` 跳转扩展 options 页。
- 常态包边复用现有 `MotionOverlay`（流体玻璃）。
- three/gsap 懒加载、动态 `import()` 切分为独立 chunk；常态/克制日常路径不加载 WebGL。
- 跟随系统深浅色 + 尊重 `prefers-reduced-motion`；入场结束释放 WebGL 上下文。
- 纯逻辑（quickLinks 模型、两态判定、持久化）走 TDD。

## 提交

- `6156ec4` docs: 登记 NewTabHome 模块、功能与视觉方向
- `86517e5` chore(ext): 新增 three/gsap 依赖（newtab 入场用）
- `ea80c18` feat(ext): 快捷入口纯模型（增删改排序 + URL 归一化）
- `dc98f32` feat(ext): 新标签两态判定与会话标志
- `6acdb82` feat(ext): 快捷入口与 onboarding 标志持久化
- `0abf72f` feat(ext): newtab 入口骨架并接管新标签页
- `4a0a18b` feat(ext): newtab 引导页文案（中英）
- `42be757` feat(ext): newtab 字标 hero 与设置入口
- `30e279e` feat(ext): 快捷入口网格与编辑（增删改拖拽）
- `595b567` feat(ext): newtab onboarding 4 步清单
- `1dfbf32` feat(ext): newtab 常态仪表盘组装（流体玻璃包边 + 入口 + onboarding + 设置）
- `942eb8d` feat(ext): 液态玻璃折射场景（Three.js，懒加载，含 GPU 释放）
- `35c8e15` feat(ext): 液态玻璃之门入场时间线与两态接入
- （外加本任务自身的执行日志提交）

## 状态变更

- 架构文档 `ARCHITECTURE.md`（NewTabHome 卡片 + QuickLink 实体 + DAG 边 + 持久化行）、`PRD.md`（F5 增强功能）、`UIUX.md`（§12 视觉方向）均在 `6156ec4` 同步登记。
- three/gsap 显式 chunk 命名（`wxt.config.js` 的 `rollupOptions.output.manualChunks`）经验证与 WXT 的 MV3 输出不兼容：background 入口启用 `output.inlineDynamicImports`，与 `manualChunks` 互斥，构建报错 `Invalid value for option "output.manualChunks" - this option is not supported for "output.inlineDynamicImports"`。故撤销该改动——three/gsap 早已通过动态 `import()` 自动切分独立 chunk，目标已达成，显式命名仅为美化/缓存收益，不与 WXT 较劲。
- 测试：`pnpm -F extension test` 全绿（10 files / 36 tests，含新增 `quickLinks` / `newtabMode` / `quickLinksStorage` 单测）。
- 构建：`pnpm -F extension build` 通过；eager `newtab` chunk 28.33 kB（静态导入仅含共享 React/UI 运行时、sparkles、trash-2、extensionPages，不含 three/gsap），`three.module` 经 `import("./three.module-…")` 动态加载切出 1.67 MB 独立 chunk，gsap 与入场场景代码一并切入懒加载的 `index-DQozFdbi.js`（168 kB）；常态路径不拉这两者。
- 注意：计划稿里的 `GlassPortalScene` / `IntroSequence` 源码需补 `import type * as THREE from 'three'` 与 `gsap.core.Timeline` 注解才能过严格 tsc（已在 `942eb8d` / `35c8e15` 落地修正）。

## 下一步

- 人工视觉验收（加载扩展，逐项核对）：每会话首个新标签播放完整入场并透出仪表盘；同会话后续新标签为常态无 WebGL；reduced-motion 静态；深 / 浅色各一遍；快捷入口增删改拖拽持久化；齿轮进 options；重播可重看；入场后 GPU 上下文释放。
- spec §14 开放项：磁贴图标来源（当前 emoji / 图片 URL / 首字母单字，未抓 favicon）；入场时长与折射参数微调。

## 会话收尾（2026-06-14）

- 合并：`feat/newtab-home` 全部提交以 fast-forward 并入 `main`，分支已删；合并结果 `pnpm -F extension test` 37/37 绿。
- 真机验收：用 `.browsers` 的 CfT 加载构建产物（`--load-extension` + `--remote-debugging-port`，经 CDP 截图）核对——两态切换、Three.js 折射、GSAP 透出、流体玻璃包边、百度首位、无搜索框均如预期。
- 用户反馈落地：
  - `c55f054` 默认快捷入口首位＝百度（国内），引导页不设搜索框（关闭 spec §14「默认搜索」开放项）。
  - `67cfb73` 新标签页固定白底（浅色），不再跟随系统深色（`main.tsx` 移除 `dark` 类、`index.html` `color-scheme=light`）。
- ⚠️ 待用户回写：`UIUX.md` §12 仍写「跟随系统深浅色」，应改为「固定白底（浅色）」。该文件有用户并行未提交改动，本会话刻意未触碰它（避免把用户改动卷进提交）——请用户提交自己的 UIUX 改动时一并改掉这一行（spec §3.4 已同步为白底）。
- 仍开放：磁贴图标来源；若要「更炫」，入场折射参数/对比/光扫/时长可再调（用户暂未要求）。
