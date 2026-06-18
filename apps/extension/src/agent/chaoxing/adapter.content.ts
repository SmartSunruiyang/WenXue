/**
 * 超星学习通「内容脚本适配层」+ RPC 接收端。
 *
 * 把 Task 2–4 的纯函数（{@link extractQuestion} / {@link fillQuestion}）封装成跨
 * RPC 边界、可在 *实时* 页面上运行的四个动作，并经 `CHAOXING_CONTROL` 消息暴露给
 * agent 域（与 `RemotePageController.*` 的 `PAGE_CONTROL` 通道完全平行）。
 *
 * 设计要点（Spec §10.2）：
 *   - 读题与回填分属两次 RPC，DOM 引用不跨边界。两个动作用 *完全相同* 的枚举顺序遍历
 *     `.questionLi`（顶层文档优先，再按文档顺序逐个同源 iframe），并以运行序号 `q${i}`
 *     稳定配对——回填时按序号 / 顺序就地重新定位，绝不依赖读题时缓存的节点。
 *   - 下面四个 `extractQuestions` / `fillAnswers` / `gotoNextPage` / `probeInterrupts`
 *     都接收显式 `Document`，纯 DOM、无 `chrome.*` / `fetch` / 副作用，可在 jsdom 单测。
 *     仅 {@link initChaoxingAdapter} 在函数体内触碰 `chrome.runtime`（与
 *     `initPageController` 同样的惰性引用模式，故本模块在测试环境可安全 import）。
 *
 * 人脸识别 / 自定义字体（learn通反爬）探测移植自 ocsjs 4.0（MIT, © 2022 enncy）
 * `packages/scripts/src/projects/cx.ts`：`hasFaceRecognition` / `hasNewFaceRecognition`
 * `cx.ts:2206-2235`；下一题按钮 `cx.ts:952`。字体探测此处只做轻量启发（统计私用区码点），
 * 不解码字形——解码属后续任务。
 */

import type { ChaoxingAnswer, ChaoxingQuestion } from './types'

import { extractQuestion } from './extract'
import { fillQuestion, type FillResult } from './fill'
import { resolveQuestionImages, type ResolveImagesDeps } from './images'

/** `.questionLi` 题目根选择器（与 detect / extract / fill 完全一致）。 */
const QUESTION_SELECTOR = '.questionLi'

/** 下一题按钮选择器（ocsjs `cx.ts:952`）。 */
const NEXT_BUTTON_SELECTOR = '[onclick="getTheNextQuestion(1)"]'

/** 私用区码点范围 U+E000–U+F8FF（自定义字形反爬常用此区段渲染文本）。 */
const PUA_REGEX = /[-�]/g

/** 判定为「疑似自定义字体」所需的最少可疑码点数（轻量启发，宁缺毋滥）。 */
const SUSPICIOUS_FONT_THRESHOLD = 4

/**
 * 在单个文档内判定作业 / 考试模式：考试页有 `input[name^="type"]`，作业页有
 * `input[id^="answertype"]`（与 {@link detectChaoxing} 的判别一致，但不做 host 门禁——
 * 适配层只会在已确认的超星标签页里被调用）。两者皆无时回退 `work`（其题型 input 选择器
 * 对纯文本枚举无害）。
 */
function detectMode(doc: Document): 'work' | 'exam' {
	if (doc.querySelector('input[name^="type"]')) return 'exam'
	return 'work'
}

/**
 * 收集要遍历的根文档列表：顶层文档优先，再按文档顺序追加每个 *同源* iframe 的
 * `contentDocument`（跨域访问会抛 `SecurityError`，吞掉即跳过）。读题与回填共用此列表，
 * 保证两次 RPC 看到的 `.questionLi` 顺序完全一致。
 */
function collectRootDocuments(doc: Document): Document[] {
	const roots: Document[] = [doc]
	for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
		try {
			const idoc = (frame as HTMLIFrameElement).contentDocument
			if (idoc) roots.push(idoc)
		} catch {
			// 跨域 iframe：无法读取，跳过。
		}
	}
	return roots
}

