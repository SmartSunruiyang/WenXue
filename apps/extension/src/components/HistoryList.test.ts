import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HISTORY_LIST_SOURCE = fileURLToPath(new URL('./HistoryList.tsx', import.meta.url))

describe('HistoryList layout source', () => {
	it('renders history records as cards without divider borders', () => {
		const source = readFileSync(HISTORY_LIST_SOURCE, 'utf8')

		expect(source).toContain('rounded-lg')
		expect(source).not.toMatch(/(?:^|[\s"'])border-b(?:$|[\s"'])/)
	})

	it('exposes a button for returning to the saved conversation context', () => {
		const source = readFileSync(HISTORY_LIST_SOURCE, 'utf8')

		expect(source).toContain('onGoToSession')
		expect(source).toContain("t('goToSession')")
	})
})
