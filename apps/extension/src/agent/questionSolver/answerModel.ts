import {
	hasNamedToolChoice,
	isNamedToolChoiceCompatibilityError,
	rememberNamedToolChoiceUnsupported,
	shouldDisableNamedToolChoice,
	type LLMConfig,
} from '@page-agent/llms'
import * as z from 'zod/v4'

import type {
	ContentPart,
	ImageAssetRef,
	Question,
	QuestionSolverModels,
	QuestionType,
	StructuredAnswer,
} from './contracts'

const TOOL_NAME = 'submit_answer'
const ACCEPT_CONFIDENCE = 0.75
const RECHECK_CONFIDENCE = 0.55

const SYSTEM_PROMPT =
	'你是通用题目求解器。严格依据题块内容作答，保留题目 path 和选项 key，' +
	'并调用 submit_answer 返回完整结构化答案；不得返回解释、DOM 定位或 JavaScript。'
const SCHEMA_RETRY_PROMPT =
	'上一次响应没有满足 submit_answer 的结构。请重新检查题目，并只调用 submit_answer。'
const CONFIDENCE_RECHECK_PROMPT =
	'请独立复核整道题，尤其检查不确定点。仍须调用 submit_answer 返回完整答案和置信度。'

export type AnswerModelRoute = 'text' | 'vision'

export type AnswerModelContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } }

export interface AnswerModelMessage {
	role: 'system' | 'user'
	content: string | AnswerModelContentBlock[]
}

export interface ModelAnswerNode {
	questionFingerprint: string
	type: QuestionType
	selectedOptions?: string[]
	blanks?: Array<{ key: string; value: string }>
	dropdowns?: Array<{ key: string; optionKey: string }>
	linePairs?: Array<{ leftKey: string; rightKey: string }>
	subAnswers?: ModelAnswerNode[]
}

export interface ModelAnswerPayload {
	answer: ModelAnswerNode
	confidence: number
}

export interface SerializedAnswerQuestion {
	route: AnswerModelRoute
	messages: AnswerModelMessage[]
}

export interface QuestionSolverModelSources {
	questionSolverModels?: Partial<QuestionSolverModels>
	chaoxingModels?: Partial<QuestionSolverModels>
	agentTextModel?: LLMConfig
}

export interface AnswerModelAskOptions {
	signal: AbortSignal
	fetchImpl?: typeof fetch
}

export type AnswerModelInvoker = (
	config: LLMConfig,
	messages: AnswerModelMessage[],
	schema: z.ZodType<ModelAnswerPayload>,
	options: AnswerModelAskOptions,
) => Promise<ModelAnswerPayload>

export interface AnswerQuestionWithModelOptions {
	models: { text?: LLMConfig; vision?: LLMConfig }
	signal: AbortSignal
	resolveImageAsset?: (asset: ImageAssetRef, signal: AbortSignal) => Promise<string>
	fetchImpl?: typeof fetch
	ask?: AnswerModelInvoker
}

export type AnswerModelResolution =
	| {
			status: 'accepted'
			route: AnswerModelRoute
			answer: StructuredAnswer
			rechecked: boolean
	  }
	| {
			status: 'review'
			route: AnswerModelRoute
			code: string
			retryable: boolean
	  }

export class AnswerModelError extends Error {
	constructor(
		readonly code: string,
		readonly retryable: boolean,
		readonly status?: number,
	) {
		super(code)
		this.name = 'AnswerModelError'
	}
}

export function resolveQuestionSolverModels(sources: QuestionSolverModelSources): {
	text?: LLMConfig
	vision?: LLMConfig
} {
	return {
		text:
			sources.questionSolverModels?.text ?? sources.chaoxingModels?.text ?? sources.agentTextModel,
		vision: sources.questionSolverModels?.vision ?? sources.chaoxingModels?.vision,
	}
}

export async function serializeQuestionForAnswerModel(
	question: Question,
	options: Pick<AnswerQuestionWithModelOptions, 'signal' | 'resolveImageAsset'>,
): Promise<SerializedAnswerQuestion> {
	throwIfAborted(options.signal)
	const route = questionNeedsVision(question) ? 'vision' : 'text'
	if (route === 'text') {
		const lines: string[] = []
		appendTextQuestion(question, 'root', lines)
		return {
			route,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: lines.join('\n') },
			],
		}
	}

	if (!options.resolveImageAsset) {
		throw new AnswerModelError('required_visual_unavailable', false)
	}

	const blocks: AnswerModelContentBlock[] = []
	const visualState: VisualSerializationState = {
		resolveImageAsset: options.resolveImageAsset,
		signal: options.signal,
		seenAssets: new Map(),
		requiredVisualCount: 0,
		resolvedRequiredVisualCount: 0,
	}
	await appendVisualQuestion(question, 'root', blocks, visualState)
	if (
		visualState.requiredVisualCount === 0 ||
		visualState.requiredVisualCount !== visualState.resolvedRequiredVisualCount
	) {
		throw new AnswerModelError('required_visual_unavailable', false)
	}

	return {
		route,
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: blocks },
		],
	}
}

