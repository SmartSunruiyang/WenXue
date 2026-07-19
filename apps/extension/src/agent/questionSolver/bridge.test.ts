import { describe, expect, it, vi } from 'vitest'

import {
	QuestionSolverBridge,
	QuestionSolverBridgeError,
	type QuestionSolverTransport,
} from './bridge'
import type { FrameRef } from './contracts'
import type { SolverRequest } from './protocol'

const FRAME: FrameRef = {
	tabId: 1,
	frameId: 0,
	parentFrameId: -1,
	documentId: 'document-1',
	documentToken: 'document-token-1',
	urlFingerprint: 'a'.repeat(64),
}

describe('QuestionSolverBridge', () => {
	it('begins a task-bound run and injects background recovery admission only for state capture', async () => {
		const sent: unknown[] = []
		const transport: QuestionSolverTransport = {
			send: vi.fn(async (message) => {
				sent.push(message)
				const record = message as any
				if (record.type === 'QUESTION_SOLVER_RUN' && record.operation === 'begin') {
					return { ok: true, recoveryCapabilityHash: 'b'.repeat(64) }
				}
				return {
					ok: true,
					identity: record.identity,
					requestId: record.requestId,
					requestSeq: record.requestSeq,
					laneKey: record.laneKey,
					generation: record.generation,
					targetDocumentToken: record.target.documentToken,
					data: { transactionId: 'transaction-1' },
				}
			}),
		}
		const bridge = new QuestionSolverBridge(lease(), transport)
		const run = await bridge.begin('fill', 'current_page')
		await run.request(FRAME, 'state_capture', { payload: { commands: [] } })

		const capture = sent.find(
			(message) => (message as any).operation === 'state_capture',
		) as SolverRequest
		expect(capture.payload).toMatchObject({
			solverAction: 'fill',
			solverScope: 'current_page',
			recoveryCapabilityHash: 'b'.repeat(64),
		})
	})

	it('rejects stale document-bound responses', async () => {
		const transport: QuestionSolverTransport = {
			send: vi.fn(async (message) => {
				const record = message as any
				if (record.operation === 'begin') {
					return { ok: true, recoveryCapabilityHash: 'b'.repeat(64) }
				}
				return {
					ok: true,
					identity: record.identity,
					requestId: record.requestId,
					requestSeq: record.requestSeq,
					targetDocumentToken: 'replaced-document',
					data: {},
				}
			}),
		}
		const run = await new QuestionSolverBridge(lease(), transport).begin('inspect', 'current_page')

		await expect(run.request(FRAME, 'probe')).rejects.toBeInstanceOf(QuestionSolverBridgeError)
	})

	it('returns frame discovery without constructing content identities in the caller', async () => {
		const transport: QuestionSolverTransport = {
			send: vi.fn(async (message) => {
				const record = message as any
				if (record.operation === 'begin') {
					return { ok: true, recoveryCapabilityHash: 'b'.repeat(64) }
				}
				return { ok: true, data: { frames: [FRAME], incompleteFrameIds: [] } }
			}),
		}
		const run = await new QuestionSolverBridge(lease(), transport).begin('answer', 'current_page')

		await expect(run.discoverFrames()).resolves.toEqual({
			frames: [FRAME],
			incompleteFrameIds: [],
		})
	})
})

function lease() {
	return {
		taskId: 'task',
		taskEpoch: 1,
		leaseToken: 'lease-token-that-is-long-enough-for-the-solver',
		managedTabIds: [1],
		targetTabId: 1,
	}
}
