# 问学 新标签引导页（NewTabHome）— 设计稿（spec）

- **日期**：2026-06-13
- **类型**：派生设计文档（依据上游 `PRD.md` / `ARCHITECTURE.md` / `UIUX.md` 产出，落地时回写上游，见 §10）
- **状态**：已通过头脑风暴对齐，待用户过目 → 转实施计划
- **关联上游**：`ARCHITECTURE.md` §2.2 插件域（新增 `NewTabHome` 模块）、`UIUX.md`（新增视觉方向小节）、`PRD.md`（新增功能）

---

## 0. 目标与范围

为「问学浏览器」（桌面启动器拉起的 Chrome for Testing）提供一个**接管新标签页**的引导/起始页。一个页面承载三件事：

1. **首次 onboarding**：告诉用户拿到这个浏览器后怎么用问学插件。
2. **快捷入口仪表盘**：几个网站快速入口，可自定义（增/删/改/排序）。
3. **设置入口**：一键进入插件 options 设置页。

并以一段「电影级液态玻璃之门」入场动效呈现品牌（GSAP + Three.js），落地时把这次对「安静克制」基调的**有意偏离**记录进 `UIUX.md`。

**范围边界**：本页只属插件域，桌面端零改动（不依赖 `startUrl`，不跨域，守 I3）。不收集 API Key、不做模型编辑（属 options 设置页，守 I2）。

## 1. 用户故事

- 作为首次使用者，我打开问学浏览器后能在第一个标签页看到一段惊艳的入场，并被一张 4 步清单带着上手插件。
- 作为日常使用者，我每开一个新标签都回到一个安静、好扫的仪表盘，点几个常用站点或自定义我的入口。
- 作为想换模型的用户，我能从这里一键进入插件设置页。

## 2. 信息架构与两态行为

页面常态结构（自上而下）：

- 顶栏：品牌标记（问学 logo + 字样）｜右侧设置齿轮（→ options）。
- 主区 `BrandHero`：字标 `Ask °For Σverything` + slogan `ask for everything`。
- `QuickLinksGrid`：快捷入口磁贴 + 末位「＋ 自定义」。
- `OnboardingChecklist`：首次展开的 4 步清单；完成后折叠为一个「新手引导」入口。
- 角落常驻「重播入场」（开发/演示与用户回看用）。

**两态规则（对应已选「炫酷首屏·克制日常」）**：

| 触发 | 表现 |
|---|---|
| 每次启动浏览器后的第一个新标签（含首次打开；会话标志位未置位） | 完整电影级入场（加载 three/gsap，跑 `GlassPortalScene` + `IntroSequence`） |
| 同一会话内之后开的新标签 | 克制常态：**不加载 WebGL**，仅 CSS「流体玻璃」包边 + 内容快速淡入 |
| onboarding 未完成（`newtabOnboardingDone` 未置位） | 清单默认展开；完成后折叠为「新手引导」入口 |
| `prefers-reduced-motion: reduce` | 跳过 WebGL 与时间线，直接静态合成首屏 |

- 入场判定：`sessionStorage.introPlayedThisSession` 未置位 → 播放完整入场（自然覆盖「首次打开」与「每次启动的第一个新标签」），播完置位。该标志只决定**是否播入场**，与 onboarding 展开互相独立。
- 「重播入场」按钮：手动重新播放完整入场（懒加载 three/gsap），不受上述标志限制。

## 3. 视觉与动效 — 液态玻璃之门

延展 `UIUX.md` §5 的「问学流体玻璃」语言到 3D，主体是一块**真实折射**的玻璃面板，仪表盘内容从玻璃里「透出来」。

### 3.1 入场编排（`IntroSequence`，GSAP 主时间线，约 2.6s）

