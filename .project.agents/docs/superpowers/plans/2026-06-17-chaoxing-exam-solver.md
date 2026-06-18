# Chaoxing Exam Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 进入超星学习通作业/考试页时，提供单一高层 agent 工具 `chaoxing_solve`，把「读题 → LLM
生成结构化答案 → 回填」封装成确定性流水线；LLM 只负责答案生成，读题定位与回填移植 ocsjs 的学习通
DOM 契约；含图题经位置锚定的交错多模态载荷喂视觉模型；只填不交。

**Architecture:** 全部新增代码落在插件域 `apps/extension/src/agent/chaoxing/*`，**零改 vendor
`packages/*`（不变量 I5）**。`solve.ts`（智能域）编排，取代 ocsjs 的 OCSWorker；`adapter.content.ts`
（内容脚本顶层 frame）持有学习通 DOM 操作，经与 `RemotePageController` 同传输的 RPC 被调用；工具经
`PageAgentCore` 的 `customTools` 注入（仿 `tabTools.ts`）；不引入桌面域通信（I3），只经 OpenAI-compatible
HTTP 调模型（I4）。

**Tech Stack:** TypeScript, React 19, WXT MV3 extension, Vitest, Zod v4；复用 `@page-agent/llms`
（`zodToOpenAITool`，仅 import 不改）；移植来源 ocsjs 4.0（MIT）`cx.ts` / `work.ts`。

**Spec:** `../specs/2026-06-17-chaoxing-exam-solver-design.md`

> **构建约束（已知）**：`pnpm -F extension build` 用 esbuild，**不做类型检查**；类型错误须另跑
> `pnpm -F extension exec tsc --noEmit`。单测用 `pnpm -F extension test <file>`（`<file>` 相对
> `apps/extension` 写，如 `src/agent/chaoxing/detect.test.ts`）。改扩展源码后需
> `pnpm -F extension build` 才生效（根 dev 不 watch 扩展）。
> DOM 测试经文件顶部 `// @vitest-environment jsdom` 切到 jsdom（`jsdom`/`@types/jsdom` 为 `apps/extension` devDependency，全局 vitest env 仍是 `node`）。

---

## File Structure

- Modify `.project.agents/docs/context/PRD.md`
  - 新增「学习通作业/考试求解」特性（含「只填不交」「不绕过防护」边界）。
- Modify `.project.agents/docs/context/ARCHITECTURE.md`
  - 插件域模块图新增 `chaoxing/*` 与其对 `RemotePageController` 的依赖；声明零改 vendor `packages/*`。
- Create `apps/extension/src/agent/chaoxing/types.ts`
  - `QType` / `ContentPart` / `ChaoxingOption` / `ChaoxingQuestion` / `ChaoxingAnswer`（见 Spec §7）。
- Create `apps/extension/src/agent/chaoxing/detect.ts` (+ `.test.ts`)
  - host + `.questionLi` 检测；作业/考试题型来源判定。
- Create `apps/extension/src/agent/chaoxing/extract.ts` (+ `.test.ts`)
  - 纯函数：从一个 `.questionLi` 元素解析出 `ChaoxingQuestion`（选择器移植自 `cx.ts:801-815`）。
- Create `apps/extension/src/agent/chaoxing/fill.ts` (+ `.test.ts`)
  - 纯函数：按题型把 `ChaoxingAnswer` 落到一个 `.questionLi`（操作移植自 `cx.ts:857-894`、`cx.ts:2194`）。
- Create `apps/extension/src/agent/chaoxing/images.ts` (+ `.test.ts`)
  - 页内抓图、装饰图过滤、降采样、LaTeX 文本源优先、占位符标注。
- Create `apps/extension/src/agent/chaoxing/serialize.ts` (+ `.test.ts`)
  - `ChaoxingQuestion → { messages, hasImages }`（纯文本 / 多模态交错，见 Spec §8.2）。
- Create `apps/extension/src/agent/chaoxing/schema.ts` (+ `.test.ts`)
  - 按题型返回 Zod 答案 schema（见 Spec §7.3）。
