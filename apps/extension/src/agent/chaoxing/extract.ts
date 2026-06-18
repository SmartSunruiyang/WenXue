/**
 * 超星学习通「读题」步骤：把单个 `.questionLi` 解析为结构化 {@link ChaoxingQuestion}。
 *
 * DOM 契约移植自 ocsjs 4.0（MIT, © 2022 enncy）
 * `packages/scripts/src/projects/cx.ts`：
 *   - 根 / 题干 / 选项选择器 `cx.ts:801-815`
 *   - 题型码映射 `getQuestionType` `cx.ts:2160-2178`
 *   - 完形/填空的 textarea/iframe 容器 `cx.ts:862-875`
 *
 * 图片处理（Task 9，Spec §8.1）在 DOM 阶段同步完成「分类与占位」——装饰图丢弃、
 * 有文本源（LaTeX / alt / title）的图转成文本就地内联、其余图发成 `{type:'image'}`
 * 占位部件（仅带 `fallbackUrl`，base64 抓取是异步、由 `images.ts` 之后补 `dataUrl`）。
 * 标签编码回填绑定：题干图为 `题干图N`，选项图为 `选项<key>图`。本文件保持**同步**、
 * 无 `chrome.*` / `fetch` / canvas / 副作用，故可在 jsdom 单测。
 * line / fill / reader 仅定型不展开（属 Task 10）。
 */

import type { ChaoxingOption, ChaoxingQuestion, ContentPart, QType } from './types'

/** 题干元素选择器（仅 `.questionLi` 直接子节点），取文本非空者。 */
const TITLE_SELECTOR = ':scope > h3, :scope > div:not(.stem_answer), :scope > p'

/** 选项 / 填空容器选择器。 */
const OPTION_SELECTOR = '.answerBg .answer_p, .textDIV, .eidtDiv'

/** 宽 / 高属性小于此像素值即判为装饰图（图标 / spacer），不路由到视觉模型。 */
const DECORATIVE_SIZE_PX = 24

/** 已知装饰类名（图标 / spacer）——命中即丢弃。 */
const DECORATIVE_CLASS_RE = /(^|\s)(icon|spacer|emoji|ico|decoration)(\s|$|-)/i

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
 * 把一个 `<img>` 归类为「装饰 / 文本源 / 视觉」三态之一。
 *
 * - `decorative`：丢弃（不入内容流）。判据为**测试可见**的属性：宽/高属性 <24px、
 *   已知图标 / spacer 类名、或 `data:` 内联占位 src。jsdom 无布局故 `naturalWidth` 恒 0，
 *   仅作真实浏览器下的额外佐证（属性已判装饰时不再二次确认）。
 * - `text`：有可用文本源（`data-latex` → `$…$`；否则有意义的 `alt` / `title`）。原位输出
 *   文本、丢弃图片（更省更准，无需抓取）。
 * - `visual`：以上皆否，需作为图片部件发给视觉模型。
 */
type ImageClass = { kind: 'decorative' } | { kind: 'text'; text: string } | { kind: 'visual' }

function classifyImage(img: HTMLImageElement): ImageClass {
	if (isDecorativeImage(img)) return { kind: 'decorative' }

	const latex = img.getAttribute('data-latex')?.trim()
	if (latex) return { kind: 'text', text: `$${latex}$` }

	const alt = img.getAttribute('alt')?.trim()
	if (alt) return { kind: 'text', text: alt }
	const title = img.getAttribute('title')?.trim()
	if (title) return { kind: 'text', text: title }

	return { kind: 'visual' }
}

/** 装饰图判据（仅看属性 / 类名 / src，jsdom 可测）。 */
function isDecorativeImage(img: HTMLImageElement): boolean {
	if (isTinyDimension(img.getAttribute('width'))) return true
	if (isTinyDimension(img.getAttribute('height'))) return true

	const className = img.getAttribute('class')
	if (className && DECORATIVE_CLASS_RE.test(className)) return true

	// `data:` 内联 src 常为 1x1 spacer / 占位 gif，无抓取价值。
	const src = img.getAttribute('src') ?? ''
	if (src.startsWith('data:')) return true

	return false
}

/** 把宽/高属性解析为数值，<{@link DECORATIVE_SIZE_PX} 即判小。非数值（如 `100%`）不算小。 */
function isTinyDimension(attr: string | null): boolean {
	if (attr === null) return false
	const value = parseInt(attr, 10)
	return Number.isFinite(value) && value < DECORATIVE_SIZE_PX
}

/** 给 `<img>` 分配占位标签的回调（题干 → `题干图N`；选项 → `选项<key>图`）。 */
type LabelAllocator = () => string

