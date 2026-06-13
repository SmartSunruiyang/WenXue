import { describe, expect, it } from 'vitest'

import { buildHistoryExportFilename } from './history-export'

describe('history export filenames', () => {
	it('uses the WenXue product prefix instead of the upstream page-agent prefix', () => {
		const filename = buildHistoryExportFilename(
			'Find Page Agent docs',
			Date.UTC(2026, 5, 14, 8, 9, 10),
		)

		expect(filename).toMatch(/^wenxue-history-find-page-agent-docs-/)
		expect(filename).not.toMatch(/^page-agent-history/)
	})
})