export function schemaForAnswerQuestion(question: Question): z.ZodType<ModelAnswerPayload> {
	return z
		.object({
			answer: schemaForAnswerNode(question),
			confidence: z.number().min(0).max(1),
		})
		.strict() as z.ZodType<ModelAnswerPayload>
}

export async function askStructuredAnswer(
	config: LLMConfig,
	messages: AnswerModelMessage[],
	schema: z.ZodType<ModelAnswerPayload>,
	options: AnswerModelAskOptions,
): Promise<ModelAnswerPayload> {
	throwIfAborted(options.signal)
	const tool = {
		type: 'function' as const,
		function: {
			name: TOOL_NAME,
			description: '提交当前顶层题块的完整结构化答案',
			parameters: z.toJSONSchema(schema, { target: 'openapi-3.0' }),
		},
	}
	const hasImages = messages.some((message) => Array.isArray(message.content))
	const qwenLike = isQwenLike(config)
	const body: Record<string, unknown> = {
		model: config.model,
		messages,
		temperature: 0,
		tools: [tool],
		tool_choice: shouldDisableNamedToolChoice(config)
			? 'required'
			: { type: 'function', function: { name: TOOL_NAME } },
	}
	if (qwenLike) {
		body.enable_thinking = true
		if (!hasImages) body.tool_choice = 'auto'
	}

	const sentNamedToolChoice = !shouldDisableNamedToolChoice(config) && hasNamedToolChoice(body)
	let response = await postChatCompletion(config, body, options)
	if (response.status === 400 || response.status === 422) {
		const data = await readResponseJson(response)
		if (sentNamedToolChoice && isNamedToolChoiceCompatibilityError(response.status, data)) {
			await rememberNamedToolChoiceUnsupported(config)
			return askStructuredAnswer(config, messages, schema, options)
		}
		if (qwenLike && isThinkingToolChoiceError(data)) {
			response = await postChatCompletion(config, { ...body, tool_choice: 'auto' }, options)
		} else {
			throw new AnswerModelError(
				'model_http_error',
				isRetryableStatus(response.status),
				response.status,
			)
		}
	}

	if (!response.ok) {
		throw new AnswerModelError(
			'model_http_error',
			isRetryableStatus(response.status),
			response.status,
		)
	}

	const data = await readResponseJson(response)
	if (sentNamedToolChoice && isNamedToolChoiceCompatibilityError(response.status, data)) {
		await rememberNamedToolChoiceUnsupported(config)
		return askStructuredAnswer(config, messages, schema, options)
	}
	const rawArguments = extractToolArguments(data)
	if (rawArguments === undefined) {
		throw new AnswerModelError('model_missing_tool_call', true)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(rawArguments)
	} catch {
		throw new AnswerModelError('model_arguments_invalid', true)
	}
	const result = schema.safeParse(parsed)
	if (!result.success) {
		throw new AnswerModelError('model_schema_invalid', true)
	}
	return result.data
}

