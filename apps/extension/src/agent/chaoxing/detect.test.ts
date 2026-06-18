// @vitest-environment jsdom

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { detectChaoxing } from './detect'

function makeDoc(bodyHtml: string, url: string): Document {
	return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, { url }).window.document
}

const CHAOXING_URL = 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew'
const OTHER_URL = 'https://example.com/quiz'

describe('detectChaoxing', () => {
	it('flags an exam page when on chaoxing with questions and an exam type input', () => {
		const doc = makeDoc(
			'<div class="questionLi"></div><input name="type1" value="0" />',
			CHAOXING_URL,
		)

		expect(detectChaoxing(doc, CHAOXING_URL)).toEqual({ isChaoxing: true, mode: 'exam' })
	})

	it('flags a work page when on chaoxing with questions and an answertype input', () => {
		const doc = makeDoc(
			'<div class="questionLi"></div><input id="answertype1" value="0" />',
			CHAOXING_URL,
		)

		expect(detectChaoxing(doc, CHAOXING_URL)).toEqual({ isChaoxing: true, mode: 'work' })
	})

	it('detects chaoxing but leaves mode null when neither type input is present', () => {
		const doc = makeDoc('<div class="questionLi"></div>', CHAOXING_URL)

		expect(detectChaoxing(doc, CHAOXING_URL)).toEqual({ isChaoxing: true, mode: null })
	})

	it('returns not-chaoxing when on chaoxing host but no question root exists', () => {
		const doc = makeDoc('<div class="somethingElse"></div>', CHAOXING_URL)

		expect(detectChaoxing(doc, CHAOXING_URL)).toEqual({ isChaoxing: false, mode: null })
	})

	it('returns not-chaoxing on a non-chaoxing host even when questions are present', () => {
		const doc = makeDoc('<div class="questionLi"></div><input name="type1" value="0" />', OTHER_URL)

		expect(detectChaoxing(doc, OTHER_URL)).toEqual({ isChaoxing: false, mode: null })
	})
})
