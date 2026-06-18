/**
 * 超星学习通「读题」步骤：把单个 `.questionLi` 解析为结构化 {@link ChaoxingQuestion}。
 *
 * DOM 契约移植自 ocsjs 4.0（MIT, © 2022 enncy）
 * `packages/scripts/src/projects/cx.ts`：
 *   - 根 / 题干 / 选项选择器 `cx.ts:801-815`
 *   - 题型码映射 `getQuestionType` `cx.ts:2160-2178`
 *   - 完形/填空的 textarea/iframe 容器 `cx.ts:862-875`
 *
 * 本步骤只处理文本题（单选 / 多选 / 判断 / 填空）。图片只留 `[图]` 占位符、不抓取
 * （抓图属 Task 9）；line / fill / reader 仅定型不展开（属 Task 10）。
 * 纯 DOM 解析，无 `chrome.*` / `fetch` / 副作用，操作传入的元素以便单测。
 */

import type { ChaoxingOption, ChaoxingQuestion, ContentPart, QType } from './types'

/** 题干元素选择器（仅 `.questionLi` 直接子节点），取文本非空者。 */
const TITLE_SELECTOR = ':scope > h3, :scope > div:not(.stem_answer), :scope > p'

/** 选项 / 填空容器选择器。 */
const OPTION_SELECTOR = '.answerBg .answer_p, .textDIV, .eidtDiv'

/** 图片占位符——本步骤不抓图，仅在文本流原位留标记。 */
const IMAGE_PLACEHOLDER = '[图]'

/**
 * 题型码 → {@link QType}（ocsjs `getQuestionType` `cx.ts:2160-2178` 的完整移植）。
 * 0 单选 / 1 多选 / 3 判断 / 2,4,5,6,7,8,9,10 填空简答 / 11 连线 / 14 完形 / 15 阅读；
 * 其余 → 'unknown'。
 */
export function mapTypeCode(code: number): QType {
	if (code === 0) return 'single'
	if (code === 1) return 'multiple'
	if (code === 3) return 'judgement'
	if ([2, 4, 5, 6, 7, 8, 9, 10].includes(code)) return 'completion'
	if (code === 11) return 'line'
	if (code === 14) return 'fill'
	if (code === 15) return 'reader'
	return 'unknown'
}

/**
 * 把一个元素的文本读出，并在每个 `<img>` 处留下 `[图]` 占位符。
 * 用 textContent 而非 innerText：jsdom 无布局、innerText 为 undefined；自带空白规整后两者等价。
 */
function elementTextWithImagePlaceholders(el: Element): string {
	let out = ''
	for (const node of Array.from(el.childNodes)) {
		if (node.nodeType === node.TEXT_NODE) {
			out += node.textContent ?? ''
		} else if (node.nodeType === node.ELEMENT_NODE) {
			const child = node as Element
			if (child.tagName === 'IMG') {
				out += IMAGE_PLACEHOLDER
			} else if (child.querySelector('img')) {
				// 混合节点：递归以保住图片在文本流中的相对位置。
				out += elementTextWithImagePlaceholders(child)
			} else {
				out += child.textContent ?? ''
			}
		}
	}
	return normalizeWhitespace(out)
}

/** 折叠空白为单空格并去首尾。 */
function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

/** 读取本题题型码所在的隐藏 input（选择器随作业/考试模式不同）。 */
function readTypeCode(li: HTMLElement, mode: 'work' | 'exam'): number {
	const selector = mode === 'exam' ? 'input[name^="type"]' : 'input[id^="answertype"]'
	const input = li.querySelector<HTMLInputElement>(selector)
	return input ? parseInt(input.value, 10) : NaN
}

/** 收集非空题干元素的文本为 {@link ContentPart}[]（本步骤只产 text 块）。 */
function extractStem(li: HTMLElement): ContentPart[] {
	const titles = Array.from(li.querySelectorAll<HTMLElement>(TITLE_SELECTOR))
	const parts: ContentPart[] = []
	for (const el of titles) {
		const text = elementTextWithImagePlaceholders(el)
		if (text) parts.push({ type: 'text', text })
	}
	return parts
}

/** 选项容器列表（选择题用其序号成 key，填空用其 textarea/iframe 计空数）。 */
function optionContainers(li: HTMLElement): HTMLElement[] {
	return Array.from(li.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
}

/** 选择题选项：序号 → 字母 key（A/B/C…），文本含 `[图]` 占位符。 */
function extractOptions(li: HTMLElement): ChaoxingOption[] {
	return optionContainers(li).map((el, i) => ({
		key: String.fromCharCode(65 + i),
		content: [{ type: 'text', text: elementTextWithImagePlaceholders(el) }],
	}))
}

/** 填空空数 = 含 `<textarea>` 或 `<iframe>`（UEditor）的选项容器数。 */
function countBlanks(li: HTMLElement): number {
	return optionContainers(li).filter((el) => el.querySelector('textarea, iframe')).length
}

/** 拼接所有题干文本，用于「题干是否为空」判定。 */
function stemTextOf(stem: ContentPart[]): string {
	return stem
		.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
		.map((p) => p.text)
		.join('')
		.trim()
}

/**
 * 解析单个 `.questionLi` 为 {@link ChaoxingQuestion}。
 *
 * @param li    题目根元素。
 * @param mode  作业 `work` / 考试 `exam`（决定题型 input 选择器）。
 * @param index 页内序，用于稳定 id `q${index}`。
 */
export function extractQuestion(
	li: HTMLElement,
	mode: 'work' | 'exam',
	index: number,
): ChaoxingQuestion {
	const typeCode = readTypeCode(li, mode)
	const type = mapTypeCode(typeCode)
	const stem = extractStem(li)

	const question: ChaoxingQuestion = {
		id: `q${index}`,
		typeCode,
		type,
		stem,
		hasImages: false, // 由 Task 9 计算
		needsReview: type === 'unknown' || stemTextOf(stem) === '',
	}

	if (type === 'single' || type === 'multiple' || type === 'judgement') {
		question.options = extractOptions(li)
	} else if (type === 'completion') {
		question.blanksCount = countBlanks(li)
	}
	// line / fill / reader：仅定型，options/subQuestions 留待 Task 10。

	return question
}