export async function answerQuestionWithModel(
	question: Question,
	options: AnswerQuestionWithModelOptions,
): Promise<AnswerModelResolution> {
	throwIfAborted(options.signal)
	const route: AnswerModelRoute = questionNeedsVision(question) ? 'vision' : 'text'
	const model = route === 'vision' ? options.models.vision : options.models.text
	if (!model) {
		return {
			status: 'review',
			route,
			code: route === 'vision' ? 'vision_model_unavailable' : 'text_model_unavailable',
			retryable: false,
		}
	}

	try {
		const serialized = await serializeQuestionForAnswerModel(question, options)
		const schema = schemaForAnswerQuestion(question)
		const ask = options.ask ?? askStructuredAnswer
		const askOptions: AnswerModelAskOptions = {
			signal: options.signal,
			fetchImpl: options.fetchImpl,
		}
		const first = normalizePayload(
			question,
			await askWithSchemaRetry(ask, model, serialized.messages, schema, askOptions),
		)

		if (first.confidence >= ACCEPT_CONFIDENCE) {
			return {
				status: 'accepted',
				route,
				answer: toStructuredAnswer(question, first.answer, route, first.confidence, []),
				rechecked: false,
			}
		}
		if (first.confidence < RECHECK_CONFIDENCE) {
			return {
				status: 'review',
				route,
				code: 'model_confidence_too_low',
				retryable: false,
			}
		}

		const recheckMessages = [
			...serialized.messages,
			{ role: 'user' as const, content: CONFIDENCE_RECHECK_PROMPT },
		]
		const second = normalizePayload(
			question,
			await askWithSchemaRetry(ask, model, recheckMessages, schema, askOptions),
		)
		if (
			second.confidence < ACCEPT_CONFIDENCE ||
			canonicalAnswer(first.answer) !== canonicalAnswer(second.answer)
		) {
			return {
				status: 'review',
				route,
				code: 'model_recheck_disagreed',
				retryable: false,
			}
		}

		return {
			status: 'accepted',
			route,
			answer: toStructuredAnswer(question, second.answer, route, second.confidence, [
				'model_low_confidence_rechecked',
			]),
			rechecked: true,
		}
	} catch (error) {
		if (isAbortError(error) || options.signal.aborted) throw error
		if (error instanceof AnswerModelError) {
			return {
				status: 'review',
				route,
				code: error.code,
				retryable: error.retryable,
			}
		}
		return { status: 'review', route, code: 'model_request_failed', retryable: true }
	}
}

async function askWithSchemaRetry(
	ask: AnswerModelInvoker,
	config: LLMConfig,
	messages: AnswerModelMessage[],
	schema: z.ZodType<ModelAnswerPayload>,
	options: AnswerModelAskOptions,
): Promise<ModelAnswerPayload> {
	try {
		return await ask(config, messages, schema, options)
	} catch (error) {
		if (isAbortError(error) || options.signal.aborted) throw error
		if (!(error instanceof AnswerModelError) || !isSchemaResponseError(error.code)) throw error
		return await ask(
			config,
			[...messages, { role: 'user', content: SCHEMA_RETRY_PROMPT }],
			schema,
			options,
		)
	}
}

function schemaForAnswerNode(question: Question): z.ZodType<ModelAnswerNode> {
	const identity = {
		questionFingerprint: z.literal(question.locator.fingerprint),
		type: z.literal(question.type),
	}
	if (
		(question.type === 'fill' || question.type === 'reader') &&
		question.subQuestions &&
		question.subQuestions.length > 0
	) {
		const subSchemas = question.subQuestions.map(schemaForAnswerNode)
		const subSchema =
			subSchemas.length === 1
				? subSchemas[0]
				: z.union(
						subSchemas as [
							z.ZodType<ModelAnswerNode>,
							z.ZodType<ModelAnswerNode>,
							...z.ZodType<ModelAnswerNode>[],
						],
					)
		return z
			.object({
				...identity,
				subAnswers: z
					.array(subSchema)
					.length(question.subQuestions.length)
					.superRefine((answers, ctx) => {
						for (let index = 0; index < question.subQuestions!.length; index++) {
							const expected = question.subQuestions![index].locator.fingerprint
							if (answers[index]?.questionFingerprint !== expected) {
								ctx.addIssue({
									code: 'custom',
									message: `subAnswers[${index}] path mismatch`,
								})
							}
						}
					}),
			})
			.strict() as z.ZodType<ModelAnswerNode>
	}

	switch (question.type) {
		case 'single':
		case 'judgement':
			return z
				.object({
					...identity,
					selectedOptions: z.array(enumFor(optionKeys(question))).length(1),
				})
				.strict() as z.ZodType<ModelAnswerNode>
		case 'multiple': {
			const keys = optionKeys(question)
			return z
				.object({
					...identity,
					selectedOptions: z
						.array(enumFor(keys))
						.min(1)
						.max(keys.length)
						.refine((values) => new Set(values).size === values.length),
				})
				.strict() as z.ZodType<ModelAnswerNode>
		}
		case 'completion':
		case 'fill':
		case 'translation':
			return z
				.object({ ...identity, blanks: blankAnswerSchema(question) })
				.strict() as z.ZodType<ModelAnswerNode>
		case 'dropdown':
			return z
				.object({ ...identity, dropdowns: dropdownAnswerSchema(question) })
				.strict() as z.ZodType<ModelAnswerNode>
		case 'line':
			return z
				.object({ ...identity, linePairs: lineAnswerSchema(question) })
				.strict() as z.ZodType<ModelAnswerNode>
		case 'reader':
		case 'unknown':
		default:
			throw new AnswerModelError('question_schema_unsupported', false)
	}
}

