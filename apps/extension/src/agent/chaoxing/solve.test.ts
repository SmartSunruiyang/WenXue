import type { LLMConfig } from '@page-agent/llms'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

import type { FillResult } from './fill'
import { solveChaoxing } from './solve'
import type { ChaoxingAnswer, ChaoxingOption, ChaoxingQuestion, QType } from './types'

function opt(key: string, text: string): ChaoxingOption {
	return { key, content: [{ type: 'text', text }] }
}

function makeQuestion(
	partial: Partial<ChaoxingQuestion> & { id: string; type: QType },
): ChaoxingQuestion {
	return {
		typeCode: 0,
		stem: [{ type: 'text', text: 'stem' }],
		hasImages: false,
		needsReview: false,
		...partial,
	}
}

const TEXT_MODEL: LLMConfig = {
	baseURL: 'https://text.example/v1',
	model: 'text-model',
	apiKey: 'k',
}
const VISION_MODEL: LLMConfig = {
	baseURL: 'https://vision.example/v1',
	model: 'vision-model',
	apiKey: 'k',
}

/**
 * A fake bridge that records what it was asked to fill and lets the test drive
 * how many pages exist. `extractPerPage[i]` is the question list for page i;
 * gotoNextPage advances until the lists run out.
 */
function makeBridge(extractPerPage: ChaoxingQuestion[][]) {
	let page = 0
	const filledBatches: ChaoxingAnswer[][] = []
	const bridge = {
		extractQuestions: vi.fn(async () => extractPerPage[page] ?? []),
		fillAnswers: vi.fn(async (answers: ChaoxingAnswer[]): Promise<FillResult[]> => {
			filledBatches.push(answers)
			return answers.map((a) => ({
				questionId: a.questionId,
				filled: !a.needsReview,
				...(a.needsReview ? { reason: 'needsReview' } : {}),
			}))
		}),
		gotoNextPage: vi.fn(async () => {
			if (page < extractPerPage.length - 1) {
				page += 1
				return true
			}
			return false
		}),
	}
	return { bridge, filledBatches }
}

/** A valid payload for each question type, per schema.ts. */
function validPayload(q: ChaoxingQuestion): Record<string, unknown> {
	switch (q.type) {
		case 'single':
		case 'judgement':
			return { selectedOptions: [q.options?.[0]?.key ?? 'A'] }
		case 'multiple':
			return { selectedOptions: [q.options?.[0]?.key ?? 'A'] }
		case 'completion':
			return { blanks: Array.from({ length: q.blanksCount ?? 1 }, (_, i) => `ans${i}`) }
		default:
			return {}
	}
}

