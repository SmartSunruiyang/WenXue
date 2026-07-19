import { describe, expect, it } from 'vitest'

import { questionSolverCapabilitySchema, safePublicText } from './schemas'

describe('question-solver schemas', () => {
	it('requires an explicit action and rejects dual delivery tokens', () => {
		expect(() =>
			questionSolverCapabilitySchema.parse({ name: 'question_solver', scope: 'current_page' }),
		).toThrow()
		expect(() =>
			questionSolverCapabilitySchema.parse({
				name: 'question_solver',
				action: 'fill',
				scope: 'all_pages',
				continuationToken: 'c'.repeat(16),
				resumeToken: 'r'.repeat(16),
			}),
		).toThrow('mutually exclusive')
	})

	it('rejects image data URLs and long base64 from public wire strings', () => {
		expect(() => safePublicText(10_000).parse('data:image/png;base64,AAAA')).toThrow()
		expect(() => safePublicText(10_000).parse('A'.repeat(1_024))).toThrow()
		expect(safePublicText(100).parse('ordinary question text')).toBe('ordinary question text')
	})
})
