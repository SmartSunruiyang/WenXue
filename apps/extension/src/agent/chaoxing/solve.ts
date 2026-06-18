/**
 * 超星学习通「解题流水线」(Spec §7) —— 取代 ocsjs 的 OCSWorker。
 *
 * 一个确定性的 read → LLM → fill 编排器：从 bridge 读题，按题型路由到
 * 文本 / 视觉模型，用 `askStructured` 拿到「结构化答案 payload」(forced tool-call，
 * 无模糊匹配)，组装成 {@link ChaoxingAnswer} 交给 bridge 回填。
 *
 * 设计取向：**遇到任何不确定就偏向 needsReview，绝不瞎猜答案**。
 *   - needsReview / unknown 题型 → 直接标记人工，不调 LLM。
 *   - 缺对应模型 (text / vision) → 标记人工。
 *   - LLM 抛错 → 标记人工，原因带上错误信息。
 * 全程**不自动提交**：本文件里没有、也永远不会有任何 submit 调用，最终提交由用户完成。
 *
 * 纯编排，无 `chrome.*` / DOM。LLM 客户端通过 `deps.ask` 注入(默认 askStructured)，
 * 故可在 node 环境单测，无需真实网络。中断探测(人脸 / 字体反爬)属 Task 10，不在此处。
 */

import type { LLMConfig } from '@page-agent/llms'

import type { FillResult } from './fill'
import { askStructured } from './llm'
import { schemaForQuestion } from './schema'
import { serializeQuestion } from './serialize'
import type { ChaoxingAnswer, ChaoxingQuestion } from './types'

/** bridge 子集：流水线只需读题 / 回填 / 翻页三件事(中断探测属 Task 10)。 */
export interface SolveBridge {
	extractQuestions(): Promise<ChaoxingQuestion[]>
	fillAnswers(answers: ChaoxingAnswer[]): Promise<FillResult[]>
	gotoNextPage(): Promise<boolean>
}

export interface SolveDeps {
	bridge: SolveBridge
	/** 取当前可用模型；text 用于文本题，vision 用于含图题(Task 8 接线)。 */
	getModels: () => { text?: LLMConfig; vision?: LLMConfig }
	/** 注入点：默认 askStructured，测试时替换为 fake。 */
	ask?: typeof askStructured
	signal?: AbortSignal
	/** LLM 并发上限，默认 4。 */
	concurrency?: number
}

export interface SolveInput {
	scope: 'current_page' | 'all_pages'
}

/** all_pages 翻页硬上限，防止异常站点造成死循环。 */
const MAX_PAGES = 100

/** 单题在流水线内的结果：要么填(answer)、要么人工(needsReview + reason)。 */
interface QuestionOutcome {
	answer: ChaoxingAnswer
	/** 仅当该题需人工时给出的简短原因，用于汇总。 */
	reviewReason?: string
}

/**
 * 把一道题变成 {@link ChaoxingAnswer}。
 *
 * 任何「不能可靠作答」的情形都返回 needsReview 答案而非抛出 —— 调用方不必 try。
 */
async function answerQuestion(q: ChaoxingQuestion, deps: SolveDeps): Promise<QuestionOutcome> {
	// 1) 上游已判定需人工 / 未知题型 → 不调 LLM。
	if (q.needsReview) return review(q, 'needsReview')
	if (q.type === 'unknown') return review(q, 'unknown type')

	// 2) 选模型：含图走 vision，否则 text。缺模型 → 人工。
	const models = deps.getModels()
	const model = q.hasImages ? models.vision : models.text
	if (!model) {
		const which = q.hasImages ? 'vision' : 'text'
		return review(q, `no ${which} model configured`)
	}

	// 3) 调 LLM 拿结构化 payload；抛错 → 人工(原因带错误信息)，绝不猜答案。
	try {
		const ask = deps.ask ?? askStructured
		const { messages } = serializeQuestion(q)
		const payload = (await ask(model, messages, schemaForQuestion(q), {
			signal: deps.signal,
		})) as object
		const answer: ChaoxingAnswer = {
			questionId: q.id,
			type: q.type,
			...payload,
			needsReview: false,
		}
		return { answer }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return review(q, `llm_error: ${message}`)
	}
}

