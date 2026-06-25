import type { HistoricalEvent } from '@page-agent/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ContextBanner, shouldShowContextBanner } from './ContextBanner'

describe('shouldShowContextBanner', () => {
	it('shows the context banner when last step nears hard limit', () => {
		const history = [
			{
				type: 'step',
				stepIndex: 0,
				reflection: {},
				action: { name: 'click_element_by_index', input: {}, output: '' },
				usage: { promptTokens: 30_000, completionTokens: 0, totalTokens: 30_000 },
			},
		] as HistoricalEvent[]

		expect(shouldShowContextBanner(history, 28_000)).toBe(true)
		expect(shouldShowContextBanner([], 28_000)).toBe(false)
	})
})

describe('ContextBanner', () => {
	it('renders the new-conversation and continue actions', () => {
		const html = renderToStaticMarkup(
			createElement(ContextBanner, {
				onNewConversation: () => {},
				onDismiss: () => {},
			}),
		)

		expect(html).toContain('上下文已较长，建议开启新会话以获得更好效果')
		expect(html).toContain('新会话')
		expect(html).toContain('继续当前会话')
	})
})
