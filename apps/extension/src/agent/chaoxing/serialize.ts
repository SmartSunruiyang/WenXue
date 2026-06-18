import type { ChaoxingQuestion, ContentPart, QType } from './types'

type SerializedMessage = { role: 'system' | 'user'; content: string }

export interface SerializedQuestion {
	messages: SerializedMessage[]
	hasImages: boolean
}

const SYSTEM_PROMPT =
	'你是学习通答题助手。请依据题目作答，只输出结构化答案：' +
	'选择题给选项字母 key；判断题给对应选项 key；填空题按空序给文本。不要解释。'

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
 * Serialize a question into chat messages — TEXT branch only.
 *
 * Flattens every {@link ContentPart}[] down to its text. Image parts contribute
 * only their label text (e.g. `[图1]`) — their visual content is intentionally
 * NOT rendered here; building real multimodal message content is Task 9.
 *
 * `hasImages` reflects whether ANY ContentPart (stem or option) is an image, so
 * the pipeline can route image-bearing questions to the multimodal path later,
 * even though this function never emits multimodal content.
 */
export function serializeQuestion(q: ChaoxingQuestion): SerializedQuestion {
	const hasImages = questionHasImages(q)

	const lines: string[] = []
	lines.push(headerLine(q))
	lines.push(`题干：${flattenParts(q.stem)}`)

	if (isChoiceLike(q.type) && q.options && q.options.length > 0) {
		lines.push('选项：')
		for (const option of q.options) {
			lines.push(`${option.key}. ${flattenParts(option.content)}`)
		}
	}

	return {
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: lines.join('\n') },
		],
		hasImages,
	}
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
 * Flatten ContentParts to a single deterministic string.
 * Text parts contribute their text; image parts contribute their label.
 */
function flattenParts(parts: ContentPart[]): string {
	return parts
		.map((part) => (part.type === 'text' ? part.text : part.label))
		.join(' ')
		.trim()
}

function isChoiceLike(type: QType): boolean {
	return type === 'single' || type === 'multiple' || type === 'judgement'
}

function questionHasImages(q: ChaoxingQuestion): boolean {
	if (partsHaveImage(q.stem)) return true
	for (const option of q.options ?? []) {
		if (partsHaveImage(option.content)) return true
	}
	return false
}

function partsHaveImage(parts: ContentPart[]): boolean {
	return parts.some((part) => part.type === 'image')
}
