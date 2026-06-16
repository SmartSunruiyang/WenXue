# M1 — vendor page-agent 五包入库：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 alibaba/page-agent v1.9.0 的四个支撑库与扩展应用快照 vendor 进本仓 pnpm monorepo，`pnpm -r test` 全绿、`wxt build` 出可手动加载的 MV3 产物。

**Architecture:** 先 pristine 导入（一个 commit），再施加 P1–P4 最小 pnpm 适配补丁（一个 commit），保证基线与本地改动可分别审计（spec D6）。四个 lib 包源码直出、不跑库构建（spec D2）。spec：`../specs/2026-06-11-m1-vendor-page-agent-design.md`。

**Tech Stack:** pnpm 9 workspaces · TypeScript 6 · WXT 0.20（MV3）· vitest 4

**测试说明：** 本里程碑是 vendoring/集成，无新业务逻辑，不适用 TDD 新写测试；质量门 = 上游测试套件全绿 + 构建产物断言 + 人工验收（spec §5）。

---

### Task 1: 前置门禁（M0 子集校验，缺失即停）

**Files:** 只读校验，无改动。

- [ ] **Step 1: 校验工具链**

```bash
node -v && pnpm -v
```

Expected: `v22.x` 与 `9.x`。不满足 → 停止，先装 Node 22 LTS / pnpm 9。

- [ ] **Step 2: 校验 workspace 骨架（M0 产物）**

```bash
test -f pnpm-workspace.yaml && cat pnpm-workspace.yaml
node -e "const p=require('./package.json'); console.log('pm:', p.packageManager, '| ts:', (p.devDependencies||{}).typescript)"
test -f tsconfig.base.json && grep -c erasableSyntaxOnly tsconfig.base.json
```

Expected: workspace 含 `apps/*` 与 `packages/*` 两项；`pm: pnpm@9.…`、`ts: ^6.0.3`；最后输出 `1`（tsconfig.base.json 为上游同名文件的原样拷贝，spec D4）。

**任一不满足 → 全停**：先按 `docs/context/ROADMAP.md` 完成 M0（本计划不越界代做 M0）。

- [ ] **Step 3: 校验工作区干净**

```bash
git status --short
```

Expected: 无输出。有脏改动 → 按 SELF_CONSTRAINTS §A2 先与用户对齐。

---

### Task 2: 获取上游快照

**Files:** 仅 `/tmp`，不进仓库。

- [ ] **Step 1: 浅克隆 v1.9.0**

```bash
rm -rf /tmp/page-agent-v1.9.0
git clone --depth 1 --branch v1.9.0 https://github.com/alibaba/page-agent.git /tmp/page-agent-v1.9.0
```

Expected: 克隆成功（国内网络失败时用镜像 `https://ghproxy.net/https://github.com/alibaba/page-agent.git`，并在 UPSTREAM.md 注明实际来源仍为 GitHub 原仓）。

- [ ] **Step 2: 取全量 commit hash（后续 UPSTREAM.md 用）**

```bash
git -C /tmp/page-agent-v1.9.0 rev-parse HEAD | tee /tmp/page-agent-snapshot-hash.txt
```

Expected: 输出 40 位 hash，前 12 位应为 `3a2f0a41ec69`。不一致 → 停止核实（tag 可能被移动）。

---

### Task 3: pristine 导入（四包 + extension + LICENSE/NOTICE）

**Files:**

- Create: `packages/{core,llms,page-controller,ui}/`（上游原样）
- Create: `apps/extension/`（= 上游 `packages/extension/` 原样）
- Create: `third_party/page-agent/LICENSE`、`third_party/page-agent/NOTICE`

- [ ] **Step 1: 拷贝五个目录**

```bash
mkdir -p packages apps third_party/page-agent
for p in core llms page-controller ui; do cp -R /tmp/page-agent-v1.9.0/packages/$p packages/$p; done
cp -R /tmp/page-agent-v1.9.0/packages/extension apps/extension
cp /tmp/page-agent-v1.9.0/LICENSE third_party/page-agent/LICENSE
```

- [ ] **Step 2: 写 NOTICE（browser-use 衍生声明，内容取自上游 README License/Acknowledgments 节）**

