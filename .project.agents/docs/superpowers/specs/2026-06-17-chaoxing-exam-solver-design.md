# Chaoxing Exam Solver Spec

> 派生设计文档。行为依据：`PRD.md`（网页操作 / 答题能力）；架构边界依据：`ARCHITECTURE.md`
> 插件域模块边界与不变量 I3（两域零运行时通信）、I4（仅经 OpenAI-compatible HTTP 调模型）、
> I5（vendor `packages/*` 为上游快照，不在本特性内修改）；模型配置依据：
> `apps/extension/src/lib/modelConfig.ts`。
>
> 复用来源：ocsjs 4.0（MIT，Copyright © 2022 enncy）——
> `packages/scripts/src/projects/cx.ts`、`packages/scripts/src/utils/work.ts`、
> `packages/core/src/core/worker/question.resolver.ts`。本特性**移植其学习通 DOM 契约**
> （读题定位 + 回填操作），**不移植其引擎**（OCSWorker 题库搜索 + 模糊匹配 + easy-us UI）。

## 1. 目标

当「问学」进入超星学习通（chaoxing）**作业 / 考试**页面时，提供一个把「读题 → 生成答案 →
回填」三阶段封装成**单一高层 agent 工具** `chaoxing_solve` 的确定性求解器。

- LLM **只**用于「答案生成」一环；点击、输入、翻页、选元素全部由确定性代码完成。
- 「读题定位」与「回填」直接移植 ocsjs 已验证的学习通 DOM 契约。
- 答案以**结构化**形式由 LLM 返回（每题按其题型用专用 schema），不做字符串模糊匹配。
- 图片题（选项是图、题干公式是图、大题附图）经**位置锚定的交错多模态载荷**喂给视觉模型。

## 2. 非目标

- 不让 LLM 驱动点击 / 输入 / 翻页 / 选元素（这正是现有通用 agent「找不到输入框」的根因）。
- 不自动提交 / 交卷；只填，最终提交永远人工（不可逆动作不自动化）。
- 不绕过登录、验证码、人脸识别、字体反爬或任何防护机制。
- 不引入桌面域通信（I3）；只经 OpenAI-compatible HTTP 调模型（I4）；不改 vendor `packages/*`（I5）。
- 不做题库路径（题库搜索 + `question.resolver.ts` 模糊匹配）；答案来源只有 LLM。

## 3. 为什么不用现有通用 DOM 路径（背景）

现有 agent 填答案路径：`PageController.updateTree()` 用 vendored browser-use 提取器构建 DOM 树
→ 只有过「可交互候选 + `elementFromPoint` 顶层命中」的元素才得到 `highlightIndex` → LLM 按 index 调
`input_text` → `inputTextElement()`（`packages/page-controller/src/actions.ts:131`）要求元素是
`<input>/<textarea>/contenteditable`，否则抛错。

在学习通该路径先天失败，原因：

1. 选择题真 `<input>` 常被隐藏（`display:none`/`opacity:0`），可点的是样式化容器；隐藏 input 过不了
   顶层命中测试 → 拿不到 index，LLM 看不到它。
2. 填空 / 简答用 UEditor —— 一个 `<iframe>`，可编辑目标是内层 `contentDocument.body[contenteditable]`，
   常异步初始化，提取快照时尚不存在 → 不入 selectorMap。
3. 内容脚本只跑顶层 frame（`apps/extension/src/entrypoints/content.ts` `matches:['<all_urls>']`，无
   `all_frames`）；同源 iframe 经 `contentDocument` 可达，跨域 iframe 抛错被跳过 → 子树消失。
4. 翻页 / 懒加载异步渲染导致 index 快照过期。

ocsjs 不做「通用找输入框」，而是对每种题型写死 DOM 契约并直接赋值。本特性采用同样思路。

## 4. 触发与范围

### 4.1 页面检测（`detect.ts`）

判定「学习通作业 / 考试页」需同时满足：

- Host 命中 chaoxing 域（`*.chaoxing.com` 及其镜像）。
- DOM 存在题目根节点 `.questionLi`（顶层 frame 或其同源 iframe 内）。

命中后向 agent 系统提示注入一条引导：本页应调用 `chaoxing_solve` 工具，而非逐题手动操作。
检测不命中时工具不暴露 / 不被引导。

### 4.2 作业与考试差异

