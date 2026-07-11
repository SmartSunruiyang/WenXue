import type { LLMConfig } from '@page-agent/llms'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	askVisualObservation,
	captureVisibleTab,
	createVisualObserveTools,
	ensureVisualObserveBackgroundReady,
	type VisualObservationResult,
} from './visualObserve'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

const visionModel: LLMConfig = {
	baseURL: 'https://api.example.com/v1',
	model: 'vision-model',
	apiKey: 'sk-vision',
}

function toolResponse(args: VisualObservationResult): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						tool_calls: [
							{
								type: 'function',
								function: {
									name: 'visual_observation',
									arguments: JSON.stringify(args),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	)
}

describe('askVisualObservation', () => {
	it('returns schema-validated JSON from a multimodal tool call without summarizing it', async () => {
		const expected: VisualObservationResult = {
			pageType: 'login_form',
			visibleRegion: 'current viewport',
			controls: [
				{
					label: '登录',
					role: 'button',
					state: 'enabled',
					position: 'bottom-right',
					purpose: 'submit login form',
				},
			],
			blockingElements: [],
			checks: [
				{
					question: '登录按钮是否可见？',
					answer: 'yes',
					evidence: 'bottom-right blue button labeled 登录',
					confidence: 'high',
				},
			],
			visualWarnings: [],
			recommendedNextObservation: 'none',
			confidence: 'high',
		}
		const fetchImpl = vi.fn<typeof fetch>(async () => toolResponse(expected))

		const result = await askVisualObservation(
			visionModel,
			{
				purpose: 'confirm',
				reason: 'Need visual confirmation before clicking',
				checks: ['登录按钮是否可见？'],
			},
			{
				ok: true,
				protocolVersion: 2,
				dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
				tab: { id: 9, windowId: 2, url: 'https://example.com/login', title: 'Login' },
			},
			{ fetchImpl },
		)

		expect(result).toEqual(expected)
		const request = JSON.parse((fetchImpl.mock.calls[0]?.[1]?.body as string) ?? '{}')
		expect(request.messages[1].content).toEqual([
			expect.objectContaining({ type: 'text' }),
			{
				type: 'image_url',
				image_url: { url: 'data:image/jpeg;base64,SCREENSHOT' },
			},
		])
		expect(JSON.stringify(request)).not.toContain('https://example.com/login')
		expect(JSON.stringify(request)).not.toContain('Login')
	})

	it('rejects a model result that tries to echo screenshot data into tool history', async () => {
		const unsafe = {
			pageType: 'page',
			visibleRegion: 'data:image/jpeg;base64,SCREENSHOT',
			controls: [],
			blockingElements: [],
			checks: [],
			visualWarnings: [],
			recommendedNextObservation: 'none',
			confidence: 'low',
		} as VisualObservationResult
		const fetchImpl = vi.fn<typeof fetch>(async () => toolResponse(unsafe))

		await expect(
			askVisualObservation(
				visionModel,
				{ purpose: 'audit', reason: 'Check screenshot handling' },
				{
					ok: true,
					protocolVersion: 2,
					dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
					tab: { id: 9, windowId: 2 },
				},
				{ fetchImpl },
			),
		).rejects.toThrow(/unsafe image data/i)
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		const retryBody = JSON.parse(fetchImpl.mock.calls[1]?.[1]?.body as string)
		expect(retryBody.messages.map((message: { role: string }) => message.role)).toEqual([
			'system',
			'user',
		])
		expect(retryBody.messages[0].content).toMatch(/previous response was not valid/i)
	})

	it('allows long ordinary alphanumeric observation text', async () => {
		const expected: VisualObservationResult = {
			pageType: 'document',
			visibleRegion: 'a'.repeat(600),
			controls: [],
			blockingElements: [],
			checks: [],
			visualWarnings: [],
			recommendedNextObservation: 'none',
			confidence: 'low',
		}
		const fetchImpl = vi.fn<typeof fetch>(async () => toolResponse(expected))

		await expect(
			askVisualObservation(
				visionModel,
				{ purpose: 'observe', reason: 'Read visible content' },
				{
					ok: true,
					protocolVersion: 2,
					dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
					tab: { id: 9, windowId: 2 },
				},
				{ fetchImpl },
			),
		).resolves.toEqual(expected)
	})

	it('disables Qwen thinking when forcing the structured visual tool', async () => {
		const expected: VisualObservationResult = {
			pageType: 'search_home',
			visibleRegion: 'current viewport',
			controls: [],
			blockingElements: [],
			checks: [],
			visualWarnings: [],
			recommendedNextObservation: 'none',
			confidence: 'high',
		}
		const fetchImpl = vi.fn<typeof fetch>(async () => toolResponse(expected))

		await askVisualObservation(
			{
				...visionModel,
				baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
				model: 'qwen3.7-plus',
			},
			{ purpose: 'observe', reason: 'Need visual context' },
			{
				ok: true,
				protocolVersion: 2,
				dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
				tab: { id: 9, windowId: 2, url: 'https://example.com', title: 'Example' },
			},
			{ fetchImpl },
		)

		const [url, init] = fetchImpl.mock.calls[0]!
		const body = JSON.parse(init?.body as string)
		expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
		expect(body.enable_thinking).toBe(false)
		expect(body.tool_choice).toEqual({
			type: 'function',
			function: { name: 'visual_observation' },
		})
	})

	it('surfaces a CloudBase HTTP error envelope without retrying it as invalid model JSON', async () => {
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify({
						statusCode: 401,
						body: JSON.stringify({ error: { message: 'Missing bearer token', status: 401 } }),
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				),
		)

		await expect(
			askVisualObservation(
				visionModel,
				{ purpose: 'observe', reason: 'Need visual context' },
				{
					ok: true,
					protocolVersion: 2,
					dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
					tab: { id: 9, windowId: 2 },
				},
				{ fetchImpl },
			),
		).rejects.toThrow(/HTTP 401.*Missing bearer token/i)
		expect(fetchImpl).toHaveBeenCalledOnce()
	})

	it('preserves a plain-text CloudBase error-envelope diagnostic', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			Promise.resolve(
				new Response(JSON.stringify({ statusCode: 502, body: 'upstream timed out' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
			),
		)

		await expect(
			askVisualObservation(
				visionModel,
				{ purpose: 'observe', reason: 'Need visual context' },
				{
					ok: true,
					protocolVersion: 2,
					dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
					tab: { id: 9, windowId: 2 },
				},
				{ fetchImpl },
			),
		).rejects.toThrow(/HTTP 502.*upstream timed out/i)
	})

	it('propagates aborts while reading an HTTP error response body', async () => {
		const abortError = new DOMException('Stopped', 'AbortError')
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			Promise.resolve({
				ok: false,
				status: 400,
				statusText: 'Bad Request',
				json: vi.fn(async () => {
					throw abortError
				}),
			} as unknown as Response),
		)

		await expect(
			askVisualObservation(
				visionModel,
				{ purpose: 'observe', reason: 'Need visual context' },
				{
					ok: true,
					protocolVersion: 2,
					dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
					tab: { id: 9, windowId: 2 },
				},
				{ fetchImpl },
			),
		).rejects.toBe(abortError)
	})
})

describe('captureVisibleTab', () => {
	it('sends the bridge protocol version and logical target tab id', async () => {
		const sendMessage = vi.fn(async () => ({
			ok: true,
			protocolVersion: 2,
			dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
			tab: { id: 7, windowId: 2 },
		}))
		vi.stubGlobal('chrome', { runtime: { sendMessage } })

		await expect(captureVisibleTab({ targetTabId: 7 })).resolves.toMatchObject({ ok: true })
		expect(sendMessage).toHaveBeenCalledWith({
			type: 'VISUAL_OBSERVE',
			action: 'capture_visible_tab',
			protocolVersion: 2,
			targetTabId: 7,
		})
	})

	it('identifies a legacy background response as an outdated runtime', async () => {
		vi.stubGlobal('chrome', {
			runtime: { sendMessage: vi.fn(async () => ({ error: 'Unknown message type' })) },
		})

		await expect(captureVisibleTab({ targetTabId: 7 })).resolves.toMatchObject({
			ok: false,
			code: 'runtime_outdated',
		})
	})

	it('normalizes runtime message rejection into a capture failure', async () => {
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => {
					throw new Error('Receiving end does not exist')
				}),
			},
		})

		await expect(captureVisibleTab({ targetTabId: 7 })).resolves.toMatchObject({
			ok: false,
			code: 'message_failed',
			error: 'Receiving end does not exist',
		})
	})

	it('rejects a response whose failure code is outside the versioned bridge contract', async () => {
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => ({
					ok: false,
					protocolVersion: 2,
					code: 'invented_failure',
					error: 'Untrusted response',
				})),
			},
		})

		await expect(captureVisibleTab({ targetTabId: 7 })).resolves.toMatchObject({
			ok: false,
			code: 'runtime_outdated',
		})
	})
})

