import type { ChaoxingQuestion, ContentPart, QType } from './types'

/** OpenAI 兼容的多模态内容块（仅文本块与图像块两种，§8.2）。 */
export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } }

/** 一条聊天消息：纯文本题 content 为 string，含图题 user 消息 content 为 {@link ContentBlock}[]。 */
type SerializedMessage = { role: 'system' | 'user'; content: string | ContentBlock[] }

export interface SerializedQuestion {
	messages: SerializedMessage[]
	hasImages: boolean
}

const SYSTEM_PROMPT =
	'你是学习通答题助手。请依据题目作答，只输出结构化答案：' +
	'选择题给选项字母 key；判断题给对应选项 key；填空题按空序给文本；' +
	'连线题为每个左项给 {leftIndex, rightKey}；完形/阅读为每个小题给 {subIndex, optionKey}。不要解释。'

/** 含图题追加的占位符约定说明（§8.2）。 */
const IMAGE_CONVENTION =
	'图片以 [xxx] 占位符在文本中标注，对应图像随后按相同标签顺序给出；作答只返回选项 key 或按空文本。'

/** 引出后续图片的固定句（紧跟在题面文本之后）。 */
const IMAGE_LEAD_IN = '下面按相同标签顺序给出图片：'

const TYPE_LABELS: Record<QType, string> = {
	single: '单选',
	multiple: '多选',
	judgement: '判断',
	completion: '填空',
	line: '连线',
	fill: '完形填空',
	reader: '阅读理解',
	unknown: '未知题型',
}

/**
 * 把一道题序列化成聊天消息。
 *
 * - **纯文本题**（无图）：user 消息 content 为单个 string（沿用旧行为，未变）。
 * - **含图题**（§8.2）：user 消息 content 为**有序交错数组**——先一个文本块（带 `[label]` 占位符的
 *   完整题面 + 引出句），随后按「题干图 → 选项图」的标签序，每图给一个 `[label]:` 文本块 + 一个
 *   `image_url` 块；只剩 `fallbackUrl`（抓图失败但题未判 needsReview）的图退化为文本
 *   `[label]:<url>（无法内联）`。系统消息追加占位符约定说明。
 *
 * `hasImages` 反映题干 / 选项是否含 `{type:'image'}` 部件，供流水线路由到视觉 / 文本模型。
 */
export function serializeQuestion(q: ChaoxingQuestion): SerializedQuestion {
	const hasImages = questionHasImages(q)
	if (!hasImages) return serializeTextOnly(q)
	return serializeMultimodal(q)
}

/** 纯文本分支：content 全为 string（与历史行为一致）。 */
function serializeTextOnly(q: ChaoxingQuestion): SerializedQuestion {
	return {
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: buildQuestionText(q) },
		],
		hasImages: false,
	}
}

/** 含图分支：user content 为交错数组（§8.2）。 */
function serializeMultimodal(q: ChaoxingQuestion): SerializedQuestion {
	const blocks: ContentBlock[] = []
	blocks.push({ type: 'text', text: `${buildQuestionText(q)}\n${IMAGE_LEAD_IN}` })

	// 按「题干图 → 选项图」的标签序逐图给出（与文本里占位符顺序一致）。
	for (const part of orderedImageParts(q)) {
		if (part.dataUrl) {
			blocks.push({ type: 'text', text: `[${part.label}]:` })
			blocks.push({ type: 'image_url', image_url: { url: part.dataUrl } })
		} else {
			// 抓图失败、仅余 URL（题未判 needsReview）→ 退化为 URL 文本（§8.4）。
			const url = part.fallbackUrl ?? ''
			blocks.push({ type: 'text', text: `[${part.label}]:${url}（无法内联）` })
		}
	}

	return {
		messages: [
			{ role: 'system', content: `${SYSTEM_PROMPT}\n${IMAGE_CONVENTION}` },
			{ role: 'user', content: blocks },
		],
		hasImages: true,
	}
}

/**
 * 题面纯文本（header + 题干 + 选项列表），图片处一律保留 `[label]` 占位符。
 * 纯文本题与含图题的**前导文本块**复用此函数，保证两条路径题面措辞一致。
 */
function buildQuestionText(q: ChaoxingQuestion): string {
	const lines: string[] = []
	lines.push(headerLine(q))
	lines.push(`题干：${flattenParts(q.stem)}`)

	if (isChoiceLike(q.type) && q.options && q.options.length > 0) {
		lines.push('选项：')
		for (const option of q.options) {
			lines.push(`${option.key}. ${flattenParts(option.content)}`)
		}
	}

	if (q.type === 'line') appendLineBlock(lines, q)
	if (q.type === 'fill' || q.type === 'reader') appendSubBlock(lines, q)

	return lines.join('\n')
}