- Create `apps/extension/src/agent/chaoxing/llm.ts`
  - 极薄多模态 OpenAI 调用（上游 Message.content 仅 string，故自带）；吃 `LLMConfig`，forced tool-call。
- Create `apps/extension/src/agent/chaoxing/adapter.content.ts`
  - 内容脚本侧：`extractQuestions` / `fillAnswers` / `gotoNextPage` / `probeInterrupts`；调用 extract/fill/images。
- Create `apps/extension/src/agent/chaoxing/solve.ts` (+ `.test.ts`)
  - 流水线编排（Spec §11）：extract → 并发 LLM → fill → 翻页 → 汇总。
- Create `apps/extension/src/agent/chaoxing/tools.ts`
  - `createChaoxingTools(deps)` → `chaoxing_solve`，形状兼容 `customTools`（仿 `tabTools.ts`）。
- Modify `apps/extension/src/agent/RemotePageController.content.ts` / `RemotePageController.background.ts`
  - 增设 chaoxing RPC 通道（或并置 `ChaoxingBridge`），同传输。
- Modify `apps/extension/src/agent/MultiPageAgent.ts`
  - 在组装 `customTools` 处注入 `createChaoxingTools(...)`。
- Modify `apps/extension/src/agent/system_prompt.md`（或检测注入处）
  - 学习通页命中时引导调用 `chaoxing_solve`。
- Modify `apps/extension/src/lib/modelConfig.ts`
  - 新增 `chaoxingTextModelId` / `chaoxingVisionModelId` 与 `resolveChaoxingModelConfigs`。
- Modify `apps/extension/src/lib/settingsConfig.ts` / `configStorage.ts` (+ 各 `.test.ts`)
  - 持久化两个角色模型指针，默认指向当前 `selectedModelId`。
- Modify `apps/extension/src/components/SettingsForm.tsx` / `apps/extension/src/lib/i18n.tsx`
  - 两个模型角色下拉 + 文案。
- Create `.project.agents/log/2026-06-17-chaoxing-exam-solver.md`
  - 执行日志（Task 11）。

---

## Task 1: Sync Source-of-Truth Docs

**Files:**

- Modify: `.project.agents/docs/context/PRD.md`
- Modify: `.project.agents/docs/context/ARCHITECTURE.md`

- [ ] **Step 1: PRD 新增特性条目**

  在 PRD 功能区新增（措辞贴合现有条目风格）：

  ```markdown
  - 学习通求解：进入超星学习通作业/考试页时，问学可读取全部题目、用 LLM 生成结构化答案并自动回填；
    全程不自动提交（最终交卷由用户完成），不绕过登录/验证码/人脸识别/字体反爬等任何防护。
  ```

- [ ] **Step 2: ARCHITECTURE 新增模块卡片与依赖**

  在插件域模块描述中加入 `chaoxing/*`：

  ```markdown
  - chaoxing/*（apps/extension）：学习通作业/考试求解器。solve.ts 智能域编排；adapter.content.ts
    内容脚本持有学习通 DOM 读取/回填；经 RemotePageController 同传输 RPC 通信；工具经 customTools 注入。
    依赖边：→ @page-agent/llms（仅 zodToOpenAITool）、→ RemotePageController。零改 vendor packages/*（I5）。
  ```

- [ ] **Step 3: 校验文档格式**

  ```sh
  pnpm format:check .project.agents/docs/context/PRD.md .project.agents/docs/context/ARCHITECTURE.md
  ```

  Expected: PASS。

## Task 2: Types and Page Detection

**Files:**

- Create: `apps/extension/src/agent/chaoxing/types.ts`
- Create: `apps/extension/src/agent/chaoxing/detect.ts`
- Create: `apps/extension/src/agent/chaoxing/detect.test.ts`

