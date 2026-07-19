import type { LLMConfig } from '@page-agent/llms'
import { describe, expect, it, vi } from 'vitest'

import {
	AnswerModelError,
	answerQuestionWithModel,
	askStructuredAnswer,
	resolveQuestionSolverModels,
	schemaForAnswerQuestion,
	serializeQuestionForAnswerModel,
	type AnswerModelContentBlock,
	type ModelAnswerPayload,
} from './answerModel'
import type { ImageAssetRef, Question } from './contracts'

const QUESTION_HASH = '1'.repeat(64)
const SUB_HASH = '2'.repeat(64)

const textModel: LLMConfig = {
	baseURL: 'https://models.example/v1',
	model: 'text-model',
	apiKey: 'sk-never-log-this',
}
const visionModel: LLMConfig = {
	baseURL: 'https://vision.example/v1',
	model: 'vision-model',
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
	return {
		locator: {
			platform: 'synthetic',
			variant: 'contract',
			adapterVersion: 1,
			tabId: 10,
			frameId: 0,
			attemptId: 'attempt-1',
			platformQuestionId: 'question-1',
			fingerprint: QUESTION_HASH,
		},
		type: 'single',
		stem: [{ type: 'text', text: '题干' }],
		options: [
			{ key: 'A', platformId: 'oa', content: [{ type: 'text', text: '甲' }] },
			{ key: 'B', platformId: 'ob', content: [{ type: 'text', text: '乙' }] },
		],
		hasRequiredVisuals: false,
		visibility: 'fully_visible',
		visualAnchorKeys: [],
		extractionWarnings: [],
		...overrides,
	}
}

function makePayload(
	selectedOptions: string[],
	confidence: number,
	questionFingerprint = QUESTION_HASH,
): ModelAnswerPayload {
	return {
		answer: {
			questionFingerprint,
			type: 'single',
			selectedOptions,
		},
		confidence,
	}
}

function toolResponse(payload: unknown): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						tool_calls: [
							{
								function: {
									name: 'submit_answer',
									arguments: JSON.stringify(payload),
								},
							},
						],
					},
				},
			],
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	)
}

describe('resolveQuestionSolverModels', () => {
	it('resolves each field through explicit, legacy, then Agent text priority', () => {
		const explicitVision = { ...visionModel, model: 'explicit-vision' }
		const legacyText = { ...textModel, model: 'legacy-text' }
		const resolved = resolveQuestionSolverModels({
			questionSolverModels: { vision: explicitVision },
			chaoxingModels: { text: legacyText, vision: visionModel },
			agentTextModel: textModel,
		})

		expect(resolved).toEqual({ text: legacyText, vision: explicitVision })
	})

	it('does not use an observation model as a solver vision fallback', () => {
		expect(resolveQuestionSolverModels({ agentTextModel: textModel })).toEqual({
			text: textModel,
			vision: undefined,
		})
	})
})

describe('serializeQuestionForAnswerModel', () => {
	it('keeps material, stem, options, and sub-question content in exact order', async () => {
		const sub = makeQuestion({
			locator: {
				...makeQuestion().locator,
				platformQuestionId: 'sub-1',
				fingerprint: SUB_HASH,
			},
			stem: [{ type: 'text', text: '小题题干' }],
		})
		const question = makeQuestion({
			type: 'reader',
			material: [{ type: 'text', text: '共享材料' }],
			stem: [{ type: 'text', text: '总题干' }],
			options: [{ key: 'M', content: [{ type: 'text', text: '根选项' }] }],
			subQuestions: [sub],
		})

		const serialized = await serializeQuestionForAnswerModel(question, {
			signal: new AbortController().signal,
		})
		const content = serialized.messages[1].content as string

		expect(serialized.route).toBe('text')
		expect(content.indexOf('共享材料')).toBeLessThan(content.indexOf('总题干'))
		expect(content.indexOf('总题干')).toBeLessThan(content.indexOf('根选项'))
		expect(content.indexOf('根选项')).toBeLessThan(content.indexOf('小题题干'))
		expect(content).toContain('[root/sub:0]')
	})

	it('interleaves image blocks at their owning path and emits a shared asset once', async () => {
		const asset: ImageAssetRef = {
			assetId: 'asset-1234567890123456',
			runId: 'run-1',
			questionFingerprint: QUESTION_HASH,
			sha256: 'a'.repeat(64),
			mimeType: 'image/png',
			width: 200,
			height: 100,
			byteLength: 10,
		}
		const sharedImage = {
			type: 'image' as const,
			label: '材料图',
			anchorKey: 'anchor-1',
			asset,
			requiredForAnswer: true,
			resolution: 'inline' as const,
		}
		const sub = makeQuestion({
			locator: { ...makeQuestion().locator, fingerprint: SUB_HASH },
			stem: [sharedImage, { type: 'text', text: '小题文字' }],
			hasRequiredVisuals: true,
		})
		const question = makeQuestion({
			type: 'reader',
			material: [{ type: 'text', text: '材料开头' }, sharedImage],
			stem: [{ type: 'text', text: '根题干' }],
			options: [],
			subQuestions: [sub],
			hasRequiredVisuals: true,
		})
		const resolveImageAsset = vi.fn(async () => 'data:image/png;base64,AAAA')

		const serialized = await serializeQuestionForAnswerModel(question, {
			signal: new AbortController().signal,
			resolveImageAsset,
		})
		const blocks = serialized.messages[1].content as AnswerModelContentBlock[]
		const imageBlocks = blocks.filter((block) => block.type === 'image_url')
		const text = blocks
			.filter(
				(block): block is Extract<AnswerModelContentBlock, { type: 'text' }> =>
					block.type === 'text',
			)
			.map((block) => block.text)

		expect(serialized.route).toBe('vision')
		expect(resolveImageAsset).toHaveBeenCalledOnce()
		expect(imageBlocks).toHaveLength(1)
		expect(text.indexOf('[root/material/part:1:image] 材料图')).toBeLessThan(
			text.indexOf('[root/stem/part:0:text] 根题干'),
		)
		expect(text).toContain('[shared-image-ref] 材料图')
	})
})

