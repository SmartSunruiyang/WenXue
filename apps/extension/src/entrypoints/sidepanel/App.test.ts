// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DEMO_CONFIG } from '@/agent/constants'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_VISION_MODEL_ID,
	type CustomModelConfig,
} from '@/lib/modelConfig'

import {
	ModelMenu,
	SIDEPANEL_AGENT_OPTIONS,
	SidepanelHistoryButton,
	getSidepanelControlState,
	getSidepanelModelGroups,
	pickSendAction,
} from './App'

const APP_SOURCE = resolve(process.cwd(), 'src/entrypoints/sidepanel/App.tsx')

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

describe('ModelMenu', () => {
	const customModel: CustomModelConfig = {
		id: 'custom:qwen-vl',
		provider: 'qwen',
		baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		apiKey: 'sk-qwen',
		model: 'qwen-vl-max',
	}
	const config = {
		...DEMO_CONFIG,
		selectedModelId: BUILT_IN_MODEL_ID,
		visionModelId: 'custom:qwen-vl',
		customModels: [customModel],
	}

	it('shows the built-in primary model name on the closed trigger', () => {
		const html = renderToStaticMarkup(
			createElement(ModelMenu, {
				config,
				disabled: false,
				onConfigure: async () => {},
			}),
		)

		expect(html).toContain('qwen3.7-max')
	})

	it('shows the selected multimodal-capable built-in model when it is the primary model', () => {
		const html = renderToStaticMarkup(
			createElement(ModelMenu, {
				config: { ...config, selectedModelId: BUILT_IN_VISION_MODEL_ID },
				disabled: false,
				onConfigure: async () => {},
			}),
		)

		expect(html).toContain('qwen3.7-plus')
	})

	it('shows a custom primary model name on the closed trigger', () => {
		const html = renderToStaticMarkup(
			createElement(ModelMenu, {
				config: { ...config, selectedModelId: customModel.id },
				disabled: false,
				onConfigure: async () => {},
			}),
		)

		expect(html).toContain('qwen-vl-max')
	})

	it('builds synchronized primary and multimodal choices without text-only vision options', () => {
		const groups = getSidepanelModelGroups(config)

		expect(groups.primary.selectedId).toBe(BUILT_IN_MODEL_ID)
		expect(groups.vision.selectedId).toBe('custom:qwen-vl')
		expect(groups.primary.options.map((option) => option.id)).toContain(BUILT_IN_MODEL_ID)
		expect(groups.vision.options.map((option) => option.id)).toEqual([
			BUILT_IN_VISION_MODEL_ID,
			'custom:qwen-vl',
		])
	})

	it('updates only the vision choice when a multimodal menu item is clicked', async () => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		const onConfigure = vi.fn(async () => {})

		try {
			await act(async () => {
				root.render(createElement(ModelMenu, { config, disabled: false, onConfigure }))
			})
			await act(async () => {
				container
					.querySelector<HTMLButtonElement>('button[aria-label="选择模型"]')
					?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			})
			const visionOption = [
				...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
			]
				.filter((button) => button.textContent?.includes('qwen3.7-plus'))
				.at(-1)
			expect(visionOption).toBeDefined()
			await act(async () => {
				visionOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			})
			expect(onConfigure).toHaveBeenCalledWith({
				...config,
				selectedModelId: BUILT_IN_MODEL_ID,
				visionModelId: BUILT_IN_VISION_MODEL_ID,
			})
		} finally {
			await act(async () => root.unmount())
			container.remove()
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
		}
	})
})
