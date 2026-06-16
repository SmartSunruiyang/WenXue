# CLAUDE.md

This file guides Claude Code (and other agents) when working in this repository.

## Project

`问学 WenXue`（ask for everything）是一个跨平台桌面套件：Electron 启动器内置 Chrome for Testing 浏览器，启动时注入「问学」MV3 插件（LLM 网页操作 Agent，fork 自 alibaba/page-agent，MIT）。pnpm monorepo：应用代码在 `apps/`（desktop、extension），vendor 的上游库在 `packages/`（`@page-agent/*`）；测试为各包内同目录的 `*.test.ts`。

- Entry point: `apps/desktop/src/main/index.ts`（Electron 主进程）· `apps/extension/src/entrypoints/`（WXT）
- 浏览器内核 = Chrome for Testing **打包内置**：品牌版 Chrome 137+ 已移除 `--load-extension`，CfT 永久保留（决策记录：TECH-INFRA §12）
- 边界铁律：插件域管"智能"（Agent 循环、LLM、历史），桌面域管"运行时"（CfT 版本、画像、进程看护）；Demo 阶段两域**零运行时通信**（不变量 I3）
- Known environment constraints: Node 22 LTS + pnpm 9（`packageManager` 字段）；CfT 二进制不入库，构建期拉取至 `.browsers/`（国内设 `PUPPETEER_DOWNLOAD_BASE_URL=https://registry.npmmirror.com/-/binary/chrome-for-testing`）；Demo 产物不签名（macOS 需手动放行）

## Common commands

```sh
# Build
pnpm build

# Run
pnpm dev

# Test
pnpm -r test
```

根聚合脚本由 ROADMAP M0 落地（`pnpm build` = 插件构建 → 桌面构建，完整流水线见 TECH-INFRA §8.1）。单包操作用 `pnpm -F <pkg> <script>`（如 `pnpm -F desktop fetch-browser` 拉取 CfT、`pnpm -F extension build` 产出插件）。M0 之前这些命令尚不可用——属正常状态，不要试图"修复"。

## Architecture

The implementation follows the module boundaries in `.project.agents/docs/context/ARCHITECTURE.md`:

- **桌面域**（`apps/desktop`）：AppPaths / AppLogger（L0 基础设施）→ BrowserResources（资源定位，纯）→ LaunchConfig（argv 组装，纯）→ ProfileStore + BrowserSupervisor（画像与进程状态机）→ DesktopBridge（typed IPC，契约见 ARCHITECTURE §3.2）→ ConsoleUI（React 控制台）→ MainBootstrap（组装根）
- **插件域**（`apps/extension` + vendor `packages/*`）：`@page-agent/ui · llms · page-controller · core`（上游快照，不变量 I5）→ MultiPageAgent（跨标签编排）+ SidepanelApp（对话/配置/历史 UI）→ ExtensionEntrypoints（组装根）
- 两域之间**没有任何依赖边**（I3）；插件域只经 OpenAI-compatible HTTP 调 LLM（I4）；API Key 永不经过桌面端进程（I2）

## Project-level rules

- **Read these two files before any code-changing task** — they encode the lessons that gate every decision in this repo:
  - `.project.agents/VIBECODING_GUIDE.md` — the practice guide (why & how)
  - `.project.agents/SELF_CONSTRAINTS.md` — the hard constraints (what's forbidden, what's required, when to stop)

  For any non-trivial task, run through `SELF_CONSTRAINTS.md §A` (pre-flight self-check) before editing anything.

- **Agent settings live under `.project.agents/`.** Any `settings.json` or other configuration you generate for your own use MUST be written to `.project.agents/` (or a subdirectory) — never the project root, `.claude/`, or `~/.claude/`. This keeps repo-tracked agent state contained.

- **Canonical project documentation lives under `.project.agents/docs/context/`** as a single flat directory. Canonical files:
  - `PRD.md` — product requirements (source of truth for behavior)
  - `ARCHITECTURE.md` — module boundaries, dependencies, contracts, directory layout
  - `TECH-INFRA.md` — 基础设施权威：CfT 供应链、打包分发、CI、启动参数全集、关键决策记录（ADR）
  - `ROADMAP.md` — implementation milestones and acceptance checks
  - `CONVENTIONS.md` — naming, style, testing, repository conventions
  - `UIUX.md` — visual tokens + interaction details (source of truth for visuals)
  - `UPSTREAM.md` — vendor 同步记录（ROADMAP M1 建立后存在）

- **Superpowers specs and plans live under `.project.agents/docs/superpowers/`.**
  - Specs: `.project.agents/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
  - Plans: `.project.agents/docs/superpowers/plans/YYYY-MM-DD-<topic>.md`
  - Do not create `.project.agents/specs/`, `.project.agents/plans/`, root-level `docs/superpowers/`, or store Superpowers specs/plans in `.project.agents/docs/context/`.
  - Plans should link their specs with relative sibling paths, e.g. `../specs/YYYY-MM-DD-<topic>-design.md`.
  - Superpowers docs are derived planning artifacts. Behavior/module changes still update canonical upstream docs in `.project.agents/docs/context/`.

- **Source-of-truth hierarchy** — on conflict, upstream wins:

  ```
  PRD.md > ARCHITECTURE.md > TECH-INFRA.md > UIUX.md > CONVENTIONS.md > derived docs
  ```

  分工备注：模块边界与依赖以 `ARCHITECTURE.md` 为准；供应链/打包/CI/签名以 `TECH-INFRA.md` 为准，两者按领域各自权威，顺序仅用于裁决重叠地带。When an upstream doc changes, regenerate the affected sections of derived docs to stay in sync. Feature changes must update `PRD.md`; module/dependency changes must update `ARCHITECTURE.md` in the same commit. Do not let code and architecture drift for more than 24 hours.

- **Roadmap execution rules:**
  1. Advance in the order set by `.project.agents/docs/context/ROADMAP.md` and the logs in `.project.agents/log/`. Tick each checkbox in the same commit that completes it.
  2. Prefer subagents for concrete implementation; the main conversation decomposes, reviews, and ticks.
  3. **Milestone-level / multi-file / multi-module = a large task**: write a plan/spec first, then execute against it. Small tasks (single file, single checkbox, pure revision) can be done directly.
  4. After each milestone, write an execution log per the `.project.agents/log/` template.
