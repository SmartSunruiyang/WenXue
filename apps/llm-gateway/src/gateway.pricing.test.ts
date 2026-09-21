import { describe, expect, it } from 'vitest'

import {
	assertUsageRecordSafe,
	buildUsageRecord,
	buildUsageSummary,
	DASHSCOPE_CHAT_COMPLETIONS_URL,
	estimateTokenCostCny,
	handleChatCompletions,
	normalizeUsage,
	readUsageRecords,
} from './gateway.mjs'

const USER_ID = 'pricing-user'
const ENV = {
	cloudbaseEnvId: 'pricing-test-env',
	cloudbaseClientId: 'client-id',
	cloudbaseClientSecret: '',
	cloudbaseUsageApiKey: 'usage-api-key',
	dashscopeApiKey: 'server-dashscope-key',
}
const BASE_USAGE = { inputTokens: 100_000, outputTokens: 50_000, totalTokens: 150_000 }
const HISTORY_RECORD = {
	_id: 'history-record',
	ts: Date.parse('2026-09-21T00:00:00Z'),
	uid: USER_ID,
	browserId: 'browser-1',
	model: 'qwen3.7-plus',
	...BASE_USAGE,
	latencyMs: 100,
	requestId: 'history-request',
	createdAt: '2026-09-21T00:00:00.000Z',
}

describe('Qwen 3.7 token cost estimates', () => {
	it.each([
		{ model: 'qwen3.7-plus', cached: 0, created: 0, expected: 0.6 },
		{ model: 'qwen3.7-max', cached: 0, created: 0, expected: 3 },
		{ model: 'qwen3.7-plus', cached: 20_000, created: 0, expected: 0.568 },
		{ model: 'qwen3.7-max', cached: 20_000, created: 0, expected: 2.808 },
		{ model: 'qwen3.7-plus', cached: 20_000, created: 10_000, expected: 0.569 },
		{ model: 'qwen3.7-max', cached: 20_000, created: 10_000, expected: 2.814 },
	])('prices $model with $cached cached and $created created tokens', (testCase) => {
		expect(
			estimateTokenCostCny(testCase.model, {
				...BASE_USAGE,
				cachedInputTokens: testCase.cached,
				cacheCreationInputTokens: testCase.created,
			}),
		).toBe(testCase.expected)
	})

	it.each([
		{ model: 'qwen3.7-plus', expected: 0.564 },
		{ model: 'qwen3.7-max', expected: 2.784 },
	])(
		'uses the explicit hit price for $model even without cache creation',
		({ model, expected }) => {
			expect(
				estimateTokenCostCny(
					model,
					{ ...BASE_USAGE, cachedInputTokens: 20_000, cacheCreationInputTokens: 0 },
					'explicit',
				),
			).toBe(expected)
		},
	)

	it.each([
		{ input: 256_000, output: 10_000, cached: 0, created: 0, expected: 0.592 },
		{ input: 256_001, output: 10_000, cached: 0, created: 0, expected: 1.776006 },
		{ input: 256_001, output: 0, cached: 256_000, created: 0, expected: 0.307206 },
		{ input: 256_001, output: 10_000, cached: 200_000, created: 50_000, expected: 0.771006 },
	])('selects the Plus tier from $input total input tokens', (testCase) => {
		expect(
			estimateTokenCostCny('qwen3.7-plus', {
				inputTokens: testCase.input,
				outputTokens: testCase.output,
				totalTokens: testCase.input + testCase.output,
				cachedInputTokens: testCase.cached,
				cacheCreationInputTokens: testCase.created,
			}),
		).toBe(testCase.expected)
	})

	it('retains a single cached token at 0.0000001 CNY precision', () => {
		expect(
			estimateTokenCostCny(
				'qwen3.7-plus',
				{ inputTokens: 1, outputTokens: 0, totalTokens: 1, cachedInputTokens: 1 },
				'explicit',
			),
		).toBe(0.0000002)
	})

	it('keeps the Max price unchanged for inputs larger than 256,000 tokens', () => {
		expect(
			estimateTokenCostCny('qwen3.7-max', {
				inputTokens: 300_000,
				outputTokens: 10_000,
				totalTokens: 310_000,
			}),
		).toBe(3.96)
	})

	it('keeps zero usage and models without a supplied price at zero', () => {
		expect(
			estimateTokenCostCny('qwen3.7-plus', {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
			}),
		).toBe(0)
		expect(estimateTokenCostCny('qwen-plus', BASE_USAGE)).toBe(0)
	})
})