/**
 * 按确定顺序枚举所有 `.questionLi`（顶层文档优先，再逐个同源 iframe，均按文档顺序）。
 * 返回 `(li, 其所属文档)` 列表；{@link extractQuestions} 与 {@link fillAnswers} 共用，
 * 第 i 项稳定对应 id `q${i}`。
 */
function enumerateQuestionLis(doc: Document): { li: HTMLElement; ownerDoc: Document }[] {
	const out: { li: HTMLElement; ownerDoc: Document }[] = []
	for (const root of collectRootDocuments(doc)) {
		for (const li of Array.from(root.querySelectorAll<HTMLElement>(QUESTION_SELECTOR))) {
			out.push({ li, ownerDoc: root })
		}
	}
	return out
}

/**
 * 读题：把当前页（含同源 iframe）的所有 `.questionLi` 解析为 {@link ChaoxingQuestion}[]，
 * id 依枚举序为 `q0, q1, …`。模式按每个题目所属文档单独判定（顶层与 iframe 可不同）。
 *
 * 每题先经同步 {@link extractQuestion} 解析（含装饰图过滤 / LaTeX 转文本 / 图片占位部件），
 * 再 `await` {@link resolveQuestionImages} 在内容脚本里带 cookie 抓图 + canvas 降采样，把
 * 图片占位部件补成内联 base64（失败兜底见 §8.4，可能置该题 needsReview）。故本函数为 **async**。
 * 枚举顺序保持确定（与 {@link fillAnswers} 一致），图片解析并发但不改题序。
 *
 * @param doc  目标文档，默认实时 `document`。
 * @param deps 可注入的抓图 / 降采样实现（仅测试用；内容脚本走真实 fetch + canvas 默认实现）。
 */
export async function extractQuestions(
	doc: Document = document,
	deps?: ResolveImagesDeps,
): Promise<ChaoxingQuestion[]> {
	const entries = enumerateQuestionLis(doc)
	const modeCache = new Map<Document, 'work' | 'exam'>()
	const questions = entries.map(({ li, ownerDoc }, index) => {
		let mode = modeCache.get(ownerDoc)
		if (!mode) {
			mode = detectMode(ownerDoc)
			modeCache.set(ownerDoc, mode)
		}
		return extractQuestion(li, mode, index)
	})
	// 解析图片为内联 base64（保持题序）；纯文本题为 no-op。
	return Promise.all(questions.map((q) => resolveQuestionImages(q, deps)))
}

/** 解析 `q${i}` 形式的 questionId 为序号 i；不匹配返回 null。 */
function questionIndexOf(questionId: string): number | null {
	const m = /^q(\d+)$/.exec(questionId)
	return m ? Number(m[1]) : null
}

/**
 * 回填：以与 {@link extractQuestions} *完全相同* 的顺序重新枚举 `.questionLi`，把每个答案
 * 按其 `questionId === 'q'+i` 配到第 i 个 `.questionLi`，再调 {@link fillQuestion} 就地写入。
 * 无匹配 li（或 id 无法解析）的答案返回 `filled:false` 并附 reason。
 *
 * @param answers 答案列表（与读题分属两次 RPC，故按 id / 顺序重新定位，不用缓存引用）。
 * @param doc     目标文档，默认实时 `document`。
 */
export function fillAnswers(answers: ChaoxingAnswer[], doc: Document = document): FillResult[] {
	const lis = enumerateQuestionLis(doc).map((e) => e.li)
	return answers.map((answer) => {
		const index = questionIndexOf(answer.questionId)
		if (index === null) {
			return { questionId: answer.questionId, filled: false, reason: 'unparseable questionId' }
		}
		const li = lis[index]
		if (!li) {
			return {
				questionId: answer.questionId,
				filled: false,
				reason: `no .questionLi at index ${index}`,
			}
		}
		return fillQuestion(li, answer)
	})
}

/**
 * 翻到下一题：点击「下一题」按钮（ocsjs `cx.ts:952`）。点到返回 true，无按钮返回 false。
 *
 * @param doc 目标文档，默认实时 `document`。
 */
export function gotoNextPage(doc: Document = document): boolean {
	const btn = doc.querySelector<HTMLElement>(NEXT_BUTTON_SELECTOR)
	if (btn) {
		btn.click()
		return true
	}
	return false
}