二者共用 `.questionLi` 结构与同一套回填逻辑，仅**题型来源输入**不同：

- 作业：`input[id^="answertype"]`
- 考试：`input[name^="type"]`

考试通常分页（逐题），作业通常单页（全部题）。考试翻页用 `getTheNextQuestion(1)`
（`cx.ts:952`）。

## 5. 三阶段架构与数据流

```
┌─ 智能域（agent 运行处：sidepanel/background）────────────────────────┐
│  agent loop → 调用工具 chaoxing_solve（solve.ts 编排，替代 OCSWorker）│
│    ① rpc.extractQuestions() ───────────────┐                         │
│    ③ 逐题并发(池=4)：serialize→选模型→llm    │ ④ 结构化 Answer[]       │
│       有图→视觉模型 / 无图→文本模型          │   (forced tool-call)   │
│    ⑤ rpc.fillAnswers(Answer[]) ────────────┤                         │
│    ⑥ 考试则 rpc.gotoNextPage() 循环          │                         │
│    ⑦ 汇总「完成 28/30，2 题需人工」回 agent                           │
└────────────────────────────────────────────│─────────────────────────┘
                                              │ 与 RemotePageController 同传输的 RPC
┌─ 内容脚本（考试标签页·顶层 frame）───────────▼─────────────────────────┐
│  ChaoxingAdapter（adapter.content.ts）                                │
│    ② extractQuestions：移植 ocsjs 选择器；同源 iframe 经 contentDocument│
│       进入；页内带 cookie 抓图 → canvas 降采样 → base64                 │
│    ⑥ fillAnswers：移植 ocsjs 按题型回填；**不提交**                     │
└───────────────────────────────────────────────────────────────────────┘
```

## 6. 题型契约（读·定位 + LLM 返回 + 填·操作，全部对到 ocsjs 源码行）

题型码映射 `getQuestionType(parseInt(typeInput.value))`（`cx.ts:2160-2178`）：

| 码               | 题型                 | 码  | 题型            |
| ---------------- | -------------------- | --- | --------------- |
| 0                | single 单选          | 11  | line 连线       |
| 1                | multiple 多选        | 14  | fill 完形填空   |
| 3                | judgement 判断       | 15  | reader 阅读理解 |
| 2,4,5,6,7,8,9,10 | completion 填空/简答 | —   | —               |

定位选择器（`cx.ts:801-815`）：根 `.questionLi`；题干 `:scope > h3, :scope > div:not(.stem_answer),
:scope > p`（取非空）；选项 `.answerBg .answer_p, .textDIV, .eidtDiv`；连线 `lineSelectBox =
.line_answer_ct .selectBox`；完形 `.filling_answer`；阅读 `.reading_answer`。

| 题型               | LLM 结构化返回                        | 回填 DOM 操作（照搬 ocsjs）                                                                                               |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| single / judgement | `selectedOptions: [key]`（长度 1）    | `option.click()`，跳过已选 `[class*=check_answer]`（`cx.ts:857-861`）                                                     |
| multiple           | `selectedOptions: [key, …]`           | 逐个 `option.click()`（`cx.ts:857-861`）                                                                                  |
| completion         | `blanks: [text, …]` 按空序            | `textarea.value=ans` **且** `iframe.contentDocument.body.innerHTML=ans` → 点 `[onclick*=saveQuestion]`（`cx.ts:862-875`） |
| line               | `linePairs: [{leftIndex, rightKey}]`  | 每 box `li[data=rightKey] a`.click()（`cx.ts:889-894`）                                                                   |
| fill / reader      | `subAnswers: [{subIndex, optionKey}]` | `span.saveSingleSelect[data=optionKey]`.click()（`cx.ts:2194`）                                                           |

`key` 为选项在 DOM 中的稳定标识（选择题用字母 A/B/C…；连线 / 完形 / 阅读用 `data` 属性值），
读题与回填共用同一 key 空间，使「LLM 返回 → DOM 动作」闭环里无任何字符串匹配。

## 7. 数据契约

### 7.1 读题输出（`types.ts`）