1. `0.0–0.2s` canvas 淡入；背后低饱和光晕（蓝/紫/青/珊瑚）浮现。
2. `0.2–1.3s` 玻璃面板由小到正、由毛到清（折射粗糙度 →低）；一道光扫过；相机极轻 dolly。
3. `~0.9s` 字标逐字 reveal（mask 擦除 / SplitText 风格）。
4. `1.3–2.2s` DOM 仪表盘去模糊 + 磁贴错位 stagger 进场（「透出」感 = DOM 初始 `backdrop-filter` 模糊+低透明覆盖于 canvas 之上，GSAP 清除）。
5. `2.2s+` 收束：光晕减速，玻璃≤0.4% 振幅呼吸，最外缘流光环继续慢转（呼应 §5）。

### 3.2 GlassPortalScene（Three.js）

- 一块圆角玻璃 mesh，`MeshPhysicalMaterial`（`transmission`、低 `roughness`、`thickness`、`ior≈1.3`）；背后放低饱和渐变/色光作为被折射内容。
- 边缘流光＝ fresnel/rim + 双层反向旋转色环（≈9s/15s），重模糊呈果冻光感（与 §5 一致）。
- 光扫＝移动的 emissive 条或方向光高光。
- DPR 上限 1.5；入场播完 `dispose()` 释放 GPU 上下文（常态不留 WebGL 循环）。

### 3.3 常态（克制）

无 WebGL。沿用现有 CSS 流体玻璃包边（中性玻璃 + 边缘羽化），内容静态可用；磁贴 hover 轻量过渡（≤150ms）。

### 3.4 深浅色与降级

- 跟随系统：深色＝近黑底辉光（更出片）；浅色＝暖白底，玻璃/墨色调，流光降饱和。
- reduced-motion：见 §2 表，静态合成；所有流光/呼吸/扫光静止。

## 4. 模块与目录（架构归属）

- 新模块卡片（写入 `ARCHITECTURE.md` §2.2 插件域，L5，与 `SidepanelApp` 同层）：

```
## 模块名：NewTabHome（L5）
- 职责：接管新标签页；首次 onboarding、快捷入口仪表盘（自定义增删改排序）、设置入口、液态玻璃入场动效
- 不负责：不实现 Agent 循环 / 不发 LLM 请求 / 不收集 API Key / 不跨域调用桌面端
- 输入：chrome.storage.local（QuickLink、标志位）、@page-agent/ui、chrome.runtime.openOptionsPage
- 输出：用户；经 chrome.tabs 打开站点
- 持有状态：UI 态；读写 QuickLink 与 introSeen 标志
```

- 目录（与 `hub/` 同构）：

```
apps/extension/src/entrypoints/newtab/
├── index.html
├── main.tsx
└── App.tsx
apps/extension/src/components/newtab/   # 本页专属组件
```

- manifest：WXT 约定 `entrypoints/newtab/` 自动注册为 `chrome_url_overrides.newtab`；若 WXT 版本不自动注册，则在 `wxt.config.js` 的 `manifest` 显式声明 `chrome_url_overrides: { newtab: 'newtab.html' }`。
- 依赖边：`ExtensionEntrypoints → NewTabHome`（DAG 新增，无环）。

## 5. 组件拆分（小而专）

| 组件 | 职责 |
|---|---|
| `App` | 装配；判定两态；按需懒加载入场层 |
| `IntroSequence` | GSAP 时间线编排（仅入场态挂载） |
| `GlassPortalScene` | Three.js 折射 canvas（动态 import three，仅入场态） |
| `BrandHero` | 字标/slogan 排印 |
| `QuickLinksGrid` | 磁贴网格 + 拖拽排序 + 末位「＋」 |
| `QuickLinkEditor` | 增/改对话框（标题、URL、可选图标）；删除 |
| `OnboardingChecklist` | 4 步清单，可折叠/重开，步骤完成态 |
| `SettingsEntry` | 齿轮按钮 → `chrome.runtime.openOptionsPage()` |

## 6. 数据模型与持久化（`chrome.storage.local`，不出本机 / I2）