describe('upstream usage normalization for pricing', () => {
	it.each([
		{
			prompt_tokens: 100_000,
			completion_tokens: 50_000,
			total_tokens: 150_000,
			prompt_tokens_details: { cached_tokens: 20_000, cache_creation_input_tokens: 10_000 },
		},
		{
			input_tokens: 100_000,
			output_tokens: 50_000,
			total_tokens: 150_000,
			input_tokens_details: { cached_tokens: 20_000, cache_creation_input_tokens: 10_000 },
		},
	])('preserves cache hit and creation counts in supported usage shapes', (usage) => {
		expect(normalizeUsage(usage)).toEqual({
			...BASE_USAGE,
			cachedInputTokens: 20_000,
			cacheCreationInputTokens: 10_000,
		})
	})

	it('preserves cache creation when no cache hit count is returned', () => {
		expect(
			normalizeUsage({
				prompt_tokens: 100_000,
				completion_tokens: 50_000,
				total_tokens: 150_000,
				prompt_tokens_details: { cache_creation_input_tokens: 10_000 },
			}),
		).toEqual({ ...BASE_USAGE, cachedInputTokens: 0, cacheCreationInputTokens: 10_000 })
	})

	it.each([
		{ prompt_tokens: -1 },
		{ completion_tokens: 0.5 },
		{ total_tokens: Number.POSITIVE_INFINITY },
		{ prompt_tokens_details: { cached_tokens: -1 } },
		{ prompt_tokens_details: { cached_tokens: 1.5 } },
		{ prompt_tokens_details: { cached_tokens: '20' } },
		{ prompt_tokens_details: { cache_creation_input_tokens: Number.NaN } },
		{ prompt_tokens_details: { cache_creation_input_tokens: 0.5 } },
		{ prompt_tokens_details: { cached_tokens: 101 } },
		{ prompt_tokens_details: { cached_tokens: 80, cache_creation_input_tokens: 21 } },
	])('rejects invalid or overlapping billable token counts: %j', (override) => {
		expect(
			normalizeUsage({
				prompt_tokens: 100,
				completion_tokens: 10,
				total_tokens: 110,
				...override,
			}),
		).toBeNull()
	})
})