- [ ] **Step 1: 写失败的检测测试**

  `detect.test.ts`：用 jsdom 构造含/不含 `.questionLi` 的 DOM 与不同 host，断言 `detectChaoxing()`
  返回 `{ isChaoxing, mode: 'work'|'exam'|null }`。先红。

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/detect.test.ts
  ```

  Expected: FAIL（模块不存在）。

- [ ] **Step 2: 落 `types.ts`**

  按 Spec §7 写入 `QType` / `ContentPart` / `ChaoxingOption` / `ChaoxingQuestion` / `ChaoxingAnswer`。

- [ ] **Step 3: 落 `detect.ts`**

  ```ts
  export interface ChaoxingDetection { isChaoxing: boolean; mode: 'work' | 'exam' | null }
  export function detectChaoxing(doc: Document = document, url = location.href): ChaoxingDetection {
    const host = new URL(url).hostname
    const hostOk = /(^|\.)chaoxing\.com$/.test(host) || /(^|\.)edu\.cn$/.test(host)
    const hasQuestions = !!doc.querySelector('.questionLi')
    if (!hostOk || !hasQuestions) return { isChaoxing: hostOk && hasQuestions, mode: null }
    const mode = doc.querySelector('input[name^="type"]') ? 'exam'
      : doc.querySelector('input[id^="answertype"]') ? 'work' : null
    return { isChaoxing: true, mode }
  }
  ```

- [ ] **Step 4: 绿**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/detect.test.ts
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: PASS。

## Task 3: Extract (Read) — Text Question Types

**Files:**

- Create: `apps/extension/src/agent/chaoxing/extract.ts`
- Create: `apps/extension/src/agent/chaoxing/extract.test.ts`

- [ ] **Step 1: 写失败的解析测试（fixtures 仿学习通 DOM）**

  在 `extract.test.ts` 内置 `.questionLi` fixture（单选/多选/判断/填空各一），断言 `extractQuestion(li,
  mode)` 产出正确的 `type`、`stem`（text parts）、`options[].key`（A/B/C…）、`blanksCount`。先红。

- [ ] **Step 2: 落 `extract.ts`（选择器移植自 ocsjs `cx.ts:801-815` + 题型码 `cx.ts:2160-2178`）**

  关键点：
  - 题型码：`getQuestionType(parseInt(typeInput.value))`，typeInput 选择器按 `mode`
    （exam `input[name^="type"]` / work `input[id^="answertype"]`）。
  - 题干：`:scope > h3, :scope > div:not(.stem_answer), :scope > p`（取非空）。
  - 选项：`.answerBg .answer_p, .textDIV, .eidtDiv`；`key` 按序号映射 `String.fromCharCode(65+i)`。
  - completion `blanksCount` = 选项容器内 `textarea`/UEditor `iframe` 数。
  - `id` 编码页内序（如 `q{pageIndex}`）。
  - 本任务**仅文本**：图片暂以占位符文本 `[图]` 记，`hasImages` 先恒 false（Task 9 接管）。

- [ ] **Step 3: 绿**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/extract.test.ts
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: PASS。

## Task 4: Fill — Text Question Types (with re-location)

**Files:**

- Create: `apps/extension/src/agent/chaoxing/fill.ts`
- Create: `apps/extension/src/agent/chaoxing/fill.test.ts`

- [ ] **Step 1: 写失败的回填测试**

  fixture + `fillQuestion(li, answer, mode)`，断言：单选点中对应 `.answer_p`；多选点中多个；判断点中；
  填空写入 `textarea.value` 且（若有）`iframe.contentDocument.body.innerHTML`，并触发 saveQuestion。先红。

  > 说明：jsdom 不支持真实 UEditor iframe/contentDocument 完整行为；测试用可控的 mock iframe 节点验证
  > 写入路径选择逻辑，真实 UEditor 行为在 Task 11 真机走查。

- [ ] **Step 2: 落 `fill.ts`（操作移植自 ocsjs `cx.ts:857-894`、`cx.ts:2194`）**

  - **重定位**（Spec §10.2）：`fillAnswers` 时由 `adapter` 重新 `querySelectorAll('.questionLi')` 按序定位；
    `fill.ts` 接收 live `li` + answer，按 key 序号/`data` 值在 `li` 内重新查元素，不依赖 extract 期引用。
  - single/multiple/judgement：`options[keyIndex].click()`，跳过已选 `[class*=check_answer]`。
  - completion：`textarea.value = blank` 且 `iframe.contentDocument.body.innerHTML = blank`，
    再 `$el('[onclick*=saveQuestion]', …)?.click()`。
  - line：每 box `li[data=rightKey] a`.click()；fill/reader：`span.saveSingleSelect[data=optionKey]`.click()。
  - 本任务实现 single/multiple/judgement/completion；line/fill/reader 留 Task 10。
  - 返回每题 `{ questionId, filled: boolean, reason? }`。

- [ ] **Step 3: 绿**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/fill.test.ts
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: PASS。

## Task 5: Content-Script RPC Bridge

**Files:**

- Create: `apps/extension/src/agent/chaoxing/adapter.content.ts`
- Modify: `apps/extension/src/agent/RemotePageController.content.ts`
- Modify: `apps/extension/src/agent/RemotePageController.background.ts`

- [ ] **Step 1: 落 `adapter.content.ts`**

  顶层 frame 运行；提供：
  - `extractQuestions(): ChaoxingQuestion[]` —— 遍历 `.questionLi`（含同源 iframe：先 `document` 再
    `iframe.contentDocument` 同源可达者），逐个 `extractQuestion`。
  - `fillAnswers(answers): FillResult[]` —— 重定位后逐个 `fillQuestion`。
  - `gotoNextPage(): boolean` —— `document.querySelector('[onclick="getTheNextQuestion(1)"]')` 存在则点击并返回 true。
  - `probeInterrupts(): { faceRecognition: boolean; suspiciousFont: boolean }` —— 移植 `hasFaceRecognition`
    /`hasNewFaceRecognition`（`cx.ts:2206-2230`）；字体反爬先做轻量乱码探测。

- [ ] **Step 2: 接 RPC 通道**

  在 `RemotePageController.content.ts` 注册 chaoxing 方法分发；`RemotePageController.background.ts`
  暴露对应代理供智能域调用（沿用既有 message 协议/通道）。保持与现有 DOM RPC 同一传输。

- [ ] **Step 3: 验证编译**

  ```sh
  pnpm -F extension build
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: PASS。（端到端连通在 Task 7 真机/集成验证。）

