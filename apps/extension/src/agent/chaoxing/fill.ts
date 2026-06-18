/**
 * 超星学习通「回填」步骤：把一个 {@link ChaoxingAnswer} 写回 *实时* 的 `.questionLi`。
 *
 * DOM 契约移植自 ocsjs 4.0（MIT, © 2022 enncy）
 * `packages/scripts/src/projects/cx.ts`：
 *   - 选项 / 填空容器选择器 `cx.ts:801-815`
 *   - 单选 / 多选 / 判断 的 `check_answer` 守卫 + `option.click()` `cx.ts:855-861`
 *   - 完形 / 填空的 textarea / iframe 写入与 saveQuestion 保存 `cx.ts:862-875`
 *
 * 关键约束（Spec §10.2）：读题与回填分属两次 RPC，DOM 引用不跨边界。本函数收到的是
 * 一个 *实时* 的 `.questionLi`，按字母序号 / 顺序就地重新定位选项与填空容器，绝不依赖
 * 读题时缓存的元素引用，也不做模糊文本匹配。
 *
 * 本步骤只回填文本题（单选 / 多选 / 判断 / 填空）；line / fill / reader 属 Task 10。
 * 纯 DOM 操作，无 `chrome.*` / `fetch` / 定时器；ocsjs 的 `await $.sleep(500)` 是
 * 用户脚本节流手段，此处省略——节流由上层流水线负责。
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

	return {
		questionId: answer.questionId,
		filled: false,
		reason: `unsupported type: ${answer.type} (Task 10)`,
	}
}
