# M1 — vendor page-agent 五包入库：设计 spec

- 日期：2026-06-11
- 对应：`docs/context/ROADMAP.md` M1；约束 `ARCHITECTURE.md` 不变量 I5、`TECH-INFRA.md` §2/§6
- 状态：已评审（设计决策源自 2026-06-11 会话中用户确认的架构）

## 1. 目标与验收

把上游 alibaba/page-agent 的四个支撑库与扩展应用以"快照 vendor"方式纳入本仓 pnpm monorepo，使：

- `pnpm install && pnpm -r test` 全绿；
- `pnpm -F extension build` 产出 `.output/chrome-mv3/`；
- 产物在任意 Chromium 内核浏览器手动加载后，侧边栏可开、配置模型后能跑通一个最小页面任务（ROADMAP M1 验收）。

M1 **不做**品牌化、不改默认模型、不动权限（全部属 M4）。

## 2. 上游快照基准（D1）

| 项      | 值                                                                            |
| ------- | ----------------------------------------------------------------------------- |
| 仓库    | https://github.com/alibaba/page-agent.git                                     |
| 基准    | tag `v1.9.0`（2026-06-08 发布，最新 release）                                 |
| commit  | `3a2f0a41ec69…`（执行时以 `git rev-parse HEAD` 取全量 40 位记入 UPSTREAM.md） |
| License | MIT（含对 browser-use 的 MIT 衍生声明）                                       |

选 release tag 而非 main：可对 diff、可复现，发布仅 3 天足够新。

## 3. 关键集成决策

**D2 — 源码直出，不跑库构建。** 上游四包 `main`/`exports` 直接指向 `./src/*.ts`（publishConfig 才切 dist）。我们不发布这些包，因此 vendor 后不运行它们的 `build`/`prepublishOnly` 脚本（视为惰性脚本），extension 经 WXT 直接打包 TS 源码。

**D3 — npm-hoisting → pnpm-isolation 的补丁集。** 上游靠 npm workspaces 根提升解析依赖，pnpm 隔离模式下不成立。最小补丁（全部登记 UPSTREAM.md）：

| #   | 文件                          | 改动                                            | 原因                                                                        |
| --- | ----------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| P1  | `apps/extension/package.json` | `name: "@page-agent/ext"` → `"extension"`       | 对齐文档约定 `pnpm -F extension`；该包是我们的应用层 fork，不受 I5 包名约束 |
| P2  | `apps/extension/package.json` | 4 个 `@page-agent/*: "1.9.0"` → `"workspace:*"` | 指向本仓 vendor 包而非 npm registry                                         |
| P3  | `apps/extension/package.json` | devDependencies 增加 `"zod": "^4.4.3"`          | zod 是其 peerDependency，pnpm 下无提升来源                                  |
| P4  | `packages/llms/package.json`  | devDependencies 增加 `"vitest": "^4.1.8"`       | 其 `test` 脚本依赖根提升的 vitest（快照中其他含 test 脚本的包同样处理）     |

除 P1–P4 外**零改动**：四个 lib 包的包名、目录结构、源码、版权头原样保留（I5）。

**D4 — 前置依赖（M0 子集，硬门禁）。** M1 开工前仓库根必须已具备（属 M0 范围，M1 计划 Task 1 校验，缺失即停）：

- `pnpm-workspace.yaml` 含 `apps/*`、`packages/*`；
- 根 `package.json`：`packageManager: pnpm@9.x`、devDependencies 含 `typescript@^6.0.3`、`@types/node`；
- 根 `tsconfig.base.json` = 上游同名文件原样拷贝（vendored 包的 tsconfig `extends: ../../tsconfig.base.json`，对 `apps/*` 与 `packages/*` 两级深度均成立）；
- Node 22 LTS + pnpm 9 可用。

**D5 — License 与 NOTICE。** 上游根 `LICENSE` → `third_party/page-agent/LICENSE`；README 中对 browser-use 的衍生声明块 → `third_party/page-agent/NOTICE`。

**D6 — 提交策略：先 pristine 后补丁。** 快照原样导入一个 commit，P1–P4 补丁一个 commit——保证 vendor 基线与本地改动在 git 历史里可分别审计，UPSTREAM.md 直接引用这两个 hash。

## 4. 已知问题与明确不处理（M1 范围外）

| 问题                                                                                                   | 处置                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 上游 `wxt.config.js` 内置其官方 manifest `key`，未打包加载与商店版 PageAgent 共享扩展 ID，二者不可共存 | 记录于 UPSTREAM.md；M4 换问学自己的 key                                               |
| `wxt dev`（`pnpm -F extension dev`）在品牌版 Chrome 137+ 上因 `--load-extension` 失效                  | M1 验收用手动加载路径；`webExt.chromiumBinary` 指 CfT 的配置留到 M2 产出 CfT 后顺手补 |
| 上游根 `overrides`（uuid / tmp 钉版本）                                                                | 暂不引入；`pnpm install`/audit 报问题时再按需加 `pnpm.overrides` 并登记               |
| 上游品牌（名称/图标/locales/默认模型）                                                                 | 原样保留，M4 处理                                                                     |

## 5. 验收清单（执行计划 Task 9 引用）

1. `pnpm install` 无 ERR（peer 告警可接受并记录）；
2. `pnpm -r test` 全绿；
3. `pnpm -F extension build` 产出 `.output/chrome-mv3/manifest.json`，`manifest_version === 3` 且含 `side_panel`；
4. 浏览器手动加载产物：侧边栏可开 → 配置面板填入百炼 baseURL + `qwen3.5-plus` + 有效 Key → 在一个静态表单页跑通一次最小任务（点击/填写类指令）；
5. `UPSTREAM.md` 含：上游地址、tag、40 位 commit、导入与补丁两个本仓 commit hash、P1–P4 清单、同步流程；
6. ROADMAP M1 四个复选框打勾 + 执行日志（DoD）。
