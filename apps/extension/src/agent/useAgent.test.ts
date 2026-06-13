import type { AgentActivity, HistoricalEvent } from '@page-agent/core'
import { describe, expect, it } from 'vitest'

import {
	createClearedAgentConversationState,
	createRestoredAgentConversationState,
	hasAgentConversationContent,
} from './useAgent'

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
})
