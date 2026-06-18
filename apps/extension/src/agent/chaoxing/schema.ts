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

		case 'line':
			return z.object({
				linePairs: z.array(z.object({ leftIndex: z.number().int(), rightKey: z.string() })),
			})

		case 'fill':
		case 'reader':
			return z.object({
				subAnswers: z.array(z.object({ subIndex: z.number().int(), optionKey: z.string() })),
			})

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