```bash
cat > third_party/page-agent/NOTICE <<'EOF'
This repository vendors code from Page Agent (https://github.com/alibaba/page-agent),
Copyright (c) Alibaba, licensed under the MIT License (see LICENSE in this directory).

Upstream acknowledgment, preserved as required:

DOM processing components and prompt are derived from browser-use:

Browser Use <https://github.com/browser-use/browser-use>
Copyright (c) 2024 Gregor Zunic
Licensed under the MIT License

We gratefully acknowledge the browser-use project and its contributors for their
excellent work on web automation and DOM interaction patterns that helped make
this project possible.
EOF
```

- [ ] **Step 3: 核验导入完整性**

```bash
ls packages/core/src packages/llms/src packages/page-controller/src packages/ui/src apps/extension/src
node -e "for (const p of ['packages/core','packages/llms','packages/page-controller','packages/ui','apps/extension']) { const j=require('./'+p+'/package.json'); console.log(j.name, j.version, j.license||'-') }"
```

Expected: 各 src 目录非空；五行输出，lib 四包名为 `@page-agent/*`、版本 `1.9.0`、license `MIT`；extension 名为 `@page-agent/ext`。

- [ ] **Step 4: Commit（pristine 基线 + 勾 ROADMAP M1 第 1 项）**

把 `docs/context/ROADMAP.md` M1 中「从上游快照复制…」一项的 `- [ ]` 改为 `- [x]`，然后：

```bash
git add packages apps/extension third_party .project.agents/docs/context/ROADMAP.md
git commit -m "chore(vendor): pristine 导入 page-agent v1.9.0（四包 + extension + LICENSE/NOTICE）"
```

---

### Task 4: pnpm 适配补丁 P1–P4

**Files:**

- Modify: `apps/extension/package.json`
- Modify: `packages/llms/package.json`

- [ ] **Step 1: P1+P2+P3 —— extension package.json**

对 `apps/extension/package.json` 做三处字段修改（其余字段不动）：

```jsonc
// P1 包名（应用层 fork，对齐 `pnpm -F extension` 约定）
"name": "@page-agent/ext"   →   "name": "extension"

// P2 dependencies 中四个 vendor 包改 workspace 协议
"@page-agent/core": "1.9.0"            →  "@page-agent/core": "workspace:*"
"@page-agent/llms": "1.9.0"            →  "@page-agent/llms": "workspace:*"
"@page-agent/page-controller": "1.9.0" →  "@page-agent/page-controller": "workspace:*"
"@page-agent/ui": "1.9.0"              →  "@page-agent/ui": "workspace:*"

// P3 devDependencies 增加一行（zod 是其 peerDependency，pnpm 隔离下无提升来源）
"zod": "^4.4.3"
```

- [ ] **Step 2: P4 —— llms 补 vitest**

`packages/llms/package.json` 的 `devDependencies` 增加一行（其 `test: "vitest run"` 上游靠根提升）：

```jsonc
"vitest": "^4.1.8"
```

同时检查其余三包：`grep -l '"test":' packages/*/package.json` —— 凡含 `test` 脚本的包同样补 `"vitest": "^4.1.8"`（v1.9.0 时点预期只有 llms；如快照有出入，以实际为准并在 UPSTREAM.md 登记）。

- [ ] **Step 3: JSON 语法核验**

```bash
node -e "for (const p of ['apps/extension','packages/llms']) { const j=require('./'+p+'/package.json'); console.log(j.name, j.dependencies?.['@page-agent/core']||'-', j.devDependencies?.zod||j.devDependencies?.vitest) }"
```

Expected: `extension workspace:* ^4.4.3` 与 `@page-agent/llms - ^4.1.8`。

- [ ] **Step 4: Commit**

```bash
git add apps/extension/package.json packages/llms/package.json
git commit -m "fix(vendor): pnpm workspace 适配补丁 P1-P4（包名/workspace协议/zod/vitest）"
```

---

### Task 5: 安装与上游测试套件

**Files:**

- Create: `pnpm-lock.yaml`（自动生成）

- [ ] **Step 1: 安装**

