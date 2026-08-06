# 问学 WenXue — 实施路线图（ROADMAP）

> 由 `PRD.md` + `ARCHITECTURE.md` 推导。按依赖图的拓扑顺序排开发节奏：先做被依赖最多的底层模块。
> 每完成一个复选框，在**同一个 commit**里打勾。每完成一个 milestone，按 `.project.agents/log/` 模板写日志。
> 命名说明：本文 M0–M5 是 **Demo 工程里程碑**，全部从属于 `PRD.md §8` 的产品里程碑 M0（Demo）；PRD 的 M1–M3 是产品级演进，不在本文展开。

## 0. 排序原则

- 按依赖图自底向上：底层模块先行，UI/功能后行。
- 每个 milestone 必须能独立通过编译/构建，并跑出某种**可见行为**（不是"写完了"，是"能演示什么"）。
- M1（vendor）与 M2（供应链）互不依赖，可并行。

## 1. 里程碑总览

| Milestone | 目标                                                 | 验收（能演示什么）                                         |
| --------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| M0        | 基线整备（治理 + 文档 + pnpm 骨架 + 空 Electron 壳） | 克隆 → `pnpm i` → `pnpm build` 成功，`pnpm dev` 出空窗口   |
| M1        | vendor page-agent 五包入库                           | 任意 Chromium 手动加载插件产物，侧边栏跑通最小任务         |
| M2        | 浏览器供应链与桌面底层模块                           | `fetch-browser` 拉到 CfT；底层模块单测全绿                 |
| M3        | 启动链路打通                                         | 点「启动浏览器」→ CfT 带插件拉起，状态机全程正确           |
| M3.5      | 启动器 App 化重构                                    | 无边框白色 App 工作台可管理多画像、查看日志、tokens 与设置 |
| M4.5      | CloudBase LLM Gateway M0 Spike                       | 真实流式网关调用 usage 非 0，并记录延迟基线                |
| M4.6      | 后台管理系统                                         | 内部账号密码登录后台，可查看 tokens 看板并调整用户状态     |
| M4.7      | 消息与版本发布控制面                                 | 定向消息可确认，后台可选择 CI 候选并控制 rollout           |
| M4        | 品牌化与默认配置                                     | 全新 profile 首启只填 Key，示例页全链路任务成功            |
| M5        | 打包分发与冒烟                                       | 双端安装包在干净机器通过 PRD F1–F4 验收                    |
| M5.1      | 手动更新提示闭环                                     | 旧版可发现并下载未签名候选，再显式打开系统安装包           |

## 2. 里程碑详细

### M0 — 基线整备

- [x] 版本控制 + ignore + 文档零点提交（`f27e6fb` → `9c39e5e`）
- [x] 文档体系入位（PRD / ARCHITECTURE / TECH-INFRA / ROADMAP / CONVENTIONS / UIUX + 治理文件）
- [x] pnpm workspace 骨架：`pnpm-workspace.yaml`、根 `package.json`（`packageManager`）、`.nvmrc`、Prettier/ESLint 基线（继承上游配置，见 CONVENTIONS §2.1）
- [x] 空 Electron 壳（electron-vite 模板级主窗口）可构建可运行
- [x] 根聚合脚本就位：`pnpm build` / `pnpm dev` / `pnpm -r test`
- **验收**：克隆仓库 → `pnpm i` → `pnpm build` 一次成功；`pnpm dev` 打开空白主窗口。

### M1 — vendor page-agent 五包（依赖 M0；与 M2 可并行）

- [x] 从上游快照复制 `packages/{ui,llms,page-controller,core}` 与 `apps/extension`，保留版权头与 LICENSE（不变量 I5；`third_party/page-agent/LICENSE` 入库）
- [x] 包间依赖改 `workspace:*`，`pnpm -r test` 全绿
- [x] 建立 `UPSTREAM.md`：上游地址、快照 commit、日期、本地改动清单、手动同步流程
- [x] `wxt build` 产出 `.output/chrome-mv3`
- **验收**：在任意 Chromium 内核浏览器手动加载产物 → 侧边栏可打开，配置模型后跑通一个最小页面任务。

### M2 — 浏览器供应链与桌面底层（依赖 M0；与 M1 可并行）

- [x ] `apps/desktop/browser.lock.json`（锁定当时 CfT Stable 版本）+ `scripts/fetch-browser.ts`（@puppeteer/browsers，支持 `PUPPETEER_DOWNLOAD_BASE_URL` 镜像）
- [x] 实现 AppPaths / AppLogger / BrowserResources / LaunchConfig / ProfileStore（ARCHITECTURE §2.1 L0–L3 中的无 spawn 部分）+ 单测
- **验收**：`pnpm -F desktop fetch-browser` 在 mac-arm64 / mac-x64 / win64 各拉取成功；vitest 全绿。

