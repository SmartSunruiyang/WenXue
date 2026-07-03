import type {
	AgentActivity,
	HistoricalEvent,
	UserTakeoverEvent,
	UserTakeoverRequest,
} from '@page-agent/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
	Conversation,
	createPausedTakeoverActionModel,
	createTakeoverActionModel,
} from './conversation'

const LOGIN_REQUEST: UserTakeoverRequest = {
	id: 'takeover-login',
	reason: 'login',
	title: 'Sign in to continue',
	message: 'Finish signing in on the page, then return here.',
	goal: 'Open the course dashboard',
	lastAction: {
		name: 'click_element_by_index',
		input: { index: 7 },
		output: 'Login dialog opened',
	},
}

function renderConversation(
	props: Partial<Parameters<typeof Conversation>[0]> & {
		events?: HistoricalEvent[]
	} = {},
) {
	return renderToStaticMarkup(
		createElement(Conversation, {
			task: 'Open my course',
			events: [],
			...props,
		}),
	)
}

describe('Conversation takeover UI', () => {
	it('renders continued user turns as separate bubbles without duplicating the current task', () => {
		const html = renderConversation({
			task: '继续追问',
			events: [
				{ type: 'user_message', content: '第一轮问题' },
				{ type: 'observation', content: '已阅读页面' },
				{ type: 'user_message', content: '继续追问' },
			],
		})

		expect(html).toContain('第一轮问题')
		expect(html).toContain('继续追问')
		expect(html.match(/继续追问/g)).toHaveLength(1)
		expect(html.indexOf('第一轮问题')).toBeLessThan(html.indexOf('已阅读页面'))
		expect(html.indexOf('已阅读页面')).toBeLessThan(html.indexOf('继续追问'))
	})

	it('connects complete and pause actions to the supplied callbacks', () => {
		const complete = vi.fn()
		const pause = vi.fn()
		const actions = createTakeoverActionModel(LOGIN_REQUEST, {
			onComplete: complete,
			onPause: pause,
		})

		actions.primary.onSelect()
		actions.secondary.onSelect()

		expect(complete).toHaveBeenCalledTimes(1)
		expect(pause).toHaveBeenCalledTimes(1)
		expect(actions.primary.label).toBe('takeoverCompleted')
		expect(actions.secondary.label).toBe('pauseTask')
	})

	it('connects the paused resume action to the supplied callback', () => {
		const resume = vi.fn()
		const action = createPausedTakeoverActionModel(resume)

		action.onSelect()

		expect(resume).toHaveBeenCalledTimes(1)
		expect(action.label).toBe('resumeTask')
	})

	it('renders one active waiting card with request details and actions', () => {
		const waitingEvent: UserTakeoverEvent = {
			type: 'user_takeover',
			request: LOGIN_REQUEST,
			status: 'waiting',
		}
		const activity: AgentActivity = {
			type: 'waiting_for_user',
			request: LOGIN_REQUEST,
		}

		const html = renderConversation({
			events: [waitingEvent],
			activity,
			status: 'waiting_for_user',
			takeoverRequest: LOGIN_REQUEST,
			onCompleteTakeover: () => {},
			onPauseTakeover: () => {},
		})

		expect(html.match(/Sign in to continue/g)).toHaveLength(1)
		expect(html).toContain('Finish signing in on the page')
		expect(html).toContain('Open the course dashboard')
		expect(html).toContain('click_element_by_index')
		expect(html).toContain('&quot;index&quot;: 7')
		expect(html).toContain('Login dialog opened')
		expect(html).toContain('已完成，继续')
		expect(html).toContain('暂停')
		expect(html).not.toContain('需要你接管当前页面后继续')
	})

	it('uses the stuck takeover primary action label', () => {
		const stuckRequest: UserTakeoverRequest = {
			...LOGIN_REQUEST,
			id: 'takeover-stuck',
			reason: 'stuck',
			title: 'Repeated action',
		}

		const html = renderConversation({
			status: 'waiting_for_user',
			takeoverRequest: stuckRequest,
		})

		expect(html).toContain('我已接管，继续')
	})

	it('renders the latest paused takeover as one actionable preserved card', () => {
		const pausedEvent: UserTakeoverEvent = {
			type: 'user_takeover',
			request: LOGIN_REQUEST,
			status: 'paused',
		}

		const html = renderConversation({
			events: [pausedEvent],
			status: 'paused',
			onResumePausedTask: () => {},
		})

		expect(html.match(/Sign in to continue/g)).toHaveLength(1)
		expect(html).toContain('任务已暂停')
		expect(html).toContain('Finish signing in on the page')
		expect(html).toContain('继续')
		expect(html).not.toContain('接管已完成')
	})

	it('renders completed takeover history as a compact note', () => {
		const completedEvent: UserTakeoverEvent = {
			type: 'user_takeover',
			request: LOGIN_REQUEST,
			status: 'completed',
		}

		const html = renderConversation({ events: [completedEvent], status: 'completed' })

		expect(html).toContain('接管已完成')
		expect(html).toContain('Sign in to continue')
		expect(html).not.toContain('暂停')
	})

	it('renders waiting activity without reading an error message field', () => {
		const html = renderConversation({
			activity: { type: 'waiting_for_user', request: LOGIN_REQUEST },
			status: 'waiting_for_user',
		})

		expect(html).toContain('等待人工接管')
	})
})