```ts
export type QType =
	| 'single'
	| 'multiple'
	| 'judgement'
	| 'completion'
	| 'line'
	| 'fill'
	| 'reader'
	| 'unknown'

export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image'; label: string; dataUrl?: string; fallbackUrl?: string }

export interface ChaoxingOption {
	key: string // 回填用：字母 / data 值
	content: ContentPart[]
}

export interface ChaoxingQuestion {
	id: string // 稳定题号（页内序 + DOM 派生）
	typeCode: number
	type: QType
	stem: ContentPart[] // 占位符锚定的交错内容
	options?: ChaoxingOption[] // choice / line / fill / reader
	blanksCount?: number // completion
	subQuestions?: ChaoxingQuestion[] // fill / reader 的小题
	hasImages: boolean // 路由标记
	needsReview: boolean // 读题阶段已知无法可靠作答（如图片选项抓取失败）
}
```

### 7.2 答案输出（`types.ts`）

```ts
export interface ChaoxingAnswer {
	questionId: string
	type: QType
	selectedOptions?: string[] // single/multiple/judgement
	blanks?: string[] // completion
	linePairs?: { leftIndex: number; rightKey: string }[] // line
	subAnswers?: { subIndex: number; optionKey: string }[] // fill/reader
	confidence?: number // 0..1
	needsReview: boolean // 抓图失败 / 低置信 / 无模型 / LLM 报错
}
```

### 7.3 按题型选 schema（`schema.ts`）

题型在读题时已知，故每题用**专用** Zod schema 强制结构化，模型不需判断形状、不可能返回错形状：

```ts
single / judgement → z.object({ selectedOptions: z.array(z.enum(optionKeys)).length(1) })
multiple           → z.object({ selectedOptions: z.array(z.enum(optionKeys)).min(1) })
completion         → z.object({ blanks: z.array(z.string()).length(blanksCount) })
line               → z.object({ linePairs: z.array(z.object({ leftIndex: z.number(), rightKey: z.enum(rightKeys) })) })
fill / reader      → z.object({ subAnswers: z.array(z.object({ subIndex: z.number(), optionKey: z.enum(optionKeys) })) })
```

经 `zodToOpenAITool`（从 `@page-agent/llms` import 复用，不改上游）+ `tool_choice` 强制工具调用获得
校验过的结构。

## 8. 图片处理：位置锚定的交错多模态载荷

ocsjs **不给模型发图**（全仓库无 `image_url`/vision）；其 `optimizationElementWithImage`
（`work.ts:187`）只把 `img.src` 当隐藏文本塞进题干供题库匹配。本特性的视觉方案为净新增，
但所用零件均为标准 Web/LLM 能力。

### 8.1 抽取（`adapter.content.ts`，运行于内容脚本）

按文档顺序遍历题目节点，累积文本块，遇 `<img>`：

1. **优先取文本源**：若 `alt`/`title`/`data-latex` 含可用源码（如 LaTeX），原位输出文本并**跳过图片**。
2. 否则视觉：页内带 cookie 抓取 `fetch(src, { credentials: 'include' })` → `blob()` → canvas 降采样
   （最长边约 1280px，JPEG q≈0.85）→ base64 data URL；按 `src` 去重缓存。
3. **过滤装饰图**：尺寸 <24px、已知图标类、spacer data-URI 一律忽略，避免误路由到视觉模型。

每图在文本流原位留占位符 `[…图N]`，标签绑定到第 6 节的回填 key 空间。

### 8.2 序列化（`serialize.ts`）

输出 OpenAI 兼容的有序 `content` 数组，文本块与图像块交错，顺序即语义：

```jsonc
[
	{
		"type": "text",
		"text": "【q15·单选】题干：下列函数的导数是 [题干图1] 的是？\nA = [选项A图]\nB = [选项B图]\nC = x²\nD = 2x\n下面按相同标签顺序给出图片：",
	},
	{ "type": "text", "text": "[题干图1]:" },
	{ "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } },
	{ "type": "text", "text": "[选项A图]:" },
	{ "type": "image_url", "image_url": { "url": "data:…" } },
	{ "type": "text", "text": "[选项B图]:" },
	{ "type": "image_url", "image_url": { "url": "data:…" } },
]
```

系统提示固定交代：图片以 `[…图N]` 占位符在文本中标注，对应图像随后按相同标签顺序给出；作答只返回
选项 key / 按空文本。

### 8.3 三种情况

- **选项是图片**：选项 key（A/B/…）= 回填点击的同一序号；文本写 `A = [选项A图]`，图随后给出。
  此类题字符串匹配不可行，唯结构化选 key 可行。
