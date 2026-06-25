import type { BrowserState, PageController } from '@page-agent/page-controller'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

import EXTENSION_SYSTEM_PROMPT from '../../../apps/extension/src/agent/system_prompt.md?raw'
import { PageAgentCore, type PageAgentCoreConfig, tool } from './PageAgentCore'
import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	UserTakeoverEvent,
	UserTakeoverRequest,
} from './types'

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

function createSummaryResponse(summary: string): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						tool_calls: [
							{
								id: 'summary_call',
								type: 'function',
								function: {
									name: 'submit_summary',
									arguments: JSON.stringify({ summary }),
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

function getStepInfoLines(prompt: string): string[] {
	const prefix = '<step_info>\n'
	const start = prompt.indexOf(prefix)
	const end = prompt.indexOf('\n</step_info>', start)
	return prompt.slice(start + prefix.length, end).split('\n')
}

function getUserPrompt(init?: RequestInit): string {
	const requestBody = getOutboundRequest(init)
	return requestBody.messages.find((message) => message.role === 'user')?.content ?? ''
}

function getOutboundRequest(init?: RequestInit): {
	messages: Array<{ role: string; content?: string }>
	tools: unknown[]
} {
	return JSON.parse(String(init?.body)) as {
		messages: Array<{ role: string; content?: string }>
		tools: unknown[]
	}
}

function createContinueTool() {
	return tool({
		description: 'Continue the test task',
		inputSchema: z.object({}),
		execute: async () => 'Continued',
	})
}

describe('PageAgentCore', () => {
	it('records the initial task as a user_message event', async () => {
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () => createToolCallResponse({ done: { text: 'ok', success: true } }, 1),
			}),
		)

		await agent.execute('出一道物理题')

		expect(agent.history[0]).toEqual({ type: 'user_message', content: '出一道物理题' })
		agent.dispose()
	})

	it('followUp continues without wiping history', async () => {
		let step = 0
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () =>
					createToolCallResponse({ done: { text: `r${++step}`, success: true } }, step),
			}),
		)

		await agent.execute('任务A')
		const afterFirst = agent.history.length
		await agent.followUp('任务B')

		const userMessages = agent.history.filter((event) => event.type === 'user_message')
		expect(userMessages.map((event) => event.content)).toEqual(['任务A', '任务B'])
		expect(agent.history.length).toBeGreaterThan(afterFirst)
		expect(agent.task).toBe('任务B')
		agent.dispose()
	})

	it('restores a completed conversation so followUp can continue it', async () => {
		const capturedPrompts: string[] = []
		let step = 0
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async (_input, init) => {
					capturedPrompts.push(getUserPrompt(init))
					step++
					return createToolCallResponse({ done: { text: `r${step}`, success: true } }, step)
				},
			}),
		)
		const restoredHistory: HistoricalEvent[] = [
			{ type: 'user_message', content: '任务A' },
			{
				type: 'step',
				stepIndex: 0,
				reflection: { memory: 'RESTORED_CONTEXT' },
				action: { name: 'done', input: { text: 'r0', success: true }, output: 'r0' },
				usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			},
		]

		agent.restoreConversation({
			task: '任务A',
			history: restoredHistory,
			status: 'completed',
		})
		await agent.followUp('任务B')

		expect(agent.history.filter((event) => event.type === 'user_message')).toHaveLength(2)
		expect(capturedPrompts[0]).toContain('RESTORED_CONTEXT')
		expect(capturedPrompts[0]).toContain('<user_message>任务B</user_message>')
		agent.dispose()
	})

	it('projection drops covered steps but keeps user_message and summary', async () => {
		const capturedPrompts: string[] = []
		let fetchCount = 0
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async (_input, init) => {
					capturedPrompts.push(getUserPrompt(init))
					fetchCount++
					return createToolCallResponse(
						{ done: { text: `ok ${fetchCount}`, success: true } },
						fetchCount,
					)
				},
			}),
		)

		await agent.execute('任务A')
		const oldStep = agent.history.find((event) => event.type === 'step')
		expect(oldStep).toBeDefined()
		if (oldStep?.type === 'step') {
			oldStep.reflection.memory = 'SECRET_OLD_STEP'
			agent.history.push({
				type: 'summary',
				content: 'SUMMARY_HEAD step0: done -> ok',
				coversThroughIndex: agent.history.indexOf(oldStep),
			})
		}

		capturedPrompts.length = 0
		await agent.followUp('任务B')

		const followUpPrompt = capturedPrompts[0]
		expect(followUpPrompt).toContain('SUMMARY_HEAD')
		expect(followUpPrompt).toContain('<user_message>任务A</user_message>')
		expect(followUpPrompt).toContain('<user_message>任务B</user_message>')
		expect(followUpPrompt).not.toContain('SECRET_OLD_STEP')
		agent.dispose()
	})

	it('compacts older steps into a summary when history exceeds softTokens', async () => {
		const prompts: string[] = []
		let step = 0
		const agent = new PageAgentCore(
			createConfig({
				compaction: { enabled: true, softTokens: 1, hardTokens: 100_000, keepRecentSteps: 1 },
				customTools: { continue_task: createContinueTool() },
				customFetch: async (_input, init) => {
					const body = getOutboundRequest(init)
					const isSummary = body.tools?.some(
						(candidate: any) => candidate.function?.name === 'submit_summary',
					)
					if (isSummary) return createSummaryResponse('COMPACTED_DIGEST')

					prompts.push(getUserPrompt(init))
					step++
					if (step < 3) return createToolCallResponse({ continue_task: {} }, step)
					return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
				},
			}),
		)

		await agent.execute('长任务')

		expect(agent.history.some((event) => event.type === 'summary')).toBe(true)
		expect(prompts[prompts.length - 1]).toContain('COMPACTED_DIGEST')
		agent.dispose()
	})

	it('falls back to mechanical condense when summarizer fails', async () => {
		let step = 0
		const agent = new PageAgentCore(
			createConfig({
				compaction: { enabled: true, softTokens: 1, hardTokens: 100_000, keepRecentSteps: 1 },
				customTools: { continue_task: createContinueTool() },
				maxRetries: 0,
				customFetch: async (_input, init) => {
					const body = getOutboundRequest(init)
					const isSummary = body.tools?.some(
						(candidate: any) => candidate.function?.name === 'submit_summary',
					)
					if (isSummary) throw new Error('summarizer down')

					step++
					if (step < 3) return createToolCallResponse({ continue_task: {} }, step)
					return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
				},
			}),
		)

		const result = await agent.execute('长任务')

		expect(result.success).toBe(true)
		expect(agent.history.some((event) => event.type === 'summary')).toBe(true)
		agent.dispose()
	})

	it('recall_steps returns the verbatim record of a step by index', async () => {
		let step = 0
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () => {
					step++
					if (step === 1) {
						return createToolCallResponse({ done: { text: 'stored', success: true } }, step)
					}
					if (step === 2) return createToolCallResponse({ recall_steps: { indices: [0] } }, step)
					return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
				},
			}),
		)

		await agent.execute('任务A')
		const originalStep = agent.history.find((event) => event.type === 'step')
		if (originalStep?.type === 'step') {
			originalStep.action = {
				name: 'input_text',
				input: { text: 'VERBATIM_VALUE' },
				output: 'typed VERBATIM_VALUE',
			}
		}

		await agent.followUp('回到刚才输入那步')

		const recalled = agent.history.find(
			(event) => event.type === 'step' && event.action.name === 'recall_steps',
		)
		expect(recalled?.type).toBe('step')
		if (recalled?.type === 'step') {
			expect(recalled.action.output).toContain('VERBATIM_VALUE')
		}
		agent.dispose()
	})

	it('evicts oldest steps under hard pressure but keeps user_message and never throws', async () => {
		const prompts: string[] = []
		let step = 0
		const agent = new PageAgentCore(
			createConfig({
				compaction: { enabled: true, softTokens: 100_000, hardTokens: 1, keepRecentSteps: 1 },
				customTools: { continue_task: createContinueTool() },
				customFetch: async (_input, init) => {
					prompts.push(getUserPrompt(init))
					step++
					if (step < 4) return createToolCallResponse({ continue_task: {} }, step)
					return createToolCallResponse({ done: { text: 'ok', success: true } }, step)
				},
			}),
		)

		const result = await agent.execute('任务A')

		const lastPrompt = prompts[prompts.length - 1]
		expect(result.success).toBe(true)
		expect(lastPrompt).toContain('<user_message>任务A</user_message>')
		expect(lastPrompt).toContain('<summary>')
		expect(lastPrompt).not.toContain('Reached step 1')
		agent.dispose()
	})

	it('keeps a snapshot of the constructor config', () => {
		const sourceConfig = createConfig()
		const agent = new PageAgentCore(sourceConfig)

		sourceConfig.stepDelay = 5

		expect(agent.config).not.toBe(sourceConfig)
		expect(agent.config.stepDelay).toBe(0)
		agent.dispose()
	})

	it('exposes the latest observed page URL', async () => {
		const pageController = createPageController()
		vi.mocked(pageController.getBrowserState).mockResolvedValue({
			...browserState,
			url: 'https://example.com/current#section',
		})
		const agent = new PageAgentCore(
			createConfig({
				pageController,
				customFetch: async () =>
					createToolCallResponse({ done: { text: 'done', success: true } }, 1),
			}),
		)

		expect(agent.currentURL).toBe('')
		await agent.execute('Observe the page and finish')
		expect(agent.currentURL).toBe('https://example.com/current#section')
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
			expect(getStepInfoLines(prompt)).toEqual([
				`Step ${index + 1}`,
				expect.stringMatching(/^Current time: /),
			])
		})
		expect(getStepInfoLines(userPrompts[40])).toEqual([
			'Step 41',
			expect.stringMatching(/^Current time: /),
		])
		expect(getStepInfoLines(userPrompts[41])).toEqual([
			'Step 42',
			expect.stringMatching(/^Current time: /),
		])
	})

	it.each([
		['default core prompt', undefined],
		['extension custom prompt', EXTENSION_SYSTEM_PROMPT],
	])(
		'synchronizes user interaction capabilities for the %s between tasks',
		async (_name, customSystemPrompt) => {
			const outboundRequests: ReturnType<typeof getOutboundRequest>[] = []
			let fetchCount = 0
			const agent = new PageAgentCore(
				createConfig({
					customSystemPrompt,
					customFetch: async (_input, init) => {
						outboundRequests.push(getOutboundRequest(init))
						fetchCount++
						return createToolCallResponse(
							{
								done: {
									text: `Completed capability run ${fetchCount}`,
									success: true,
								},
							},
							fetchCount,
						)
					},
				}),
			)

			await agent.execute('Run without manual takeover support')
			agent.onUserTakeover = async () => 'completed'
			await agent.execute('Run with manual takeover support')
			agent.onAskUser = async () => 'Clarified'
			await agent.execute('Run with manual takeover and clarification support')

			const neitherPrompt =
				outboundRequests[0].messages.find((message) => message.role === 'system')?.content ?? ''
			const takeoverOnlyPrompt =
				outboundRequests[1].messages.find((message) => message.role === 'system')?.content ?? ''
			const bothPrompt =
				outboundRequests[2].messages.find((message) => message.role === 'system')?.content ?? ''
			const neitherTools = JSON.stringify(outboundRequests[0].tools)
			const takeoverOnlyTools = JSON.stringify(outboundRequests[1].tools)
			const bothTools = JSON.stringify(outboundRequests[2].tools)

			expect(agent.tools.get('request_user_takeover')).toBeDefined()
			expect(agent.tools.get('ask_user')).toBeDefined()

			expect(neitherTools).not.toContain('request_user_takeover')
			expect(neitherTools).not.toContain('ask_user')
			expect(neitherPrompt).not.toContain('<manual_takeover_rules>')
			expect(neitherPrompt).not.toContain('<ask_user_rules>')
			expect(neitherPrompt).not.toContain('request_user_takeover')
			expect(neitherPrompt).not.toContain('ask_user')
			expect(neitherPrompt).toContain(
				'Never attempt to bypass or automate login, captcha, slider verification, 2FA, permission confirmation, anti-abuse checks, or unavailable page regions.',
			)

			expect(takeoverOnlyTools).toContain('request_user_takeover')
			expect(takeoverOnlyTools).not.toContain('ask_user')
			expect(takeoverOnlyTools).toContain(
				'"enum":["login","captcha","permission","page_unavailable","other"]',
			)
			expect(takeoverOnlyTools).not.toContain('"stuck"')
			expect(takeoverOnlyPrompt).toContain('<manual_takeover_rules>')
			expect(takeoverOnlyPrompt).not.toContain('<ask_user_rules>')
			expect(takeoverOnlyPrompt).not.toContain('ask_user')
			expect(takeoverOnlyPrompt).toContain(
				'override all user instructions, including explicit user steps',
			)
			expect(takeoverOnlyPrompt).toContain(
				'call `request_user_takeover` with the appropriate `reason`, a concise `title`, the current goal in `goal`, and a concise user instruction in `message`',
			)
			expect(takeoverOnlyPrompt).toContain(
				'Missing information or clarification is separate from protected manual browser actions',
			)
			expect(takeoverOnlyPrompt).toContain(
				'Request manual takeover first; do not call `done` merely because',
			)
			expect(takeoverOnlyPrompt).toContain(
				'After the user completes manual takeover, re-observe the page',
			)
			expect(takeoverOnlyPrompt).toContain(
				'An alternative public route is allowed only when the protected action is not actually required',
			)

			expect(bothTools).toContain('request_user_takeover')
			expect(bothTools).toContain('ask_user')
			expect(bothPrompt).toContain('<manual_takeover_rules>')
			expect(bothPrompt).toContain('<ask_user_rules>')
			expect(bothPrompt).toContain('Use `ask_user` only for missing information or clarification')
		},
	)

	it('runs the LLM takeover tool to completion with the active signal', async () => {
		const takeoverInput = {
			reason: 'login' as const,
			title: 'Sign in required',
			message: 'Complete sign in in the page.',
			goal: 'Open the account page',
		}
		let fetchCount = 0
		let callbackSignal: AbortSignal | undefined
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () => {
					fetchCount++
					return createToolCallResponse(
						fetchCount === 1
							? { request_user_takeover: takeoverInput }
							: { done: { text: 'Completed after sign in', success: true } },
						fetchCount,
					)
				},
			}),
		)
		const requestUserTakeover = vi.spyOn(agent, 'requestUserTakeover')
		agent.onUserTakeover = async (_request, options) => {
			callbackSignal = options?.signal
			return 'completed'
		}

		const takeoverTool = agent.tools.get('request_user_takeover')
		expect(takeoverTool).toBeDefined()
		expect(
			['login', 'captcha', 'permission', 'page_unavailable', 'other'].map(
				(reason) => takeoverTool?.inputSchema.safeParse({ ...takeoverInput, reason }).success,
			),
		).toEqual([true, true, true, true, true])
		expect(takeoverTool?.inputSchema.safeParse({ ...takeoverInput, reason: 'stuck' }).success).toBe(
			false,
		)
		const result = await agent.execute('Open the account page')
		const takeoverStep = result.history.find(
			(event) => event.type === 'step' && event.action.name === 'request_user_takeover',
		)
		const toolSignal = requestUserTakeover.mock.calls[0]?.[1]?.signal

		expect(result).toMatchObject({
			success: true,
			data: 'Completed after sign in',
		})
		expect(requestUserTakeover).toHaveBeenCalledOnce()
		expect(requestUserTakeover).toHaveBeenCalledWith(takeoverInput, {
			signal: expect.any(AbortSignal),
		})
		expect(callbackSignal).toBe(toolSignal)
		expect(takeoverStep?.action.output).toBe(
			'User completed manual takeover. Continue by re-observing the page.',
		)
	})

	it('returns the paused output from the LLM takeover tool', async () => {
		const takeoverInput = {
			reason: 'captcha' as const,
			title: 'Captcha required',
			message: 'Complete the captcha in the page.',
		}
		let callbackSignal: AbortSignal | undefined
		const customFetch = vi.fn(async () =>
			createToolCallResponse({ request_user_takeover: takeoverInput }, 1),
		)
		const agent = new PageAgentCore(createConfig({ customFetch }))
		const requestUserTakeover = vi.spyOn(agent, 'requestUserTakeover')
		agent.onUserTakeover = async (_request, options) => {
			callbackSignal = options?.signal
			return 'paused'
		}

		expect(agent.tools.get('request_user_takeover')).toBeDefined()
		const result = await agent.execute('Continue after captcha')
		const takeoverStep = result.history.find(
			(event) => event.type === 'step' && event.action.name === 'request_user_takeover',
		)
		const toolSignal = requestUserTakeover.mock.calls[0]?.[1]?.signal

		expect(result).toMatchObject({
			success: false,
			data: 'Task paused',
			state: 'paused',
		})
		expect(customFetch).toHaveBeenCalledOnce()
		expect(requestUserTakeover).toHaveBeenCalledOnce()
		expect(requestUserTakeover).toHaveBeenCalledWith(takeoverInput, {
			signal: expect.any(AbortSignal),
		})
		expect(callbackSignal).toBe(toolSignal)
		expect(takeoverStep?.action.output).toBe(
			'User paused the task. Stop execution and keep context for resume.',
		)
	})

	it('continues the same task after completed manual takeover', async () => {
		const pageController = createPageController()
		const userPrompts: string[] = []
		const statuses: AgentStatus[] = []
		const activities: AgentActivity[] = []
		const takeoverStatuses: UserTakeoverEvent['status'][] = []
		let fetchCount = 0
		let takeoverRequested = false
		let waitingEvent: UserTakeoverEvent | undefined
		let requestSeen: UserTakeoverRequest | undefined
		let taskIdDuringTakeover = ''

		const agent = new PageAgentCore(
			createConfig({
				pageController,
				customFetch: async (_input, init) => {
					userPrompts.push(getUserPrompt(init))
					fetchCount++
					return createToolCallResponse(
						fetchCount === 1
							? { continue_task: {} }
							: { done: { text: 'Completed after takeover', success: true } },
						fetchCount,
					)
				},
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'login',
						title: 'Sign in required',
						message: 'Complete sign in in the page.',
						goal: 'Open the account page',
					})
				},
			}),
		)

		agent.addEventListener('statuschange', () => statuses.push(agent.status))
		agent.addEventListener('activity', (event) => {
			activities.push((event as CustomEvent<AgentActivity>).detail)
		})
		agent.addEventListener('historychange', () => {
			const event = agent.history.find(
				(item): item is UserTakeoverEvent => item.type === 'user_takeover',
			)
			if (event) takeoverStatuses.push(event.status)
		})
		agent.onUserTakeover = async (request, options) => {
			expect(options?.signal).toBeInstanceOf(AbortSignal)
			expect(agent.status).toBe('waiting_for_user')
			expect(pageController.cleanUpHighlights).toHaveBeenCalledOnce()
			expect(pageController.hideMask).toHaveBeenCalledOnce()
			expect(pageController.showMask).toHaveBeenCalledOnce()
			requestSeen = request
			taskIdDuringTakeover = agent.taskId
			waitingEvent = agent.history.find(
				(item): item is UserTakeoverEvent => item.type === 'user_takeover',
			)
			expect(waitingEvent?.status).toBe('waiting')
			return 'completed'
		}

		const result = await agent.execute('Open the account page')
		const completedEvent = result.history.find(
			(item): item is UserTakeoverEvent => item.type === 'user_takeover',
		)

		expect(result.success).toBe(true)
		expect(agent.task).toBe('Open the account page')
		expect(agent.taskId).toBe(taskIdDuringTakeover)
		expect(agent.status).toBe('completed')
		expect(statuses).toEqual(['running', 'waiting_for_user', 'running', 'completed'])
		expect(requestSeen?.id).toEqual(expect.any(String))
		expect(completedEvent).toBe(waitingEvent)
		expect(completedEvent?.status).toBe('completed')
		expect(takeoverStatuses).toContain('waiting')
		expect(takeoverStatuses).toContain('completed')
		expect(activities).toContainEqual({ type: 'waiting_for_user', request: requestSeen })
		expect(pageController.cleanUpHighlights).toHaveBeenCalledTimes(2)
		expect(pageController.hideMask).toHaveBeenCalledTimes(2)
		expect(pageController.showMask).toHaveBeenCalledTimes(2)
		expect(userPrompts).toHaveLength(2)
		expect(userPrompts[1]).toContain(
			'User completed manual takeover. Re-observe the page and continue from the current task.',
		)
		expect(
			result.history.filter((event) => event.type === 'step').map((event) => event.stepIndex),
		).toEqual([0, 1])
	})

	it('returns a paused result without terminal cleanup', async () => {
		const pageController = createPageController()
		const onAfterTask = vi.fn()
		let takeoverRequested = false
		const agent = new PageAgentCore(
			createConfig({
				pageController,
				customFetch: async () => createToolCallResponse({ continue_task: {} }, 1),
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'captcha',
						title: 'Captcha required',
						message: 'Complete the captcha in the page.',
					})
				},
				onAfterTask,
			}),
		)
		agent.onUserTakeover = async () => 'paused'

		const result = await agent.execute('Continue after captcha')

		expect(result).toMatchObject({
			success: false,
			data: 'Task paused',
			state: 'paused',
		})
		expect(result.history).toBe(agent.history)
		expect(agent.status).toBe('paused')
		expect(agent.history).toContainEqual(
			expect.objectContaining({ type: 'user_takeover', status: 'paused' }),
		)
		expect(agent.history.some((event) => event.type === 'error')).toBe(false)
		expect(pageController.cleanUpHighlights).toHaveBeenCalledOnce()
		expect(pageController.hideMask).toHaveBeenCalledOnce()
		expect(onAfterTask).toHaveBeenCalledOnce()
		expect(onAfterTask).toHaveBeenCalledWith(agent, result)
	})

	it('rejects a new task while the current task is paused', async () => {
		let fetchCount = 0
		let takeoverRequested = false
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () => {
					fetchCount++
					return createToolCallResponse(
						fetchCount === 1
							? { continue_task: {} }
							: { done: { text: 'Replacement task ran', success: true } },
						fetchCount,
					)
				},
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'captcha',
						title: 'Captcha required',
						message: 'Complete the captcha in the page.',
					})
				},
			}),
		)
		agent.onUserTakeover = async () => 'paused'

		await agent.execute('Original paused task')
		const task = agent.task
		const taskId = agent.taskId
		const history = agent.history

		await expect(agent.execute('Replacement task')).rejects.toThrow('A task is already running.')
		expect(agent.status).toBe('paused')
		expect(agent.task).toBe(task)
		expect(agent.taskId).toBe(taskId)
		expect(agent.history).toBe(history)
		expect(fetchCount).toBe(1)
	})

	it('makes a paused task terminal when stopped', async () => {
		const pageController = createPageController()
		const activities: AgentActivity[] = []
		let takeoverRequested = false
		let takeoverSignal: AbortSignal | undefined
		let historyChangeCount = 0
		const agent = new PageAgentCore(
			createConfig({
				pageController,
				customFetch: async () => createToolCallResponse({ continue_task: {} }, 1),
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'permission',
						title: 'Permission required',
						message: 'Approve the permission dialog.',
					})
				},
			}),
		)
		agent.onUserTakeover = async (_request, options) => {
			takeoverSignal = options?.signal
			return 'paused'
		}
		agent.addEventListener('activity', (event) => {
			activities.push((event as CustomEvent<AgentActivity>).detail)
		})
		agent.addEventListener('historychange', () => historyChangeCount++)

		const pausedResult = await agent.execute('Complete the protected workflow')
		expect(pausedResult.state).toBe('paused')
		expect(takeoverSignal?.aborted).toBe(false)
		const historyChangesBeforeStop = historyChangeCount
		vi.mocked(pageController.cleanUpHighlights).mockClear()
		vi.mocked(pageController.hideMask).mockClear()

		agent.stop()

		const abortErrors = agent.history.filter(
			(event) => event.type === 'error' && event.message === 'Task aborted',
		)
		expect(agent.status).toBe('error')
		expect(takeoverSignal?.aborted).toBe(true)
		expect(abortErrors).toHaveLength(1)
		expect(activities).toContainEqual({ type: 'error', message: 'Task aborted' })
		expect(historyChangeCount).toBe(historyChangesBeforeStop + 1)
		expect(pageController.cleanUpHighlights).toHaveBeenCalledOnce()
		expect(pageController.hideMask).toHaveBeenCalledOnce()
		await expect(agent.resume()).rejects.toThrow('Only paused tasks can be resumed.')
	})

	it('rejects reentrant execute during terminal status settlement without mutating the task', async () => {
		let reentrantExecution: Promise<{ result?: ExecutionResult; error?: unknown }> | undefined
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () =>
					createToolCallResponse({ done: { text: 'Original task completed', success: true } }, 1),
			}),
		)
		agent.addEventListener('statuschange', () => {
			if (agent.status === 'completed') {
				reentrantExecution = agent.execute('Phantom replacement task').then(
					(result) => ({ result }),
					(error) => ({ error }),
				)
			}
		})

		const result = await agent.execute('Original task')
		const reentrant = await reentrantExecution

		expect(result.success).toBe(true)
		expect(result.data).toBe('Original task completed')
		expect(reentrant?.result).toBeUndefined()
		expect(reentrant?.error).toEqual(
			expect.objectContaining({ message: 'A task is already running.' }),
		)
		expect(agent.status).toBe('completed')
		expect(agent.task).toBe('Original task')
		expect(result.history).toBe(agent.history)
		expect(agent.history.filter((event) => event.type === 'step')).toHaveLength(1)
	})

	it('rejects takeover requests outside an active running loop', async () => {
		const onUserTakeover = vi.fn(async () => 'completed' as const)
		const agent = new PageAgentCore(createConfig())
		agent.onUserTakeover = onUserTakeover

		await expect(
			agent.requestUserTakeover({
				reason: 'other',
				title: 'Invalid request',
				message: 'This request is outside a task.',
			}),
		).rejects.toThrow('User takeover requires an active running task.')
		expect(agent.status).toBe('idle')
		expect(agent.history).toEqual([])
		expect(onUserTakeover).not.toHaveBeenCalled()
	})

	it('allows only one takeover request at a time', async () => {
		let takeoverRequested = false
		let resolveTakeover: ((resolution: 'completed') => void) | undefined
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () =>
					createToolCallResponse({ done: { text: 'Completed after takeover', success: true } }, 1),
				onBeforeStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'login',
						title: 'Sign in required',
						message: 'Complete sign in.',
					})
				},
			}),
		)
		agent.onUserTakeover = async () =>
			new Promise<'completed'>((resolve) => {
				resolveTakeover = resolve
			})

		const execution = agent.execute('Continue after sign in')
		await vi.waitFor(() => expect(agent.status).toBe('waiting_for_user'))

		await expect(
			agent.requestUserTakeover({
				reason: 'other',
				title: 'Duplicate request',
				message: 'A second request must be rejected.',
			}),
		).rejects.toThrow('A user takeover request is already active.')
		expect(agent.history.filter((event) => event.type === 'user_takeover')).toHaveLength(1)

		resolveTakeover?.('completed')
		await expect(execution).resolves.toMatchObject({ success: true })
	})

	it('cancels takeover with task stop even when an external signal is provided', async () => {
		const externalController = new AbortController()
		const addAbortListener = vi.spyOn(externalController.signal, 'addEventListener')
		const removeAbortListener = vi.spyOn(externalController.signal, 'removeEventListener')
		let takeoverSignal: AbortSignal | undefined
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () =>
					createToolCallResponse({ done: { text: 'Should not execute', success: true } }, 1),
				onBeforeStep: async (currentAgent) => {
					await currentAgent.requestUserTakeover(
						{
							reason: 'login',
							title: 'Sign in required',
							message: 'Complete sign in.',
						},
						{ signal: externalController.signal },
					)
				},
			}),
		)
		agent.onUserTakeover = async (_request, options) => {
			takeoverSignal = options?.signal
			return new Promise(() => {})
		}

		const execution = agent.execute('Wait for external takeover')
		await vi.waitFor(() => expect(agent.status).toBe('waiting_for_user'))
		agent.stop()
		const result = await execution

		expect(result).toMatchObject({ success: false, data: 'Task aborted' })
		expect(agent.status).toBe('error')
		expect(externalController.signal.aborted).toBe(false)
		expect(takeoverSignal).not.toBe(externalController.signal)
		expect(takeoverSignal?.aborted).toBe(true)
		expect(addAbortListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
		expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
		expect(
			agent.history.filter((event) => event.type === 'error' && event.message === 'Task aborted'),
		).toHaveLength(1)
	})

	it.each(['onBeforeTask', 'onBeforeStep'] as const)(
		'settles pause from %s before page observation or LLM execution',
		async (hookName) => {
			const pageController = createPageController()
			const customFetch = vi.fn(async () =>
				createToolCallResponse({ done: { text: 'Should not execute', success: true } }, 1),
			)
			const pauseHook = async (currentAgent: PageAgentCore) => {
				await currentAgent.requestUserTakeover({
					reason: 'permission',
					title: 'Permission required',
					message: 'Approve the permission dialog.',
				})
			}
			const agent = new PageAgentCore(
				createConfig({
					pageController,
					customFetch,
					[hookName]: pauseHook,
				}),
			)
			agent.onUserTakeover = async () => 'paused'

			const result = await agent.execute(`Pause from ${hookName}`)

			expect(result.state).toBe('paused')
			expect(agent.status).toBe('paused')
			expect(customFetch).not.toHaveBeenCalled()
			expect(pageController.getBrowserState).not.toHaveBeenCalled()
			expect(agent.history.filter((event) => event.type === 'step')).toHaveLength(0)
		},
	)

	it('finalizes stop during onBeforeTask takeover waiting exactly once', async () => {
		const activities: AgentActivity[] = []
		const releaseResources = vi.fn()
		const onAfterTask = vi.fn(async () => {
			releaseResources()
		})
		let takeoverSignal: AbortSignal | undefined
		const agent = new PageAgentCore(
			createConfig({
				onBeforeTask: async (currentAgent) => {
					await currentAgent.requestUserTakeover({
						reason: 'permission',
						title: 'Permission required',
						message: 'Approve the permission dialog.',
					})
				},
				onAfterTask,
			}),
		)
		agent.onUserTakeover = async (_request, options) => {
			takeoverSignal = options?.signal
			return new Promise(() => {})
		}
		agent.addEventListener('activity', (event) => {
			activities.push((event as CustomEvent<AgentActivity>).detail)
		})

		const execution = agent.execute('Pause during task setup')
		await vi.waitFor(() => expect(agent.status).toBe('waiting_for_user'))
		agent.stop()
		const result = await execution
		const abortErrors = result.history.filter(
			(event) => event.type === 'error' && event.message === 'Task aborted',
		)

		expect(result).toMatchObject({
			success: false,
			data: 'Task aborted',
			state: 'error',
		})
		expect(agent.status).toBe('error')
		expect(takeoverSignal?.aborted).toBe(true)
		expect(abortErrors).toHaveLength(1)
		expect(
			activities.filter(
				(activity) => activity.type === 'error' && activity.message === 'Task aborted',
			),
		).toHaveLength(1)
		expect(onAfterTask).toHaveBeenCalledOnce()
		expect(onAfterTask).toHaveBeenCalledWith(agent, result)
		expect(releaseResources).toHaveBeenCalledOnce()
	})

	it('keeps stop terminal when invoked during paused onAfterTask', async () => {
		const onAfterTask = vi.fn(async (currentAgent: PageAgentCore) => {
			currentAgent.stop()
		})
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () => createToolCallResponse({ continue_task: {} }, 1),
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					await currentAgent.requestUserTakeover({
						reason: 'captcha',
						title: 'Captcha required',
						message: 'Complete the captcha.',
					})
				},
				onAfterTask,
			}),
		)
		agent.onUserTakeover = async () => 'paused'

		const result = await agent.execute('Stop while settling pause')
		const abortErrors = result.history.filter(
			(event) => event.type === 'error' && event.message === 'Task aborted',
		)

		expect(result).toMatchObject({
			success: false,
			data: 'Task aborted',
			state: 'error',
		})
		expect(agent.status).toBe('error')
		expect(onAfterTask).toHaveBeenCalledOnce()
		expect(abortErrors).toHaveLength(1)
	})

	it('does not reinterpret paused onAfterTask rejection as a step failure', async () => {
		const onAfterTask = vi.fn(async () => {
			throw new Error('Paused cleanup failed')
		})
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () => createToolCallResponse({ continue_task: {} }, 1),
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					await currentAgent.requestUserTakeover({
						reason: 'permission',
						title: 'Permission required',
						message: 'Approve the permission dialog.',
					})
				},
				onAfterTask,
			}),
		)
		agent.onUserTakeover = async () => 'paused'

		await expect(agent.execute('Reject paused cleanup')).rejects.toThrow('Paused cleanup failed')

		expect(agent.status).toBe('paused')
		expect(onAfterTask).toHaveBeenCalledOnce()
		expect(agent.history.filter((event) => event.type === 'error')).toHaveLength(0)
	})

	it('does not allow resume until the paused execution loop has settled', async () => {
		const statuses: AgentStatus[] = []
		let fetchCount = 0
		let takeoverRequested = false
		let resolveTakeover: ((resolution: 'paused') => void) | undefined
		let immediateResumeAttempt: Promise<{ result?: ExecutionResult; error?: unknown }> | undefined
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async () => {
					fetchCount++
					return createToolCallResponse(
						fetchCount === 1
							? { continue_task: {} }
							: { done: { text: 'Completed after settled resume', success: true } },
						fetchCount,
					)
				},
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'captcha',
						title: 'Captcha required',
						message: 'Complete the captcha in the page.',
					})
				},
			}),
		)
		agent.onUserTakeover = async () => {
			return new Promise<'paused'>((resolve) => {
				resolveTakeover = resolve
			})
		}
		agent.addEventListener('statuschange', () => {
			statuses.push(agent.status)
			if (agent.status === 'paused') {
				immediateResumeAttempt = agent.resume().then(
					(result) => ({ result }),
					(error) => ({ error }),
				)
			}
		})

		const execution = agent.execute('Pause before continuing')
		await vi.waitFor(() => expect(agent.status).toBe('waiting_for_user'))
		resolveTakeover?.('paused')
		const pausedResult = await execution
		const immediateResume = await immediateResumeAttempt

		expect(pausedResult.state).toBe('paused')
		expect(agent.status).toBe('paused')
		expect(immediateResume?.result).toBeUndefined()
		expect(immediateResume?.error).toEqual(
			expect.objectContaining({ message: 'Paused task is still settling.' }),
		)
		expect(fetchCount).toBe(1)
		expect(agent.history.filter((event) => event.type === 'step')).toHaveLength(1)
		expect(statuses).not.toContain('completed')

		const resumedResult = await agent.resume()

		expect(resumedResult.success).toBe(true)
		expect(resumedResult.data).toBe('Completed after settled resume')
		expect(fetchCount).toBe(2)
		expect(
			resumedResult.history
				.filter((event) => event.type === 'step')
				.map((event) => event.stepIndex),
		).toEqual([0, 1])
	})

	it('resumes only paused tasks and preserves task context with monotonic step numbers', async () => {
		const idleAgent = new PageAgentCore(createConfig())
		await expect(idleAgent.resume()).rejects.toThrow('Only paused tasks can be resumed.')
		idleAgent.dispose()

		const userPrompts: string[] = []
		const fetchSignals: AbortSignal[] = []
		const beforeStepIndexes: number[] = []
		const onBeforeTask = vi.fn()
		const onAfterTask = vi.fn()
		let fetchCount = 0
		let takeoverRequested = false
		const agent = new PageAgentCore(
			createConfig({
				customFetch: async (_input, init) => {
					userPrompts.push(getUserPrompt(init))
					if (init?.signal) fetchSignals.push(init.signal)
					fetchCount++
					const action =
						fetchCount < 3
							? { continue_task: {} }
							: { done: { text: 'Completed after resume', success: true } }
					return createToolCallResponse(action, fetchCount)
				},
				customTools: { continue_task: createContinueTool() },
				onBeforeTask,
				onBeforeStep: async (_currentAgent, stepIndex) => {
					beforeStepIndexes.push(stepIndex)
				},
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'permission',
						title: 'Permission required',
						message: 'Approve the permission dialog.',
					})
				},
				onAfterTask,
			}),
		)
		agent.onUserTakeover = async () => 'paused'

		const pausedResult = await agent.execute('Complete the protected workflow')
		const task = agent.task
		const taskId = agent.taskId
		const history = agent.history

		const resumedResult = await agent.resume()

		expect(pausedResult.state).toBe('paused')
		expect(resumedResult.success).toBe(true)
		expect(resumedResult.data).toBe('Completed after resume')
		expect(agent.status).toBe('completed')
		expect(agent.task).toBe(task)
		expect(agent.taskId).toBe(taskId)
		expect(agent.history).toBe(history)
		expect(onBeforeTask).toHaveBeenCalledOnce()
		expect(onAfterTask).toHaveBeenCalledTimes(2)
		expect(beforeStepIndexes).toEqual([0, 1, 2])
		expect(fetchSignals).toHaveLength(3)
		expect(fetchSignals[1]).not.toBe(fetchSignals[0])
		expect(fetchSignals[2]).toBe(fetchSignals[1])
		expect(userPrompts).toHaveLength(3)
		expect(userPrompts.map((prompt) => getStepInfoLines(prompt)[0])).toEqual([
			'Step 1',
			'Step 2',
			'Step 3',
		])
		expect(userPrompts[1]).toContain(
			'User resumed the paused task. Re-observe the page and continue.',
		)
		expect(
			resumedResult.history
				.filter((event) => event.type === 'step')
				.map((event) => event.stepIndex),
		).toEqual([0, 1, 2])
	})

	it('preserves accumulated wait and navigation state across resume', async () => {
		const taskURL = 'https://example.com/protected'
		const pageController = createPageController()
		vi.mocked(pageController.getBrowserState).mockResolvedValue({
			...browserState,
			url: taskURL,
		})
		const userPrompts: string[] = []
		let fetchCount = 0
		let takeoverRequested = false
		const agent = new PageAgentCore(
			createConfig({
				pageController,
				customFetch: async (_input, init) => {
					userPrompts.push(getUserPrompt(init))
					fetchCount++
					return createToolCallResponse(
						fetchCount === 1
							? { wait: { seconds: 3 } }
							: { done: { text: 'Completed with preserved state', success: true } },
						fetchCount,
					)
				},
				customTools: {
					wait: tool({
						description: 'Record wait time without delaying the test',
						inputSchema: z.object({ seconds: z.number() }),
						execute: async () => 'Waited',
					}),
				},
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'permission',
						title: 'Permission required',
						message: 'Approve the permission dialog.',
					})
				},
			}),
		)
		agent.onUserTakeover = async () => 'paused'

		const pausedResult = await agent.execute('Wait, pause, then continue')
		const resumedResult = await agent.resume()
		const observations = resumedResult.history.filter((event) => event.type === 'observation')

		expect(pausedResult.state).toBe('paused')
		expect(resumedResult.success).toBe(true)
		expect(userPrompts).toHaveLength(2)
		expect(userPrompts[1]).toContain('You have waited 3 seconds accumulatively.')
		expect(
			observations.filter((event) => event.content === `Page navigated to → ${taskURL}`),
		).toHaveLength(1)
	})

	it('stops an ordinary running task with exactly one abort error', async () => {
		const pageController = createPageController()
		let fetchSignal: AbortSignal | undefined
		const agent = new PageAgentCore(
			createConfig({
				pageController,
				customFetch: async (_input, init) => {
					fetchSignal = init?.signal ?? undefined
					return new Promise((_, reject) => {
						init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
							once: true,
						})
					})
				},
			}),
		)

		const execution = agent.execute('Keep running until stopped')
		await vi.waitFor(() => expect(fetchSignal).toBeInstanceOf(AbortSignal))
		agent.stop()
		const result = await execution
		const abortErrors = agent.history.filter(
			(event) => event.type === 'error' && event.message === 'Task aborted',
		)

		expect(result).toMatchObject({ success: false, data: 'Task aborted' })
		expect(agent.status).toBe('error')
		expect(fetchSignal?.aborted).toBe(true)
		expect(abortErrors).toHaveLength(1)
	})

	it('stops without hanging while waiting for user takeover', async () => {
		const pageController = createPageController()
		const onAfterTask = vi.fn()
		let takeoverRequested = false
		let takeoverSignal: AbortSignal | undefined
		const agent = new PageAgentCore(
			createConfig({
				pageController,
				customFetch: async () => createToolCallResponse({ continue_task: {} }, 1),
				customTools: { continue_task: createContinueTool() },
				onAfterStep: async (currentAgent) => {
					if (takeoverRequested) return
					takeoverRequested = true
					await currentAgent.requestUserTakeover({
						reason: 'other',
						title: 'Manual action required',
						message: 'Complete the manual action.',
					})
				},
				onAfterTask,
			}),
		)
		agent.onUserTakeover = async (_request, options) => {
			takeoverSignal = options?.signal
			return new Promise(() => {})
		}

		const execution = agent.execute('Wait for manual action')
		await vi.waitFor(() => expect(agent.status).toBe('waiting_for_user'))
		agent.stop()
		const result: ExecutionResult = await execution

		expect(takeoverSignal?.aborted).toBe(true)
		expect(result).toMatchObject({ success: false, data: 'Task aborted' })
		expect(result.state).not.toBe('paused')
		expect(agent.status).toBe('error')
		expect(agent.history).toContainEqual(
			expect.objectContaining({ type: 'user_takeover', status: 'waiting' }),
		)
		expect(
			agent.history.filter((event) => event.type === 'error' && event.message === 'Task aborted'),
		).toHaveLength(1)
		expect(pageController.cleanUpHighlights).toHaveBeenCalled()
		expect(pageController.hideMask).toHaveBeenCalled()
		expect(onAfterTask).toHaveBeenCalledOnce()
	})
})