```bash
pnpm install
```

Expected: 成功结束；extension 的 `postinstall: wxt prepare` 自动执行（生成 `.wxt/` 类型，已被 gitignore）。peer 警告可接受；任何 `ERR_PNPM_*` → 停止排查（最可能是 P2 协议笔误或 registry 网络）。

- [ ] **Step 2: 跑上游测试**

```bash
pnpm -r test
```

Expected: `@page-agent/llms` 的 vitest 套件全部 PASS；无 test 脚本的包被 pnpm 自动跳过。任何 FAIL → 停止：不允许靠改测试通过（上游套件是 vendor 完整性的证据，SELF_CONSTRAINTS 不许半完成）。

- [ ] **Step 3: Commit（lockfile + 勾 ROADMAP M1 第 2 项「workspace:\* 与测试全绿」）**

```bash
git add pnpm-lock.yaml .project.agents/docs/context/ROADMAP.md
git commit -m "chore(vendor): pnpm-lock 入库，pnpm -r test 全绿"
```

---

### Task 6: 建立 UPSTREAM.md

**Files:**

- Create: `.project.agents/docs/context/UPSTREAM.md`

- [ ] **Step 1: 写入全文**（两处 `<hash>` 用 Task 2 Step 2 与 `git log` 的真实值替换）

