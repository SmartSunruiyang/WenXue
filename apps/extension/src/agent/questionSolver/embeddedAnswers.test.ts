import { describe, expect, it, vi } from 'vitest'

import type { EmbeddedAnswerCandidate, Question } from './contracts'
import { mapEmbeddedAnswerCandidates, resolveEmbeddedFirst } from './embeddedAnswers'

describe('embedded answer mapping', () => {
	it('accepts only a strictly identified platform-option mapping without model fallback', async () => {
		const fallback = vi.fn(async () => 'model-result')
		const candidate = embeddedCandidate('option-b')

		const result = await resolveEmbeddedFirst(question(), [candidate], {}, fallback)

		expect(result).toMatchObject({
			source: 'embedded',
			answer: {
				selectedOptions: ['B'],
				evidence: { source: 'embedded_answer', mappingConfidence: 0.9 },
			},
		})
		expect(fallback).not.toHaveBeenCalled()
	})

	it('rejects conflicting candidates instead of guessing by order', () => {
		const result = mapEmbeddedAnswerCandidates(question(), [
			embeddedCandidate('option-a'),
			embeddedCandidate('option-b'),
		])

		expect(result).toMatchObject({
			status: 'conflict',
			warningCodes: expect.arrayContaining(['embedded_sources_conflict']),
		})
	})

	it('falls back once when the candidate lacks exact question identity', async () => {
		const fallback = vi.fn(async () => 'model-result')
		const candidate = embeddedCandidate('option-b')
		delete candidate.platformQuestionId

		const result = await resolveEmbeddedFirst(question(), [candidate], {}, fallback)

		expect(result).toMatchObject({ source: 'fallback', result: 'model-result' })
		expect(fallback).toHaveBeenCalledOnce()
	})
})

function question(): Question {
	return {
		locator: {
			platform: 'generic',
			variant: 'generic.standard_html',
			adapterVersion: 1,
			tabId: 1,
			frameId: 0,
			platformQuestionId: 'question-1',
			fingerprint: 'a'.repeat(64),
		},
		type: 'single',
		stem: [{ type: 'text', text: 'Choose one' }],
		options: [
			{ key: 'A', platformId: 'option-a', content: [{ type: 'text', text: 'Alpha' }] },
			{ key: 'B', platformId: 'option-b', content: [{ type: 'text', text: 'Beta' }] },
		],
		hasRequiredVisuals: false,
		visibility: 'fully_visible',
		visualAnchorKeys: [],
		extractionWarnings: [],
	}
}

function embeddedCandidate(platformOptionId: string): EmbeddedAnswerCandidate {
	return {
		source: 'runtime',
		platformQuestionId: 'question-1',
		type: 'single',
		selectedPlatformOptionIds: [platformOptionId],
		sourceRefHash: 'b'.repeat(64),
	}
}
