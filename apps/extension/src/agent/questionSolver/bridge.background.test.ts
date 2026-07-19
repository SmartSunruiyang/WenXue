import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QuestionSolverBackgroundState } from './backgroundState'
import {
	QuestionSolverBackgroundBridge,
	type QuestionSolverBackgroundApi,
} from './bridge.background'
import type { FrameRef, JsonValue, RunIdentity } from './contracts'
import type { MainWorldRequest, SolverRequest, SolverResponse } from './protocol'

const LEASE = 'lease-token-that-is-long-enough-for-the-solver'
const IDENTITY: RunIdentity = { taskId: 'task', taskEpoch: 1, runId: 'run-1' }
const ADAPTER = { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 }
const OUTER = {
	id: 'extension-id',
	url: 'chrome-extension://extension-id/hub.html',
} as chrome.runtime.MessageSender
const CONTENT = {
	id: 'extension-id',
	tab: { id: 1 } as chrome.tabs.Tab,
	frameId: 0,
	documentId: 'document-1',
	url: 'https://mooc1.chaoxing.com/mooc2/work/dowork',
} as chrome.runtime.MessageSender

describe('QuestionSolverBackgroundBridge', () => {
	let state: QuestionSolverBackgroundState
	let api: QuestionSolverBackgroundApi
	let bridge: QuestionSolverBackgroundBridge
	let frame: FrameRef

	beforeEach(async () => {
		state = new QuestionSolverBackgroundState()
		api = {
			runtimeId: 'extension-id',
			extensionBaseUrl: 'chrome-extension://extension-id/',
			getAllFrames: vi.fn(async () => []),
			sendTabMessage: vi.fn(async () => undefined),
			executeMainWorld: vi.fn(async () => ({ updated: 1 })),
			captureVisiblePng: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==' })),
			cropAsset: vi.fn(async (args) => ({
				kind: 'question_solver_image_asset' as const,
				assetId: 'asset-1',
				runId: args.runId,
				questionFingerprint: args.questionFingerprint,
				anchorKey: args.anchorKey,
				mimeType: 'image/jpeg' as const,
				base64: 'AA==',
				sha256: 'a'.repeat(64),
				width: 1,
				height: 1,
				byteLength: 1,
			})),
		}
		bridge = new QuestionSolverBackgroundBridge(state, api)
		await state.registerTaskLease({
			taskId: 'task',
			taskEpoch: 1,
			leaseToken: LEASE,
			managedTabIds: [1],
			targetTabId: 1,
		})
		frame = await registerFrame(state)
	})

	it('rejects solver control from a web-page sender before routing it', async () => {
		await expect(
			bridge.handleMessage(request('probe'), {
				...OUTER,
				url: 'https://attacker.invalid/',
			} as chrome.runtime.MessageSender),
		).rejects.toThrow('outer_solver_sender_not_extension')
		expect(api.sendTabMessage).not.toHaveBeenCalled()
	})

	it('discovers frames through one-shot challenges bound to the actual content sender', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'inspect',
			scope: 'current_page',
		})
		vi.mocked(api.getAllFrames).mockResolvedValue([
			{ frameId: 0, parentFrameId: -1, documentId: 'document-2' },
		])
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) => {
			const challenge = message as { nonce: string }
			return bridge.handleMessage(
				{
					type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
					protocolVersion: 1,
					nonce: challenge.nonce,
					documentToken: 'document-token-2',
					urlFingerprint: 'b'.repeat(64),
				},
				{ ...CONTENT, documentId: 'document-2' },
			)
		})

		const result = await bridge.handleMessage(
			{
				type: 'QUESTION_SOLVER_DISCOVER',
				protocolVersion: 1,
				identity: IDENTITY,
				leaseToken: LEASE,
				tabId: 1,
			},
			OUTER,
		)

		expect(result).toMatchObject({
			ok: true,
			data: { frames: [{ documentId: 'document-2', documentToken: 'document-token-2' }] },
		})
	})

	it('allows only parent-bound fixed MAIN-world setters with matching transaction metadata', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'fill',
			scope: 'current_page',
		})
		const fingerprint = 'b'.repeat(64)
		const digest = 'a'.repeat(64)
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) => {
			const outer = message as SolverRequest
			const main: MainWorldRequest = {
				type: 'QUESTION_SOLVER_MAIN_WORLD',
				protocolVersion: 1,
				kind: 'request',
				identity: IDENTITY,
				requestId: 'main-1',
				parentRequestId: outer.requestId,
				phase: 'business',
				leaseToken: LEASE,
				target: frame,
				adapter: ADAPTER,
				operationId: 'common.native_input_set',
				transactionId: 'transaction-1',
				snapshotDigestVersion: 1,
				snapshotDigest: digest,
				questionFingerprint: fingerprint,
				args: { questionFingerprint: fingerprint, values: [{ key: '1', value: 'answer' }] },
			}
			const mainResponse = await bridge.handleMessage(main, CONTENT)
			expect(mainResponse).toMatchObject({ ok: true, parentRequestId: outer.requestId })
			return success(outer, [{ result: 'written' }])
		})

		const response = await bridge.handleMessage(
			request('fill', {
				adapter: ADAPTER,
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					transaction: {
						transactionId: 'transaction-1',
						snapshotDigestVersion: 1,
						snapshotDigest: digest,
					},
					commands: [{ locator: { fingerprint } }],
				},
			}),
			OUTER,
		)

		expect(response).toMatchObject({ ok: true, data: [{ result: 'written' }] })
		expect(api.executeMainWorld).toHaveBeenCalledWith({
			operationId: 'common.native_input_set',
			operationArgs: expect.any(Object),
			target: frame,
		})
	})

	it('quarantines a run when a MAIN-world setter outcome is uncertain', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'fill',
			scope: 'current_page',
		})
		const fingerprint = 'b'.repeat(64)
		const digest = 'a'.repeat(64)
		vi.mocked(api.executeMainWorld).mockRejectedValue(new Error('execution_channel_lost'))
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) => {
			const outer = message as SolverRequest
			const main: MainWorldRequest = {
				type: 'QUESTION_SOLVER_MAIN_WORLD',
				protocolVersion: 1,
				kind: 'request',
				identity: IDENTITY,
				requestId: 'main-failed',
				parentRequestId: outer.requestId,
				phase: 'business',
				leaseToken: LEASE,
				target: frame,
				adapter: ADAPTER,
				operationId: 'common.native_input_set',
				transactionId: 'transaction-1',
				snapshotDigestVersion: 1,
				snapshotDigest: digest,
				questionFingerprint: fingerprint,
				args: { questionFingerprint: fingerprint, values: [{ key: '1', value: 'answer' }] },
			}
			const mainResponse = await bridge.handleMessage(main, CONTENT)
			expect(mainResponse).toMatchObject({ ok: false, requestId: 'main-failed' })
			return success(outer, [{ result: 'content-observed-main-failure' }])
		})

		const response = await bridge.handleMessage(
			request('fill', {
				adapter: ADAPTER,
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					transaction: {
						transactionId: 'transaction-1',
						snapshotDigestVersion: 1,
						snapshotDigest: digest,
					},
					commands: [{ locator: { fingerprint } }],
				},
			}),
			OUTER,
		)

		expect(response).toMatchObject({ ok: true })
		expect(state.getEffect(IDENTITY.runId, 'main-failed')).toBeDefined()
		await expect(state.finishRun(IDENTITY, true)).resolves.toBe('quarantined')
	})

	it('retains a passive-capture arm effect until fixed disarm succeeds', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'answer',
			scope: 'current_page',
		})
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) =>
			success(message as SolverRequest, { armed: true }),
		)

		const arm = await bridge.handleMessage(
			request('embedded_arm', {
				adapter: ADAPTER,
				payload: {
					solverAction: 'answer',
					solverScope: 'current_page',
					transactionId: 'arm-transaction',
				},
			}),
			OUTER,
		)
		expect(arm).toMatchObject({ ok: true })
		expect(state.getEffect(IDENTITY.runId, 'request-embedded_arm')).toMatchObject({
			operation: 'embedded_arm',
		})

		const disarm = await bridge.handleMessage(
			request('embedded_disarm', {
				adapter: ADAPTER,
				phase: 'cleanup',
				payload: {
					solverAction: 'answer',
					solverScope: 'current_page',
					transactionId: 'disarm-transaction',
				},
			}),
			OUTER,
		)
		expect(disarm).toMatchObject({ ok: true })
		expect(state.getEffect(IDENTITY.runId, 'request-embedded_arm')).toBeUndefined()
		await expect(state.finishRun(IDENTITY, true)).resolves.toBe('closed')
	})

	it('rehydrates and disarms an uncertain passive capture before closing quarantine', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'answer',
			scope: 'current_page',
		})
		await state.acquireMutationOwner(IDENTITY)
		await state.recordEffectDispatch(IDENTITY, {
			requestId: 'uncertain-arm',
			operation: 'embedded_arm',
			tabId: 1,
			documentId: 'document-1',
			documentToken: 'document-token-1',
		})
		await state.finishRun(IDENTITY, false)
		const nonce = await state.createFrameChallenge({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'document-1',
		})

		await bridge.handleMessage(
			{
				type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
				protocolVersion: 1,
				nonce,
				documentToken: 'document-token-1',
				urlFingerprint: 'a'.repeat(64),
			},
			CONTENT,
		)

		expect(api.executeMainWorld).toHaveBeenCalledWith({
			operationId: 'common.passive_capture_disarm',
			operationArgs: {},
			target: frame,
		})
		expect(state.getEffect(IDENTITY.runId, 'uncertain-arm')).toBeUndefined()
		expect(state.getRunLifecycle(IDENTITY.runId)).toBe('closed')
	})

	it('keeps screenshot preparation, crop and visual restore inside one image request', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'answer',
			scope: 'current_page',
		})
		const operations: string[] = []
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) => {
			const control = message as SolverRequest
			operations.push(control.operation)
			if (control.operation === 'image_resolve') {
				return success(control, {
					kind: 'capture_required',
					preparation: {
						transactionId: 'visual-1',
						anchorKey: 'anchor-1',
						localRectCssPx: { x: 10, y: 20, width: 30, height: 40 },
						viewportCssPx: { width: 800, height: 600 },
						fullyVisibleInFrame: true,
						scrollWasChanged: true,
					},
				})
			}
			return success(control, { restored: true })
		})

		const response = await bridge.handleMessage(
			request('image_resolve', {
				adapter: ADAPTER,
				payload: {
					solverAction: 'answer',
					solverScope: 'current_page',
					locator: { fingerprint: 'b'.repeat(64) },
					anchorKey: 'anchor-1',
					policy: 'inline_then_bound_crop',
				},
			}),
			OUTER,
		)

		expect(response).toMatchObject({
			ok: true,
			data: { kind: 'resolved', envelope: { assetId: 'asset-1' } },
		})
		expect(operations).toEqual(['image_resolve', 'visual_restore'])
		expect(api.captureVisiblePng).toHaveBeenCalledOnce()
		expect(api.cropAsset).toHaveBeenCalledOnce()
	})

	it('restores pending visual transactions after a worker restart before releasing quarantine', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'answer',
			scope: 'current_page',
		})
		await state.acquireMutationOwner(IDENTITY)
		await state.recordEffectDispatch(IDENTITY, {
			requestId: 'uncertain-image',
			operation: 'image_resolve',
			tabId: 1,
			documentId: 'document-1',
			documentToken: 'document-token-1',
		})
		await state.finishRun(IDENTITY, false)
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) => {
			if ((message as { type?: string }).type === 'QUESTION_SOLVER_RELEASE') return { ok: true }
			return { ok: true, data: { restored: true, restoredCount: 1 } }
		})
		const nonce = await state.createFrameChallenge({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'document-1',
		})

		await bridge.handleMessage(
			{
				type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
				protocolVersion: 1,
				nonce,
				documentToken: 'document-token-1',
				urlFingerprint: 'a'.repeat(64),
			},
			CONTENT,
		)

		expect(state.getRunLifecycle(IDENTITY.runId)).toBe('closed')
		expect(state.getEffect(IDENTITY.runId, 'uncertain-image')).toBeUndefined()
		expect(
			vi
				.mocked(api.sendTabMessage)
				.mock.calls.map(([, message]) =>
					(message as { type?: string }).type === 'QUESTION_SOLVER_RELEASE'
						? 'release'
						: (message as { operation?: string }).operation,
				),
		).toEqual(['visual_restore', 'release'])
	})

	it('rehydrates a quarantined setter by inventorying and restoring the content journal', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'fill',
			scope: 'current_page',
		})
		await state.acquireMutationOwner(IDENTITY)
		await state.recordEffectDispatch(IDENTITY, {
			requestId: 'late-setter',
			operation: 'common.native_input_set',
			tabId: 1,
			documentId: 'document-1',
			documentToken: 'document-token-1',
			transactionId: 'transaction-1',
			snapshotDigest: 'e'.repeat(64),
		})
		await state.finishRun(IDENTITY, false)
		vi.mocked(api.sendTabMessage).mockImplementation(async (_tabId, message) => {
			const recovery = message as { operation: string }
			return recovery.operation === 'inventory'
				? { ok: true, data: { available: true } }
				: { ok: true, data: { restored: true, verified: true } }
		})
		const nonce = await state.createFrameChallenge({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'document-1',
		})

		await bridge.handleMessage(
			{
				type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
				protocolVersion: 1,
				nonce,
				documentToken: 'document-token-1',
				urlFingerprint: 'a'.repeat(64),
			},
			CONTENT,
		)

		expect(state.getRunLifecycle(IDENTITY.runId)).toBe('closed')
		expect(state.getMutationOwner(1)).toBeUndefined()
		expect(
			vi
				.mocked(api.sendTabMessage)
				.mock.calls.map(([, message]) =>
					(message as { type?: string }).type === 'QUESTION_SOLVER_RELEASE'
						? 'release'
						: (message as { operation?: string }).operation,
				),
		).toEqual(['inventory', 'state_restore', 'release'])
	})

	it('releases content-owned run state after a verified finish', async () => {
		await state.beginRun({
			identity: IDENTITY,
			leaseToken: LEASE,
			tabId: 1,
			action: 'inspect',
			scope: 'current_page',
		})

		const result = await bridge.handleMessage(
			{
				type: 'QUESTION_SOLVER_RUN',
				protocolVersion: 1,
				operation: 'finish',
				identity: IDENTITY,
				leaseToken: LEASE,
				cleanupVerified: true,
			},
			OUTER,
		)

		expect(result).toEqual({ ok: true, lifecycle: 'closed' })
		expect(api.sendTabMessage).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				type: 'QUESTION_SOLVER_RELEASE',
				identity: IDENTITY,
				preserveRecovery: false,
			}),
			{ documentId: 'document-1' },
		)
	})
})

