import type { AgentActivity, HistoricalEvent, UserTakeoverRequest } from '@page-agent/core'
import { describe, expect, it, vi } from 'vitest'

import {
	createClearedAgentConversationState,
	createRestoredAgentConversationState,
	createTakeoverRequestController,
	hasAgentConversationContent,
	isAgentTaskActive,
} from './useAgent'

const TAKEOVER_REQUEST: UserTakeoverRequest = {
	id: 'takeover-1',
	reason: 'login',
	title: 'Sign in required',
	message: 'Complete sign-in in the page.',
}

describe('agent conversation state helpers', () => {
	it('detects whether the current conversation has visible content', () => {
		const event = { type: 'observation', content: 'Read page' } as HistoricalEvent
		const activity = { type: 'thinking' } as AgentActivity

		expect(
			hasAgentConversationContent({
				currentTask: '',
				history: [],
				activity: null,
			}),
		).toBe(false)
		expect(
			hasAgentConversationContent({
				currentTask: 'Summarize this page',
				history: [],
				activity: null,
			}),
		).toBe(true)
		expect(
			hasAgentConversationContent({
				currentTask: '',
				history: [event],
				activity: null,
			}),
		).toBe(true)
		expect(
			hasAgentConversationContent({
				currentTask: '',
				history: [],
				activity,
			}),
		).toBe(true)
	})

	it('creates an empty visible conversation state for a new conversation', () => {
		expect(createClearedAgentConversationState()).toEqual({
			status: 'idle',
			history: [],
			activity: null,
			currentTask: '',
		})
	})

	it('creates a visible conversation state restored from a saved history session', () => {
		const event = { type: 'observation', content: 'Read page' } as HistoricalEvent
		const history = [event]

		const restored = createRestoredAgentConversationState({
			task: 'Summarize this page',
			history,
			status: 'completed',
		})

		expect(restored).toEqual({
			status: 'completed',
			history: [event],
			activity: null,
			currentTask: 'Summarize this page',
		})
		expect(restored.history).not.toBe(history)
	})

	it.each([
		['running', true],
		['waiting_for_user', true],
		['paused', true],
		['idle', false],
		['completed', false],
		['error', false],
	] as const)('reports whether %s locks the active task', (status, expected) => {
		expect(isAgentTaskActive(status)).toBe(expected)
	})
})

describe('takeover request controller', () => {
	it('completes the active request exactly once and removes its abort listener', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const abortController = new AbortController()
		const removeListener = vi.spyOn(abortController.signal, 'removeEventListener')
		const controller = createTakeoverRequestController((request) => requests.push(request))

		const resolution = controller.request(TAKEOVER_REQUEST, {
			signal: abortController.signal,
		})
		controller.resolve('completed')
		controller.resolve('paused')

		await expect(resolution).resolves.toBe('completed')
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
		expect(removeListener).toHaveBeenCalledTimes(1)
	})

	it('pauses the active request', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const controller = createTakeoverRequestController((request) => requests.push(request))

		const resolution = controller.request(TAKEOVER_REQUEST)
		controller.resolve('paused')

		await expect(resolution).resolves.toBe('paused')
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
	})

	it('rejects and clears the active request when its signal aborts', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const abortController = new AbortController()
		const controller = createTakeoverRequestController((request) => requests.push(request))
		const reason = new Error('task stopped')

		const resolution = controller.request(TAKEOVER_REQUEST, {
			signal: abortController.signal,
		})
		abortController.abort(reason)
		controller.resolve('completed')

		await expect(resolution).rejects.toBe(reason)
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
	})

	it('rejects and clears the active request during cleanup', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const controller = createTakeoverRequestController((request) => requests.push(request))

		const resolution = controller.request(TAKEOVER_REQUEST)
		controller.dispose()
		controller.dispose()

		await expect(resolution).rejects.toMatchObject({ name: 'AbortError' })
		expect(requests).toEqual([TAKEOVER_REQUEST, null])
	})

	it('prevents an earlier request from settling a later request', async () => {
		const requests: Array<UserTakeoverRequest | null> = []
		const firstAbortController = new AbortController()
		const controller = createTakeoverRequestController((request) => requests.push(request))
		const secondRequest = { ...TAKEOVER_REQUEST, id: 'takeover-2', title: 'Captcha required' }

		const firstResolution = controller.request(TAKEOVER_REQUEST, {
			signal: firstAbortController.signal,
		})
		const secondResolution = controller.request(secondRequest)
		firstAbortController.abort(new Error('stale abort'))
		controller.resolve('completed')

		await expect(firstResolution).rejects.toMatchObject({ name: 'AbortError' })
		await expect(secondResolution).resolves.toBe('completed')
		expect(requests).toEqual([TAKEOVER_REQUEST, null, secondRequest, null])
	})
})
