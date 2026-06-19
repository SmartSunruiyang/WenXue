// @vitest-environment jsdom

import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import type { ChaoxingAnswer, ContentPart } from './types'

import { extractQuestions, fillAnswers, gotoNextPage, probeInterrupts } from './adapter.content'

/** Build a Document from a body fragment, with an optional page URL. */
function makeDoc(bodyHtml: string, url = 'https://mooc1.chaoxing.com/work'): Document {
	return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, { url }).window.document
}

/** A single-choice `.questionLi` fragment in exam mode (input[name^=type]). */
function examChoiceLi(typeValue: number, stem: string, options: string[]): string {
	const opts = options.map((o) => `<div class="answer_p">${o}</div>`).join('')
	return `
		<div class="questionLi">
			<input type="hidden" name="type" value="${typeValue}">
			<h3>${stem}</h3>
			<div class="stem_answer"><div class="answerBg">${opts}</div></div>
		</div>`
}

describe('extractQuestions', () => {
	it('enumerates every top-document .questionLi in order with running q-ids', async () => {
		const doc = makeDoc(
			examChoiceLi(0, '1. 甲', ['A. a', 'B. b']) +
				examChoiceLi(0, '2. 乙', ['A. c', 'B. d']) +
				examChoiceLi(3, '3. 丙', ['正确', '错误']),
		)

		const qs = await extractQuestions(doc)

		expect(qs.map((q) => q.id)).toEqual(['q0', 'q1', 'q2'])
		expect(qs[0].type).toBe('single')
		expect(qs[2].type).toBe('judgement')
		// stem carried through from extractQuestion
		expect(qs[1].stem).toEqual([{ type: 'text', text: '2. 乙' }])
	})

	it('detects work mode from input[id^=answertype] when no exam input is present', async () => {
		const doc = makeDoc(`
			<div class="questionLi">
				<input type="hidden" id="answertype1" value="1">
				<h3>多选</h3>
				<div class="stem_answer"><div class="answerBg">
					<div class="answer_p">A. x</div><div class="answer_p">B. y</div>
				</div></div>
			</div>`)

		const qs = await extractQuestions(doc)

		expect(qs).toHaveLength(1)
		expect(qs[0].type).toBe('multiple')
	})

	it('returns an empty array on a doc with no questions', async () => {
		expect(await extractQuestions(makeDoc('<div class="other"></div>'))).toEqual([])
	})

	it('enumerates same-origin iframe questions after top-doc ones, in document order', async () => {
		const doc = makeDoc(examChoiceLi(0, 'TOP', ['A. a', 'B. b']) + `<iframe id="f"></iframe>`)
		const iframe = doc.querySelector('iframe') as HTMLIFrameElement
		const idoc = iframe.contentDocument
		// jsdom gives same-origin iframes a real contentDocument; if this ever regresses,
		// the iframe-enumeration path is exercised only by tsc/build.
		expect(idoc).toBeTruthy()
		idoc!.body.innerHTML = examChoiceLi(3, 'INNER', ['正确', '错误'])

		const qs = await extractQuestions(doc)

		expect(qs.map((q) => q.id)).toEqual(['q0', 'q1'])
		// top doc first
		expect(qs[0].type).toBe('single')
		expect(qs[0].stem).toEqual([{ type: 'text', text: 'TOP' }])
		// iframe question second, with the running index continued
		expect(qs[1].type).toBe('judgement')
		expect(qs[1].stem).toEqual([{ type: 'text', text: 'INNER' }])
	})

	it('awaits image resolution: a stem <img> is inlined to base64 via injected deps', async () => {
		const doc = makeDoc(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>看图 <img src="https://x/p.png"> 选择</h3>
				<div class="stem_answer"><div class="answerBg">
					<div class="answer_p">A. a</div><div class="answer_p">B. b</div>
				</div></div>
			</div>`)
		const fetchImpl = vi.fn(
			async () => new Response(new Blob(['x'], { type: 'image/png' }), { status: 200 }),
		) as unknown as typeof fetch
		const downscale = vi.fn(async () => 'data:image/jpeg;base64,RESOLVED')

		const qs = await extractQuestions(doc, { fetchImpl, downscale })

		expect(qs[0].hasImages).toBe(true)
		const img = qs[0].stem.find((p) => p.type === 'image') as Extract<
			ContentPart,
			{ type: 'image' }
		>
		expect(img.dataUrl).toBe('data:image/jpeg;base64,RESOLVED')
		expect(fetchImpl).toHaveBeenCalledWith('https://x/p.png', { credentials: 'include' })
	})
})

describe('fillAnswers', () => {
	it('pairs each answer to the .questionLi at the matching q-index and clicks it', () => {
		const doc = makeDoc(
			examChoiceLi(0, '1', ['A. a', 'B. b', 'C. c']) + examChoiceLi(0, '2', ['A. d', 'B. e']),
		)
		const allOptions = Array.from(doc.querySelectorAll<HTMLElement>('.answer_p'))
		const clicks = allOptions.map((el) => {
			const rec = { el, n: 0 }
			el.addEventListener('click', () => (rec.n += 1))
			return rec
		})

		const answers: ChaoxingAnswer[] = [
			{ questionId: 'q0', type: 'single', selectedOptions: ['C'], needsReview: false },
			{ questionId: 'q1', type: 'single', selectedOptions: ['A'], needsReview: false },
		]

		const results = fillAnswers(answers, doc)

		expect(results.map((r) => r.questionId)).toEqual(['q0', 'q1'])
		expect(results.every((r) => r.filled)).toBe(true)
		// q0 → 3rd option (C) of first li; q1 → 1st option (A) of second li
		expect(clicks.map((c) => c.n)).toEqual([0, 0, 1, 1, 0])
	})

	it('returns filled:false with a reason for an answer whose q-index has no .questionLi', () => {
		const doc = makeDoc(examChoiceLi(0, '1', ['A. a', 'B. b']))

		const answers: ChaoxingAnswer[] = [
			{ questionId: 'q0', type: 'single', selectedOptions: ['A'], needsReview: false },
			// q5 has no matching li
			{ questionId: 'q5', type: 'single', selectedOptions: ['A'], needsReview: false },
		]

		const results = fillAnswers(answers, doc)

		expect(results).toHaveLength(2)
		const q5 = results.find((r) => r.questionId === 'q5')!
		expect(q5.filled).toBe(false)
		expect(q5.reason).toBeTruthy()
	})

	it('ignores answers with an unparseable id (no crash)', () => {
		const doc = makeDoc(examChoiceLi(0, '1', ['A. a']))
		const results = fillAnswers(
			[{ questionId: 'not-a-q', type: 'single', selectedOptions: ['A'], needsReview: false }],
			doc,
		)
		expect(results).toHaveLength(1)
		expect(results[0].filled).toBe(false)
	})
})

describe('gotoNextPage', () => {
	it('clicks the next-question button and returns true', async () => {
		const doc = makeDoc(
			`<a onclick="getTheNextQuestion(1)">下一题</a>` + examChoiceLi(0, '1. 甲', ['A. a', 'B. b']),
		)
		const btn = doc.querySelector<HTMLElement>('[onclick="getTheNextQuestion(1)"]')!
		let clicked = 0
		btn.addEventListener('click', () => (clicked += 1))

		expect(await gotoNextPage(doc)).toBe(true)
		expect(clicked).toBe(1)
	})

	it('returns false when no next-question button is present (no readiness wait)', async () => {
		const waitForReady = vi.fn(async () => {})
		expect(await gotoNextPage(makeDoc('<div></div>'), { waitForReady })).toBe(false)
		// no click happened → must not have waited for readiness.
		expect(waitForReady).not.toHaveBeenCalled()
	})

	it('waits for page readiness after clicking before returning true', async () => {
		const order: string[] = []
		const doc = makeDoc(`<a onclick="getTheNextQuestion(1)">下一题</a>`)
		const btn = doc.querySelector<HTMLElement>('[onclick="getTheNextQuestion(1)"]')!
		btn.addEventListener('click', () => order.push('click'))
		const waitForReady = vi.fn(async () => {
			order.push('wait')
		})

		const result = await gotoNextPage(doc, { waitForReady })

		expect(result).toBe(true)
		expect(waitForReady).toHaveBeenCalledTimes(1)
		// click happens first, readiness wait second.
		expect(order).toEqual(['click', 'wait'])
	})

	it('still returns true even if the readiness wait times out (best-effort)', async () => {
		const doc = makeDoc(`<a onclick="getTheNextQuestion(1)">下一题</a>`)
		// a waiter that resolves (simulating timeout fallback, not throwing)
		const waitForReady = vi.fn(async () => {})
		expect(await gotoNextPage(doc, { waitForReady })).toBe(true)
	})
})

describe('probeInterrupts', () => {
	it('returns all-false on a clean question doc', () => {
		const doc = makeDoc(examChoiceLi(0, '正常题目 normal text', ['A. a', 'B. b']))
		expect(probeInterrupts(doc)).toEqual({ faceRecognition: false, suspiciousFont: false })
	})

	it('flags faceRecognition for a #fcqrimg with a non-empty src', () => {
		const doc = makeDoc(`<img id="fcqrimg" src="https://x/qr.png">`)
		expect(probeInterrupts(doc).faceRecognition).toBe(true)
	})

	it('does not flag faceRecognition for a #fcqrimg with an empty src', () => {
		const doc = makeDoc(`<img id="fcqrimg" src="">`)
		expect(probeInterrupts(doc).faceRecognition).toBe(false)
	})

	it('flags faceRecognition for a visible .chapterVideoFaceMaskDiv', () => {
		const doc = makeDoc(`<div class="chapterVideoFaceMaskDiv" style="display:block"></div>`)
		expect(probeInterrupts(doc).faceRecognition).toBe(true)
	})

	it('does not flag faceRecognition for a hidden .chapterVideoFaceMaskDiv', () => {
		const doc = makeDoc(`<div class="chapterVideoFaceMaskDiv" style="display:none"></div>`)
		expect(probeInterrupts(doc).faceRecognition).toBe(false)
	})

	it('flags suspiciousFont when question text carries many Private-Use-Area glyphs', () => {
		// 6 PUA codepoints (U+E000…) sprinkled into the stem → anti-scrape custom-glyph garble.
		const garble = ''
		const doc = makeDoc(`
			<div class="questionLi">
				<input type="hidden" name="type" value="0">
				<h3>题目 ${garble} 内容</h3>
			</div>`)
		expect(probeInterrupts(doc).suspiciousFont).toBe(true)
	})

	it('does not flag suspiciousFont for ordinary CJK + ascii text', () => {
		const doc = makeDoc(examChoiceLi(0, '下列哪个是质数？which is prime', ['A. 4', 'B. 7']))
		expect(probeInterrupts(doc).suspiciousFont).toBe(false)
	})
})