## Task 6: Answer Schema, Serialize (text), Thin LLM Client

**Files:**

- Create: `apps/extension/src/agent/chaoxing/schema.ts` (+ `.test.ts`)
- Create: `apps/extension/src/agent/chaoxing/serialize.ts` (+ `.test.ts`)
- Create: `apps/extension/src/agent/chaoxing/llm.ts`

- [ ] **Step 1: 写失败的 schema / serialize 测试**

  - `schema.test.ts`：`schemaForQuestion(q)` 对每题型返回正确 Zod 形状；`enum` 用该题 option keys；
    completion `blanks` 长度 = `blanksCount`。
  - `serialize.test.ts`：纯文本题 → `messages[0].content` 为字符串、含题干与带 key 选项、`hasImages=false`。
    先红。

- [ ] **Step 2: 落 `schema.ts` / `serialize.ts`（见 Spec §7.3 / §8.2，本任务仅文本分支）**

- [ ] **Step 3: 落 `llm.ts`（多模态 forced tool-call，自带 fetch）**

  ```ts
  import { zodToOpenAITool } from '@page-agent/llms' // 仅 import，不改上游
  // askStructured(cfg: LLMConfig, messages, schema, signal): Promise<unknown>
  //  - body: { model, messages, tools:[zodToOpenAITool('submit_answer', { inputSchema: schema })],
  //            tool_choice:{type:'function',function:{name:'submit_answer'}}, temperature:0 }
  //  - fetch(`${cfg.baseURL}/chat/completions`, { headers: Authorization Bearer cfg.apiKey, signal })
  //  - 解析 choices[0].message.tool_calls[0].function.arguments → JSON → schema.parse
  ```

- [ ] **Step 4: 绿**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/schema.test.ts apps/extension/src/agent/chaoxing/serialize.test.ts
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: PASS。

