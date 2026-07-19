// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { assessmentAutomationBlockReason } from './assessmentSafety'

describe('assessment automation safety guard', () => {
	it('blocks final assessment submission but not an unambiguous next button', () => {
		const submit = button('提交试卷')
		const next = button('下一题')

		expect(assessmentAutomationBlockReason(submit, 'click')).toBe('final_assessment_submission')
		expect(assessmentAutomationBlockReason(next, 'click')).toBeUndefined()
	})

	it('blocks a plain submit control and its descendants inside an assessment document', () => {
		document.body.innerHTML = `
			<div class="questionLi">Question</div>
			<button id="submit"><span id="submit-label">提交</span></button>
		`

		expect(
			assessmentAutomationBlockReason(
				document.querySelector('#submit-label') as HTMLElement,
				'click',
			),
		).toBe('final_assessment_submission')
	})

	it('recognizes production platform question roots as assessment context', () => {
		document.body.innerHTML = `
			<div class="questionBox"><div class="questionContent">Question</div></div>
			<button id="submit" type="submit">提交</button>
		`

		expect(
			assessmentAutomationBlockReason(document.querySelector('#submit') as HTMLElement, 'click'),
		).toBe('final_assessment_submission')
	})

	it('blocks icon-only submission controls identified by action semantics', () => {
		document.body.innerHTML = `
			<div class="q_content">Question</div>
			<button id="onclick-submit" onclick="submitExam()"><svg></svg></button>
			<a id="href-submit" href="/exam/submitExam"><svg></svg></a>
			<a id="href-finish" href="/quiz/finish"><svg></svg></a>
		`

		for (const id of ['#onclick-submit', '#href-submit', '#href-finish']) {
			expect(
				assessmentAutomationBlockReason(document.querySelector(id) as HTMLElement, 'click'),
			).toBe('final_assessment_submission')
		}
	})

	it('recognizes controlled generic fieldsets as assessment context', () => {
		document.body.innerHTML = `
			<fieldset><legend>Question</legend><label><input type="radio" name="q"> A</label></fieldset>
			<button id="submit">Submit</button>
		`

		expect(
			assessmentAutomationBlockReason(document.querySelector('#submit') as HTMLElement, 'click'),
		).toBe('final_assessment_submission')
	})

	it.each(['提交作业', '提交答卷', '提交测验', '确认提交', '完成作业'])(
		'blocks compact Chinese final-action label %s',
		(label) => {
			const submit = button(label)
			expect(assessmentAutomationBlockReason(submit, 'click')).toBe('final_assessment_submission')
		},
	)

	it('blocks challenge descendants and login secrets', () => {
		document.body.innerHTML = `
			<div class="yidun_slider"><button id="verify">Verify</button></div>
			<input id="password" type="password">
		`

		expect(
			assessmentAutomationBlockReason(document.querySelector('#verify') as HTMLElement, 'click'),
		).toBe('protected_challenge')
		expect(
			assessmentAutomationBlockReason(document.querySelector('#password') as HTMLElement, 'input'),
		).toBe('login_secret')
	})
})

function button(text: string): HTMLButtonElement {
	const element = document.createElement('button')
	element.textContent = text
	return element
}
