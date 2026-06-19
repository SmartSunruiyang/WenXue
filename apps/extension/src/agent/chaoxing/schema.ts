import * as z from 'zod/v4'

import type { ChaoxingQuestion } from './types'

/**
 * Per-question answer PAYLOAD schema (spec §7.3).
 *
 * Returns a Zod schema describing ONLY the answer payload for THIS question —
 * not the full {@link ChaoxingAnswer} envelope. Choice-type payloads are keyed
 * to this question's own option keys via `z.enum`, so the LLM can only select
 * keys that actually exist on the question.
 *
 * This schema is handed to the LLM as a forced tool-call argument schema
 * (see `askStructured`), giving us structured output with no fuzzy matching.
 */
export function schemaForQuestion(q: ChaoxingQuestion): z.ZodType {
	const optionKeys = q.options?.map((o) => o.key) ?? []

	switch (q.type) {
		case 'single':
		case 'judgement': {
			const keyEnum = optionKeyEnum(optionKeys)
			if (!keyEnum) return fallbackStringArray()
			return z.object({ selectedOptions: z.array(keyEnum).length(1) })
		}

		case 'multiple': {
			const keyEnum = optionKeyEnum(optionKeys)
			if (!keyEnum) return fallbackStringArray()
			return z.object({ selectedOptions: z.array(keyEnum).min(1) })
		}

		case 'completion':
			return z.object({ blanks: z.array(z.string()).length(q.blanksCount ?? 1) })

		case 'line': {
			// 每个 subQuestion 是一个左项框；leftIndex 约束到框范围，rightKey 约束到「所有框 li[data]
			// 键的并集」(混合各框枚举不便表达，故用并集 + serialize 逐框展示其专属选项来兜底)。
			// 无 subQuestions 时（极少：读题未展开）退化为自由 string + 无界 int，保持宽松不抛错。
			const boxCount = q.subQuestions?.length ?? 0
			const rightKey = unionKeyEnum(q.subQuestions) ?? z.string()
			return z.object({
				linePairs: z.array(z.object({ leftIndex: indexField(boxCount), rightKey })),
			})
		}

		case 'fill':
		case 'reader': {
			// 每个 subQuestion 是一个小题；subIndex 约束到小题范围，optionKey 约束到「所有小题
			// span[data] 键的并集」(理由同 line)。无 subQuestions 时退化为自由 string + 无界 int。
			const subCount = q.subQuestions?.length ?? 0
			const optionKey = unionKeyEnum(q.subQuestions) ?? z.string()
			return z.object({
				subAnswers: z.array(z.object({ subIndex: indexField(subCount), optionKey })),
			})
		}

		case 'unknown':
		default:
			// Permissive: this schema is never actually sent to the LLM for unknown
			// questions (they are needsReview upstream), but we must not throw.
			return z.looseObject({})
	}
}

/**
 * Build a `z.enum` over the question's option keys.
 *
 * `z.enum` requires a non-empty tuple — returns `null` when there are no keys so
 * the caller can fall back to a plain string array (such a choice question would
 * be flagged needsReview upstream anyway).
 */
function optionKeyEnum(keys: string[]) {
	if (keys.length === 0) return null
	return z.enum(keys as [string, ...string[]])
}

function fallbackStringArray(): z.ZodType {
	return z.array(z.string())
}

/**
 * 把所有小题（连线框 / 完形·阅读小题）的选项 key 去重成并集，构造 `z.enum`。
 * 任一小题无 key（或根本无小题）时返回 `null`，调用方退化为自由 `z.string()`。
 *
 * 设计取舍：理想是每框 / 每小题各用其专属 key 枚举（精确），但那需要按下标分发的元组 schema，
 * 既难表达又难喂给 LLM。改用「全体 key 并集」单一枚举挡掉无中生有的 key，再由 serialize 给 LLM
 * 逐框 / 逐小题列出其专属可选项作为引导——回填仍按 data 精确点击，故并集不会放进错框的 key。
 */
function unionKeyEnum(subQuestions: ChaoxingQuestion[] | undefined) {
	if (!subQuestions || subQuestions.length === 0) return null
	const keys = new Set<string>()
	for (const sub of subQuestions) {
		for (const option of sub.options ?? []) keys.add(option.key)
	}
	if (keys.size === 0) return null
	return z.enum([...keys] as [string, ...string[]])
}

/**
 * leftIndex / subIndex 字段：整数。已知小题数 `count > 0` 时进一步约束到 `[0, count)`，挡掉越界
 * 下标；`count === 0`（未展开）时仅保留整数约束，保持宽松。
 */
function indexField(count: number): z.ZodType {
	const base = z.number().int()
	if (count <= 0) return base
	return base.min(0).max(count - 1)
}