async function registerFrame(state: QuestionSolverBackgroundState): Promise<FrameRef> {
	const nonce = await state.createFrameChallenge({
		identity: IDENTITY,
		leaseToken: LEASE,
		tabId: 1,
		frameId: 0,
		parentFrameId: -1,
		documentId: 'document-1',
	})
	return state.consumeFrameChallenge(
		{
			type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
			protocolVersion: 1,
			nonce,
			documentToken: 'document-token-1',
			urlFingerprint: 'a'.repeat(64),
		},
		CONTENT,
	)
}

function request(
	operation: SolverRequest['operation'],
	overrides: Partial<SolverRequest> = {},
): SolverRequest {
	return {
		type: 'QUESTION_SOLVER_CONTROL',
		protocolVersion: 1,
		kind: 'request',
		identity: IDENTITY,
		requestId: `request-${operation}`,
		requestSeq: 1,
		leaseToken: LEASE,
		target: {
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'document-1',
			documentToken: 'document-token-1',
			urlFingerprint: 'a'.repeat(64),
		},
		operation,
		payload: { solverAction: 'inspect', solverScope: 'current_page' },
		...overrides,
	}
}

function success(request: SolverRequest, data: JsonValue): SolverResponse {
	return {
		ok: true,
		identity: request.identity,
		requestId: request.requestId,
		requestSeq: request.requestSeq,
		targetDocumentToken: request.target.documentToken,
		data,
	}
}