- **题干内公式是图片**：题干文本流原位留 `[题干图1]`，保住阅读顺序；能取 LaTeX 则连图都不发。
- **大题附图（阅读 / 完形 / 共享材料）**：共享材料 / 图标 `[材料图1]` 只发一次，其下小题共用。
  因此 **LLM 请求的最小单位 = 一个顶层题块（含其全部小题 / 空）**，共享上下文只传一遍。

### 8.4 抓图失败兜底

跨域 403 / canvas 污染导致抓图失败时：退化为把原始 URL 作为文本 `[选项A图:<url>（无法内联）]`；
若失败的是**图片选项**这类「图即答案」的关键图，则该题 `needsReview = true`，宁缺勿猜。

## 9. 双模型路由与设置

依用户决策：后台配两个模型，含图题走多模态、纯文本题走文本模型。

### 9.1 路由

题块 `content` 含 ≥1 图像块（且抓取成功）→ 视觉模型；否则（含已转 LaTeX）→ 文本模型。
所选角色模型缺失时该题 `needsReview = true`，不强行用不匹配的模型。

### 9.2 设置（`apps/extension/src/lib/*`，系统级文本 + 视觉模型）

> 现状（2026-06-20 重构）：学习通不再有专属模型选择，**跟随系统两个模型**。

系统级有两个模型设置：

- **文本模型 / 主模型** — 既有的 `selectedModelId`（`BUILT_IN_MODEL_ID` 或 `customModels[].id`），
  内置默认 `qwen3.7-max`。agent 自身与学习通纯文本题用它。
- **视觉模型（多模态）** — 新增系统级 `visionModelId?: string`，与 `selectedModelId` 平级持久化；
  未设置时解析回退到新内置视觉模型 `BUILT_IN_VISION_MODEL_ID = 'builtin:qwen3.7-plus'`（同 DashScope 端点）。
  学习通含图题用它。

`modelConfig.ts` 提供 `resolveSelectedLLMConfig`（文本，默认文本内置）与 `resolveVisionLLMConfig`（视觉，
默认视觉内置）；两者共享内部解析器，两个内置模型互相可解析。学习通路由处由 `useAgent` 把
`{ text: resolveSelectedLLMConfig(...), vision: resolveVisionLLMConfig(...) }` 传入 `MultiPageAgent`。
设置页提供两个下拉（主模型 + 视觉模型），引用**同一份**模型列表（两个内置 + 自定义）。

## 10. 工具与代码落位（全部在 `apps/extension`，零改 vendor `packages/*`）

```
apps/extension/src/agent/chaoxing/
  detect.ts            页面检测（host + .questionLi）→ 是否学习通作业/考试页
  types.ts             ChaoxingQuestion / ChaoxingAnswer / ContentPart / QType
  adapter.content.ts   【内容脚本·顶层frame】extractQuestions / fillAnswers / gotoNextPage
                       —— 移植 ocsjs 选择器与回填；同源 iframe 经 contentDocument；页内抓图降采样
  serialize.ts         ChaoxingQuestion → LLM messages（纯文本 / 多模态占位符锚定）
  schema.ts            每题型 Zod 答案 schema
  llm.ts               极薄多模态 OpenAI 调用（上游 Message.content 仅 string，故自带）；吃 LLMConfig
  solve.ts             流水线编排（替代 OCSWorker）：extract→并发LLM→fill→翻页→汇总
  tools.ts             createChaoxingTools(deps) → 暴露 chaoxing_solve，经 customTools 注入
```

### 10.1 工具形状（仿 `tabTools.ts`，经 `customTools` 注入）

```ts
// createChaoxingTools 返回 Record<string, { description; inputSchema; execute }>
chaoxing_solve: {
  description: '在超星学习通作业/考试页：读取全部题目→用 LLM 生成答案→回填（不自动提交）。',
  inputSchema: z.object({ scope: z.enum(['current_page', 'all_pages']).default('all_pages') }),
  execute: async (input) => solveChaoxing(deps, input), // 返回人类可读汇总字符串
}
```

### 10.2 RPC 接缝

`adapter.content.ts` 暴露 `extractQuestions()` / `fillAnswers(answers)` / `gotoNextPage()`，经
**与 `RemotePageController` 同传输**的 content-script RPC 被 `solve.ts`（智能域）调用。
`RemotePageController.{content,background}.ts` 在 `apps/extension`，可直接扩展或并置一个 `ChaoxingBridge`。

