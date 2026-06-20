import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SidepanelHistoryButton } from './App'

const APP_SOURCE = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('Sidepanel new conversation transition', () => {
	it('collects the visible conversation into the history button before showing home', () => {
		const source = readFileSync(APP_SOURCE, 'utf8')

		expect(source).toContain('wx-conversation-collect-to-history')
		expect(source).toContain('wx-history-collect-target')
		expect(source).not.toContain('slide-out-to-bottom')
		expect(source).not.toContain('zoom-out-95')
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