describe('askStructuredAnswer', () => {
	it('forces submit_answer with a per-question JSON schema', async () => {
		const question = makeQuestion()
		const fetchImpl = vi.fn().mockResolvedValue(toolResponse(makePayload(['B'], 0.9)))
		const messages = [
			{ role: 'system' as const, content: 'system' },
			{ role: 'user' as const, content: 'question' },
		]

		await expect(
			askStructuredAnswer(textModel, messages, schemaForAnswerQuestion(question), {
				signal: new AbortController().signal,
				fetchImpl,
			}),
		).resolves.toEqual(makePayload(['B'], 0.9))

		const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
		expect(body.temperature).toBe(0)
		expect(body.tool_choice).toEqual({
			type: 'function',
			function: { name: 'submit_answer' },
		})
		expect(body.tools[0].function.name).toBe('submit_answer')
		expect(JSON.stringify(body.tools[0].function.parameters)).toContain(QUESTION_HASH)
	})

	it('remembers named-tool rejection and retries once with required', async () => {
		const onNamedToolChoiceUnsupported = vi.fn(async () => {})
		const config: LLMConfig = { ...textModel, onNamedToolChoiceUnsupported }
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: {
							param: 'tool_choice',
							message: "Invalid tool_choice type: 'object'; expected string",
						},
					}),
					{ status: 422, headers: { 'Content-Type': 'application/json' } },
				),
			)
			.mockResolvedValueOnce(toolResponse(makePayload(['A'], 0.9)))

		await askStructuredAnswer(
			config,
			[{ role: 'user', content: 'question' }],
			schemaForAnswerQuestion(makeQuestion()),
			{ signal: new AbortController().signal, fetchImpl },
		)

		expect(fetchImpl).toHaveBeenCalledTimes(2)
		expect(JSON.parse(fetchImpl.mock.calls[1][1].body).tool_choice).toBe('required')
		expect(onNamedToolChoiceUnsupported).toHaveBeenCalledOnce()
	})

	it('keeps Qwen text thinking enabled while using its auto compatibility path', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(toolResponse(makePayload(['A'], 0.9)))
		await askStructuredAnswer(
			{ ...textModel, model: 'qwen-plus' },
			[{ role: 'user', content: 'question' }],
			schemaForAnswerQuestion(makeQuestion()),
			{ signal: new AbortController().signal, fetchImpl },
		)

		const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
		expect(body.enable_thinking).toBe(true)
		expect(body.tool_choice).toBe('auto')
	})

	it('returns API-key-safe diagnostics for provider errors', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'secret response sk-provider-body' } }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			}),
		)
		const promise = askStructuredAnswer(
			textModel,
			[{ role: 'user', content: 'question' }],
			schemaForAnswerQuestion(makeQuestion()),
			{ signal: new AbortController().signal, fetchImpl },
		)

		await expect(promise).rejects.toMatchObject({ code: 'model_http_error', status: 401 })
		await promise.catch((error) => {
			expect(String(error)).not.toContain('sk-provider-body')
			expect(String(error)).not.toContain('sk-never-log-this')
		})
	})
})