### M3 — 启动链路（依赖 M1 + M2）

- [x] BrowserSupervisor（spawn、exit/error 监听、状态机）+ 状态机单测
- [x] DesktopBridge typed IPC 通道（契约见 ARCHITECTURE §3.2）
- [x] ConsoleUI 最小态（状态卡 + 启动按钮 + 版本 footer）
- [x] MainBootstrap：退出询问对话框、重复启动聚焦（I1）
- **验收**：dev 模式点「启动浏览器」→ CfT 拉起且问学插件出现在工具栏；状态 `idle→launching→running→idle` 全程正确；重复点击不开第二实例；浏览器被手动关闭后状态回落。

### M3.5 — 启动器 App 化重构（依赖 M3）

- [x] 主窗口改为无边框 1120×720 白色 App shell，常驻图标侧栏与浏览器 / 日志 / tokens / 设置路由
- [x] BrowserSupervisor 从单实例状态机升级为按画像并行看护，同一画像不重复启动
- [x] BrowserProfileStore / LauncherLogStore / LauncherSettingsStore / TokenUsageStore 入位并经 DesktopBridge 暴露
- [x] 浏览器页支持添加、就地重命名、多选批量打开、聚焦、停止与空状态
- [x] 日志页支持查询、筛选、清空与保留策略 UI；tokens 页支持总览、聚合与空状态
- **验收**：`pnpm -F desktop test` 与 `pnpm -F desktop build` 通过；dev 窗口在桌面与窄视口无明显重叠、遮挡或横向溢出。

### M4.5 — CloudBase LLM Gateway M0 Spike（2026-06-28 提前插入；全计划网关门）

- [x] 绑定 CloudBase env `wenxue-d8gz76tacc3659f05`（ap-shanghai）并确认 MCP 可用
- [x] 新增 `apps/llm-gateway` CloudBase Run 网关雏形（container-backed functions-framework）
- [x] 真实流式请求打通：CloudBase access_token → 网关 → DashScope → SSE 回传
- [x] 验证末块 usage 非 0、记录端到端延迟基线（2026-06-28：1075ms，34 tokens）
- **验收**：流式 + 鉴权 + usage 非 0 + 延迟基线全部 OK；否则停在 M0 门，不进入后续 M1+。

> 该 spike 只验证网关可行性；M1+ 未放行前不切扩展内置模型、不删除本地百炼 Key。

#### M4.5 后续 — 网关硬化与用户 session（2026-07-02 重构）

- [x] M1 网关硬化：文本/视觉/工具透传、usage 写 `token_usage`、无正文落库、缺失/无效 token 拒绝、PUBLIC + `MinNum≥1` 部署
- [x] M2 启动器用户账号：恢复 CloudBase Auth 用户 id + 密码登录/注册；桌面校验用户名/密码并通过 CreateUser → Web SDK 验密 → `/auth/v1/user/me` ACTIVE 校验完成真实公网冒烟
- [x] M2.1 账号隔离本地画像：`browsers.json` 记录 `AccountNamespace`；所有画像 IPC 在主进程按当前
      网关验证后的 session 校验归属；退出前停止当前账号画像但保留 Profile，切回原账号恢复列表；
      Electron 单实例与跨进程启动标记覆盖 CfT 建锁前窗口
  - 验收：A→B 不展示 A 且已知 A profileId 失败；B→A 恢复原列表/扩展数据；停止失败不切号；首次
    session 不遗留其他账号 live 浏览器；伪造 userId/token 不匹配失败；Cloud signOut 结果未知不解除保护；
    desktop 账号隔离测试、typecheck、build 通过
- [ ] M2 session 交接：启动器经一次性 localhost `externally_connectable` 页面把 CloudBase 用户 session 交给插件 background，插件保存 `WenXueUserSession`
- [ ] M3 内置模型切网关：默认文本 `qwen3.7-max`、视觉 `qwen3.7-plus` 经 CloudBase Gateway 使用用户 session
- [ ] M4 tokens 页读网关计量：CloudBase Run 暴露 `GET /v1/usage/summary`，启动器 `UsageCloudClient` 云优先读取并按 userId 缓存，本地用量作为失败兜底
- [x] M5 内置模型删除本地 Key：移除本地直连兜底开关与内置百炼 Key，网关成为内置模型唯一路径；自定义 BYO-Key 不受影响
- **验收**：干净启动进入账号登录页；用户 id + 密码登录/注册后才能进入工作台；CfT + 构建后插件 user-session handoff smoke 返回 `{ ok: true }`；`pnpm -F desktop test`、`pnpm -F desktop build`、`pnpm -F extension test`、`pnpm -F extension build` 通过。

