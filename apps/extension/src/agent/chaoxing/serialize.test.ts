import { describe, expect, it } from 'vitest'

import { serializeQuestion } from './serialize'
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

describe('serializeQuestion', () => {
	describe('single choice (text)', () => {
		const q = makeQuestion({
			id: 'q3',
			type: 'single',
			stem: [{ type: 'text', text: '地球是太阳系第几颗行星？' }],
			options: [opt('A', '第二颗'), opt('B', '第三颗'), opt('C', '第四颗')],
		})
		const { messages, hasImages } = serializeQuestion(q)

		it('produces exactly one system and one user message', () => {
			expect(messages).toHaveLength(2)
			expect(messages[0].role).toBe('system')
			expect(messages[1].role).toBe('user')
		})

		it('system message frames the structured-answer task', () => {
			expect(messages[0].content).toContain('学习通')
			expect(messages[0].content).toContain('结构化')
		})

		it('user message contains a header with the question id and type label', () => {
			expect(messages[1].content).toContain('q3')
			expect(messages[1].content).toContain('单选')
		})

		it('user message contains the stem text', () => {
			expect(messages[1].content).toContain('地球是太阳系第几颗行星？')
		})

		it('user message lists options keyed by their option key', () => {
			expect(messages[1].content).toContain('A. 第二颗')
			expect(messages[1].content).toContain('B. 第三颗')
			expect(messages[1].content).toContain('C. 第四颗')
		})

		it('reports hasImages false for a pure-text question', () => {
			expect(hasImages).toBe(false)
		})
	})

	describe('multiple / judgement labels', () => {
		it('labels a multiple choice question', () => {
			const q = makeQuestion({ type: 'multiple', options: [opt('A', 'a'), opt('B', 'b')] })
			expect(serializeQuestion(q).messages[1].content).toContain('多选')
		})

		it('labels a judgement question and lists its options', () => {
			const q = makeQuestion({
				type: 'judgement',
				options: [opt('true', '正确'), opt('false', '错误')],
			})
			const content = serializeQuestion(q).messages[1].content
			expect(content).toContain('判断')
			expect(content).toContain('true. 正确')
			expect(content).toContain('false. 错误')
		})
	})

	describe('completion', () => {
		it('shows the blank count in the header and no options block', () => {
			const q = makeQuestion({
				type: 'completion',
				stem: [{ type: 'text', text: '床前明月光，疑是____。' }],
				blanksCount: 2,
			})
			const content = serializeQuestion(q).messages[1].content
			expect(content).toContain('共 2 空')
			expect(content).toContain('床前明月光，疑是____。')
		})
	})

	describe('images', () => {
		it('reports hasImages true when any stem ContentPart is an image', () => {
			const q = makeQuestion({
				type: 'single',
				stem: [
					{ type: 'text', text: '看图选择：' },
					{ type: 'image', label: '[图1]' },
				],
				options: [opt('A', 'a'), opt('B', 'b')],
				hasImages: true,
			})
			const { hasImages, messages } = serializeQuestion(q)
			expect(hasImages).toBe(true)
			// text branch: must NOT build multimodal content; content stays a string.
			expect(typeof messages[1].content).toBe('string')
		})

		it('reports hasImages true when an option ContentPart is an image', () => {
			const q = makeQuestion({
				type: 'single',
				options: [{ key: 'A', content: [{ type: 'image', label: '[选项图]' }] }, opt('B', 'b')],
			})
			expect(serializeQuestion(q).hasImages).toBe(true)
		})

		it('may still emit an image part label text in the user content', () => {
			const q = makeQuestion({
				type: 'completion',
				stem: [
					{ type: 'text', text: '题图：' },
					{ type: 'image', label: '[配图]' },
				],
				blanksCount: 1,
				hasImages: true,
			})
			expect(serializeQuestion(q).messages[1].content).toContain('[配图]')
		})
	})

	it('content is always a plain string in the text branch', () => {
		const q = makeQuestion({ type: 'single', options: [opt('A', 'a')] })
		for (const m of serializeQuestion(q).messages) {
			expect(typeof m.content).toBe('string')
		}
	})
})