describe('priced usage persistence and aggregation', () => {
	it.each([
		{
			name: 'JSON implicit caching',
			stream: false,
			messages: [{ role: 'user', content: 'private conversation text' }],
			created: 0,
			cacheMode: 'implicit',
			expected: 0.568,
		},
		{
			name: 'JSON explicit message caching',
			stream: false,
			messages: [
				{
					role: 'system',
					content: 'private conversation text',
					cache_control: { type: 'ephemeral' },
				},
			],
			created: 0,
			cacheMode: 'explicit',
			expected: 0.564,
		},
		{
			name: 'SSE explicit content caching',
			stream: true,
			messages: [
				{
					role: 'system',
					content: [
						{
							type: 'text',
							text: 'private conversation text',
							cache_control: { type: 'ephemeral' },
						},
					],
				},
			],
			created: 0,
			cacheMode: 'explicit',
			expected: 0.564,
		},
		{
			name: 'SSE explicit tool caching',
			stream: true,
			messages: [{ role: 'user', content: 'private conversation text' }],
			tools: [
				{ type: 'function', function: { name: 'search' }, cache_control: { type: 'ephemeral' } },
			],
			created: 0,
			cacheMode: 'explicit',
			expected: 0.564,
		},
		{
			name: 'SSE cache creation',
			stream: true,
			messages: [{ role: 'user', content: 'private conversation text' }],
			created: 10_000,
			cacheMode: 'explicit',
			expected: 0.569,
		},
	])('writes and reads the cost and cache metadata for $name', async (testCase) => {
		const writes: Record<string, unknown>[] = []
		const usage = {
			prompt_tokens: 100_000,
			completion_tokens: 50_000,
			total_tokens: 150_000,
			prompt_tokens_details: {
				cached_tokens: 20_000,
				cache_creation_input_tokens: testCase.created,
			},
		}
		const frame = `data: ${JSON.stringify({ choices: [], usage })}\n\n`
		const response = testCase.stream
			? new Response(`${frame}data: [DONE]\n\n`, {
					headers: { 'content-type': 'text/event-stream' },
				})
			: Response.json({ choices: [], usage })
		const fetchImpl = createGatewayFetch(response, writes)
		const chunks: string[] = []
		const result = await handleChatCompletions({
			headers: {
				authorization: 'Bearer access-token',
				'x-wenxue-browser-id': 'browser-1',
			},
			rawBody: JSON.stringify({
				model: 'qwen3.7-plus',
				stream: testCase.stream,
				messages: testCase.messages,
				tools: testCase.tools,
			}),
			sse: { closed: false, send: (chunk: string) => chunks.push(chunk), end() {} },
			env: ENV,
			fetchImpl,
		})

		expect(result.usagePersisted).toBe(true)
		expect(result.usageRecord).toMatchObject({
			...BASE_USAGE,
			browserId: 'browser-1',
			cachedInputTokens: 20_000,
			cacheCreationInputTokens: testCase.created,
			cacheMode: testCase.cacheMode,
			estimatedCostCny: testCase.expected,
			pricingVersion: expect.any(String),
		})
		expect(writes).toEqual([result.usageRecord])
		expect(() => assertUsageRecordSafe(result.usageRecord)).not.toThrow()
		expect(JSON.stringify(writes)).not.toMatch(
			/private conversation text|prompt|content|authorization|bearer|access-token|server-dashscope-key/i,
		)
		if (testCase.stream) expect(chunks.join('')).toContain(frame)
		else expect(result.responseBody).toEqual({ choices: [], usage })

		const records = await readUsageRecords({
			uid: USER_ID,
			envId: ENV.cloudbaseEnvId,
			apiKey: ENV.cloudbaseUsageApiKey,
			fetchImpl,
		})
		expect(records).toEqual([result.usageRecord])
		expect(buildUsageSummary(records)).toMatchObject({
			estimatedCostCny: testCase.expected,
			byBrowser: [{ key: 'browser-1', estimatedCostCny: testCase.expected }],
			byModel: [{ key: 'qwen3.7-plus', estimatedCostCny: testCase.expected }],
			recent: [{ estimatedCostCny: testCase.expected }],
		})
	})

	it('preserves the stored price and numeric EJSON cache metadata when reading CloudBase', async () => {
		const records = await readUsageRecords({
			uid: USER_ID,
			envId: ENV.cloudbaseEnvId,
			apiKey: ENV.cloudbaseUsageApiKey,
			fetchImpl: async () =>
				Response.json({
					list: [
						{
							...HISTORY_RECORD,
							cachedInputTokens: { $numberInt: '20000' },
							cacheCreationInputTokens: { $numberLong: '10000' },
							cacheMode: 'explicit',
							estimatedCostCny: { $numberDouble: '1.2345678' },
							pricingVersion: 'stored-price-version',
						},
					],
				}),
		})

		expect(records).toEqual([
			{
				...HISTORY_RECORD,
				cachedInputTokens: 20_000,
				cacheCreationInputTokens: 10_000,
				cacheMode: 'explicit',
				estimatedCostCny: 1.2345678,
				pricingVersion: 'stored-price-version',
			},
		])
		expect(buildUsageSummary(records)).toMatchObject({
			estimatedCostCny: 1.2346,
			recent: [{ estimatedCostCny: 1.2345678 }],
		})
	})

	it('prices loaded history without cache details and preserves a stored zero cost', async () => {
		const records = await readUsageRecords({
			uid: USER_ID,
			envId: ENV.cloudbaseEnvId,
			apiKey: ENV.cloudbaseUsageApiKey,
			fetchImpl: async () =>
				Response.json({
					list: [
						HISTORY_RECORD,
						{
							...HISTORY_RECORD,
							_id: 'stored-zero',
							requestId: 'stored-zero',
							model: 'qwen3.7-max',
							estimatedCostCny: 0,
						},
					],
				}),
		})
		const summary = buildUsageSummary(records)

		expect(summary).toMatchObject({
			estimatedCostCny: 0.6,
			byModel: expect.arrayContaining([
				{ key: 'qwen3.7-plus', label: 'qwen3.7-plus', ...BASE_USAGE, estimatedCostCny: 0.6 },
				{ key: 'qwen3.7-max', label: 'qwen3.7-max', ...BASE_USAGE, estimatedCostCny: 0 },
			]),
		})
		expect(HISTORY_RECORD).not.toHaveProperty('estimatedCostCny')
	})

	it('adds small request costs before rounding each summary and bucket to four decimal places', () => {
		const groups = [
			{ model: 'qwen3.7-plus', browserId: 'browser-1', day: '2026-09-21' },
			{ model: 'qwen3.7-max', browserId: 'browser-1', day: '2026-09-22' },
			{ model: 'qwen3.7-plus', browserId: 'browser-2', day: '2026-09-22' },
			{ model: 'qwen3.7-max', browserId: 'browser-2', day: '2026-09-21' },
		]
		const records = groups.flatMap((group, groupIndex) =>
			Array.from({ length: 100 }, (_, index) =>
				buildUsageRecord({
					uid: USER_ID,
					browserId: group.browserId,
					model: group.model,
					usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
					latencyMs: 1,
					requestId: `${groupIndex}-${index}`,
					now: () => Date.parse(`${group.day}T00:00:00Z`) + index,
				}),
			),
		)

		const summary = buildUsageSummary(records)

		expect(summary.estimatedCostCny).toBe(0.0116)
		expect(summary.byBrowser.map((bucket) => bucket.estimatedCostCny)).toEqual([0.0058, 0.0058])
		expect(summary.daily.map((bucket) => bucket.estimatedCostCny)).toEqual([0.0058, 0.0058])
		expect(summary.byModel).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'qwen3.7-plus', estimatedCostCny: 0.002 }),
				expect.objectContaining({ key: 'qwen3.7-max', estimatedCostCny: 0.0096 }),
			]),
		)
		expect(summary.recent).toHaveLength(20)
		expect(summary.recent.every((record) => record.estimatedCostCny > 0)).toBe(true)
	})
})

function createGatewayFetch(upstream: Response, writes: Record<string, unknown>[]): typeof fetch {
	return async (url, init) => {
		const href = String(url)
		if (href.includes('/auth/v1/user/me')) {
			return Response.json({ status: 'ACTIVE', sub: USER_ID })
		}
		if (href === DASHSCOPE_CHAT_COMPLETIONS_URL) return upstream
		if (href.includes('/collections/token_usage/documents')) {
			if (init?.method === 'GET') return Response.json({ list: writes })
			const payload = JSON.parse(String(init?.body)) as { data: Record<string, unknown>[] }
			writes.push(...payload.data)
			return Response.json({ insertedIds: ['usage-record'] }, { status: 201 })
		}
		throw new Error(`Unexpected gateway request: ${href}`)
	}
}