### M4.6 — 后台管理系统（依赖 M4.5）

- [x] `CloudBaseLlmGateway` 在请求 DashScope 前调用 `/auth/v1/user/me`，仅 CloudBase Auth `status=ACTIVE` 放行，`BLOCKED` 在上游调用前拒绝
- [ ] `apps/admin-api` 入位：CloudBase Auth bearer 校验、`admin_users` 角色校验、tokens summary，以及迁移到 TCB `DescribeUserList` / `ModifyUser ACTIVE|BLOCKED` 的用户管理与审计
- [ ] `apps/admin` 入位：内部用户名/密码登录、受保护后台壳、tokens 看板、用户启用/禁用
- [ ] CloudBase Auth 前置要求：username/password provider 已启用；创建内部管理员账号并在 `admin_users` 登记 active admin；普通用户授权状态以 CloudBase Auth `ACTIVE/BLOCKED` 为准
- **验收**：未登录/非管理员后台 API 均拒绝；后台看板聚合正确；后台禁用用户后该用户网关调用在 DashScope 前返回 403；`pnpm -F admin-api test`、`pnpm -F admin-api typecheck`、`pnpm -F admin build` 通过。

#### M4.6 后续 — CloudBase 常驻实例降耗（2026-07-17）

- [x] 建立三个 CloudRun 服务、七条 HTTP 路由与固定计算资源点基线
- [x] 在仓库中把 AdminApi targets 与 AdminConsole 静态产物合并到 `wenxue-llm-gateway`，并完成白名单 staging、本地 Functions Framework、测试与 typecheck
- [x] 环境恢复后回滚无流量中间灰度版本 022，发布完整组合版本 023 并按 5% → 25% → 50% → 100% 验证；配置发布版本 024 复用 023 镜像并以 100% 流量上线
- [x] 新 Gateway 达到 100% 后，批量把 `/admin*` 与 `/api/admin/v1/*` 七条路由切到 Gateway
- [x] 将 `wenxue-admin-web` 在线版本 006、`wenxue-admin-api` 在线版本 009 调为 `MinNum=0`，再把唯一常驻 Gateway 调为 0.25C/0.5GB、`MinNum=1`、`MaxNum=2`
- **执行记录**：环境恢复后完成上述发布与配置切换；未购买额外资源点、未开启超限。真实浏览器确认后台登录页正常渲染且无控制台错误，本轮未使用真实管理员凭据登录。
- **结果**：按配置估算，固定计算从约 107100 点/月降至约 21420 点/月（约 80%）；该数值不是账单实测。唯一 Gateway 保持 `MinNum=1`，LLM、登录与后台正常首请求不进入冷启动路径。

### M4.7 — 消息与版本发布控制面（依赖 M4.6）

- [x] `@wenxue/client-operations` 落地分发契约、纯校验/匹配与固定弹窗组件
- [x] AdminApi/Gateway 落地消息、回执、候选、rollout、signal、匿名事件与审计 API
- [x] AdminConsole 增加“消息推送”“版本更新”；后台不能上传或改写候选二进制
- [x] renderer 增加 DesktopAnnouncementService 与 DesktopReleaseSignalService；后者只 watch 公开
      revision 并经 IPC 触发更新检查，main 不加载 CloudBase Web SDK
- **资源进度（2026-07-18）**：8 个 collection、索引/规则、4 个 signal seed、两个 TTL 与
  `release_created_cursor` / `runtime_channel_published` 索引已创建。Gateway 030、AdminApi 012、
  AdminWeb 007 和包含 11 条新增精确路由的 18 条公开 routes 已上线；独立 COS 桶与 CloudRun 服务端
  release 配置已就绪。环境查询为 `NORMAL`，账单侧仍为 `EnvActivated=no`、`EnableOverrun=false`。
- **剩余阻塞**：Gateway/WAF QPS 与 CloudRun 直达收口仍需确认；GitHub 受保护 Environment、最小权限
  CAM CI 身份、真实候选发布和三平台手动安装交接 E2E 未完成。
- **验收**：目标账号收到固定弹窗且跨设备不重复；非目标账号不可见；只有匹配发布策略的客户端报告
  available。

### M4 — 品牌化与默认配置（依赖 M3）