## Task 7: Pipeline + Tool + Injection → End-to-End (Text)

**Files:**

- Create: `apps/extension/src/agent/chaoxing/solve.ts` (+ `.test.ts`)
- Create: `apps/extension/src/agent/chaoxing/tools.ts`
- Modify: `apps/extension/src/agent/MultiPageAgent.ts`
- Modify: `apps/extension/src/agent/system_prompt.md`

- [ ] **Step 1: 写失败的 solve 测试（mock rpc + mock llm）**

  注入假 `rpc`（extract 返回若干题、fill 记录入参、gotoNextPage 返回 false）与假 `askStructured`
  （返回结构化答案），断言：并发不超 4、每题路由到正确模型、`needsReview` 题不调用模型、汇总字符串正确。先红。

- [ ] **Step 2: 落 `solve.ts`（Spec §11）**

  含并发池（常量 4）、模型路由（`q.hasImages` → vision else text）、`needsReview`/异常兜底（宁缺勿猜）、
  考试翻页循环、汇总。受 `AbortSignal` 取消。

- [ ] **Step 3: 落 `tools.ts` 并注入**

  ```ts
  export function createChaoxingTools(deps) {
    return { chaoxing_solve: {
      description: '在超星学习通作业/考试页：读取全部题目→用 LLM 生成答案→回填（不自动提交）。',
      inputSchema: z.object({ scope: z.enum(['current_page','all_pages']).default('all_pages') }),
      execute: async (input) => solveChaoxing(deps, input),
    } }
  }
  ```

  在 `MultiPageAgent.ts` 组装 `customTools` 处合并 `createChaoxingTools({ rpc, resolveModels, signal })`。

- [ ] **Step 4: 系统提示引导**

  学习通页命中（`detectChaoxing`）时，向系统提示注入：本页应调用 `chaoxing_solve` 完成作业/考试，
  不要逐题手动点击；遇登录/验证码/人脸识别调用既有人工接管。

- [ ] **Step 5: 绿 + 真机走查（纯文本作业）**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/solve.test.ts
  pnpm -F extension build
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: 单测 PASS；构建 PASS。真机：纯文本作业可端到端读题→答案→回填，不自动提交。

## Task 8: Dual-Model Settings + UI

**Files:**

- Modify: `apps/extension/src/lib/modelConfig.ts`
- Modify: `apps/extension/src/lib/settingsConfig.ts` (+ `.test.ts`)
- Modify: `apps/extension/src/lib/configStorage.ts` (+ `.test.ts`)
- Modify: `apps/extension/src/components/SettingsForm.tsx`
- Modify: `apps/extension/src/lib/i18n.tsx`

- [ ] **Step 1: 写失败的配置测试**

  断言 `settingsConfig`/`configStorage` 读写 `chaoxingTextModelId`/`chaoxingVisionModelId`，缺省回退到
  `selectedModelId`；`resolveChaoxingModelConfigs` 返回 `{ text: LLMConfig; vision?: LLMConfig }`。先红。

- [ ] **Step 2: 落 `modelConfig.ts` 解析 + 持久化**

  新增两字段与 `resolveChaoxingModelConfigs(settings, customModels)`（复用 `resolveSelectedLLMConfig`）。

- [ ] **Step 3: 设置 UI + 文案**

  `SettingsForm.tsx` 加「学习通·文本模型」「学习通·图片模型」两个下拉，引用同一模型列表；`i18n.tsx` 加文案。
  `solve.ts` 的 `resolveModels` 接此。

