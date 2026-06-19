/**
 * 超星学习通「回填」步骤：把一个 {@link ChaoxingAnswer} 写回 *实时* 的 `.questionLi`。
 *
 * DOM 契约移植自 ocsjs 4.0（MIT, © 2022 enncy）
 * `packages/scripts/src/projects/cx.ts`：
 *   - 选项 / 填空容器选择器 `cx.ts:801-815`
 *   - 单选 / 多选 / 判断 的 `check_answer` 守卫 + `option.click()` `cx.ts:855-861`
 *   - 完形 / 填空的 textarea / iframe 写入与 saveQuestion 保存 `cx.ts:862-875`
 *   - 连线 `li[data=key] a`.click() `cx.ts:889-894`；完形 / 阅读 `span.saveSingleSelect[data=key]`.click() `cx.ts:2194`
 *
 * 关键约束（Spec §10.2）：读题与回填分属两次 RPC，DOM 引用不跨边界。本函数收到的是
 * 一个 *实时* 的 `.questionLi`，按字母序号 / 顺序 / `data` 值就地重新定位选项、填空容器、
 * 连线框与小题，绝不依赖读题时缓存的元素引用，也不做模糊文本匹配。
 *
 * 覆盖全部题型：单选 / 多选 / 判断 / 填空 / 连线 / 完形 / 阅读。纯 DOM 操作，无
 * `chrome.*` / `fetch` / 定时器；ocsjs 的 `await $.sleep(200/500)` 是用户脚本节流手段，
 * 此处省略——节流由上层流水线负责。
 */

import type { ChaoxingAnswer } from './types'

/** 回填结果：是否写入、以及未写入 / 部分写入时的原因。 */
export interface FillResult {
	questionId: string
	filled: boolean
	reason?: string
}

/** 选项 / 填空容器选择器（与读题 `extract.ts` 完全一致）。 */
const OPTION_SELECTOR = '.answerBg .answer_p, .textDIV, .eidtDiv'

/** 连线题：左项下拉框（ocsjs `cx.ts:810`）；与读题 `extract.ts` 完全一致。 */
const LINE_BOX_SELECTOR = '.line_answer_ct .selectBox'

/** 完形 / 阅读小题容器（ocsjs `cx.ts:812,814`）；与读题 `extract.ts` 完全一致。 */
const FILL_SUB_SELECTOR = '.filling_answer'
const READER_SUB_SELECTOR = '.reading_answer'

