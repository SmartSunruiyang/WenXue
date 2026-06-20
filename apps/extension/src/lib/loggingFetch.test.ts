import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock('./logRedaction', () => ({
	redact: vi.fn((v: unknown) => v),
}))

import { logger } from './logger'
import { redact } from './logRedaction'

describe('installLlmFetchLogging', () => {
	let installModule: typeof import('./loggingFetch')
	let origFetch: typeof globalThis.fetch

	beforeEach(async () => {
		vi.resetModules()
		vi.clearAllMocks()
		origFetch = globalThis.fetch
		installModule = await import('./loggingFetch')
	})

	afterEach(() => {
		globalThis.fetch = origFetch
	})

	it('logs LLM requests and passes through the original response', async () => {
		const mockResponse = new Response(JSON.stringify({ choices: [{ message: {} }] }), {
			status: 200,
		})
		const fakeFetch = vi.fn().mockResolvedValue(mockResponse)
		globalThis.fetch = fakeFetch

		const uninstall = installModule.installLlmFetchLogging()

		const body = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
		const resp = await globalThis.fetch('https://api.example.com/v1/chat/completions', {
			method: 'POST',
			body,
		})

		// Response is returned unchanged
		expect(resp.status).toBe(200)
		const data = await resp.json()
		expect(data).toEqual({ choices: [{ message: {} }] })

		// Logger was called asynchronously — wait for it
		await vi.waitFor(() => {
			expect(logger.info).toHaveBeenCalledWith(
				'llm',
				expect.stringContaining('200'),
				expect.objectContaining({
					request: expect.anything(),
					response: expect.objectContaining({ status: 200 }),
					durationMs: expect.any(Number),
				}),
			)
		})

		// Redact was called on the request body
		expect(redact).toHaveBeenCalled()

		uninstall()
	})

	it('does not log non-LLM fetches', async () => {
		const fakeFetch = vi.fn().mockResolvedValue(new Response('ok'))
		globalThis.fetch = fakeFetch

		const uninstall = installModule.installLlmFetchLogging()

		await globalThis.fetch('https://example.com/api/data')

		expect(logger.info).not.toHaveBeenCalled()
		expect(fakeFetch).toHaveBeenCalled()

		uninstall()
	})

	it('logs errors when fetch rejects', async () => {
		const fakeFetch = vi.fn().mockRejectedValue(new Error('network down'))
		globalThis.fetch = fakeFetch

		const uninstall = installModule.installLlmFetchLogging()

		await expect(
			globalThis.fetch('https://api.example.com/v1/chat/completions', {
				method: 'POST',
				body: '{}',
			}),
		).rejects.toThrow('network down')

		await vi.waitFor(() => {
			expect(logger.error).toHaveBeenCalledWith(
				'llm',
				expect.stringContaining('fetch failed'),
				expect.objectContaining({
					error: expect.stringContaining('network down'),
				}),
			)
		})

		uninstall()
	})

	it('restores original fetch when uninstalled', async () => {
		const fakeFetch = vi.fn().mockResolvedValue(new Response('ok'))
		globalThis.fetch = fakeFetch

		const uninstall = installModule.installLlmFetchLogging()
		expect(globalThis.fetch).not.toBe(fakeFetch)

		uninstall()
		expect(globalThis.fetch).toBe(fakeFetch)
	})

	it('uses custom isLlmUrl when provided', async () => {
		const fakeFetch = vi.fn().mockResolvedValue(new Response('ok'))
		globalThis.fetch = fakeFetch

		const uninstall = installModule.installLlmFetchLogging({
			isLlmUrl: (url) => url.includes('/my-llm/'),
		})

		// Standard LLM URL should NOT be logged with custom filter
		await globalThis.fetch('https://api.example.com/v1/chat/completions')
		expect(logger.info).not.toHaveBeenCalled()

		// Custom URL should be logged
		const llmResponse = new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
		fakeFetch.mockResolvedValueOnce(llmResponse)
		await globalThis.fetch('https://custom.com/my-llm/endpoint', {
			method: 'POST',
			body: '{"q":"test"}',
		})

		await vi.waitFor(() => {
			expect(logger.info).toHaveBeenCalledWith(
				'llm',
				expect.stringContaining('200'),
				expect.anything(),
			)
		})

		uninstall()
	})

	it('handles non-JSON response bodies gracefully', async () => {
		const mockResponse = new Response('not json', { status: 200 })
		const fakeFetch = vi.fn().mockResolvedValue(mockResponse)
		globalThis.fetch = fakeFetch

		const uninstall = installModule.installLlmFetchLogging()

		await globalThis.fetch('https://api.example.com/v1/chat/completions', {
			method: 'POST',
			body: '{}',
		})

		await vi.waitFor(() => {
			expect(logger.info).toHaveBeenCalledWith(
				'llm',
				expect.anything(),
				expect.objectContaining({
					response: expect.objectContaining({ status: 200 }),
				}),
			)
		})

		uninstall()
	})
})
