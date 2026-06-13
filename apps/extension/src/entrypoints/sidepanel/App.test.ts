import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

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