```markdown
# UPSTREAM — page-agent vendor 记录

> 对应 ARCHITECTURE 不变量 I5。任何对 `packages/@page-agent 四包` 与 `apps/extension` 上游部分的改动，先登记本文再动代码。

## 当前快照

| 项                        | 值                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 上游                      | https://github.com/alibaba/page-agent.git                                                                                            |
| 基准                      | tag `v1.9.0`（2026-06-08 发布）                                                                                                      |
| 上游 commit               | `<Task2 输出的 40 位 hash>`                                                                                                          |
| 本仓 pristine 导入 commit | `<git log --oneline 中 chore(vendor): pristine 的 hash>`                                                                             |
| 本仓适配补丁 commit       | `<fix(vendor): P1-P4 的 hash>`                                                                                                       |
| 导入范围                  | packages/{core,llms,page-controller,ui} → packages/\*；packages/extension → apps/extension；LICENSE+NOTICE → third_party/page-agent/ |
| 未导入                    | packages/{page-agent,mcp,website}、scripts/、根配置（root 由本仓自管）                                                               |

## 本地补丁清单（相对 pristine）

| #   | 文件                        | 改动                                 | 原因                                               |
| --- | --------------------------- | ------------------------------------ | -------------------------------------------------- |
| P1  | apps/extension/package.json | name → `extension`                   | 对齐 `pnpm -F extension`；应用层 fork 不受 I5 约束 |
| P2  | apps/extension/package.json | `@page-agent/*` 依赖 → `workspace:*` | 指向本仓 vendor 包                                 |
| P3  | apps/extension/package.json | +devDep `zod@^4.4.3`                 | peer 依赖在 pnpm 隔离下无提升来源                  |
| P4  | packages/llms/package.json  | +devDep `vitest@^4.1.8`              | 同上，test 脚本所需                                |

## 已知差异与遗留

- 上游 `wxt.config.js` 保留其官方 manifest `key`：未打包加载与商店版 PageAgent 共享扩展 ID，**两者不可同时安装**；M4 更换为问学自有 key。
- 上游根 `overrides`（uuid、web-ext-run>tmp）未引入；install/audit 出问题时按需补 `pnpm.overrides` 并在此登记。
- lib 四包的 `build`/`prepublishOnly`/`postpublish` 脚本在本仓为惰性脚本（源码直出，不发布）。

## 手动同步流程（升级上游时）

1. `git clone --depth 1 --branch <新tag> https://github.com/alibaba/page-agent.git /tmp/pa-new`
2. 逐包 `diff -ruN <本仓包目录> /tmp/pa-new/packages/<包>`，剔除 P1–P4 与 M4 品牌化改动后评审 diff；
3. 挑拣合入（不整目录覆盖），重跑本计划 Task 5 验证；
4. 更新本文快照表与补丁清单，commit message 注明新旧 tag。
```

- [ ] **Step 2: Commit（勾 ROADMAP M1 第 3 项「UPSTREAM.md」）**

```bash
git add .project.agents/docs/context/UPSTREAM.md .project.agents/docs/context/ROADMAP.md
git commit -m "docs(vendor): UPSTREAM.md 快照与补丁登记"
```

---

### Task 7: 构建产物与 manifest 断言

**Files:** 产出 `apps/extension/.output/chrome-mv3/`（gitignored，不提交）。

- [ ] **Step 1: 构建**

```bash
pnpm -F extension build
```

Expected: WXT 构建成功，输出含 `.output/chrome-mv3`。若报错涉及 `../../packages/...` 类相对路径 → 属上游配置对目录深度的隐含假设被打破，停止并把实际报错登记 UPSTREAM.md 后再修。

- [ ] **Step 2: manifest 断言**

```bash
node -e "
const m = require('./apps/extension/.output/chrome-mv3/manifest.json')
if (m.manifest_version !== 3) throw new Error('not MV3')
if (!m.side_panel) throw new Error('side_panel missing')
if (!(m.permissions||[]).includes('sidePanel')) throw new Error('sidePanel permission missing')
console.log('manifest OK:', m.name, m.version)
"
```

Expected: `manifest OK: __MSG_extName__ 1.9.0`。

- [ ] **Step 3: Commit（勾 ROADMAP M1 第 4 项「wxt build 产出」；本步无代码改动，仅 ROADMAP 勾选）**

```bash
git add .project.agents/docs/context/ROADMAP.md
git commit -m "docs: ROADMAP M1 构建项打勾（wxt build 产物验证通过）"
```

---

### Task 8: 人工验收（spec §5.4）

**Files:** 无改动；需要人参与（百炼 API Key）。

- [ ] **Step 1: 手动加载**：浏览器 `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选 `apps/extension/.output/chrome-mv3`。Expected: 扩展出现且无错误徽标（若机器装有商店版 PageAgent，先停用——ID 冲突见 UPSTREAM.md）。
- [ ] **Step 2: 侧边栏**：固定工具栏图标 → 点击。Expected: 侧边栏打开（上游品牌属预期，M4 换）。
- [ ] **Step 3: 配模型**：配置面板填 `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen3.5-plus` + 有效 Key。
- [ ] **Step 4: 最小任务**：开任意静态表单/搜索页，下达一条点击或填写类指令。Expected: 页面出现模拟光标与高亮，任务完成，侧边栏有活动流与结果总结，历史可见。
- [ ] **Step 5: 把实际验证环境（浏览器与版本、OS）记下来，供 Task 9 日志使用。**

---

### Task 9: 里程碑收尾

**Files:**

- Create: `.project.agents/log/<今日日期>-m1-vendor-page-agent.md`

- [ ] **Step 1: 写执行日志**（按 `log/README.md` 模板：做了什么 / Task 3–7 的 commit 列表 / 状态变更（ARCHITECTURE 未动、UPSTREAM.md 新增）/ 测试结果（pnpm -r test、manifest 断言、人工验收环境）/ 下一步 = M2 或 M3 前置）
- [ ] **Step 2: 核对 DoD**：ROADMAP M1 四项均已在对应 commit 打勾；`git status` 干净；`pnpm -r test` 最后一次运行为绿。
- [ ] **Step 3: Commit**

```bash
git add .project.agents/log/
git commit -m "docs: M1 vendor page-agent 执行日志"
```

---

## 自审记录（写计划时已执行）

- **Spec 覆盖**：D1→Task 2；D2→Task 7 不跑库构建；D3 P1-P4→Task 4；D4→Task 1；D5→Task 3；D6→Task 3/4 两 commit；spec §5 验收 1-6 → Task 5/7/8/9。无缺口。
- **占位符扫描**：仅两类执行期捕获值（commit hash、验收环境），均给出产生它们的确切命令。
- **一致性**：包名 `extension` 在 P1、Task 5/7 的 `-F extension`、CLAUDE.md 既有命令三处一致；vitest/zod 版本与上游根 devDeps 一致（^4.1.8 / ^4.4.3）。
