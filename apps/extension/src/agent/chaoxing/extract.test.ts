// @vitest-environment jsdom

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { extractQuestion } from './extract'

/** Build a single `.questionLi` element from an HTML string. */
function makeLi(html: string): HTMLElement {
	const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document
	const li = doc.querySelector('.questionLi')
	if (!li) throw new Error('fixture missing .questionLi')
	return li as HTMLElement
}

/** Pull the concatenated text out of a ContentPart[] for terse assertions. */
function stemText(parts: { type: string; text?: string }[]): string {
	return parts
		.filter((p) => p.type === 'text')
		.map((p) => p.text ?? '')
		.join(' ')
}

describe('extractQuestion', () => {
	it('parses a single-choice question (exam mode, type 0)', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>1. 下列哪个是质数？</h3>
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">A. 4</div>
						<div class="answer_p">B. 7</div>
						<div class="answer_p">C. 8</div>
					</div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 0)

		expect(q.id).toBe('q0')
		expect(q.typeCode).toBe(0)
		expect(q.type).toBe('single')
		// .stem_answer wrapper is excluded from the title selector → stem is the h3 alone.
		expect(q.stem).toEqual([{ type: 'text', text: '1. 下列哪个是质数？' }])
		expect(q.options?.map((o) => o.key)).toEqual(['A', 'B', 'C'])
		expect(stemText(q.options![1].content)).toBe('B. 7')
		expect(q.blanksCount).toBeUndefined()
		expect(q.hasImages).toBe(false)
		expect(q.needsReview).toBe(false)
	})

	it('parses a multiple-choice question (work mode, type 1)', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" id="answertype1" value="1">
				<h3>2. 以下哪些是偶数？</h3>
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">A. 2</div>
						<div class="answer_p">B. 3</div>
						<div class="answer_p">C. 4</div>
						<div class="answer_p">D. 6</div>
					</div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'work', 1)

		expect(q.id).toBe('q1')
		expect(q.typeCode).toBe(1)
		expect(q.type).toBe('multiple')
		expect(q.stem).toEqual([{ type: 'text', text: '2. 以下哪些是偶数？' }])
		expect(q.options?.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D'])
		expect(stemText(q.options![3].content)).toBe('D. 6')
		expect(q.needsReview).toBe(false)
	})

	it('parses a judgement question (exam mode, type 3) with 正确/错误 options', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type2" value="3">
				<h3>3. 地球是平的。</h3>
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">正确</div>
						<div class="answer_p">错误</div>
					</div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 2)

		expect(q.typeCode).toBe(3)
		expect(q.type).toBe('judgement')
		expect(q.stem).toEqual([{ type: 'text', text: '3. 地球是平的。' }])
		expect(q.options?.map((o) => o.key)).toEqual(['A', 'B'])
		expect(stemText(q.options![0].content)).toBe('正确')
		expect(stemText(q.options![1].content)).toBe('错误')
	})

	it('counts a single blank for a completion question (type 2, one textarea)', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="2">
				<h3>4. 中国的首都是____。</h3>
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p"><textarea></textarea></div>
					</div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 3)

		expect(q.typeCode).toBe(2)
		expect(q.type).toBe('completion')
		expect(q.blanksCount).toBe(1)
		// completion must NOT populate options
		expect(q.options).toBeUndefined()
		expect(q.stem).toEqual([{ type: 'text', text: '4. 中国的首都是____。' }])
		expect(q.needsReview).toBe(false)
	})

	it('counts two blanks for a completion question with a textarea and a UEditor iframe (work mode)', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" id="answertype1" value="4">
				<h3>5. 两数之和与差。</h3>
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p"><textarea></textarea></div>
						<div class="answer_p"><iframe></iframe></div>
					</div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'work', 4)

		expect(q.typeCode).toBe(4)
		expect(q.type).toBe('completion')
		expect(q.blanksCount).toBe(2)
		expect(q.options).toBeUndefined()
	})

	it('emits a stem image part with a 题干图N label + placeholder, sets hasImages', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>6. 下列函数 <img src="https://x/formula.png"> 的导数是？</h3>
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">A. 2x</div>
						<div class="answer_p">B. x</div>
					</div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 5)

		// The text part keeps a [题干图1] token where the <img> sat; an image part follows.
		expect(q.stem).toEqual([
			{ type: 'text', text: '6. 下列函数 [题干图1] 的导数是？' },
			{ type: 'image', label: '题干图1', fallbackUrl: 'https://x/formula.png' },
		])
		// At least one image part now present → hasImages flips true.
		expect(q.hasImages).toBe(true)
	})

	it('numbers multiple stem images 题干图1, 题干图2 in document order', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>6. 比较 <img src="https://x/a.png"> 与 <img src="https://x/b.png"> 大小。</h3>
				<div class="stem_answer">
					<div class="answerBg"><div class="answer_p">A. x</div></div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 5)
		const imageParts = q.stem.filter((p) => p.type === 'image')
		expect(imageParts).toEqual([
			{ type: 'image', label: '题干图1', fallbackUrl: 'https://x/a.png' },
			{ type: 'image', label: '题干图2', fallbackUrl: 'https://x/b.png' },
		])
		expect(stemText(q.stem)).toContain('[题干图1]')
		expect(stemText(q.stem)).toContain('[题干图2]')
	})

	it('emits an image part for an image option labelled 选项<key>图', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>7. 选出正确的图。</h3>
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p"><img src="https://x/a.png"></div>
						<div class="answer_p">B. 文字选项</div>
					</div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 6)

		expect(q.options![0].key).toBe('A')
		expect(q.options![0].content).toEqual([
			{ type: 'text', text: '[选项A图]' },
			{ type: 'image', label: '选项A图', fallbackUrl: 'https://x/a.png' },
		])
		expect(stemText(q.options![1].content)).toBe('B. 文字选项')
		expect(q.hasImages).toBe(true)
	})

	it('renders a LaTeX-source image as $…$ text and drops the image (no fetch)', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>8. 求 <img src="https://x/eq.png" data-latex="x^2 + 1"> 的值。</h3>
				<div class="stem_answer">
					<div class="answerBg"><div class="answer_p">A. 1</div></div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 7)

		// LaTeX inlined as text; NO image part, NO placeholder token, hasImages stays false.
		expect(q.stem).toEqual([{ type: 'text', text: '8. 求 $x^2 + 1$ 的值。' }])
		expect(q.stem.some((p) => p.type === 'image')).toBe(false)
		expect(q.hasImages).toBe(false)
	})

	it('renders a meaningful alt/title image as its alt text and drops the image', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>9. 看图：<img src="https://x/cat.png" alt="一只猫"> 是什么动物？</h3>
				<div class="stem_answer">
					<div class="answerBg"><div class="answer_p">A. 猫</div></div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 8)

		expect(q.stem).toEqual([{ type: 'text', text: '9. 看图：一只猫 是什么动物？' }])
		expect(q.hasImages).toBe(false)
	})

	it('drops decorative images (tiny size attrs / icon class / data spacer) and keeps hasImages false', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>10. 选择<img src="https://x/star.png" width="16" height="16"><img class="icon" src="https://x/i.png"><img src="data:image/gif;base64,R0lGOD"> 正确项。</h3>
				<div class="stem_answer">
					<div class="answerBg"><div class="answer_p">A. x</div></div>
				</div>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 9)

		// All three images are decorative → emit nothing, no placeholder token.
		expect(q.stem).toEqual([{ type: 'text', text: '10. 选择 正确项。' }])
		expect(q.hasImages).toBe(false)
	})

	it('marks an unknown type code as needsReview and leaves options unpopulated', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="99">
				<h3>8. 无法识别的题型。</h3>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 7)

		expect(q.typeCode).toBe(99)
		expect(q.type).toBe('unknown')
		expect(q.needsReview).toBe(true)
		expect(q.options).toBeUndefined()
	})

	it('marks an empty stem as needsReview even for a known type', () => {
		// Whitespace-only title with no other direct-child title element → empty stem.
		// (The options wrapper is nested so the title selector does not pick it up.)
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>   </h3>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 8)

		expect(q.type).toBe('single')
		expect(stemText(q.stem)).toBe('')
		expect(q.needsReview).toBe(true)
	})

	it('maps the line type code (11) without throwing and leaves options unpopulated', () => {
		const li = makeLi(`
			<div class="questionLi">
				<input type="hidden" name="type" value="11">
				<h3>9. 连线题。</h3>
			</div>
		`)

		const q = extractQuestion(li, 'exam', 9)

		expect(q.typeCode).toBe(11)
		expect(q.type).toBe('line')
		expect(q.options).toBeUndefined()
		expect(q.needsReview).toBe(false)
	})

	it('maps fill (14) and reader (15) type codes', () => {
		const fill = extractQuestion(
			makeLi(`
				<div class="questionLi">
					<input type="hidden" name="type" value="14">
					<h3>完形填空材料。</h3>
				</div>
			`),
			'exam',
			10,
		)
		const reader = extractQuestion(
			makeLi(`
				<div class="questionLi">
					<input type="hidden" name="type" value="15">
					<h3>阅读理解材料。</h3>
				</div>
			`),
			'exam',
			11,
		)

		expect(fill.type).toBe('fill')
		expect(reader.type).toBe('reader')
	})

	it('reads the type code only from the mode-appropriate input', () => {
		// Both inputs present; exam mode must read name^="type" (5 → completion),
		// work mode must read id^="answertype" (0 → single).
		const html = `
			<div class="questionLi">
				<input type="hidden" name="type" value="5">
				<input type="hidden" id="answertype1" value="0">
				<h3>题干。</h3>
				<div class="stem_answer">
					<div class="answerBg"><div class="answer_p">A. x</div></div>
				</div>
			</div>
		`

		expect(extractQuestion(makeLi(html), 'exam', 0).typeCode).toBe(5)
		expect(extractQuestion(makeLi(html), 'exam', 0).type).toBe('completion')
		expect(extractQuestion(makeLi(html), 'work', 0).typeCode).toBe(0)
		expect(extractQuestion(makeLi(html), 'work', 0).type).toBe('single')
	})
})