/**
 * 把 `el` 解析为 {@link ContentPart}[]，形如 `[文本部件?, …图片部件]`（Spec §8.2）：
 *
 * 按文档顺序遍历，所有文本片段连续累积成**一个** text 部件，视觉图在其原位嵌入 `[label]`
 * token（保住阅读顺序），同时把对应 `{type:'image'}` 部件收集起来在文本之后追加；装饰图
 * 丢弃、文本源图（LaTeX/alt/title）就地转成文本。空白规整为单空格。文本块在前、图片块在后，
 * 与序列化阶段「文本带占位符，随后按标签序给图」的载荷形状一致。
 */
function walkContent(el: Element, allocLabel: LabelAllocator): ContentPart[] {
	let buffer = ''
	const imageParts: ContentPart[] = []

	const visit = (node: Node): void => {
		if (node.nodeType === node.TEXT_NODE) {
			buffer += node.textContent ?? ''
			return
		}
		if (node.nodeType !== node.ELEMENT_NODE) return

		const child = node as Element
		if (child.tagName === 'IMG') {
			const cls = classifyImage(child as HTMLImageElement)
			if (cls.kind === 'decorative') return
			if (cls.kind === 'text') {
				// 不额外补空格：原 HTML 在图前后的空白经规整后即为分隔，避免 CJK 标点后凭空多空格。
				buffer += cls.text
				return
			}
			// visual：分配标签，文本流原位留 `[label]` token；image 部件收集后追加在文本之后。
			const label = allocLabel()
			buffer += ` [${label}] `
			imageParts.push({
				type: 'image',
				label,
				fallbackUrl: (child as HTMLImageElement).getAttribute('src') ?? '',
			})
			return
		}

		// 非 IMG 元素：递归其子节点，保住图片在文本流中的相对位置。
		for (const grandchild of Array.from(child.childNodes)) visit(grandchild)
	}

	for (const node of Array.from(el.childNodes)) visit(node)

	const parts: ContentPart[] = []
	const text = normalizeWhitespace(buffer)
	if (text) parts.push({ type: 'text', text })
	parts.push(...imageParts)
	return parts
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

/**
 * 收集题干内容为交错 {@link ContentPart}[]：跨**所有**题干元素共享一个图片计数器，
 * 故视觉图按文档全局序编号 `题干图1, 题干图2, …`（Spec §8.1 标签绑定）。
 */
function extractStem(li: HTMLElement): ContentPart[] {
	const titles = Array.from(li.querySelectorAll<HTMLElement>(TITLE_SELECTOR))
	const parts: ContentPart[] = []
	let imageSeq = 0
	const allocLabel: LabelAllocator = () => `题干图${++imageSeq}`
	for (const el of titles) {
		parts.push(...walkContent(el, allocLabel))
	}
	return parts
}

/** 选项容器列表（选择题用其序号成 key，填空用其 textarea/iframe 计空数）。 */
function optionContainers(li: HTMLElement): HTMLElement[] {
	return Array.from(li.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
}

/**
 * 选择题选项：序号 → 字母 key（A/B/C…）；内容为交错 {@link ContentPart}[]，选项内图片
 * 标签为 `选项<key>图`（一选项至多一图的常见情形；多图时同一 key 复用标签，Spec §8.1）。
 */
function extractOptions(li: HTMLElement): ChaoxingOption[] {
	return optionContainers(li).map((el, i) => {
		const key = String.fromCharCode(65 + i)
		const allocLabel: LabelAllocator = () => `选项${key}图`
		return { key, content: walkContent(el, allocLabel) }
	})
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

/** 内容里是否含至少一个 `{type:'image'}` 部件。 */
function partsHaveImage(parts: ContentPart[]): boolean {
	return parts.some((p) => p.type === 'image')
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

	let options: ChaoxingOption[] | undefined
	let blanksCount: number | undefined
	if (type === 'single' || type === 'multiple' || type === 'judgement') {
		options = extractOptions(li)
	} else if (type === 'completion') {
		blanksCount = countBlanks(li)
	}
	// line / fill / reader：仅定型，options/subQuestions 留待 Task 10。

	// 含图判定：题干或任一选项含 `{type:'image'}` 部件（装饰图已丢、LaTeX/alt 已转文本）。
	const hasImages =
		partsHaveImage(stem) || (options?.some((o) => partsHaveImage(o.content)) ?? false)

	// 空题干 → 人工，但「题干仅为图片」不算空（图即题面，交给视觉模型）。
	const emptyStem = stemTextOf(stem) === '' && !partsHaveImage(stem)

	const question: ChaoxingQuestion = {
		id: `q${index}`,
		typeCode,
		type,
		stem,
		hasImages,
		needsReview: type === 'unknown' || emptyStem,
	}

	if (options) question.options = options
	if (blanksCount !== undefined) question.blanksCount = blanksCount

	return question
}
