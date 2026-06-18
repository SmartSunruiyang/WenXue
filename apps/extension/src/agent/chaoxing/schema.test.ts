import { describe, expect, it } from 'vitest'
import * as z from 'zod/v4'

import { schemaForQuestion } from './schema'
import type { ChaoxingOption, ChaoxingQuestion, QType } from './types'

function opt(key: string, text: string): ChaoxingOption {
	return { key, content: [{ type: 'text', text }] }
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
