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

	describe('images (routing flag)', () => {
		it('reports hasImages true when any stem ContentPart is an image (→ array content)', () => {
			const q = makeQuestion({
				type: 'single',
				stem: [
					{ type: 'text', text: '看图选择： [图1]' },
					{ type: 'image', label: '图1', dataUrl: 'data:image/jpeg;base64,Z' },
				],
				options: [opt('A', 'a'), opt('B', 'b')],
				hasImages: true,
			})
			const { hasImages, messages } = serializeQuestion(q)
			expect(hasImages).toBe(true)
			// image-bearing question → user content is now the interleaved array (§8.2).
			expect(Array.isArray(messages[1].content)).toBe(true)
		})

		it('reports hasImages true when an option ContentPart is an image', () => {
			const q = makeQuestion({
				type: 'single',
				options: [{ key: 'A', content: [{ type: 'image', label: '选项A图' }] }, opt('B', 'b')],
			})
			expect(serializeQuestion(q).hasImages).toBe(true)
		})

		it('emits the image part label as a placeholder in the leading text block', () => {
			const q = makeQuestion({
				type: 'completion',
				stem: [
					{ type: 'text', text: '题图： [配图]' },
					{ type: 'image', label: '配图', dataUrl: 'data:image/jpeg;base64,Z' },
				],
				blanksCount: 1,
				hasImages: true,
			})
			const blocks = serializeQuestion(q).messages[1].content as { type: string; text?: string }[]
			const lead = blocks[0].text ?? ''
			expect(lead).toContain('[配图]')
		})
	})

	describe('line (text)', () => {
		/** A line sub-question (one left box) carrying keyed right-choices. */
		function box(id: string, options: ChaoxingOption[]): ChaoxingQuestion {
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

		const q = makeQuestion({
			id: 'q10',
			type: 'line',
			stem: [{ type: 'text', text: '把左侧与右侧连线。' }],
			subQuestions: [
				box('q10-box0', [opt('a', '苹果'), opt('b', '香蕉')]),
				box('q10-box1', [opt('a', '苹果'), opt('b', '香蕉')]),
			],
		})
		const content = serializeQuestion(q).messages[1].content as string

		it('labels the question 连线 and shows the stem', () => {
			expect(content).toContain('连线')
			expect(content).toContain('把左侧与右侧连线。')
		})

		it('presents each left item by its index', () => {
			expect(content).toContain('左项 0')
			expect(content).toContain('左项 1')
		})

		it('presents each box right-choices keyed by their data value', () => {
			expect(content).toContain('a. 苹果')
			expect(content).toContain('b. 香蕉')
		})

		it('explains the linePairs answer shape (leftIndex + rightKey)', () => {
			expect(content).toMatch(/leftIndex/)
			expect(content).toMatch(/rightKey/)
		})
	})

	describe('fill / reader (text)', () => {
		function sub(id: string, options: ChaoxingOption[]): ChaoxingQuestion {
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

		it('fill presents each sub-question by index with keyed options', () => {
			const q = makeQuestion({
				id: 'q12',
				type: 'fill',
				stem: [{ type: 'text', text: '完形材料……' }],
				subQuestions: [
					sub('q12-sub0', [opt('A', 'apple'), opt('B', 'banana')]),
					sub('q12-sub1', [opt('A', 'red'), opt('B', 'blue')]),
				],
			})
			const content = serializeQuestion(q).messages[1].content as string
			expect(content).toContain('完形填空')
			expect(content).toContain('完形材料……')
			expect(content).toContain('小题 0')
			expect(content).toContain('小题 1')
			expect(content).toContain('A. apple')
			expect(content).toContain('B. blue')
			expect(content).toMatch(/subIndex/)
			expect(content).toMatch(/optionKey/)
		})

		it('reader presents its sub-questions and keyed options', () => {
			const q = makeQuestion({
				id: 'q13',
				type: 'reader',
				stem: [{ type: 'text', text: '阅读材料……' }],
				subQuestions: [sub('q13-sub0', [opt('A', '正确'), opt('B', '错误')])],
			})
			const content = serializeQuestion(q).messages[1].content as string
			expect(content).toContain('阅读理解')
			expect(content).toContain('小题 0')
			expect(content).toContain('A. 正确')
			expect(content).toContain('B. 错误')
		})
	})

	describe('multimodal sub-options (§8.2)', () => {
		type TextBlock = { type: 'text'; text: string }
		type ImageBlock = { type: 'image_url'; image_url: { url: string } }
		type Block = TextBlock | ImageBlock
		const isText = (b: Block): b is TextBlock => b.type === 'text'
		const isImage = (b: Block): b is ImageBlock => b.type === 'image_url'

		it('emits image_url blocks for images inside fill sub-options', () => {
			const q = makeQuestion({
				id: 'q12',
				type: 'fill',
				hasImages: true,
				stem: [{ type: 'text', text: '图片完形：' }],
				subQuestions: [
					{
						id: 'q12-sub0',
						typeCode: NaN,
						type: 'unknown',
						stem: [],
						hasImages: true,
						needsReview: false,
						options: [
							{
								key: 'A',
								content: [
									{ type: 'text', text: '[小题0选项A图]' },
									{
										type: 'image',
										label: '小题0选项A图',
										dataUrl: 'data:image/jpeg;base64,SUB',
									},
								],
							},
							opt('B', '文字项'),
						],
					},
				],
			})
			const blocks = serializeQuestion(q).messages[1].content as Block[]
			expect(Array.isArray(blocks)).toBe(true)
			// the sub-option image is given after the lead text, label-matched.
			const idx = blocks.findIndex(
				(b) => isImage(b) && b.image_url.url === 'data:image/jpeg;base64,SUB',
			)
			expect(idx).toBeGreaterThan(0)
			expect((blocks[idx - 1] as TextBlock).text).toBe('[小题0选项A图]:')
			// lead text still presents the sub item + its keyed options.
			const lead = blocks.filter(isText)[0].text
			expect(lead).toContain('小题 0')
			expect(lead).toContain('A.')
		})
	})

	it('content is always a plain string in the text branch', () => {
		const q = makeQuestion({ type: 'single', options: [opt('A', 'a')] })
		for (const m of serializeQuestion(q).messages) {
			expect(typeof m.content).toBe('string')
		}
	})

	describe('multimodal branch (§8.2)', () => {
		/** Narrow helpers for the array-content shape. */
		type TextBlock = { type: 'text'; text: string }
		type ImageBlock = { type: 'image_url'; image_url: { url: string } }
		type Block = TextBlock | ImageBlock
		const isText = (b: Block): b is TextBlock => b.type === 'text'
		const isImage = (b: Block): b is ImageBlock => b.type === 'image_url'

		function imageQuestion(): ChaoxingQuestion {
			return makeQuestion({
				id: 'q15',
				type: 'single',
				hasImages: true,
				stem: [
					{ type: 'text', text: '下列函数的导数是 [题干图1] 的是？' },
					{
						type: 'image',
						label: '题干图1',
						fallbackUrl: 'https://x/f.png',
						dataUrl: 'data:image/jpeg;base64,STEM',
					},
				],
				options: [
					{
						key: 'A',
						content: [
							{ type: 'text', text: '[选项A图]' },
							{
								type: 'image',
								label: '选项A图',
								fallbackUrl: 'https://x/a.png',
								dataUrl: 'data:image/jpeg;base64,OPTA',
							},
						],
					},
					opt('B', '2x'),
				],
			})
		}

		it('builds the user message content as an interleaved array', () => {
			const { messages } = serializeQuestion(imageQuestion())
			const user = messages[1]
			expect(user.role).toBe('user')
			expect(Array.isArray(user.content)).toBe(true)
		})

		it('does NOT duplicate the inline placeholder in the leading text block', () => {
			// regression: the placeholder is inlined by extract; flattenParts must not re-add it.
			const lead = (
				serializeQuestion(imageQuestion()).messages[1].content as Block[]
			)[0] as TextBlock
			expect(lead.text.match(/\[题干图1\]/g)).toHaveLength(1)
			expect(lead.text.match(/\[选项A图\]/g)).toHaveLength(1)
		})

		it('leads with one text block carrying the full question text + label placeholders inline', () => {
			const blocks = serializeQuestion(imageQuestion()).messages[1].content as Block[]
			const first = blocks[0]
			expect(isText(first)).toBe(true)
			const text = (first as TextBlock).text
			// placeholders kept inline so the question reads in order
			expect(text).toContain('[题干图1]')
			expect(text).toContain('[选项A图]')
			expect(text).toContain('下列函数的导数是')
			// the convention sentence that introduces the following images
			expect(text).toContain('下面按相同标签顺序给出图片')
		})

		it('emits a [label]: text block immediately before each image_url block, label-matched', () => {
			const blocks = serializeQuestion(imageQuestion()).messages[1].content as Block[]
			// find the image_url blocks and check the preceding text block names the same label
			const stemIdx = blocks.findIndex(
				(b) => isImage(b) && b.image_url.url === 'data:image/jpeg;base64,STEM',
			)
			const optIdx = blocks.findIndex(
				(b) => isImage(b) && b.image_url.url === 'data:image/jpeg;base64,OPTA',
			)
			expect(stemIdx).toBeGreaterThan(0)
			expect(optIdx).toBeGreaterThan(0)
			expect((blocks[stemIdx - 1] as TextBlock).text).toBe('[题干图1]:')
			expect((blocks[optIdx - 1] as TextBlock).text).toBe('[选项A图]:')
		})

		it('orders the image blocks stem-first then options, matching label order', () => {
			const blocks = serializeQuestion(imageQuestion()).messages[1].content as Block[]
			const labelTexts = blocks.filter(isText).map((b) => b.text)
			const stemPos = labelTexts.indexOf('[题干图1]:')
			const optPos = labelTexts.indexOf('[选项A图]:')
			expect(stemPos).toBeGreaterThanOrEqual(0)
			expect(optPos).toBeGreaterThan(stemPos)
		})

		it('system message states the placeholder convention', () => {
			const sys = serializeQuestion(imageQuestion()).messages[0]
			expect(typeof sys.content).toBe('string')
			expect(sys.content as string).toContain('占位符')
			expect(sys.content as string).toContain('相同标签顺序')
		})

		it('falls back to text for an image that has only fallbackUrl (fetch failed, not needsReview)', () => {
			const q = makeQuestion({
				id: 'q9',
				type: 'single',
				hasImages: true,
				stem: [
					{ type: 'text', text: '看图 [题干图1]' },
					{ type: 'image', label: '题干图1', fallbackUrl: 'https://x/blocked.png' },
				],
				options: [opt('A', 'a'), opt('B', 'b')],
			})
			const blocks = serializeQuestion(q).messages[1].content as Block[]
			// no image_url block at all (no dataUrl); instead a text block with the URL + 无法内联
			expect(blocks.some(isImage)).toBe(false)
			const fallbackText = blocks
				.filter(isText)
				.map((b) => b.text)
				.join('\n')
			expect(fallbackText).toContain('[题干图1]:https://x/blocked.png（无法内联）')
		})

		it('mixes inlined images and url-fallbacks in the same question', () => {
			const q = makeQuestion({
				id: 'q9',
				type: 'multiple',
				hasImages: true,
				stem: [{ type: 'text', text: '看图：' }],
				options: [
					{
						key: 'A',
						content: [
							{
								type: 'image',
								label: '选项A图',
								fallbackUrl: 'https://x/a.png',
								dataUrl: 'data:image/jpeg;base64,OK',
							},
						],
					},
					{
						key: 'B',
						content: [{ type: 'image', label: '选项B图', fallbackUrl: 'https://x/b.png' }],
					},
				],
			})
			const blocks = serializeQuestion(q).messages[1].content as Block[]
			// A inlined as image_url; B degraded to text url-fallback
			expect(
				blocks.some((b) => isImage(b) && b.image_url.url === 'data:image/jpeg;base64,OK'),
			).toBe(true)
			const text = blocks
				.filter(isText)
				.map((b) => b.text)
				.join('\n')
			expect(text).toContain('[选项B图]:https://x/b.png（无法内联）')
		})

		it('header (id + type label) and option keys are present in the leading text block', () => {
			const blocks = serializeQuestion(imageQuestion()).messages[1].content as Block[]
			const lead = (blocks[0] as TextBlock).text
			expect(lead).toContain('q15')
			expect(lead).toContain('单选')
			// text option B still listed by its key inside the text block
			expect(lead).toContain('B. 2x')
		})
	})
})
