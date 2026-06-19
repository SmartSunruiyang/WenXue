# 超星学习通考试/作业自动求解器（chaoxing_solve 工具 + 三段式确定性流水线）

- **日期**：2026-06-17
- **关联**：设计稿 [`../docs/superpowers/specs/2026-06-17-chaoxing-exam-solver-design.md`](../docs/superpowers/specs/2026-06-17-chaoxing-exam-solver-design.md)、实施计划 [`../docs/superpowers/plans/2026-06-17-chaoxing-exam-solver.md`](../docs/superpowers/plans/2026-06-17-chaoxing-exam-solver.md)
- **会话上下文**：在隔离 worktree `.worktrees/chaoxing-exam-solver`（分支 `codex/chaoxing-exam-solver`，依赖已装）上执行 Task 1–11。本日志为 Task 11（最终自动化验证 + 写日志）。真机人工走查因缺少在线学习通页面与已配置模型，本环境无法执行，明确标记为 PENDING。

## 做了什么

实现一个超星学习通（Chaoxing）考试/作业自动求解器，对外只暴露单个 Agent 工具 `chaoxing_solve`，内部跑一条**确定性三段式流水线**：

1. **读题（extract）**：DOM 选择器从 MIT ocsjs 移植，识别单选/多选/判断/填空等题型；图片题走多模态，按位置锚点生成占位符。
2. **生成答案（LLM，唯一一处 LLM 调用）**：强制 tool-call 产出**结构化**答案；文本/视觉双模型路由（image 题走 vision 模型）。
3. **填答（fill）**：按结构化答案回填到页面对应控件。

铁律：**绝不自动提交**；绝不绕过登录/验证码/人脸识别/字体反爬；任何 LLM 出错一律降级为 needsReview，绝不写入错误答案。

十个已落地子任务（commits 见下「提交」）对应：
- 文档（spec/plan + 特性登记）
- 类型 + 页面检测（`types.ts` / `detect.ts`）
- 读题/抽取（`extract.ts`，文本题型）
- 填答（`fill.ts`，文本题型）
- 内容适配器 + RPC 桥（`adapter.content.ts` / `bridge.ts` / `bridge.background.ts`）
- 答案 schema + 序列化 + LLM 客户端（`schema.ts` / `serialize.ts` / `llm.ts`）
- 求解流水线 + 工具 + Agent 注入（`solve.ts` / `tools.ts`）
- 文本/视觉双模型设置
- 图片抽取 + 降采样 + 多模态序列化与路由（`images.ts`）
- line/fill/reader 题型 + 中断守卫 + 分页就绪判断

代码全部位于 `apps/extension/src/agent/chaoxing/`，外加 MultiPageAgent / useAgent / settings / entrypoints 的少量接线。vendored `packages/*` 未触碰（不变量 I5）。jsdom 作为测试 devDependency 引入，供 DOM 单测使用。

## 验证（实际结果）

在 worktree 内实跑以下四条命令，结果如实记录：

1. `pnpm -F extension test`（vitest）：**全绿，23 文件 / 197 测试通过**（Duration ~793ms）。这是本特性测试的真正归属——`chaoxing/` 全部 `*.test.ts` 都在此包内。

2. `pnpm -F extension exec tsc --noEmit`：**非零退出（exit 2），但仅 3 个已知的、与本特性无关的既有错误**，全部在 `src/components/misc.test.ts`：
   - `misc.test.ts(45,16): TS18046: 'logoWrap.props' is of type 'unknown'.`
   - `misc.test.ts(48,10): TS18046: 'logoWrap.props' is of type 'unknown'.`
   - `misc.test.ts(51,10): TS18046: 'slogan.props' is of type 'unknown'.`

   本特性新增的 `agent/chaoxing/**` 文件**零类型错误**。这 3 个为既有问题（pre-existing），非本次引入。

3. `pnpm -F extension build`（WXT/esbuild）：**通过**，产出 `.output/chrome-mv3`（Σ 2.15 MB）。仅保留既有 warning：`Unrecognized target environment "es2025"`（esbuild 对 vendored `packages/core/src/utils/autoFixer.ts` 的提示）与 Vite 的 `@vitejs/plugin-react-oxc` 性能建议。均与本特性无关。

4. `pnpm -r test`（全 workspace）：**非零退出（Exit status 1），但属环境/fail-fast 现象，非本特性测试失败**。明细：
   - Scope: 6 of 7 workspace projects。三个 vendored 包（`@page-agent/core`、`@page-agent/page-controller`、`@page-agent/ui`）无 `test` 脚本，被 pnpm 静默跳过。
   - `packages/llms`：**58 测试通过**。
   - `apps/desktop`：**30 测试通过**，但有 2 个测试套件（`AppLogger.test.ts`、`MainBootstrap.test.ts`）**加载失败**，原因是本沙箱内 Electron 二进制未安装（`Error: Electron failed to install correctly, please delete node_modules/electron and try installing again`）——是环境问题，不是断言失败。
   - 由于 `pnpm -r` 并行 + fail-fast，`apps/desktop` 先失败即中断整轮，**`apps/extension` 的 197 测试在本次 `-r` 调用中未被调度**。这些测试已由上面第 1 条专用命令（`-F extension test`）覆盖并全绿。

   小结：`pnpm -r test` 的非零退出来自 desktop 的 Electron 环境缺失（非本特性引入、非真实断言失败）；本特性测试在 `-F extension test` 中 197/197 全过。

