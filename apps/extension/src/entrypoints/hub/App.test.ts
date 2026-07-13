import { describe, expect, it } from 'vitest'

import { HUB_AGENT_OPTIONS } from './App'

describe('Hub agent configuration', () => {
	it('keeps manual takeover capability disabled until the external API supports it', () => {
		expect(HUB_AGENT_OPTIONS).toEqual({
			enableUserTakeover: false,
			enableUserQuestions: false,
		})
	})
})
