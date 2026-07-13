import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
	SIDEPANEL_AGENT_OPTIONS,
	SidepanelHistoryButton,
	getSidepanelControlState,
	pickSendAction,
} from './App'

const APP_SOURCE = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('Sidepanel new conversation transition', () => {
	it('routes a follow-up message to followUp after completion', () => {
		expect(pickSendAction({ status: 'completed', hasConversation: true })).toBe('followUp')
		expect(pickSendAction({ status: 'error', hasConversation: true })).toBe('followUp')
		expect(pickSendAction({ status: 'idle', hasConversation: false })).toBe('execute')
		expect(pickSendAction({ status: 'running', hasConversation: true })).toBe('execute')
	})

	it('collects the visible conversation into the history button before showing home', () => {
		const source = readFileSync(APP_SOURCE, 'utf8')

		expect(source).toContain('wx-conversation-collect-to-history')
		expect(source).toContain('wx-history-collect-target')
		expect(source).not.toContain('slide-out-to-bottom')
		expect(source).not.toContain('zoom-out-95')
	})
})

describe('getSidepanelControlState', () => {
	it('enables clarification questions and protected-action takeover in the side panel', () => {
		expect(SIDEPANEL_AGENT_OPTIONS).toEqual({
			enableUserTakeover: true,
			enableUserQuestions: true,
		})
	})

	it('keeps escape controls available while waiting for user takeover', () => {
		expect(getSidepanelControlState('waiting_for_user')).toMatchObject({
			inputDisabled: false,
			canStartNewConversation: true,
			showStopButton: true,
			showSendButton: true,
			shouldSubmitToActiveTask: true,
		})
	})

	it('keeps the running state locked to stop-only controls', () => {
		expect(getSidepanelControlState('running')).toMatchObject({
			inputDisabled: true,
			canStartNewConversation: false,
			showStopButton: true,
			showSendButton: false,
			shouldSubmitToActiveTask: false,
		})
	})

	it('unlocks only answer submission while ask_user is waiting', () => {
		expect(getSidepanelControlState('running', true)).toMatchObject({
			isAwaitingQuestion: true,
			inputDisabled: false,
			canStartNewConversation: false,
			showStopButton: true,
			showSendButton: true,
			shouldSubmitToActiveTask: true,
		})
	})
})

describe('SidepanelHistoryButton', () => {
	it('is visibly disabled while a task is active', () => {
		const html = renderToStaticMarkup(
			createElement(SidepanelHistoryButton, {
				disabled: true,
				collecting: false,
				onOpen: () => {},
			}),
		)

		expect(html).toMatch(/<button[^>]*\sdisabled(?:=""|>)/)
	})
})