describe('ensureVisualObserveBackgroundReady', () => {
	it('accepts the current background protocol without reloading the extension', async () => {
		const reload = vi.fn()
		const remove = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => ({ ok: true, protocolVersion: 2 })),
				reload,
			},
			storage: { local: { get: vi.fn(), set: vi.fn(), remove } },
		})

		await expect(ensureVisualObserveBackgroundReady()).resolves.toBe('ready')
		expect(remove).toHaveBeenCalledWith('visualObserveProtocolReloadAttempt')
		expect(reload).not.toHaveBeenCalled()
	})

	it('reloads once when the running background predates the visual protocol', async () => {
		const reload = vi.fn()
		const set = vi.fn(async () => {})
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => ({ error: 'Unknown message type' })),
				reload,
			},
			storage: { local: { get: vi.fn(async () => ({})), set, remove: vi.fn() } },
		})

		await expect(ensureVisualObserveBackgroundReady()).resolves.toBe('reloading')
		expect(set).toHaveBeenCalledWith({ visualObserveProtocolReloadAttempt: 2 })
		expect(reload).toHaveBeenCalledOnce()
	})

	it('coalesces concurrent readiness checks into one extension reload', async () => {
		const reload = vi.fn()
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => ({ error: 'Unknown message type' })),
				reload,
			},
			storage: {
				local: {
					get: vi.fn(async () => ({})),
					set: vi.fn(async () => {}),
					remove: vi.fn(),
				},
			},
		})

		await expect(
			Promise.all([ensureVisualObserveBackgroundReady(), ensureVisualObserveBackgroundReady()]),
		).resolves.toEqual(['reloading', 'reloading'])
		expect(reload).toHaveBeenCalledOnce()
	})

	it('uses an origin-wide Web Lock so independent extension realms cannot both reload', async () => {
		let lockTail = Promise.resolve<unknown>(undefined)
		const request = vi.fn(
			(_name: string, _options: LockOptions, callback: () => Promise<unknown>) => {
				const result = lockTail.then(callback)
				lockTail = result.catch(() => undefined)
				return result
			},
		)
		vi.stubGlobal('navigator', { locks: { request } })
		const store: Record<string, unknown> = {}
		let protocolReady = false
		const reload = vi.fn(() => {
			protocolReady = true
		})
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () =>
					protocolReady ? { ok: true, protocolVersion: 2 } : { error: 'Unknown message type' },
				),
				reload,
			},
			storage: {
				local: {
					get: vi.fn(async (key: string) => ({ [key]: store[key] })),
					set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
					remove: vi.fn(async (key: string) => delete store[key]),
				},
			},
		})

		vi.resetModules()
		const realmOne = await import('./visualObserve')
		const first = realmOne.ensureVisualObserveBackgroundReady()
		vi.resetModules()
		const realmTwo = await import('./visualObserve')
		const second = realmTwo.ensureVisualObserveBackgroundReady()

		await expect(Promise.all([first, second])).resolves.toEqual(['reloading', 'ready'])
		expect(request).toHaveBeenCalledTimes(2)
		expect(reload).toHaveBeenCalledOnce()
	})

	it('stops after one failed reload instead of entering a reload loop', async () => {
		const reload = vi.fn()
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => ({ error: 'Unknown message type' })),
				reload,
			},
			storage: {
				local: {
					get: vi.fn(async () => ({ visualObserveProtocolReloadAttempt: 2 })),
					set: vi.fn(),
					remove: vi.fn(),
				},
			},
		})

		await expect(ensureVisualObserveBackgroundReady()).rejects.toThrow(/could not be refreshed/i)
		expect(reload).not.toHaveBeenCalled()
	})
})