- [ ] **Step 4: 绿**

  ```sh
  pnpm -F extension test apps/extension/src/lib/settingsConfig.test.ts apps/extension/src/lib/configStorage.test.ts
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: PASS。

## Task 9: Images — Fetch / Downscale / Multimodal Serialize / Routing

**Files:**

- Create: `apps/extension/src/agent/chaoxing/images.ts` (+ `.test.ts`)
- Modify: `apps/extension/src/agent/chaoxing/extract.ts`
- Modify: `apps/extension/src/agent/chaoxing/serialize.ts`

- [ ] **Step 1: 写失败的 images / serialize(多模态) 测试**

  - `images.test.ts`：装饰图过滤（<24px / 图标类）；`alt`/`data-latex` 文本源优先时跳过图片；占位符标注。
  - `serialize.test.ts`：含图题 → `content` 为交错数组，占位符与 `image_url` 标签顺序一致，`hasImages=true`。
    先红。
  > 真实 `fetch(credentials)` 与 canvas 降采样在 jsdom 不可测，单测注入可 mock 的 `fetchImage`/`downscale`；
  > 真机抓取在 Task 11 走查。

- [ ] **Step 2: 落 `images.ts`**

  `collectImages(node)`：过滤装饰图；对每图，优先取 `alt`/`title`/`data-latex` 文本源（→ LaTeX 文本，跳图）；
  否则 `fetch(src,{credentials:'include'})→blob→canvas 降采样(最长边~1280, jpeg .85)→dataUrl`；按 src 去重；
  失败则 `fallbackUrl=src` 并对图片选项题标 `needsReview`。产出 `ContentPart[]` 占位符锚定。

- [ ] **Step 3: 接入 extract / serialize**

  `extract.ts` 用 `images.ts` 产出 `stem`/`options[].content` 的图文交错与 `hasImages`；`serialize.ts`
  含图分支输出交错多模态 `content`（Spec §8.2）+ 系统提示占位符约定。

- [ ] **Step 4: 绿 + 真机走查（含图题）**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/images.test.ts apps/extension/src/agent/chaoxing/serialize.test.ts
  pnpm -F extension build
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: 单测 PASS；真机：图片选项 / 题干公式图 / 大题附图能正确作答并回填。

## Task 10: Exam Pagination + Line/Fill/Reader + Interrupt Guards

**Files:**

- Modify: `apps/extension/src/agent/chaoxing/extract.ts`
- Modify: `apps/extension/src/agent/chaoxing/fill.ts`
- Modify: `apps/extension/src/agent/chaoxing/schema.ts`
- Modify: `apps/extension/src/agent/chaoxing/solve.ts`
- Modify: `apps/extension/src/agent/chaoxing/adapter.content.ts`

- [ ] **Step 1: 写失败的 line/fill/reader 测试**

  fixtures：连线（`.line_answer_ct .selectBox` + `li[data]`）、完形（`.filling_answer`）、阅读
  （`.reading_answer` + `span.saveSingleSelect[data]`）。断言 extract 产出 options/subQuestions 的 `key`/`data`，
  schema 形状正确，fill 点中正确 `data` 元素。先红。

- [ ] **Step 2: 实现三题型 extract/schema/fill + 考试翻页 + 中断守卫**

  - extract/fill/schema 补 line/fill/reader（Spec §6 表）。
  - `solve.ts` `all_pages` 翻页循环用 `rpc.gotoNextPage()`；每页 extract 前等 `.questionLi` 就绪。
  - 每页 solve 前 `rpc.probeInterrupts()`：命中人脸识别 / 疑似字体反爬乱码 → 暂停并经既有人工接管提示用户，不绕过。

- [ ] **Step 3: 绿 + 真机走查（考试分页 + 三题型）**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/
  pnpm -F extension build
  pnpm -F extension exec tsc --noEmit
  ```

  Expected: PASS；真机考试分页逐页求解直至结束，三题型可答。

## Task 11: Full Verification and Execution Log

**Files:**

- Create: `.project.agents/log/2026-06-17-chaoxing-exam-solver.md`

- [ ] **Step 1: 全量测试 + 构建 + 类型检查**

  ```sh
  pnpm -F extension test apps/extension/src/agent/chaoxing/
  pnpm -F extension build
  pnpm -F extension exec tsc --noEmit
  pnpm -r test
  ```

  Expected: PASS（含 test 脚本的包）。