/** 就地重新定位选项 / 填空容器，按文档顺序。 */
function optionContainers(li: HTMLElement): HTMLElement[] {
	return Array.from(li.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
}

/** 该选项所在分组是否已显示答案（含 `check_answer` 元素），守卫范围限于其父元素。 */
function groupAlreadyAnswered(option: HTMLElement): boolean {
	const group = option.parentElement
	if (!group) return false
	return group.querySelectorAll('[class*="check_answer"]').length > 0
}

/** 单选 / 多选 / 判断：点击每个命中的选项；返回是否至少点击了一项 + 越界键。 */
function fillChoice(
	options: HTMLElement[],
	keys: string[],
): { filled: boolean; invalid: string[] } {
	let filled = false
	const invalid: string[] = []
	for (const key of keys) {
		const idx = key.charCodeAt(0) - 65
		const option = options[idx]
		if (!option) {
			invalid.push(key)
			continue
		}
		if (groupAlreadyAnswered(option)) continue
		option.click()
		filled = true
	}
	return { filled, invalid }
}

/** 完形 / 填空：按顺序把每个空写入对应容器的 textarea / iframe，并点击 saveQuestion。 */
function fillCompletion(options: HTMLElement[], blanks: string[]): boolean {
	let filled = false
	for (let i = 0; i < blanks.length; i++) {
		const text = blanks[i]
		const option = options[i]
		if (!option || text.trim() === '') continue

		const textarea = option.querySelector<HTMLTextAreaElement>('textarea')
		if (textarea) textarea.value = text

		const iframe = option.querySelector<HTMLIFrameElement>('iframe')
		if (iframe?.contentDocument) iframe.contentDocument.body.innerHTML = text

		option.parentElement?.parentElement
			?.querySelector<HTMLElement>('[onclick*=saveQuestion]')
			?.click()

		filled = true
	}
	return filled
}

/** CSS.escape 的兜底：环境无 `CSS.escape` 时退化为最小转义（连线 / 完形 key 多为字母数字）。 */
function escapeAttrValue(value: string): string {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
	return value.replace(/["\\]/g, '\\$&')
}

/**
 * 连线（type 11）：对每个 `{leftIndex, rightKey}`，就地重新定位第 leftIndex 个 `.selectBox`，
 * 点击其中 `li[data="<rightKey>"] a`（ocsjs `cx.ts:889-894`）。越界框 / 框内无此 key 记入 invalid，
 * 不依赖读题时缓存的引用（Spec §10.2）。
 */
function fillLine(
	li: HTMLElement,
	pairs: { leftIndex: number; rightKey: string }[],
): { filled: boolean; invalid: string[] } {
	const boxes = Array.from(li.querySelectorAll<HTMLElement>(LINE_BOX_SELECTOR))
	let filled = false
	const invalid: string[] = []
	for (const { leftIndex, rightKey } of pairs) {
		const box = boxes[leftIndex]
		if (!box) {
			invalid.push(`leftIndex ${leftIndex}`)
			continue
		}
		const anchor = box.querySelector<HTMLElement>(`li[data="${escapeAttrValue(rightKey)}"] a`)
		if (!anchor) {
			invalid.push(`rightKey ${rightKey}@${leftIndex}`)
			continue
		}
		anchor.click()
		filled = true
	}
	return { filled, invalid }
}

/**
 * 完形 / 阅读（type 14 / 15）：对每个 `{subIndex, optionKey}`，就地重新定位第 subIndex 个
 * `.filling_answer` / `.reading_answer`，点击其中 `span.saveSingleSelect[data="<optionKey>"]`
 * （ocsjs `cx.ts:2194`）。越界小题 / 小题内无此 key 记入 invalid，不用缓存引用。
 */
function fillSubAnswers(
	li: HTMLElement,
	containerSelector: string,
	subAnswers: { subIndex: number; optionKey: string }[],
): { filled: boolean; invalid: string[] } {
	const items = Array.from(li.querySelectorAll<HTMLElement>(containerSelector))
	let filled = false
	const invalid: string[] = []
	for (const { subIndex, optionKey } of subAnswers) {
		const item = items[subIndex]
		if (!item) {
			invalid.push(`subIndex ${subIndex}`)
			continue
		}
		const span = item.querySelector<HTMLElement>(
			`span.saveSingleSelect[data="${escapeAttrValue(optionKey)}"]`,
		)
		if (!span) {
			invalid.push(`optionKey ${optionKey}@${subIndex}`)
			continue
		}
		span.click()
		filled = true
	}
	return { filled, invalid }
}

/**
 * 把 {@link ChaoxingAnswer} 回填进实时的 `.questionLi`。
 *
 * @param li     题目根元素（实时；与读题时不是同一个节点）。
 * @param answer 该题答案。
 */
export function fillQuestion(li: HTMLElement, answer: ChaoxingAnswer): FillResult {
	if (answer.needsReview) {
		return { questionId: answer.questionId, filled: false, reason: 'needsReview' }
	}

	const options = optionContainers(li)

	if (answer.type === 'single' || answer.type === 'multiple' || answer.type === 'judgement') {
		const { filled, invalid } = fillChoice(options, answer.selectedOptions ?? [])
		const result: FillResult = { questionId: answer.questionId, filled }
		if (invalid.length > 0) result.reason = `out-of-range option keys: ${invalid.join(', ')}`
		return result
	}

	if (answer.type === 'completion') {
		const filled = fillCompletion(options, answer.blanks ?? [])
		return { questionId: answer.questionId, filled }
	}

	if (answer.type === 'line') {
		const { filled, invalid } = fillLine(li, answer.linePairs ?? [])
		const result: FillResult = { questionId: answer.questionId, filled }
		if (invalid.length > 0) result.reason = `invalid line pairs: ${invalid.join(', ')}`
		return result
	}

	if (answer.type === 'fill' || answer.type === 'reader') {
		const selector = answer.type === 'fill' ? FILL_SUB_SELECTOR : READER_SUB_SELECTOR
		const { filled, invalid } = fillSubAnswers(li, selector, answer.subAnswers ?? [])
		const result: FillResult = { questionId: answer.questionId, filled }
		if (invalid.length > 0) result.reason = `invalid sub answers: ${invalid.join(', ')}`
		return result
	}

	return {
		questionId: answer.questionId,
		filled: false,
		reason: `unsupported type: ${answer.type}`,
	}
}