describe('createVisualObserveTools', () => {
	it('honors an already-aborted invocation before checking model configuration', async () => {
		const controller = new AbortController()
		controller.abort()
		const tools = createVisualObserveTools({
			getVisionModel: () => undefined,
		})

		await expect(
			tools.visual_observe.execute(
				{ purpose: 'observe', reason: 'Need visual context' },
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ name: 'AbortError' })
	})

	it('returns structured error JSON when the vision model configuration is incomplete', async () => {
		const tools = createVisualObserveTools({
			getVisionModel: () => ({ ...visionModel, model: '' }),
			captureVisibleTab: vi.fn(),
		})

		const result = JSON.parse(
			await tools.visual_observe.execute({
				purpose: 'observe',
				reason: 'DOM is incomplete',
			}),
		)

		expect(result).toMatchObject({
			error: {
				code: 'vision_model_unavailable',
				recommendedNextObservation: 'inspect_dom',
			},
		})
	})

	it('supports vision endpoints that do not require an API key', async () => {
		const expected: VisualObservationResult = {
			pageType: 'local_page',
			visibleRegion: 'current viewport',
			controls: [],
			blockingElements: [],
			checks: [],
			visualWarnings: [],
			recommendedNextObservation: 'none',
			confidence: 'high',
		}
		const fetchImpl = vi.fn<typeof fetch>(async () => toolResponse(expected))
		const tools = createVisualObserveTools({
			getVisionModel: () => ({ ...visionModel, apiKey: undefined }),
			captureVisibleTab: vi.fn(
				async () =>
					({
						ok: true,
						protocolVersion: 2,
						dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
						tab: { id: 1, windowId: 2 },
					}) as const,
			),
			fetchImpl,
		})

		await expect(
			tools.visual_observe.execute({ purpose: 'observe', reason: 'Inspect local page' }),
		).resolves.toBe(JSON.stringify(expected, null, 2))
		const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>
		expect(headers.Authorization).toBeUndefined()
	})

	it('does not capture for an auth-required vision model without a session token', async () => {
		const capture = vi.fn()
		const tools = createVisualObserveTools({
			getVisionModel: () => ({ ...visionModel, apiKey: '', requiresApiKey: true }),
			getTargetTabId: () => 7,
			captureVisibleTab: capture,
		})

		const result = await tools.visual_observe.execute({
			purpose: 'observe',
			reason: 'Need visual context',
		})

		expect(result).toContain('vision_model_unavailable')
		expect(capture).not.toHaveBeenCalled()
	})

	it('removes an arbitrary configured API key echoed by the provider from tool output', async () => {
		const apiKey = 'custom-key-123456'
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Response(JSON.stringify({ error: { message: `invalid key ${apiKey}` } }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				}),
		)
		const tools = createVisualObserveTools({
			getVisionModel: () => ({ ...visionModel, apiKey }),
			getTargetTabId: () => 7,
			captureVisibleTab: vi.fn(
				async () =>
					({
						ok: true,
						protocolVersion: 2,
						dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
						tab: { id: 7, windowId: 2 },
					}) as const,
			),
			fetchImpl,
		})

		const result = await tools.visual_observe.execute({
			purpose: 'observe',
			reason: 'Need visual context',
		})

		expect(result).toContain('vision_observation_failed')
		expect(result).not.toContain(apiKey)
	})

	it('captures the visible tab and returns the model JSON string', async () => {
		const expected: VisualObservationResult = {
			pageType: 'admin_table',
			visibleRegion: 'current viewport',
			controls: [],
			blockingElements: ['toast at top-right'],
			checks: [],
			visualWarnings: ['toast overlaps toolbar'],
			recommendedNextObservation: 'wait',
			confidence: 'medium',
		}
		const fetchImpl = vi.fn<typeof fetch>(async () => toolResponse(expected))
		const tools = createVisualObserveTools({
			getVisionModel: () => visionModel,
			captureVisibleTab: vi.fn(
				async () =>
					({
						ok: true,
						protocolVersion: 2,
						dataUrl: 'data:image/jpeg;base64,SCREENSHOT',
						tab: { id: 1, windowId: 2, url: 'https://example.com/admin', title: 'Admin' },
					}) as const,
			),
			fetchImpl,
		})

		const result = await tools.visual_observe.execute({
			purpose: 'audit',
			reason: 'Record current visible state',
		})

		expect(JSON.parse(result)).toEqual(expected)
		expect(result).not.toContain('data:image')
	})

	it('returns structured error JSON when screenshot capture fails', async () => {
		const tools = createVisualObserveTools({
			getVisionModel: () => visionModel,
			captureVisibleTab: vi.fn(
				async () =>
					({
						ok: false,
						protocolVersion: 2,
						code: 'capture_failed',
						error: 'Cannot capture this page',
					}) as const,
			),
		})

		const result = JSON.parse(
			await tools.visual_observe.execute({
				purpose: 'observe',
				reason: 'Need visual context',
			}),
		)

		expect(result).toMatchObject({
			error: {
				code: 'screenshot_unavailable',
				message: 'Cannot capture this page',
				recommendedNextObservation: 'inspect_dom',
			},
		})
	})

	it('fails closed when the agent has no managed target tab', async () => {
		const capture = vi.fn()
		const tools = createVisualObserveTools({
			getVisionModel: () => visionModel,
			getTargetTabId: () => null,
			captureVisibleTab: capture,
		})

		const result = JSON.parse(
			await tools.visual_observe.execute({ purpose: 'observe', reason: 'Need visual context' }),
		)

		expect(result.error.code).toBe('screenshot_unavailable')
		expect(result.error.message).toMatch(/agent-managed tab/i)
		expect(capture).not.toHaveBeenCalled()
	})

	it('returns structured JSON when an injected screenshot bridge rejects', async () => {
		const tools = createVisualObserveTools({
			getVisionModel: () => visionModel,
			captureVisibleTab: vi.fn(async () => {
				throw new Error('Extension context invalidated: Bearer secret-token')
			}),
		})

		const result = await tools.visual_observe.execute({
			purpose: 'observe',
			reason: 'Need visual context',
		})
		expect(result).toContain('screenshot_unavailable')
		expect(result).not.toContain('secret-token')
	})

	it('reports an outdated background separately from screenshot API failures', async () => {
		const tools = createVisualObserveTools({
			getVisionModel: () => visionModel,
			captureVisibleTab: vi.fn(
				async () =>
					({
						ok: false,
						protocolVersion: 2,
						code: 'runtime_outdated',
						error: 'The extension background is outdated.',
					}) as const,
			),
		})

		const result = JSON.parse(
			await tools.visual_observe.execute({
				purpose: 'observe',
				reason: 'Need visual context',
			}),
		)

		expect(result.error.code).toBe('extension_runtime_outdated')
	})
})