function blankAnswerSchema(question: Question) {
	const keys = blankKeys(question)
	const item = z.object({ key: enumFor(keys), value: z.string().max(2_000) }).strict()
	return z
		.array(item)
		.length(keys.length)
		.superRefine((answers, ctx) =>
			requireExactKeys(
				answers.map((answer) => answer.key),
				keys,
				ctx,
			),
		)
}

function dropdownAnswerSchema(question: Question) {
	const keys = blankKeys(question)
	const options = optionKeys(question)
	const item = z.object({ key: enumFor(keys), optionKey: enumFor(options) }).strict()
	return z
		.array(item)
		.length(keys.length)
		.superRefine((answers, ctx) =>
			requireExactKeys(
				answers.map((answer) => answer.key),
				keys,
				ctx,
			),
		)
}

function lineAnswerSchema(question: Question) {
	const subs = question.subQuestions ?? []
	if (subs.length === 0) throw new AnswerModelError('question_schema_invalid', false)
	const leftKeys = subs.map((sub) => sub.locator.fingerprint)
	const rightKeys = [...new Set(subs.flatMap(optionKeys))]
	const item = z.object({ leftKey: enumFor(leftKeys), rightKey: enumFor(rightKeys) }).strict()
	return z
		.array(item)
		.length(leftKeys.length)
		.superRefine((pairs, ctx) => {
			requireExactKeys(
				pairs.map((pair) => pair.leftKey),
				leftKeys,
				ctx,
			)
			for (const pair of pairs) {
				const sub = subs.find((candidate) => candidate.locator.fingerprint === pair.leftKey)
				if (!sub || !optionKeys(sub).includes(pair.rightKey)) {
					ctx.addIssue({ code: 'custom', message: 'rightKey is not valid for leftKey' })
				}
			}
		})
}

function enumFor(values: string[]) {
	if (values.length === 0) throw new AnswerModelError('question_schema_invalid', false)
	return z.enum(values as [string, ...string[]])
}

function requireExactKeys(
	actual: string[],
	expected: string[],
	ctx: z.core.$RefinementCtx<unknown>,
): void {
	if (new Set(actual).size !== actual.length || actual.some((key) => !expected.includes(key))) {
		ctx.addIssue({ code: 'custom', message: 'answer keys must match the question exactly' })
	}
}

function normalizePayload(question: Question, payload: ModelAnswerPayload): ModelAnswerPayload {
	return {
		confidence: payload.confidence,
		answer: normalizeAnswerNode(question, payload.answer),
	}
}

function normalizeAnswerNode(question: Question, answer: ModelAnswerNode): ModelAnswerNode {
	const normalized: ModelAnswerNode = {
		questionFingerprint: answer.questionFingerprint,
		type: answer.type,
	}
	if (answer.selectedOptions) {
		const order = optionKeys(question)
		normalized.selectedOptions = [...answer.selectedOptions].sort(
			(left, right) => order.indexOf(left) - order.indexOf(right),
		)
	}
	if (answer.blanks) {
		const order = blankKeys(question)
		normalized.blanks = [...answer.blanks].sort(
			(left, right) => order.indexOf(left.key) - order.indexOf(right.key),
		)
	}
	if (answer.dropdowns) {
		const order = blankKeys(question)
		normalized.dropdowns = [...answer.dropdowns].sort(
			(left, right) => order.indexOf(left.key) - order.indexOf(right.key),
		)
	}
	if (answer.linePairs) {
		const order = (question.subQuestions ?? []).map((sub) => sub.locator.fingerprint)
		normalized.linePairs = [...answer.linePairs].sort(
			(left, right) => order.indexOf(left.leftKey) - order.indexOf(right.leftKey),
		)
	}
	if (answer.subAnswers) {
		normalized.subAnswers = answer.subAnswers.map((subAnswer, index) =>
			normalizeAnswerNode(question.subQuestions![index], subAnswer),
		)
	}
	return normalized
}