- [ ] **Step 2: 真机端到端走查（清单）**

  - 进入学习通作业页 → agent 被引导调用 `chaoxing_solve`；非学习通页不引导。
  - 单选/多选/判断/填空正确回填（点样式化容器；填空写 textarea + UEditor iframe + 保存）。
  - 含图题（图片选项 / 题干公式图 / 大题附图）经视觉模型正确作答。
  - 路由：含图走图片模型、纯文本走文本模型；缺角色模型时该题标「需人工」。
  - 全程不自动提交；汇总「完成 N/M + 需人工清单」。
  - 检测到人脸识别 / 疑似字体反爬时暂停提示，不绕过。
  - 考试分页逐页求解直至结束。

- [ ] **Step 3: 写执行日志**

  创建 `.project.agents/log/2026-06-17-chaoxing-exam-solver.md`：

  ```markdown
  # 完成 学习通作业/考试求解器

  - **日期**：2026-06-17
  - **关联**：2026-06-17-chaoxing-exam-solver-design.md / 2026-06-17-chaoxing-exam-solver.md

  ## 做了什么
  - 新增 chaoxing_solve 工具与确定性流水线（读题/回填移植 ocsjs，答案用 LLM 结构化）。
  - 图片题位置锚定交错多模态 + 双模型路由。
  - 只填不交；人脸识别/字体反爬探测提示。

  ## 提交
  - 实现完成后填写实际 commit。

  ## 状态变更
  - 架构/PRD 文档：已更新。
  - 测试：填写实际命令与结果。

  ## 下一步
  - 真机覆盖更多学习通题型变体；评估是否移植字体反爬解码。
  ```

- [ ] **Step 4: 提交（仅本特性文件）**

  暂存本特性相关文件后提交（不带入无关 quick-links/newtab 改动）：

  ```sh
  git add apps/extension/src/agent/chaoxing .project.agents/docs/context/PRD.md .project.agents/docs/context/ARCHITECTURE.md apps/extension/src/agent/RemotePageController.content.ts apps/extension/src/agent/RemotePageController.background.ts apps/extension/src/agent/MultiPageAgent.ts apps/extension/src/agent/system_prompt.md apps/extension/src/lib/modelConfig.ts apps/extension/src/lib/settingsConfig.ts apps/extension/src/lib/configStorage.ts apps/extension/src/components/SettingsForm.tsx apps/extension/src/lib/i18n.tsx .project.agents/docs/superpowers/specs/2026-06-17-chaoxing-exam-solver-design.md .project.agents/docs/superpowers/plans/2026-06-17-chaoxing-exam-solver.md .project.agents/log/2026-06-17-chaoxing-exam-solver.md
  git commit -m "feat(ext): add Chaoxing exam/work solver"
  ```

  Expected: 提交成功，不含无关改动。

## Self-Review

- Spec coverage：Task 1 文档；Task 2 类型+检测；Task 3-4 读题/回填（文本题型）；Task 5 RPC 桥；
  Task 6 schema/serialize/LLM；Task 7 流水线+工具+注入（端到端文本，对应 Spec 里程碑 M3）；
  Task 8 双模型设置；Task 9 图片多模态（M4）；Task 10 翻页+line/fill/reader+中断守卫（M5）；Task 11 验收。
- Scope：单一插件域特性，全部新增于 `apps/extension/src/agent/chaoxing/*` + 少量设置/注入点；零改 vendor
  `packages/*`（守 I5）；不引入桌面域通信（守 I3）；只经 OpenAI-compatible HTTP 调模型（守 I4）。
- 类型一致：`ChaoxingQuestion`/`ChaoxingAnswer`/`ContentPart`/`QType` 在 Task 2 定义并全程沿用同名。
- 已知测试边界：UEditor iframe 写入、`fetch(credentials)`、canvas 降采样在 jsdom 不可测，已在对应 Task
  注明真机走查；纯解析/序列化/schema/重定位逻辑均有单测覆盖。
- 安全边界：不自动提交、不绕过任何防护、needsReview 宁缺勿猜，均落到 Task 7/9/10 与验收清单。
- 构建约束：所有验证含 `tsc --noEmit`（esbuild build 跳类型检查），符合仓库已知约束。
