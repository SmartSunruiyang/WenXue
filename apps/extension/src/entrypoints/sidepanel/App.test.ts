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

describe('Sidepanel active-task locking', () => {
	it('uses the shared active-status helper for task controls and takeover wiring', () => {
		const source = readFileSync(APP_SOURCE, 'utf8')

		expect(source).toContain('isAgentTaskActive(status)')
		expect(source).toContain('canGoToSession={!isTaskLocked}')
		expect(source).toContain('disabled={isTaskLocked || clearingConversation}')
		expect(source).toContain('disabled={isTaskLocked}')
		expect(source).toContain('takeoverRequest={takeoverRequest}')
		expect(source).toContain('onCompleteTakeover={completeUserTakeover}')
		expect(source).toContain('onPauseTakeover={pauseUserTakeover}')
		expect(source).toContain('onResumePausedTask={handleResume}')
		expect(source).toContain("status === 'waiting_for_user' || status === 'paused'")
	})
})