describe('answerQuestionWithModel', () => {
	it('routes required visuals only to the vision model', async () => {
		const ask = vi.fn()
		const question = makeQuestion({ hasRequiredVisuals: true })
		const result = await answerQuestionWithModel(question, {
			models: { text: textModel },
			signal: new AbortController().signal,
			ask,
		})

		expect(result).toMatchObject({
			status: 'review',
			route: 'vision',
			code: 'vision_model_unavailable',
		})
		expect(ask).not.toHaveBeenCalled()
	})

	it('accepts confidence at or above 0.75 and normalizes multiple-choice order', async () => {
		const question = makeQuestion({ type: 'multiple' })
		const ask = vi.fn(async () => ({
			answer: {
				questionFingerprint: QUESTION_HASH,
				type: 'multiple' as const,
				selectedOptions: ['B', 'A'],
			},
			confidence: 0.75,
		}))
		const result = await answerQuestionWithModel(question, {
			models: { text: textModel },
			signal: new AbortController().signal,
			ask,
		})

		expect(result).toMatchObject({
			status: 'accepted',
			rechecked: false,
			answer: {
				selectedOptions: ['A', 'B'],
				evidence: { source: 'llm_text', modelConfidence: 0.75 },
			},
		})
	})

	it('rechecks 0.55–0.75 once and accepts only the same answer at high confidence', async () => {
		const ask = vi
			.fn()
			.mockResolvedValueOnce(makePayload(['B'], 0.6))
			.mockResolvedValueOnce(makePayload(['B'], 0.91))
		const result = await answerQuestionWithModel(makeQuestion(), {
			models: { text: textModel },
			signal: new AbortController().signal,
			ask,
		})

		expect(ask).toHaveBeenCalledTimes(2)
		expect(ask.mock.calls[1][1].at(-1)).toMatchObject({
			role: 'user',
			content: expect.stringContaining('独立复核'),
		})
		expect(result).toMatchObject({
			status: 'accepted',
			rechecked: true,
			answer: { evidence: { warnings: ['model_low_confidence_rechecked'] } },
		})
	})

	it('does not accept a discordant recheck', async () => {
		const ask = vi
			.fn()
			.mockResolvedValueOnce(makePayload(['A'], 0.6))
			.mockResolvedValueOnce(makePayload(['B'], 0.95))

		await expect(
			answerQuestionWithModel(makeQuestion(), {
				models: { text: textModel },
				signal: new AbortController().signal,
				ask,
			}),
		).resolves.toMatchObject({ status: 'review', code: 'model_recheck_disagreed' })
	})

	it('marks confidence below 0.55 for review without another request', async () => {
		const ask = vi.fn().mockResolvedValue(makePayload(['A'], 0.54))
		const result = await answerQuestionWithModel(makeQuestion(), {
			models: { text: textModel },
			signal: new AbortController().signal,
			ask,
		})

		expect(result).toMatchObject({ status: 'review', code: 'model_confidence_too_low' })
		expect(ask).toHaveBeenCalledOnce()
	})

	it('retries one malformed structured response and preserves message order', async () => {
		const ask = vi
			.fn()
			.mockRejectedValueOnce(new AnswerModelError('model_schema_invalid', true))
			.mockResolvedValueOnce(makePayload(['A'], 0.9))
		const result = await answerQuestionWithModel(makeQuestion(), {
			models: { text: textModel },
			signal: new AbortController().signal,
			ask,
		})

		expect(result.status).toBe('accepted')
		expect(ask).toHaveBeenCalledTimes(2)
		expect(ask.mock.calls[1][1].at(-1)).toMatchObject({
			role: 'user',
			content: expect.stringContaining('上一次响应'),
		})
	})

	it('rejects malformed sub-question paths after the single schema retry', async () => {
		const sub = makeQuestion({
			locator: { ...makeQuestion().locator, fingerprint: SUB_HASH },
		})
		const question = makeQuestion({ type: 'reader', options: [], subQuestions: [sub] })
		const malformed = {
			answer: {
				questionFingerprint: QUESTION_HASH,
				type: 'reader',
				subAnswers: [makePayload(['A'], 0.9, '3'.repeat(64)).answer],
			},
			confidence: 0.9,
		}
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(toolResponse(malformed))
			.mockResolvedValueOnce(toolResponse(malformed))

		const result = await answerQuestionWithModel(question, {
			models: { text: textModel },
			signal: new AbortController().signal,
			fetchImpl,
		})

		expect(result).toMatchObject({ status: 'review', code: 'model_schema_invalid' })
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})

	it('propagates AbortSignal cancellation', async () => {
		const controller = new AbortController()
		const reason = new DOMException('cancelled', 'AbortError')
		controller.abort(reason)

		await expect(
			answerQuestionWithModel(makeQuestion(), {
				models: { text: textModel },
				signal: controller.signal,
			}),
		).rejects.toBe(reason)
	})
})
