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

	it('returns unsupported (no throw) for a line answer', () => {
		const { li } = makeLi(`<div class="questionLi"></div>`)
		const answer: ChaoxingAnswer = {
			questionId: 'q10',
			type: 'line',
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(false)
		expect(result.questionId).toBe('q10')
		expect(result.reason).toContain('line')
		expect(result.reason).toContain('Task 10')
	})

	it('returns unsupported (no throw) for a reader answer', () => {
		const { li } = makeLi(`<div class="questionLi"></div>`)
		const answer: ChaoxingAnswer = {
			questionId: 'q11',
			type: 'reader',
			needsReview: false,
		}

		const result = fillQuestion(li, answer)

		expect(result.filled).toBe(false)
		expect(result.reason).toContain('reader')
	})
})