/**
 * 连线题：逐「左项」列出其框内可选右项（key 取自 `li[data]`），并交代答案形状
 * `linePairs:[{leftIndex, rightKey}]`——leftIndex 即左项序号、rightKey 取自该框某右项的 key。
 */
function appendLineBlock(lines: string[], q: ChaoxingQuestion): void {
	const subs = q.subQuestions ?? []
	lines.push('连线（为每个左项选择一个右项 key）：')
	for (let i = 0; i < subs.length; i++) {
		lines.push(`左项 ${i} 可选：`)
		for (const option of subs[i].options ?? []) {
			lines.push(`  ${option.key}. ${flattenParts(option.content)}`)
		}
	}
	lines.push(
		'作答用 linePairs:[{leftIndex, rightKey}]，leftIndex 为左项序号，rightKey 取该左项某右项的 key。',
	)
}

/**
 * 完形 / 阅读：逐小题列出其可选项（key 取自 `span.saveSingleSelect[data]`），并交代答案形状
 * `subAnswers:[{subIndex, optionKey}]`——subIndex 即小题序号、optionKey 取该小题某选项的 key。
 */
function appendSubBlock(lines: string[], q: ChaoxingQuestion): void {
	const subs = q.subQuestions ?? []
	lines.push('小题（为每个小题选择一个选项 key）：')
	for (let i = 0; i < subs.length; i++) {
		lines.push(`小题 ${i}：`)
		for (const option of subs[i].options ?? []) {
			lines.push(`  ${option.key}. ${flattenParts(option.content)}`)
		}
	}
	lines.push(
		'作答用 subAnswers:[{subIndex, optionKey}]，subIndex 为小题序号，optionKey 取该小题某选项的 key。',
	)
}

function headerLine(q: ChaoxingQuestion): string {
	const label = TYPE_LABELS[q.type] ?? TYPE_LABELS.unknown
	if (q.type === 'completion') {
		const count = q.blanksCount ?? 1
		return `【题目 ${q.id} · ${label}（共 ${count} 空）】`
	}
	return `【题目 ${q.id} · ${label}】`
}

/**
 * 把 ContentParts 拍平成单一确定字符串，只取**文本**部件。
 *
 * 关键：{@link extractQuestion} 已把每个视觉图的 `[label]` 占位符**内联进文本部件**
 * （见 `walkContent`），故此处不能再为 image 部件追加一遍 `[label]`，否则占位符会重复
 * （`… [题干图1] … [题干图1]`）。占位符随文本出，图像本身由多模态分支随后单独给出。
 */
function flattenParts(parts: ContentPart[]): string {
	return parts
		.filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
		.map((part) => part.text)
		.join(' ')
		.trim()
}

/**
 * 按序收集题面里全部图片部件：先题干图（文档序），再各选项图（按选项序），最后各小题选项图
 * （连线 / 完形 / 阅读，按小题序 → 选项序）。该序与文本里占位符的出现顺序一致，故图像块与占位符
 * 按标签一一对应。
 */
function orderedImageParts(q: ChaoxingQuestion): Extract<ContentPart, { type: 'image' }>[] {
	const parts: Extract<ContentPart, { type: 'image' }>[] = []
	for (const part of q.stem) {
		if (part.type === 'image') parts.push(part)
	}
	for (const option of q.options ?? []) {
		for (const part of option.content) {
			if (part.type === 'image') parts.push(part)
		}
	}
	for (const sub of q.subQuestions ?? []) {
		for (const option of sub.options ?? []) {
			for (const part of option.content) {
				if (part.type === 'image') parts.push(part)
			}
		}
	}
	return parts
}

function isChoiceLike(type: QType): boolean {
	return type === 'single' || type === 'multiple' || type === 'judgement'
}

function questionHasImages(q: ChaoxingQuestion): boolean {
	if (partsHaveImage(q.stem)) return true
	for (const option of q.options ?? []) {
		if (partsHaveImage(option.content)) return true
	}
	for (const sub of q.subQuestions ?? []) {
		for (const option of sub.options ?? []) {
			if (partsHaveImage(option.content)) return true
		}
	}
	return false
}

function partsHaveImage(parts: ContentPart[]): boolean {
	return parts.some((part) => part.type === 'image')
}