**关键：DOM 引用不跨 RPC**。ocsjs 在同一闭包内持有 live element 引用先搜后填；本特性 extract 与 fill 是
两次独立 RPC，元素引用无法跨边界传递。故两侧均按**稳定身份重定位**：`fillAnswers` 时重新 `querySelectorAll('.questionLi')`
按文档序定位题目（`ChaoxingQuestion.id` 编码页内序），选项按序号（选择题）或 `data` 值（连线/完形/阅读）
重定位。extract 与 fill 之间页面不得发生增删题的结构性变化（翻页是显式的 `gotoNextPage` + 重新 extract）。

## 11. 流水线编排（`solve.ts`，OCSWorker 的替代）

```
solveChaoxing(deps, { scope }):
  summaries = []
  do:
    questions = await rpc.extractQuestions()                       // 移植 ocsjs 定位
    answers = await pool(questions, CONCURRENCY=4, async q => {    // 逐题并发
      if q.needsReview: return mark(q, 'needsReview')
      const model = q.hasImages ? deps.visionCfg : deps.textCfg    // 双模型路由
      if !model: return mark(q, 'no_model')
      try: return await llmStructured(model, serialize(q), schemaFor(q))
      catch: return mark(q, 'llm_error')                          // 宁缺勿猜
    })
    fillResult = await rpc.fillAnswers(answers)                    // 移植 ocsjs 回填；不提交
    summaries.push(fillResult)
  while scope === 'all_pages' && examHasNextPage && await rpc.gotoNextPage()
  return summarize(summaries) // 「完成 28/30；q7 图片选项抓取失败、q19 低置信 → 需人工」
```

`CONCURRENCY` 为常量（4），受 `AbortSignal` 协作取消。

## 12. 安全与已知坑

- **只填不交**：填完停下等人工；最多点学习通自带「保存」（`saveQuestion`），最终提交永远人工。
- **needsReview 宁缺勿猜**：图片选项抓取失败 / 低置信 / `unknown` 题型 / 无匹配模型 / LLM 报错 →
  标记并计入汇总，绝不瞎填。
- **字体反爬**（ocsjs `mappingRecognize` `cx.ts:978`）：题干可能用混淆自定义字体渲染成乱码。本特性先
  **探测并提示**（疑似乱码即标 needsReview），是否移植解码留后续里程碑。
- **人脸识别中断**（ocsjs `hasFaceRecognition`/`hasNewFaceRecognition` `cx.ts:2206-2230`）：检测到弹脸
  则暂停并提示用户，不绕过。
- **懒加载时序**：每页 `extractQuestions` 前等 `.questionLi` 与 UEditor `iframe` 就绪。

## 13. 文档影响

实施时同步更新：

- `PRD.md`：新增「学习通作业/考试求解」特性条目（含「只填不交」「不绕过防护」边界）。
- `ARCHITECTURE.md`：在插件域模块图新增 `chaoxing/*`（`apps/extension`）与其对 `RemotePageController`
  的依赖；声明零改 vendor `packages/*`（守 I5）。
- `CONVENTIONS.md`（如涉及）：登记 ocsjs（MIT）移植代码的出处注释规范。

## 14. 验收标准

- 进入学习通作业 / 考试页时，agent 被引导调用 `chaoxing_solve`；非学习通页不暴露 / 不引导。
- 纯文本作业：单选 / 多选 / 判断 / 填空可端到端读题 → LLM 结构化答案 → 正确回填，无字符串模糊匹配。
- 选择题点中样式化选项容器（非隐藏 input）；填空写入 `textarea.value` 且 UEditor `iframe` body，并点保存。
- 含图题（图片选项 / 题干公式图 / 大题附图）经交错多模态载荷喂视觉模型，占位符与图按标签对应，
  返回的 key 能正确映射回 DOM 动作。
- 路由正确：含图题走视觉模型、纯文本题走文本模型；缺角色模型时该题标 needsReview 而非乱答。
- 全程不自动提交；填完停在等人工状态，汇总报告「完成 N/M + 需人工清单」。
- 检测到人脸识别 / 疑似字体反爬乱码时暂停提示，不绕过。
- 考试分页可逐页求解并翻页直至结束。
- 零改 vendor `packages/*`；新增代码全部在 `apps/extension`（守 I5）；不引入桌面域通信（守 I3）。