describe('solveChaoxing', () => {
	it('routes each question to the right model and assembles answers for fillAnswers', async () => {
		const questions = [
			makeQuestion({ id: 'q0', type: 'single', options: [opt('A', 'a'), opt('B', 'b')] }),
			makeQuestion({
				id: 'q1',
				type: 'completion',
				blanksCount: 2,
				stem: [{ type: 'text', text: 'fill me' }],
			}),
		]
		const { bridge, filledBatches } = makeBridge([questions])
		const ask = vi.fn(
			async (model: LLMConfig, messages: { content: string }[], schema: z.ZodType) => {
				// every call must use the text model here
				expect(model).toBe(TEXT_MODEL)
				// identify the question by the id embedded in the serialized user message
				const userText = messages.map((m) => m.content).join('\n')
				const q = questions.find((qq) => userText.includes(qq.id))!
				return schema.parse(validPayload(q))
			},
		)

		const summary = await solveChaoxing(
			{ bridge, getModels: () => ({ text: TEXT_MODEL, vision: VISION_MODEL }), ask: ask as never },
			{ scope: 'current_page' },
		)

		expect(bridge.fillAnswers).toHaveBeenCalledTimes(1)
		const filled = filledBatches[0]
		expect(filled).toHaveLength(2)
		// answers carry questionId + type + payload merged + needsReview:false
		const a0 = filled.find((a) => a.questionId === 'q0')!
		expect(a0.type).toBe('single')
		expect(a0.selectedOptions).toEqual(['A'])
		expect(a0.needsReview).toBe(false)
		const a1 = filled.find((a) => a.questionId === 'q1')!
		expect(a1.type).toBe('completion')
		expect(a1.blanks).toEqual(['ans0', 'ans1'])
		expect(summary).toContain('2/2')
	})

	it('routes hasImages question to vision; with vision undefined → needsReview, ask NOT called for it', async () => {
		const textQ = makeQuestion({
			id: 'q0',
			type: 'single',
			options: [opt('A', 'a'), opt('B', 'b')],
		})
		const imgQ = makeQuestion({
			id: 'q1',
			type: 'single',
			hasImages: true,
			options: [opt('A', 'a'), opt('B', 'b')],
		})
		const { bridge, filledBatches } = makeBridge([[textQ, imgQ]])
		const askedModels: LLMConfig[] = []
		const ask = vi.fn(async (model: LLMConfig, _m, schema: z.ZodType) => {
			askedModels.push(model)
			return schema.parse(validPayload(textQ))
		})

		const summary = await solveChaoxing(
			{ bridge, getModels: () => ({ text: TEXT_MODEL, vision: undefined }), ask: ask as never },
			{ scope: 'current_page' },
		)

		// ask called exactly once — only for the text question, with the text model
		expect(ask).toHaveBeenCalledTimes(1)
		expect(askedModels).toEqual([TEXT_MODEL])

		const filled = filledBatches[0]
		const imgAnswer = filled.find((a) => a.questionId === 'q1')!
		expect(imgAnswer.needsReview).toBe(true)
		expect(summary).toContain('q1')
		expect(summary).toMatch(/vision/i)
	})

	it('skips ask for needsReview and unknown-type questions', async () => {
		const reviewQ = makeQuestion({ id: 'q0', type: 'single', needsReview: true })
		const unknownQ = makeQuestion({ id: 'q1', type: 'unknown' })
		const okQ = makeQuestion({ id: 'q2', type: 'single', options: [opt('A', 'a')] })
		const { bridge, filledBatches } = makeBridge([[reviewQ, unknownQ, okQ]])
		const ask = vi.fn(async (_model: LLMConfig, _m, schema: z.ZodType) =>
			schema.parse(validPayload(okQ)),
		)

		await solveChaoxing(
			{ bridge, getModels: () => ({ text: TEXT_MODEL }), ask: ask as never },
			{ scope: 'current_page' },
		)

		// ask called exactly once — only for the okQ
		expect(ask).toHaveBeenCalledTimes(1)
		const filled = filledBatches[0]
		expect(filled.find((a) => a.questionId === 'q0')!.needsReview).toBe(true)
		expect(filled.find((a) => a.questionId === 'q1')!.needsReview).toBe(true)
		expect(filled.find((a) => a.questionId === 'q2')!.needsReview).toBe(false)
	})

	it('an ask that throws makes that question needsReview (reason includes error); others still fill', async () => {
		const badQ = makeQuestion({ id: 'q0', type: 'single', options: [opt('A', 'a')] })
		const goodQ = makeQuestion({ id: 'q1', type: 'single', options: [opt('A', 'a')] })
		const { bridge, filledBatches } = makeBridge([[badQ, goodQ]])
		// With concurrency:1 the first call is q0 — throw only on that first call.
		let calls = 0
		const ask = vi.fn(async (_model: LLMConfig, _m, schema: z.ZodType) => {
			calls += 1
			if (calls === 1) throw new Error('boom')
			return schema.parse(validPayload(goodQ))
		})

		const summary = await solveChaoxing(
			{
				bridge,
				getModels: () => ({ text: TEXT_MODEL }),
				ask: ask as never,
				concurrency: 1, // deterministic ordering so the first call is q0
			},
			{ scope: 'current_page' },
		)

		const filled = filledBatches[0]
		const a0 = filled.find((a) => a.questionId === 'q0')!
		expect(a0.needsReview).toBe(true)
		const a1 = filled.find((a) => a.questionId === 'q1')!
		expect(a1.needsReview).toBe(false)
		expect(summary).toMatch(/llm_error/i)
		expect(summary).toContain('boom')
	})

	it('never exceeds the concurrency cap', async () => {
		const N = 12
		const cap = 4
		const questions = Array.from({ length: N }, (_, i) =>
			makeQuestion({ id: `q${i}`, type: 'single', options: [opt('A', 'a')] }),
		)
		const { bridge } = makeBridge([questions])

		let inFlight = 0
		let maxInFlight = 0
		const ask = vi.fn(async (_model: LLMConfig, _m, schema: z.ZodType) => {
			inFlight += 1
			maxInFlight = Math.max(maxInFlight, inFlight)
			await new Promise((r) => setTimeout(r, 5))
			inFlight -= 1
			return schema.parse(validPayload(questions[0]))
		})

		await solveChaoxing(
			{ bridge, getModels: () => ({ text: TEXT_MODEL }), ask: ask as never, concurrency: cap },
			{ scope: 'current_page' },
		)

		expect(ask).toHaveBeenCalledTimes(N)
		expect(maxInFlight).toBeLessThanOrEqual(cap)
		expect(maxInFlight).toBeGreaterThan(1) // proves it actually parallelized
	})

	it('all_pages iterates pages until gotoNextPage returns false; current_page does one page', async () => {
		const page0 = [makeQuestion({ id: 'q0', type: 'single', options: [opt('A', 'a')] })]
		const page1 = [makeQuestion({ id: 'q0', type: 'single', options: [opt('A', 'a')] })]

		// all_pages: 2 pages
		const all = makeBridge([page0, page1])
		const askAll = vi.fn(async (_m: LLMConfig, _x, schema: z.ZodType) =>
			schema.parse(validPayload(page0[0])),
		)
		await solveChaoxing(
			{ bridge: all.bridge, getModels: () => ({ text: TEXT_MODEL }), ask: askAll as never },
			{ scope: 'all_pages' },
		)
		expect(all.bridge.extractQuestions).toHaveBeenCalledTimes(2)
		expect(all.bridge.fillAnswers).toHaveBeenCalledTimes(2)
		expect(all.bridge.gotoNextPage).toHaveBeenCalled()

		// current_page: only one page even though more exist
		const single = makeBridge([page0, page1])
		const askSingle = vi.fn(async (_m: LLMConfig, _x, schema: z.ZodType) =>
			schema.parse(validPayload(page0[0])),
		)
		await solveChaoxing(
			{ bridge: single.bridge, getModels: () => ({ text: TEXT_MODEL }), ask: askSingle as never },
			{ scope: 'current_page' },
		)
		expect(single.bridge.extractQuestions).toHaveBeenCalledTimes(1)
		expect(single.bridge.gotoNextPage).not.toHaveBeenCalled()
	})

	it('summary reports completed vs needs-human counts across pages', async () => {
		const page0 = [
			makeQuestion({ id: 'q0', type: 'single', options: [opt('A', 'a')] }),
			makeQuestion({ id: 'q1', type: 'unknown' }), // needsReview
		]
		const page1 = [makeQuestion({ id: 'q0', type: 'single', options: [opt('A', 'a')] })]
		const { bridge } = makeBridge([page0, page1])
		const ask = vi.fn(async (_m: LLMConfig, _x, schema: z.ZodType) =>
			schema.parse(validPayload(page0[0])),
		)

		const summary = await solveChaoxing(
			{ bridge, getModels: () => ({ text: TEXT_MODEL }), ask: ask as never },
			{ scope: 'all_pages' },
		)

		// 3 questions total across 2 pages, 2 filled, 1 needs review
		expect(summary).toContain('2/3')
		expect(summary).toMatch(/1/) // K=1 needs human
		expect(summary).toContain('q1')
		// must never claim auto-submit
		expect(summary).not.toMatch(/已提交|auto.?submit/i)
	})
})