- `newtabQuickLinks: { id: string; title: string; url: string; icon?: string }[]` — 快捷入口（持久）。
- `newtabOnboardingDone: boolean` — 控制清单默认折叠（持久）。
- 会话级 `sessionStorage.introPlayedThisSession` — 入场是否本会话已播（非持久）。

写入 `ARCHITECTURE.md` §1.1 实体表（新增 `QuickLink` 持久化实体；`newtabOnboardingDone` 为页面级持久标志）与 §4 持久化表。

## 7. 默认内容

- **默认快捷入口**（用户可全改）：百度（国内，首位）、问学文档、GitHub、末位「＋ 自定义」。引导页**不设搜索框**（只放快捷入口磁贴）。
- **Onboarding 4 步**（浏览器侧，动词开头、具体）：
  1. 打开或固定问学侧边栏（工具栏点问学图标）。
  2. 默认用内置模型即可；要自定义模型 → 进设置页加 OpenAI-compatible 模型。
  3. 打开目标网页，在侧边栏用自然语言下任务。
  4. 执行中随时可停止或人工接管。
- 标题「第一次使用问学」；完成文案沿用 `UIUX.md` 语气（直接、不卖萌）。

## 8. 设置入口

齿轮按钮调用 `chrome.runtime.openOptionsPage()`（已有 options 入口）；有 `aria-label` + tooltip。

## 9. 依赖与构建

- `apps/extension` 新增 `gsap`、`three`（devDependencies，随 WXT 打包）。
- 二者**动态 import**，仅入场态加载；vite `rollupOptions.manualChunks` 单独切出 `three`/`gsap` chunk，避免拖慢常态新标签首屏。
- 常态路径零 WebGL、零 gsap。

## 10. 上游文档回写清单（与实现代码**同一 commit**，硬约束 B3）

- `PRD.md`：新增功能「新标签引导页」（onboarding + 快捷入口 + 设置入口）。
- `ARCHITECTURE.md`：§2.2 加 `NewTabHome` 卡片；§1.1 加 `QuickLink` 实体与标志位；§3 DAG 加 `ExtensionEntrypoints → NewTabHome`；§4 持久化表加 QuickLink；`ExtensionEntrypoints` 卡片补「newtab 页面装配」。
- `UIUX.md`：新增「新标签引导页」视觉方向小节，记录「炫酷首屏·克制日常 + 液态玻璃之门」对 §1.4/§5 克制基调的有意偏离与边界（仅入场、常态克制、尊重 reduced-motion）。

## 11. 测试与验收

- 纯函数单测（vitest）：两态判定（首次/首标签/常态）、QuickLink 归一化（增删改排序、URL 校验）。
- 手动验收（按 UIUX）：首次入场完整播放；同会话第二个新标签为常态无 WebGL；reduced-motion 静态；深浅色各一遍；自定义入口增删改排序持久化；齿轮进 options。
- 性能：常态新标签首屏可交互 ≤1s；入场不卡顿（60fps 档）；入场后 GPU 上下文释放。

## 12. 不做（YAGNI）

- 不做书签同步、搜索引擎聚合、天气/资讯卡、壁纸引擎。
- 不做账号/云端、不跨域联动桌面端。
- 入场不在每个新标签重播（仅首次/首标签/手动）。

## 13. 实现卫生

- 当前工作区有未提交改动（`PRD/UIUX/conversation.tsx/markdown.tsx` 等）。引导页在**新分支**实现，不混入这些改动；实现起步前与用户确认分支与是否先处理现有改动（守 §A2）。

## 14. 已解决的决策 / 开放项

- 已定：视觉野心＝炫酷首屏·克制日常；形态＝newtab override；首屏方向＝B 液态玻璃之门；模块名＝`NewTabHome`；默认入口与 onboarding 文案如上。
- 已定（用户反馈）：默认首位快捷入口＝百度（国内）；引导页不设搜索框。
- 开放（实现时确认）：磁贴图标来源（favicon 抓取 vs 内置 lucide/simple-icons）；入场时长微调。
