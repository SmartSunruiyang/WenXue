// @vitest-environment jsdom

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import type { ChaoxingAnswer } from './types'

import { fillQuestion } from './fill'

/**
 * Build a single `.questionLi` element from an HTML string, returned together
 * with its owner document so iframes get a real `contentDocument` to write into.
 */
function makeLi(html: string): { li: HTMLElement; doc: Document } {
	const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document
	const li = doc.querySelector('.questionLi')
	if (!li) throw new Error('fixture missing .questionLi')
	return { li: li as HTMLElement, doc }
}

/** Attach a click spy to every `.answer_p` and return the list, ordered. */
function spyOption(li: HTMLElement): { el: HTMLElement; clicks: number }[] {
	return Array.from(li.querySelectorAll<HTMLElement>('.answer_p')).map((el) => {
		const rec = { el, clicks: 0 }
		el.addEventListener('click', () => {
			rec.clicks += 1
		})
		return rec
	})
}

describe('fillQuestion', () => {
	it('clicks the matching option for a single-choice answer', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">A. 4</div>
						<div class="answer_p">B. 7</div>
						<div class="answer_p">C. 8</div>
					</div>
				</div>
			</div>
		`)
		const opts = spyOption(li)
		const answer: ChaoxingAnswer = {
			questionId: 'q0',
			type: 'single',
			selectedOptions: ['B'],
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result).toEqual({ questionId: 'q0', filled: true })
		expect(opts.map((o) => o.clicks)).toEqual([0, 1, 0])
	})

	it('clicks every selected option for a multiple-choice answer', () => {
		const { li } = makeLi(`
			<div class="questionLi">
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
		const opts = spyOption(li)
		const answer: ChaoxingAnswer = {
			questionId: 'q1',
			type: 'multiple',
			selectedOptions: ['A', 'C', 'D'],
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(true)
		expect(result.reason).toBeUndefined()
		expect(opts.map((o) => o.clicks)).toEqual([1, 0, 1, 1])
	})

	it('clicks the matching option for a judgement answer', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">正确</div>
						<div class="answer_p">错误</div>
					</div>
				</div>
			</div>
		`)
		const opts = spyOption(li)
		const answer: ChaoxingAnswer = {
			questionId: 'q2',
			type: 'judgement',
			selectedOptions: ['A'],
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(true)
		expect(opts.map((o) => o.clicks)).toEqual([1, 0])
	})

	it('skips an option group that already shows an answer (check_answer guard)', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">A. 4</div>
						<div class="answer_p">B. 7</div>
						<span class="check_answer_dx">已答</span>
					</div>
				</div>
			</div>
		`)
		const opts = spyOption(li)
		const answer: ChaoxingAnswer = {
			questionId: 'q3',
			type: 'single',
			selectedOptions: ['B'],
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		// Group is already answered → no click, nothing was filled.
		expect(opts.map((o) => o.clicks)).toEqual([0, 0])
		expect(result.filled).toBe(false)
	})

	it('fills the valid options and notes out-of-range keys in reason', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">A. 2</div>
						<div class="answer_p">B. 3</div>
					</div>
				</div>
			</div>
		`)
		const opts = spyOption(li)
		const answer: ChaoxingAnswer = {
			questionId: 'q4',
			type: 'multiple',
			selectedOptions: ['A', 'D'], // D (index 3) is out of range
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(true)
		expect(opts.map((o) => o.clicks)).toEqual([1, 0])
		expect(result.reason).toBeDefined()
		expect(result.reason).toContain('D')
	})

	it('writes a completion blank into a textarea and clicks saveQuestion', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p"><textarea></textarea></div>
					</div>
					<a class="saveBtn" onclick="saveQuestion(123)">保存</a>
				</div>
			</div>
		`)
		const saveBtn = li.querySelector<HTMLElement>('.saveBtn')!
		let saveClicks = 0
		saveBtn.addEventListener('click', () => {
			saveClicks += 1
		})
		const answer: ChaoxingAnswer = {
			questionId: 'q5',
			type: 'completion',
			blanks: ['北京'],
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(true)
		expect(li.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('北京')
		expect(saveClicks).toBe(1)
	})

	it('writes a completion blank into a UEditor iframe body', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p"><iframe></iframe></div>
					</div>
				</div>
			</div>
		`)
		const answer: ChaoxingAnswer = {
			questionId: 'q6',
			type: 'completion',
			blanks: ['答案文本'],
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(true)
		const iframe = li.querySelector<HTMLIFrameElement>('iframe')!
		expect(iframe.contentDocument!.body.innerHTML).toBe('答案文本')
	})

	it('writes multiple completion blanks in order into their own containers', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p"><textarea></textarea></div>
						<div class="answer_p"><textarea></textarea></div>
					</div>
				</div>
			</div>
		`)
		const answer: ChaoxingAnswer = {
			questionId: 'q7',
			type: 'completion',
			blanks: ['第一空', '第二空'],
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(true)
		const areas = li.querySelectorAll<HTMLTextAreaElement>('textarea')
		expect(areas[0].value).toBe('第一空')
		expect(areas[1].value).toBe('第二空')
	})

	it('skips empty completion blanks without writing or saving', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p"><textarea>existing</textarea></div>
					</div>
					<a class="saveBtn" onclick="saveQuestion(1)">保存</a>
				</div>
			</div>
		`)
		const saveBtn = li.querySelector<HTMLElement>('.saveBtn')!
		let saveClicks = 0
		saveBtn.addEventListener('click', () => {
			saveClicks += 1
		})
		const answer: ChaoxingAnswer = {
			questionId: 'q8',
			type: 'completion',
			blanks: ['   '], // whitespace-only → treated as empty
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(false)
		// textarea untouched, save not clicked
		expect(li.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('existing')
		expect(saveClicks).toBe(0)
	})

	it('does nothing for a needsReview answer', () => {
		const { li } = makeLi(`
			<div class="questionLi">
				<div class="stem_answer">
					<div class="answerBg">
						<div class="answer_p">A. 4</div>
						<div class="answer_p">B. 7</div>
					</div>
				</div>
			</div>
		`)
		const opts = spyOption(li)
		const answer: ChaoxingAnswer = {
			questionId: 'q9',
			type: 'single',
			selectedOptions: ['A'],
			needsReview: true,
		}

		const result = fillQuestion(li, answer)

		expect(result).toEqual({ questionId: 'q9', filled: false, reason: 'needsReview' })
		expect(opts.map((o) => o.clicks)).toEqual([0, 0])
	})

	describe('line (type 11)', () => {
		/** Build a line question with N boxes, each offering the given li[data] keys. */
		function lineLi(boxes: string[][]): HTMLElement {
			const boxHtml = boxes
				.map(
					(keys) => `
					<div class="selectBox"><ul>
						${keys.map((k) => `<li data="${k}"><a>${k}项</a></li>`).join('')}
					</ul></div>`,
				)
				.join('')
			return makeLi(`
				<div class="questionLi">
					<div class="line_answer_ct">${boxHtml}</div>
				</div>
			`).li
		}

		/** Spy clicks on every `li[data] a` inside each selectBox, grouped by box index. */
		function spyLineChoices(li: HTMLElement): { box: number; key: string; clicks: number }[] {
			const recs: { box: number; key: string; clicks: number }[] = []
			Array.from(li.querySelectorAll<HTMLElement>('.line_answer_ct .selectBox')).forEach(
				(box, b) => {
					Array.from(box.querySelectorAll<HTMLElement>('li[data]')).forEach((liEl) => {
						const anchor = liEl.querySelector<HTMLElement>('a')!
						const rec = { box: b, key: liEl.getAttribute('data') ?? '', clicks: 0 }
						anchor.addEventListener('click', () => {
							rec.clicks += 1
						})
						recs.push(rec)
					})
				},
			)
			return recs
		}

		it('clicks li[data=rightKey] a inside the box at leftIndex', () => {
			const li = lineLi([
				['a', 'b'],
				['a', 'b'],
			])
			const recs = spyLineChoices(li)
			const answer: ChaoxingAnswer = {
				questionId: 'q10',
				type: 'line',
				linePairs: [
					{ leftIndex: 0, rightKey: 'b' },
					{ leftIndex: 1, rightKey: 'a' },
				],
				needsReview: false,
			}

			const result = fillQuestion(li, answer)

			expect(result.filled).toBe(true)
			// box0 → key b clicked; box1 → key a clicked; the others untouched.
			expect(recs.find((r) => r.box === 0 && r.key === 'b')!.clicks).toBe(1)
			expect(recs.find((r) => r.box === 0 && r.key === 'a')!.clicks).toBe(0)
			expect(recs.find((r) => r.box === 1 && r.key === 'a')!.clicks).toBe(1)
			expect(recs.find((r) => r.box === 1 && r.key === 'b')!.clicks).toBe(0)
		})

		it('notes out-of-range leftIndex and unknown rightKey in reason, fills the valid pair', () => {
			const li = lineLi([['a', 'b']])
			const recs = spyLineChoices(li)
			const answer: ChaoxingAnswer = {
				questionId: 'q10',
				type: 'line',
				linePairs: [
					{ leftIndex: 0, rightKey: 'a' }, // valid
					{ leftIndex: 5, rightKey: 'a' }, // box out of range
					{ leftIndex: 0, rightKey: 'zzz' }, // key not in box
				],
				needsReview: false,
			}

			const result = fillQuestion(li, answer)

			expect(result.filled).toBe(true)
			expect(recs.find((r) => r.box === 0 && r.key === 'a')!.clicks).toBe(1)
			expect(result.reason).toBeDefined()
			expect(result.reason).toContain('5')
			expect(result.reason).toContain('zzz')
		})
	})

	describe('fill / reader (type 14 / 15)', () => {
		/** Build a fill/reader question; each sub container offers the given span[data] keys. */
		function subLi(containerClass: string, subs: string[][]): HTMLElement {
			const html = subs
				.map(
					(keys) => `
					<div class="${containerClass}">
						${keys.map((k) => `<span class="saveSingleSelect" data="${k}">${k}选</span>`).join('')}
					</div>`,
				)
				.join('')
			return makeLi(`<div class="questionLi">${html}</div>`).li
		}

		/** Spy clicks on every saveSingleSelect span, grouped by sub index. */
		function spySubSpans(
			li: HTMLElement,
			containerClass: string,
		): { sub: number; key: string; clicks: number }[] {
			const recs: { sub: number; key: string; clicks: number }[] = []
			Array.from(li.querySelectorAll<HTMLElement>(`.${containerClass}`)).forEach((item, s) => {
				Array.from(item.querySelectorAll<HTMLElement>('span.saveSingleSelect[data]')).forEach(
					(span) => {
						const rec = { sub: s, key: span.getAttribute('data') ?? '', clicks: 0 }
						span.addEventListener('click', () => {
							rec.clicks += 1
						})
						recs.push(rec)
					},
				)
			})
			return recs
		}

		it('fill: clicks span.saveSingleSelect[data=optionKey] in the sub-item at subIndex', () => {
			const li = subLi('filling_answer', [
				['A', 'B'],
				['A', 'B'],
			])
			const recs = spySubSpans(li, 'filling_answer')
			const answer: ChaoxingAnswer = {
				questionId: 'q12',
				type: 'fill',
				subAnswers: [
					{ subIndex: 0, optionKey: 'B' },
					{ subIndex: 1, optionKey: 'A' },
				],
				needsReview: false,
			}

			const result = fillQuestion(li, answer)

			expect(result.filled).toBe(true)
			expect(recs.find((r) => r.sub === 0 && r.key === 'B')!.clicks).toBe(1)
			expect(recs.find((r) => r.sub === 0 && r.key === 'A')!.clicks).toBe(0)
			expect(recs.find((r) => r.sub === 1 && r.key === 'A')!.clicks).toBe(1)
		})

		it('reader: clicks span.saveSingleSelect[data=optionKey] in the .reading_answer sub-item', () => {
			const li = subLi('reading_answer', [['A', 'B']])
			const recs = spySubSpans(li, 'reading_answer')
			const answer: ChaoxingAnswer = {
				questionId: 'q13',
				type: 'reader',
				subAnswers: [{ subIndex: 0, optionKey: 'A' }],
				needsReview: false,
			}

			const result = fillQuestion(li, answer)

			expect(result.filled).toBe(true)
			expect(recs.find((r) => r.sub === 0 && r.key === 'A')!.clicks).toBe(1)
			expect(recs.find((r) => r.sub === 0 && r.key === 'B')!.clicks).toBe(0)
		})

		it('notes out-of-range subIndex and unknown optionKey in reason', () => {
			const li = subLi('filling_answer', [['A', 'B']])
			const recs = spySubSpans(li, 'filling_answer')
			const answer: ChaoxingAnswer = {
				questionId: 'q12',
				type: 'fill',
				subAnswers: [
					{ subIndex: 0, optionKey: 'A' }, // valid
					{ subIndex: 9, optionKey: 'A' }, // sub out of range
					{ subIndex: 0, optionKey: 'Z' }, // key not present
				],
				needsReview: false,
			}

			const result = fillQuestion(li, answer)

			expect(result.filled).toBe(true)
			expect(recs.find((r) => r.sub === 0 && r.key === 'A')!.clicks).toBe(1)
			expect(result.reason).toContain('9')
			expect(result.reason).toContain('Z')
		})
	})
})
