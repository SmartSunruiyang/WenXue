import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SessionRecord } from '@/lib/db'

import { HistoryDetailActions } from './HistoryDetail'

const SESSION: SessionRecord = {
	id: 'session-1',
	conversationId: 'conversation-1',
	updatedAt: 1,
	task: 'Repeat this task',
	history: [],
	status: 'completed',
	createdAt: 1,
}

describe('HistoryDetailActions', () => {
	it('renders rerun and go-to-session disabled while a task is active', () => {
		const html = renderToStaticMarkup(
			createElement(HistoryDetailActions, {
				session: SESSION,
				onRerun: vi.fn(),
				onGoToSession: vi.fn(),
				onDelete: vi.fn(),
				canRerun: false,
				canGoToSession: false,
			}),
		)

		expect(html.match(/\sdisabled=""/g)).toHaveLength(2)
	})
})
