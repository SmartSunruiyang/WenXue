import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { HistoryRerunControl } from './HistoryList'

describe('HistoryRerunControl', () => {
	it('renders visibly disabled while rerun is locked', () => {
		const html = renderToStaticMarkup(
			createElement(HistoryRerunControl, {
				task: 'Repeat this task',
				onRerun: vi.fn(),
				canRerun: false,
			}),
		)

		expect(html).toMatch(/<button[^>]*\sdisabled(?:=""|>)/)
		expect(html).toContain('cursor-not-allowed')
	})

	it('remains enabled by default for source-compatible callers', () => {
		const html = renderToStaticMarkup(
			createElement(HistoryRerunControl, {
				task: 'Repeat this task',
				onRerun: vi.fn(),
			}),
		)

		expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=""|>)/)
	})
})