- [ ] 插件品牌化：名称 / 图标 / `_locales`（zh_CN、en）→ 问学 WenXue · ask for everything
- [ ] manifest 增加 `key` 固定插件 ID
- [ ] 默认内置模型切为 CloudBase Gateway：文本 `qwen3.7-max`、视觉 `qwen3.7-plus`，经用户 session 鉴权；自定义模型仍保留厂商 URL/API Key 配置
- [ ] 权限收敛到 Demo 必需集合并登记保留理由；页面级 API（`window.PAGE_AGENT_EXT`）编译开关默认关；审计并移除上游遥测/Demo LLM 残留
- **验收**：删除画像目录后全新首启 → 仅填 API Key → 在示例 research 页与示例答题页各完成一次全链路任务（PRD F3/F4 验收标准）。

### M5 — 打包分发与冒烟（依赖 M4）

- [ ] electron-builder：macOS dmg（arm64 / x64）+ Windows nsis（x64），`extraResources` 注入 `browser/` 与 `extension/`
- [ ] `scripts/smoke-launch.ts`：`--remote-debugging-pipe` 启动打包产物 → CDP 断言问学插件 service worker 存在 → 退出无残留
- [ ] 干净机器走查 PRD §9 成功指标（含 macOS 未签名放行说明文档）
- **验收**：双端安装包在干净机器完成 PRD §5 F1–F4 全部验收标准；冒烟脚本本地双平台绿。

### M5.1 — 手动更新提示闭环（依赖 M4.7 + M5）

- [x] DesktopUpdateService 实现 `manual-unsigned` 状态机，接入 typed IPC、稳定分桶、Ed25519 清单与
      SHA-512/size 校验、策略 freshness 和打开前实时复核；离线缓存不能授权打开安装包
- [ ] 双流水线代码已落地：`desktop-release-candidate.yml` 生成并保留 30 天原字节/seal，
      `desktop-release-publish.yml` 只消费同 commit 成功首轮 build run，校验 `artifactSetSha512`，并要求
      `quality`、`manual-installer-integrity`、`manifest-tamper-rejection` 三项 tests 均绑定同一
      `buildRunUrl`，再签署 candidate manifest、以 COS `Closed` + `--forbid-overwrite` 上传并注册。
      candidate 段在受保护分支构建未签名 DMG/NSIS 且不接触发布凭据；待受保护
      `desktop-release-production` Environment 与 candidate manifest Ed25519/COS/注册配置就绪后才能实际发布；
      CI 只注册候选，后台发起 rollout
- [ ] 完成三平台 `manual-unsigned` `0.1.0 → 0.1.1` 下载、SHA-512 拒绝、系统安装器交接、画像无损、
      pause/withdraw 和更高版本 hotfix 演练
- **阻塞**：COS 桶已就绪，但 GitHub/CAM CI 身份、Ed25519 私钥、Gateway/WAF QPS、CloudRun 直达收口、
  真实候选和三平台安装交接完成前不得标记真实分发完成。
- **遥测边界**：event token 只防随意伪造，下载/安装包交接失败率只作 advisory 运营信号，不能单独授权
  自动扩大 rollout。
- **验收**：只在用户点击后下载，SHA-512/size 校验通过并再次点击后才打开安装包；beta 可按
  5% → 25% → 50% → 100% 暂停/恢复。

## 3. 并行轨道（与代码 milestone 解耦）

- **CI**：M0 后接入 lint + typecheck + `pnpm -r test` PR 门禁；M5 后接双平台打包工作流（产物传 artifacts）。
- **品牌视觉资产**：图标全套（UIUX §11 清单），依赖 PRD 开放问题 #1 定稿，须在 M4 开始前交付（占位图标不阻塞 M4 之前的里程碑）。
- **示例验收页**：本地静态 research 示例页 + 表单答题示例页，M3 开始前备好，供 M3–M5 验收复用。
- **官网**：`apps/website` 独立静态站点，首期只做白色极简首页：全屏 DotField 首屏、浏览器 hero 演示、下载 CTA；后续再接下载页、文档页与 CloudBase 部署。

## 4. 完成定义（DoD）

- 构建通过；`pnpm -r test` 通过。
- 新增/变更模块与依赖已回写 `ARCHITECTURE.md` §2/§3（同一 commit）；行为变化已回写 `PRD.md`。
- 本 milestone 的复选框在完成它的 commit 里打勾。
- 已按 `.project.agents/log/` 模板写执行日志。

## 5. 跨 milestone 不变量

- `ARCHITECTURE.md §1.3` 的 I1–I5 在每个里程碑均不得违反。
- `PRD.md §7.3` 合规红线（不做反检测/验证码绕过；用户在场定位）约束所有里程碑的功能取舍。
- Demo 范围冻结：任何超出 `PRD.md §5` F1–F4 的功能请求，先改 PRD 再排期，不"顺手"实现。