/** 组装一道「需人工」答案(needsReview:true)，附带原因供汇总。 */
function review(q: ChaoxingQuestion, reason: string): QuestionOutcome {
	return {
		answer: { questionId: q.id, type: q.type, needsReview: true },
		reviewReason: reason,
	}
}

/**
 * 极简并发池：以 `limit` 路并发对 `items` 跑 `worker`，保持输入顺序的结果数组。
 * 无外部依赖；in-flight 数严格不超过 `limit`。
 */
async function mapPool<T, R>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length)
	let next = 0
	const size = Math.max(1, Math.min(limit, items.length || 1))

	async function runner(): Promise<void> {
		while (next < items.length) {
			const index = next++
			results[index] = await worker(items[index], index)
		}
	}

	await Promise.all(Array.from({ length: size }, () => runner()))
	return results
}

/** 单页结果累加器。 */
interface PageStats {
	total: number
	filled: number
	needsHuman: { id: string; reason: string }[]
}

/** 处理一页：读题 → 并发作答 → 回填 → 统计。 */
async function solvePage(deps: SolveDeps, concurrency: number): Promise<PageStats> {
	const questions = await deps.bridge.extractQuestions()

	const outcomes = await mapPool(questions, concurrency, (q) => answerQuestion(q, deps))

	const answers = outcomes.map((o) => o.answer)
	const fillResults = await deps.bridge.fillAnswers(answers)

	// 以 questionId 对齐回填结果，统计真正写入的题数。
	const filledById = new Map(fillResults.map((r) => [r.questionId, r.filled]))

	const needsHuman: { id: string; reason: string }[] = []
	let filled = 0
	for (const o of outcomes) {
		const wasFilled = filledById.get(o.answer.questionId) === true
		if (wasFilled) {
			filled++
		} else {
			// 优先用流水线的人工原因；否则用回填器给的原因(如越界键)。
			const fillReason = fillResults.find((r) => r.questionId === o.answer.questionId)?.reason
			needsHuman.push({
				id: o.answer.questionId,
				reason: o.reviewReason ?? fillReason ?? 'not filled',
			})
		}
	}

	return { total: questions.length, filled, needsHuman }
}

/**
 * 跑完整条解题流水线，返回**给人看的中文汇总**。
 *
 * current_page 只处理当前页；all_pages 循环 `gotoNextPage()` 直到没有下一页
 * (或触达 {@link MAX_PAGES} 上限)。永远不自动提交。
 */
export async function solveChaoxing(deps: SolveDeps, input: SolveInput): Promise<string> {
	const concurrency = deps.concurrency ?? 4

	let total = 0
	let filled = 0
	const needsHuman: { id: string; reason: string }[] = []
	let pages = 0
	let hitPageCap = false

	for (;;) {
		deps.signal?.throwIfAborted()

		const stats = await solvePage(deps, concurrency)
		total += stats.total
		filled += stats.filled
		needsHuman.push(...stats.needsHuman)
		pages++

		if (input.scope !== 'all_pages') break
		if (pages >= MAX_PAGES) {
			hitPageCap = true
			break
		}

		const hasNext = await deps.bridge.gotoNextPage()
		if (!hasNext) break
	}

	return buildSummary({ total, filled, needsHuman, pages, hitPageCap })
}

/** 渲染汇总串：完成 N/M、需人工 K 题(列出 id 与原因)、明确未自动提交。 */
function buildSummary(args: {
	total: number
	filled: number
	needsHuman: { id: string; reason: string }[]
	pages: number
	hitPageCap: boolean
}): string {
	const { total, filled, needsHuman, hitPageCap } = args

	let summary = `已完成 ${filled}/${total} 题`

	if (needsHuman.length > 0) {
		const detail = needsHuman.map((h) => `${h.id}（${h.reason}）`).join('、')
		summary += `；需人工 ${needsHuman.length} 题：${detail}`
	}

	summary += '。请检查后自行提交（未自动提交）。'

	if (hitPageCap) {
		summary += `（已达 ${MAX_PAGES} 页上限，停止翻页。）`
	}

	return summary
}
