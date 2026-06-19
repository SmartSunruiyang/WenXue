import { describe, expect, it } from 'vitest'
import * as z from 'zod/v4'

import { schemaForQuestion } from './schema'
import type { ChaoxingOption, ChaoxingQuestion, QType } from './types'

function opt(key: string, text: string): ChaoxingOption {
	return { key, content: [{ type: 'text', text }] }
}

/** A line/fill/reader sub-question carrying only keyed options. */
function subQ(id: string, options: ChaoxingOption[]): ChaoxingQuestion {
	return {
		id,
		typeCode: NaN,
		type: 'unknown',
		stem: [],
		options,
		hasImages: false,
		needsReview: false,
	}
}

function makeQuestion(partial: Partial<ChaoxingQuestion> & { type: QType }): ChaoxingQuestion {
	return {
		id: 'q1',
		typeCode: 0,
		stem: [{ type: 'text', text: 'stem' }],
		hasImages: false,
		needsReview: false,
		...partial,
	}
}

describe('schemaForQuestion', () => {
	describe('single', () => {
		const q = makeQuestion({ type: 'single', options: [opt('A', 'a'), opt('B', 'b')] })
		const schema = schemaForQuestion(q)

		it('accepts a single in-key selection', () => {
			expect(schema.safeParse({ selectedOptions: ['B'] }).success).toBe(true)
		})

		it('rejects an out-of-key selection', () => {
			expect(schema.safeParse({ selectedOptions: ['Z'] }).success).toBe(false)
		})

		it('rejects zero selections (length must be 1)', () => {
			expect(schema.safeParse({ selectedOptions: [] }).success).toBe(false)
		})

		it('rejects two selections (length must be 1)', () => {
			expect(schema.safeParse({ selectedOptions: ['A', 'B'] }).success).toBe(false)
		})
	})

	describe('judgement', () => {
		const q = makeQuestion({ type: 'judgement', options: [opt('true', '对'), opt('false', '错')] })
		const schema = schemaForQuestion(q)

		it('accepts a single in-key selection', () => {
			expect(schema.safeParse({ selectedOptions: ['true'] }).success).toBe(true)
		})

		it('rejects an out-of-key selection', () => {
			expect(schema.safeParse({ selectedOptions: ['maybe'] }).success).toBe(false)
		})
	})

	describe('multiple', () => {
		const q = makeQuestion({
			type: 'multiple',
			options: [opt('A', 'a'), opt('B', 'b'), opt('C', 'c')],
		})
		const schema = schemaForQuestion(q)

		it('accepts one selection', () => {
			expect(schema.safeParse({ selectedOptions: ['A'] }).success).toBe(true)
		})

		it('accepts multiple in-key selections', () => {
			expect(schema.safeParse({ selectedOptions: ['A', 'C'] }).success).toBe(true)
		})

		it('rejects zero selections (min 1)', () => {
			expect(schema.safeParse({ selectedOptions: [] }).success).toBe(false)
		})

		it('rejects out-of-key selections', () => {
			expect(schema.safeParse({ selectedOptions: ['A', 'Z'] }).success).toBe(false)
		})
	})

	describe('completion', () => {
		it('requires blanks length to equal blanksCount', () => {
			const q = makeQuestion({ type: 'completion', blanksCount: 3 })
			const schema = schemaForQuestion(q)
			expect(schema.safeParse({ blanks: ['x', 'y', 'z'] }).success).toBe(true)
			expect(schema.safeParse({ blanks: ['x', 'y'] }).success).toBe(false)
			expect(schema.safeParse({ blanks: ['x', 'y', 'z', 'w'] }).success).toBe(false)
		})

		it('defaults to a single blank when blanksCount is undefined', () => {
			const q = makeQuestion({ type: 'completion' })
			const schema = schemaForQuestion(q)
			expect(schema.safeParse({ blanks: ['only'] }).success).toBe(true)
			expect(schema.safeParse({ blanks: [] }).success).toBe(false)
			expect(schema.safeParse({ blanks: ['a', 'b'] }).success).toBe(false)
		})
	})

	describe('line', () => {
		const q = makeQuestion({ type: 'line' })
		const schema = schemaForQuestion(q)

		it('accepts an array of linePairs', () => {
			const result = schema.safeParse({
				linePairs: [
					{ leftIndex: 0, rightKey: 'A' },
					{ leftIndex: 1, rightKey: 'B' },
				],
			})
			expect(result.success).toBe(true)
		})

		it('rejects a non-integer leftIndex', () => {
			expect(schema.safeParse({ linePairs: [{ leftIndex: 1.5, rightKey: 'A' }] }).success).toBe(
				false,
			)
		})

		describe('with subQuestions present (keys derivable)', () => {
			const boxed = makeQuestion({
				type: 'line',
				subQuestions: [
					subQ('q1-box0', [opt('a', '苹果'), opt('b', '香蕉')]),
					subQ('q1-box1', [opt('a', '苹果'), opt('b', '香蕉')]),
				],
			})
			const boxedSchema = schemaForQuestion(boxed)

			it('accepts in-range leftIndex and in-key rightKey', () => {
				expect(
					boxedSchema.safeParse({
						linePairs: [
							{ leftIndex: 0, rightKey: 'a' },
							{ leftIndex: 1, rightKey: 'b' },
						],
					}).success,
				).toBe(true)
			})

			it('rejects a rightKey not among any box data key', () => {
				expect(
					boxedSchema.safeParse({ linePairs: [{ leftIndex: 0, rightKey: 'zzz' }] }).success,
				).toBe(false)
			})

			it('rejects a leftIndex outside the box range', () => {
				expect(
					boxedSchema.safeParse({ linePairs: [{ leftIndex: 2, rightKey: 'a' }] }).success,
				).toBe(false)
				expect(
					boxedSchema.safeParse({ linePairs: [{ leftIndex: -1, rightKey: 'a' }] }).success,
				).toBe(false)
			})
		})
	})

	describe('fill / reader', () => {
		it('fill accepts subAnswers', () => {
			const q = makeQuestion({ type: 'fill' })
			const schema = schemaForQuestion(q)
			const result = schema.safeParse({
				subAnswers: [
					{ subIndex: 0, optionKey: 'A' },
					{ subIndex: 1, optionKey: 'B' },
				],
			})
			expect(result.success).toBe(true)
		})

		it('reader accepts subAnswers', () => {
			const q = makeQuestion({ type: 'reader' })
			const schema = schemaForQuestion(q)
			expect(schema.safeParse({ subAnswers: [{ subIndex: 0, optionKey: 'C' }] }).success).toBe(true)
		})

		it('rejects a non-integer subIndex', () => {
			const q = makeQuestion({ type: 'fill' })
			const schema = schemaForQuestion(q)
			expect(schema.safeParse({ subAnswers: [{ subIndex: 0.5, optionKey: 'A' }] }).success).toBe(
				false,
			)
		})

		describe('with subQuestions present (keys derivable)', () => {
			const filled = makeQuestion({
				type: 'fill',
				subQuestions: [
					subQ('q1-sub0', [opt('A', 'apple'), opt('B', 'banana')]),
					subQ('q1-sub1', [opt('A', 'red'), opt('B', 'blue')]),
				],
			})
			const filledSchema = schemaForQuestion(filled)

			it('accepts in-range subIndex and in-key optionKey', () => {
				expect(
					filledSchema.safeParse({
						subAnswers: [
							{ subIndex: 0, optionKey: 'A' },
							{ subIndex: 1, optionKey: 'B' },
						],
					}).success,
				).toBe(true)
			})

			it('rejects an optionKey not among any sub-option data key', () => {
				expect(
					filledSchema.safeParse({ subAnswers: [{ subIndex: 0, optionKey: 'Z' }] }).success,
				).toBe(false)
			})

			it('rejects a subIndex outside the sub-question range', () => {
				expect(
					filledSchema.safeParse({ subAnswers: [{ subIndex: 2, optionKey: 'A' }] }).success,
				).toBe(false)
			})
		})
	})

	describe('fallback behaviour', () => {
		it('unknown type does not throw and yields a permissive object', () => {
			const q = makeQuestion({ type: 'unknown' })
			expect(() => schemaForQuestion(q)).not.toThrow()
			const schema = schemaForQuestion(q)
			expect(schema.safeParse({ anything: 'goes' }).success).toBe(true)
		})

		it('choice question with no options falls back to array of strings without throwing', () => {
			const q = makeQuestion({ type: 'single', options: undefined })
			expect(() => schemaForQuestion(q)).not.toThrow()
			const schema = schemaForQuestion(q)
			expect(schema.safeParse(['A']).success).toBe(true)
			expect(schema.safeParse([1]).success).toBe(false)
		})

		it('choice question with empty options array falls back without throwing', () => {
			const q = makeQuestion({ type: 'multiple', options: [] })
			expect(() => schemaForQuestion(q)).not.toThrow()
			const schema = schemaForQuestion(q)
			expect(schema.safeParse(['A', 'B']).success).toBe(true)
		})
	})

	it('returns a Zod schema instance', () => {
		const q = makeQuestion({ type: 'single', options: [opt('A', 'a')] })
		expect(schemaForQuestion(q)).toBeInstanceOf(z.ZodType)
	})
})