/** 当前文档是否存在「活动中」的人脸识别（ocsjs `hasFaceRecognition` + `hasNewFaceRecognition`）。 */
function hasFaceRecognition(doc: Document): boolean {
	// 旧版：#fcqrimg，src 非空才代表弹出（ocsjs cx.ts:2206-2218）。
	for (const face of Array.from(doc.querySelectorAll('#fcqrimg'))) {
		if (face.getAttribute('src')) return true
	}
	// 新版：.chapterVideoFaceMaskDiv，display !== 'none' 才代表显示（ocsjs cx.ts:2220-2230）。
	for (const mask of Array.from(doc.querySelectorAll<HTMLElement>('.chapterVideoFaceMaskDiv'))) {
		if (mask.style.display !== 'none') return true
	}
	return false
}

/**
 * 轻量字体反爬启发：统计所有 `.questionLi` 文本里的私用区 / 替换字符码点，超过阈值即疑似
 * 自定义字形渲染（learn通）。只计数、不解码字形（解码属后续任务）。
 */
function hasSuspiciousFont(doc: Document): boolean {
	let text = ''
	for (const li of Array.from(doc.querySelectorAll<HTMLElement>(QUESTION_SELECTOR))) {
		text += li.textContent ?? ''
	}
	const matches = text.match(PUA_REGEX)
	return matches !== null && matches.length >= SUSPICIOUS_FONT_THRESHOLD
}

/**
 * 探测会打断答题流水线的两类中断：人脸识别弹窗 / 疑似自定义字体反爬。
 * 仅看顶层文档（人脸 / 字体均在主文档），轻量、无副作用。
 *
 * @param doc 目标文档，默认实时 `document`。
 */
export function probeInterrupts(doc: Document = document): {
	faceRecognition: boolean
	suspiciousFont: boolean
} {
	return {
		faceRecognition: hasFaceRecognition(doc),
		suspiciousFont: hasSuspiciousFont(doc),
	}
}

/** `CHAOXING_CONTROL` 通道支持的动作名（agent 端与内容端共用）。 */
export type ChaoxingControlAction =
	| 'extract_questions'
	| 'fill_answers'
	| 'goto_next_page'
	| 'probe_interrupts'

/** `CHAOXING_CONTROL` 消息体（与 `PAGE_CONTROL` 同构，按 targetTabId 由 background 代理）。 */
export interface ChaoxingControlMessage {
	type: 'CHAOXING_CONTROL'
	action: ChaoxingControlAction
	targetTabId: number
	payload?: unknown
}

/**
 * 内容脚本接收端：注册一个 `CHAOXING_CONTROL` 监听器，按 action 分派到上面的纯函数，
 * 用实时 `document` 执行后 `sendResponse` 回结果。与 {@link initPageController} 一样，
 * 类型不匹配时提前 `return`，故可与 `PAGE_CONTROL` 等其它监听器共存。
 *
 * `chrome.*` 只在本函数体内引用（import 期不触碰），使本模块在 vitest 下可安全导入。
 */
export function initChaoxingAdapter(): void {
	chrome.runtime.onMessage.addListener(
		(message: ChaoxingControlMessage, _sender, sendResponse): true | undefined => {
			if (message.type !== 'CHAOXING_CONTROL') return

			const { action, payload } = message

			const fail = (error: unknown) =>
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})

			try {
				switch (action) {
					case 'extract_questions':
						// async（页内抓图 + 降采样）→ 在 Promise 兑现后再回包；监听器返回 true 保通道开放。
						extractQuestions().then(sendResponse, fail)
						break
					case 'fill_answers':
						sendResponse(fillAnswers((payload as ChaoxingAnswer[]) ?? []))
						break
					case 'goto_next_page':
						sendResponse(gotoNextPage())
						break
					case 'probe_interrupts':
						sendResponse(probeInterrupts())
						break
					default:
						sendResponse({
							success: false,
							error: `Unknown CHAOXING_CONTROL action: ${action satisfies never}`,
						})
				}
			} catch (error) {
				fail(error)
			}

			return true
		},
	)
}