function toStructuredAnswer(
	question: Question,
	answer: ModelAnswerNode,
	route: AnswerModelRoute,
	confidence: number,
	warnings: string[],
): StructuredAnswer {
	return {
		questionFingerprint: question.locator.fingerprint,
		type: question.type,
		selectedOptions: answer.selectedOptions,
		blanks: answer.blanks,
		dropdowns: answer.dropdowns,
		linePairs: answer.linePairs,
		subAnswers: answer.subAnswers?.map((subAnswer, index) =>
			toStructuredAnswer(question.subQuestions![index], subAnswer, route, confidence, warnings),
		),
		evidence: {
			source: route === 'vision' ? 'llm_vision' : 'llm_text',
			questionFingerprint: question.locator.fingerprint,
			attemptId: question.locator.attemptId,
			mappingConfidence: 1,
			modelConfidence: confidence,
			warnings: [...warnings],
		},
	}
}

function appendTextQuestion(question: Question, path: string, lines: string[]): void {
	lines.push(`[${path}] type=${question.type} fingerprint=${question.locator.fingerprint}`)
	appendTextParts(question.material, `${path}/material`, lines)
	appendTextParts(question.stem, `${path}/stem`, lines)
	if (question.options.length > 0) {
		lines.push(`[${path}/options]`)
		for (const option of question.options) {
			lines.push(`[${path}/option:${option.key}]`)
			appendTextParts(option.content, `${path}/option:${option.key}`, lines, false)
		}
	}
	if (question.blanks && question.blanks.length > 0) {
		lines.push(`[${path}/blanks] ${question.blanks.map((blank) => blank.key).join(',')}`)
	}
	for (let index = 0; index < (question.subQuestions?.length ?? 0); index++) {
		appendTextQuestion(question.subQuestions![index], `${path}/sub:${index}`, lines)
	}
}

function appendTextParts(
	parts: ContentPart[] | undefined,
	path: string,
	lines: string[],
	includeSection = true,
): void {
	if (!parts || parts.length === 0) return
	if (includeSection) lines.push(`[${path}]`)
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index]
		if (part.type === 'text') {
			lines.push(`[${path}/part:${index}:text] ${part.text}`)
		} else {
			lines.push(`[${path}/part:${index}:image] ${part.label}`)
		}
	}
}

interface VisualSerializationState {
	resolveImageAsset: (asset: ImageAssetRef, signal: AbortSignal) => Promise<string>
	signal: AbortSignal
	seenAssets: Map<string, string>
	requiredVisualCount: number
	resolvedRequiredVisualCount: number
}

async function appendVisualQuestion(
	question: Question,
	path: string,
	blocks: AnswerModelContentBlock[],
	state: VisualSerializationState,
): Promise<void> {
	blocks.push({
		type: 'text',
		text: `[${path}] type=${question.type} fingerprint=${question.locator.fingerprint}`,
	})
	await appendVisualParts(question.material, `${path}/material`, blocks, state)
	await appendVisualParts(question.stem, `${path}/stem`, blocks, state)
	if (question.options.length > 0) {
		blocks.push({ type: 'text', text: `[${path}/options]` })
		for (const option of question.options) {
			blocks.push({ type: 'text', text: `[${path}/option:${option.key}]` })
			await appendVisualParts(option.content, `${path}/option:${option.key}`, blocks, state, false)
		}
	}
	if (question.blanks && question.blanks.length > 0) {
		blocks.push({
			type: 'text',
			text: `[${path}/blanks] ${question.blanks.map((blank) => blank.key).join(',')}`,
		})
	}
	for (let index = 0; index < (question.subQuestions?.length ?? 0); index++) {
		await appendVisualQuestion(question.subQuestions![index], `${path}/sub:${index}`, blocks, state)
	}
}

async function appendVisualParts(
	parts: ContentPart[] | undefined,
	path: string,
	blocks: AnswerModelContentBlock[],
	state: VisualSerializationState,
	includeSection = true,
): Promise<void> {
	if (!parts || parts.length === 0) return
	if (includeSection) blocks.push({ type: 'text', text: `[${path}]` })
	for (let index = 0; index < parts.length; index++) {
		throwIfAborted(state.signal)
		const part = parts[index]
		if (part.type === 'text') {
			blocks.push({ type: 'text', text: `[${path}/part:${index}:text] ${part.text}` })
			continue
		}
		blocks.push({ type: 'text', text: `[${path}/part:${index}:image] ${part.label}` })
		if (part.requiredForAnswer) state.requiredVisualCount++
		if (part.resolution === 'failed' || !part.asset) {
			if (part.requiredForAnswer) throw new AnswerModelError('required_visual_unavailable', false)
			continue
		}
		const previousLabel = state.seenAssets.get(part.asset.assetId)
		if (previousLabel) {
			blocks.push({ type: 'text', text: `[shared-image-ref] ${previousLabel}` })
			if (part.requiredForAnswer) state.resolvedRequiredVisualCount++
			continue
		}
		const dataUrl = await state.resolveImageAsset(part.asset, state.signal)
		throwIfAborted(state.signal)
		if (!isMatchingImageDataUrl(dataUrl, part.asset.mimeType)) {
			throw new AnswerModelError('image_asset_invalid', false)
		}
		state.seenAssets.set(part.asset.assetId, part.label)
		blocks.push({ type: 'image_url', image_url: { url: dataUrl } })
		if (part.requiredForAnswer) state.resolvedRequiredVisualCount++
	}
}

