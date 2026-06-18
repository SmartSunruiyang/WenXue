import type { BrowserState, PageController } from '@page-agent/page-controller'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

import { PageAgentCore, type PageAgentCoreConfig, tool } from './PageAgentCore'

const browserState: BrowserState = {
	url: '',
	title: 'Test page',
	header: 'Test header',
	content: 'Test content',
	footer: 'Test footer',
}

function createPageController(): PageController {
	return {
		showMask: vi.fn(async () => {}),
		hideMask: vi.fn(async () => {}),
		cleanUpHighlights: vi.fn(async () => {}),
		getBrowserState: vi.fn(async () => browserState),
		dispose: vi.fn(),
	} as unknown as PageController
}

function createConfig(overrides: Partial<PageAgentCoreConfig> = {}): PageAgentCoreConfig {
	return {
		baseURL: 'https://api.example.com/v1',
		model: 'test-model',
		pageController: createPageController(),
		stepDelay: 0,
		...overrides,
	}
}

function createToolCallResponse(action: Record<string, unknown>, step: number): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						tool_calls: [
							{
								id: `call_${step}`,
								type: 'function',
								function: {
									name: 'AgentOutput',
									arguments: JSON.stringify({
										evaluation_previous_goal: `Completed step ${step - 1}`,
										memory: `Reached step ${step}`,
										next_goal: 'Continue until explicitly done',
										action,
									}),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	)
}

describe('PageAgentCore', () => {
	it('keeps a snapshot of the constructor config', () => {
		const sourceConfig = createConfig()
		const agent = new PageAgentCore(sourceConfig)

		sourceConfig.stepDelay = 5

		expect(agent.config).not.toBe(sourceConfig)
		expect(agent.config.stepDelay).toBe(0)
		agent.dispose()
	})

	it('runs beyond 40 steps and reports unbounded step numbers until done', async () => {
		const userPrompts: string[] = []
		let step = 0
		const customFetch: typeof fetch = async (_input, init) => {
			const requestBody = JSON.parse(String(init?.body)) as {
				messages: Array<{ role: string; content?: string }>
			}
			const userPrompt = requestBody.messages.find((message) => message.role === 'user')?.content
			userPrompts.push(userPrompt ?? '')

			step++
			const action =
				step <= 41
					? { continue_task: {} }
					: { done: { text: 'Completed after 41 work steps', success: true } }
			return createToolCallResponse(action, step)
		}
		const agent = new PageAgentCore(
			createConfig({
				customFetch,
				customTools: {
					continue_task: tool({
						description: 'Continue the test task',
						inputSchema: z.object({}),
						execute: async () => 'Continued',
					}),
				},
			}),
		)

		const result = await agent.execute('Continue for more than 40 steps, then finish')
		const steps = result.history.filter((event) => event.type === 'step')

		expect(result.success).toBe(true)
		expect(result.data).toBe('Completed after 41 work steps')
		expect(steps).toHaveLength(42)
		expect(steps.slice(0, -1).map((event) => event.action.name)).toEqual(
			Array(41).fill('continue_task'),
		)
		expect(steps.at(-1)?.action.name).toBe('done')
		expect(userPrompts).toHaveLength(42)
		userPrompts.forEach((prompt, index) => {
			expect(prompt).toContain(`<step_info>\nStep ${index + 1}\nCurrent time:`)
			expect(prompt).not.toMatch(
				/max possible steps|steps? remaining|steps? left|max_steps|maximum limit/i,
			)
		})
	})
})
