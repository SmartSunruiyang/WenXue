# 问学 WenXue — 实施路线图（ROADMAP）

> 由 `PRD.md` + `ARCHITECTURE.md` 推导。按依赖图的拓扑顺序排开发节奏：先做被依赖最多的底层模块。
> 每完成一个复选框，在**同一个 commit**里打勾。每完成一个 milestone，按 `.project.agents/log/` 模板写日志。
> 命名说明：本文 M0–M5 是 **Demo 工程里程碑**，全部从属于 `PRD.md §8` 的产品里程碑 M0（Demo）；PRD 的 M1–M3 是产品级演进，不在本文展开。

## 0. 排序原则
- 按依赖图自底向上：底层模块先行，UI/功能后行。
- 每个 milestone 必须能独立通过编译/构建，并跑出某种**可见行为**（不是"写完了"，是"能演示什么"）。
- M1（vendor）与 M2（供应链）互不依赖，可并行。

## 1. 里程碑总览

| Milestone | 目标 | 验收（能演示什么） |
|---|---|---|
| M0 | 基线整备（治理 + 文档 + pnpm 骨架 + 空 Electron 壳） | 克隆 → `pnpm i` → `pnpm build` 成功，`pnpm dev` 出空窗口 |
| M1 | vendor page-agent 五包入库 | 任意 Chromium 手动加载插件产物，侧边栏跑通最小任务 |
| M2 | 浏览器供应链与桌面底层模块 | `fetch-browser` 拉到 CfT；底层模块单测全绿 |
| M3 | 启动链路打通 | 点「启动浏览器」→ CfT 带插件拉起，状态机全程正确 |
| M4 | 品牌化与默认配置 | 全新 profile 首启只填 Key，示例页全链路任务成功 |
| M5 | 打包分发与冒烟 | 双端安装包在干净机器通过 PRD F1–F4 验收 |

## 2. 里程碑详细

### M0 — 基线整备
- [x] 版本控制 + ignore + 文档零点提交（`f27e6fb` → `9c39e5e`）
- [x] 文档体系入位（PRD / ARCHITECTURE / TECH-INFRA / ROADMAP / CONVENTIONS / UIUX + 治理文件）
- [ ] pnpm workspace 骨架：`pnpm-workspace.yaml`、根 `package.json`（`packageManager`）、`.nvmrc`、Prettier/ESLint 基线（继承上游配置，见 CONVENTIONS §2.1）
- [ ] 空 Electron 壳（electron-vite 模板级主窗口）可构建可运行
- [ ] 根聚合脚本就位：`pnpm build` / `pnpm dev` / `pnpm -r test`
- **验收**：克隆仓库 → `pnpm i` → `pnpm build` 一次成功；`pnpm dev` 打开空白主窗口。

### M1 — vendor page-agent 五包（依赖 M0；与 M2 可并行）
- [ ] 从上游快照复制 `packages/{ui,llms,page-controller,core}` 与 `apps/extension`，保留版权头与 LICENSE（不变量 I5；`third_party/page-agent/LICENSE` 入库）
- [ ] 包间依赖改 `workspace:*`，`pnpm -r test` 全绿
- [ ] 建立 `UPSTREAM.md`：上游地址、快照 commit、日期、本地改动清单、手动同步流程
- [ ] `wxt build` 产出 `.output/chrome-mv3`
- **验收**：在任意 Chromium 内核浏览器手动加载产物 → 侧边栏可打开，配置模型后跑通一个最小页面任务。

### M2 — 浏览器供应链与桌面底层（依赖 M0；与 M1 可并行）
- [ ] `apps/desktop/browser.lock.json`（锁定当时 CfT Stable 版本）+ `scripts/fetch-browser.ts`（@puppeteer/browsers，支持 `PUPPETEER_DOWNLOAD_BASE_URL` 镜像）
- [ ] 实现 AppPaths / AppLogger / BrowserResources / LaunchConfig / ProfileStore（ARCHITECTURE §2.1 L0–L3 中的无 spawn 部分）+ 单测
- **验收**：`pnpm -F desktop fetch-browser` 在 mac-arm64 / mac-x64 / win64 各拉取成功；vitest 全绿。

### M3 — 启动链路（依赖 M1 + M2）
- [ ] BrowserSupervisor（spawn、exit/error 监听、状态机）+ 状态机单测
- [ ] DesktopBridge 4 通道（契约见 ARCHITECTURE §3.2）
- [ ] ConsoleUI 最小态（状态卡 + 启动按钮 + 版本 footer）
- [ ] MainBootstrap：退出询问对话框、重复启动聚焦（I1）
- **验收**：dev 模式点「启动浏览器」→ CfT 拉起且问学插件出现在工具栏；状态 `idle→launching→running→idle` 全程正确；重复点击不开第二实例；浏览器被手动关闭后状态回落。

### M4 — 品牌化与默认配置（依赖 M3）
- [ ] 插件品牌化：名称 / 图标 / `_locales`（zh_CN、en）→ 问学 WenXue · ask for everything
- [ ] manifest 增加 `key` 固定插件 ID
- [ ] 默认预置百炼 `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen3.5-plus`，Key 留空待填
- [ ] 权限收敛到 Demo 必需集合并登记保留理由；页面级 API（`window.PAGE_AGENT_EXT`）编译开关默认关；审计并移除上游遥测/Demo LLM 残留
- **验收**：删除画像目录后全新首启 → 仅填 API Key → 在示例 research 页与示例答题页各完成一次全链路任务（PRD F3/F4 验收标准）。

### M5 — 打包分发与冒烟（依赖 M4）
- [ ] electron-builder：macOS dmg（arm64 / x64）+ Windows nsis（x64），`extraResources` 注入 `browser/` 与 `extension/`
- [ ] `scripts/smoke-launch.ts`：`--remote-debugging-pipe` 启动打包产物 → CDP 断言问学插件 service worker 存在 → 退出无残留
- [ ] 干净机器走查 PRD §9 成功指标（含 macOS 未签名放行说明文档）
- **验收**：双端安装包在干净机器完成 PRD §5 F1–F4 全部验收标准；冒烟脚本本地双平台绿。

## 3. 并行轨道（与代码 milestone 解耦）
- **CI**：M0 后接入 lint + typecheck + `pnpm -r test` PR 门禁；M5 后接双平台打包工作流（产物传 artifacts）。
- **品牌视觉资产**：图标全套（UIUX §11 清单），依赖 PRD 开放问题 #1 定稿，须在 M4 开始前交付（占位图标不阻塞 M4 之前的里程碑）。
- **示例验收页**：本地静态 research 示例页 + 表单答题示例页，M3 开始前备好，供 M3–M5 验收复用。

## 4. 完成定义（DoD）
- 构建通过；`pnpm -r test` 通过。
- 新增/变更模块与依赖已回写 `ARCHITECTURE.md` §2/§3（同一 commit）；行为变化已回写 `PRD.md`。
- 本 milestone 的复选框在完成它的 commit 里打勾。
- 已按 `.project.agents/log/` 模板写执行日志。

## 5. 跨 milestone 不变量
- `ARCHITECTURE.md §1.3` 的 I1–I5 在每个里程碑均不得违反。
- `PRD.md §7.3` 合规红线（不做反检测/验证码绕过；用户在场定位）约束所有里程碑的功能取舍。
- Demo 范围冻结：任何超出 `PRD.md §5` F1–F4 的功能请求，先改 PRD 再排期，不"顺手"实现。