async function postChatCompletion(
	config: LLMConfig,
	body: Record<string, unknown>,
	options: AnswerModelAskOptions,
): Promise<Response> {
	throwIfAborted(options.signal)
	const requestBody = { ...body }
	const transformed = config.transformRequestBody?.(requestBody)
	const finalBody = transformed ?? requestBody
	const fetchImpl = options.fetchImpl ?? config.customFetch ?? globalThis.fetch
	try {
		return await fetchImpl.call(
			globalThis,
			`${config.baseURL.replace(/\/+$/, '')}/chat/completions`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
				},
				body: JSON.stringify(finalBody),
				signal: options.signal,
			},
		)
	} catch (error) {
		if (isAbortError(error) || options.signal.aborted) throw error
		throw new AnswerModelError('model_transport_error', true)
	}
}

async function readResponseJson(response: Response): Promise<unknown> {
	try {
		return await response.json()
	} catch (error) {
		if (isAbortError(error)) throw error
		throw new AnswerModelError('model_response_invalid', true, response.status)
	}
}

function extractToolArguments(data: unknown): string | undefined {
	const choices = readRecord(data)?.choices
	if (!Array.isArray(choices)) return undefined
	const message = readRecord(readRecord(choices[0])?.message)
	const toolCalls = message?.tool_calls
	if (!Array.isArray(toolCalls)) return undefined
	for (const toolCall of toolCalls) {
		const fn = readRecord(readRecord(toolCall)?.function)
		if (fn?.name === TOOL_NAME && typeof fn.arguments === 'string') return fn.arguments
	}
	return undefined
}

function isThinkingToolChoiceError(data: unknown): boolean {
	const error = readRecord(readRecord(data)?.error)
	const message = typeof error?.message === 'string' ? error.message : ''
	return /tool_choice/i.test(message) && /think|reason/i.test(message)
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: undefined
}

function isQwenLike(config: LLMConfig): boolean {
	return /dashscope|aliyuncs/i.test(config.baseURL) || /^qwen/i.test(config.model)
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 409 || status === 429 || status >= 500
}

function isSchemaResponseError(code: string): boolean {
	return (
		code === 'model_missing_tool_call' ||
		code === 'model_arguments_invalid' ||
		code === 'model_schema_invalid' ||
		code === 'model_response_invalid'
	)
}

function isMatchingImageDataUrl(dataUrl: string, mimeType: ImageAssetRef['mimeType']): boolean {
	return dataUrl.startsWith(`data:${mimeType};base64,`) && dataUrl.length > mimeType.length + 13
}

function questionNeedsVision(question: Question): boolean {
	if (question.hasRequiredVisuals) return true
	if (partsNeedVision(question.material) || partsNeedVision(question.stem)) return true
	if (question.options.some((option) => partsNeedVision(option.content))) return true
	return question.subQuestions?.some(questionNeedsVision) ?? false
}

function partsNeedVision(parts: ContentPart[] | undefined): boolean {
	return parts?.some((part) => part.type === 'image' && part.requiredForAnswer) ?? false
}

function optionKeys(question: Question): string[] {
	return question.options.map((option) => option.key)
}

function blankKeys(question: Question): string[] {
	const keys = question.blanks?.map((blank) => blank.key) ?? []
	if (keys.length === 0) throw new AnswerModelError('question_schema_invalid', false)
	return keys
}

function canonicalAnswer(answer: ModelAnswerNode): string {
	return JSON.stringify(answer)
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return
	if (signal.reason !== undefined) throw signal.reason
	throw new DOMException('The operation was aborted.', 'AbortError')
}

function isAbortError(error: unknown): boolean {
	return (error as { name?: unknown } | null)?.name === 'AbortError'
}