## 提交

分支 `codex/chaoxing-exam-solver`，**尚未合并入 `main`**。本特性相关提交（连同本日志）：

- `e52f8f9` docs(chaoxing): 记录学习通求解器特性与模块
- `215a0b9` docs(chaoxing): 学习通考试/作业求解器 spec 与 plan
- `829bd5d` test(ext): add jsdom env for chaoxing DOM tests
- `c91127d` feat(ext): chaoxing types + page detection
- `7c365b3` feat(ext): chaoxing read/extract for text question types
- `15b4113` feat(ext): chaoxing fill for text question types
- `a390298` feat(ext): chaoxing content adapter + RPC bridge
- `1252dab` feat(ext): chaoxing answer schema, serializer, LLM client
- `a604708` refactor(ext): inline OpenAI tool builder in chaoxing llm client, drop vendored deep import
- `e9cdd65` feat(ext): chaoxing solve pipeline + tool + agent injection
- `dec9f15` feat(ext): chaoxing dual-model (text/vision) settings
- `b630fbf` feat(ext): chaoxing image extraction, downscale, multimodal serialize + routing
- `6cd8031` feat(ext): chaoxing line/fill/reader types + interrupt guard + pagination readiness
- （外加本任务自身的执行日志提交）

## 状态变更

- ARCHITECTURE：本特性新增插件域子模块 `agent/chaoxing/`（在既有插件域内），vendored `packages/*` 未动（I5 保持）；两域零运行时通信（I3）保持；LLM 仅经 OpenAI-compatible HTTP（I4）保持。
- PRD / UIUX：特性登记见 `e52f8f9`（如设计稿所述）。
- 测试：见上「验证」四条命令的实际结果。

## 已知限制 / 待真机验证（IMPORTANT — 本环境无法覆盖，须真机走查）

### 1. 真机人工端到端走查 —— **PENDING**

需要在线学习通页面 + 已配置的文本/视觉模型，本环境均不具备。待验证：

- read → answer → fill 端到端：单选 / 多选 / 判断 / 填空（completion）各跑通。
- 图片题三类经 vision 模型：图片选项、题干内公式（formula-in-stem）、共享材料（shared-material）。
- 文本/视觉双模型**路由**正确。
- **绝不自动提交**在真机得到验证。
- 人脸识别 / 字体反爬**中断暂停**真机触发并暂停。
- 考试**分页**（多页）翻页正确。

### 2. 从 ocsjs 选择器推断的 DOM 结构（无抓取到的真实页面）—— 待真机核验

- `.stem_answer` 包裹层是否成立。
- line 题：`.line_answer_ct .selectBox` / `li[data]` 结构是否成立。
- fill/reader 题：`.filling_answer` / `.reading_answer` / `span.saveSingleSelect[data]` 是否成立。
- `gotoNextPage` 就绪判断：当前以 `.questionLi` 出现为准，但**原地内容替换（in-place content swap）可能需要内容沉降（content-settle）检查**，而非仅检测 `.questionLi` 存在；真机可能需要补一个 settle 判定。

### 3. Provider 适配 —— 待对用户真实端点核验

- `llm.ts` 采用 OpenAI 格式的强制 `tool_choice` + `temperature: 0`。
- 部分 provider 行为不同：**DeepSeek / Grok 可能剥离强制 `tool_choice`；某些 provider 拒绝 `temperature`**。需对用户实际的 Qwen / DeepSeek 端点验证并可能适配。
- 安全降级仍成立：任何 LLM 错误 → needsReview，绝不产出错误答案。

### 4. jsdom 测试无法覆盖（仅 build/tsc 覆盖，须真浏览器验证）

- 带凭据的图片 `fetch`（credentialed image fetch）。
- canvas 降采样（`defaultDownscale`）。
- 真实 UEditor iframe 写入。
- 跨域 iframe（cross-origin iframes）。

以上仅经 build/tsc 覆盖，运行态须在真浏览器验证。

### 5. 工具偏置（tool biasing）为基于 prompt 的软约束

- 当前通过 prompt 软性引导 Agent 走 `chaoxing_solve` 整体求解，但 Agent **仍可能逐题点击**。
- 可能的改进方向：基于动态检测（dynamic detection）的偏置，让检测到学习通考试页时更强地导向单一工具。

## 下一步

1. **真机验证 pass**：在在线学习通页面、用用户自己的文本/视觉模型，按上面「已知限制 §1/§2/§3」逐项走查 read→answer→fill、图片三类、路由、不自动提交、人脸/字体中断、分页。
2. 据真机结果决定是否落地：**字体反爬解码（font-anti-scraping decode）** 与更紧的 `request_user_takeover` 集成（人脸/验证码/登录交还用户）。
