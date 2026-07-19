// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QuestionSolverAdapterHost } from './adapterHost.content'
import type {
	ControlSnapshot,
	FillCommand,
	FrameRef,
	JsonValue,
	StructuredAnswer,
} from './contracts'
import { sha256Hex } from './fingerprints'
import type { SolverReleaseRequest, SolverRequest } from './protocol'

const URL = 'https://mooc1.chaoxing.com/mooc2/work/dowork?id=1'

describe('QuestionSolverAdapterHost', () => {
	let host: QuestionSolverAdapterHost
	let frame: FrameRef

	beforeEach(() => {
		document.body.innerHTML = fixture()
		frame = {
			tabId: 1,
			frameId: 0,
			parentFrameId: -1,
			documentId: 'document-1',
			documentToken: 'document-token-1',
			urlFingerprint: 'a'.repeat(64),
		}
		host = new QuestionSolverAdapterHost({
			environment: { getUrl: () => URL },
			fetchImpl: vi.fn(async () => new Response(null, { status: 403 })),
			randomId: (() => {
				let id = 0
				return () => `request-id-${++id}`
			})(),
		})
		host.activate(frame, { taskId: 'task', taskEpoch: 1 })
	})

	it('selects a known adapter before generic fallback and preserves image anchors', async () => {
		const probe = await host.handleRequest(request('probe'))
		expect(probe).toMatchObject({
			ok: true,
			data: {
				ambiguous: false,
				selected: { ref: { variant: 'chaoxing.modern_work_exam' } },
			},
		})
		const extract = await host.handleRequest(
			request('extract', {
				adapter: chaoxingRef(),
				payload: { solverAction: 'answer', solverScope: 'current_page' },
			}),
		)
		expect(extract.ok).toBe(true)
		const [question] = (extract as { ok: true; data: any[] }).data
		expect(question.stem.map((part: any) => part.type)).toEqual(['text', 'image', 'text'])
		expect(question.visualAnchorKeys).toHaveLength(1)

		const image = await host.handleRequest(
			request('image_resolve', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'answer',
					solverScope: 'current_page',
					locator: question.locator,
					anchorKey: question.visualAnchorKeys[0],
					policy: 'inline_then_bound_crop',
				},
			}),
		)
		expect(image.ok, JSON.stringify(image)).toBe(true)
		expect(image).toMatchObject({ ok: true, data: { kind: 'capture_required' } })
		await expect(
			host.handleRecovery({
				type: 'QUESTION_SOLVER_RECOVERY',
				protocolVersion: 1,
				recoveryId: 'visual-recovery-1',
				runId: 'run-1',
				operation: 'visual_restore',
				recoveryCapability: 'c'.repeat(64),
				target: frame,
			}),
		).resolves.toMatchObject({ restored: true, restoredCount: 1 })
	})

	it('downsamples an oversized inline image before it crosses the content boundary', async () => {
		const close = vi.fn()
		const createBitmap = vi.fn(async () => ({ width: 3_200, height: 1_600, close }))
		const convertToBlob = vi.fn(async () =>
			new Response(new Uint8Array(256), {
				headers: { 'Content-Type': 'image/jpeg' },
			}).blob(),
		)
		vi.stubGlobal('createImageBitmap', createBitmap)
		vi.stubGlobal(
			'OffscreenCanvas',
			class {
				constructor(
					readonly width: number,
					readonly height: number,
				) {}
				getContext() {
					return { drawImage: vi.fn() }
				}
				async convertToBlob() {
					return convertToBlob()
				}
			},
		)
		try {
			const oversized = await new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
				headers: { 'Content-Type': 'image/png' },
			}).blob()
			const fetchInline = vi.fn(async () => ({ ok: true, blob: async () => oversized }) as Response)
			const inlineHost = new QuestionSolverAdapterHost({
				environment: { getUrl: () => URL },
				fetchImpl: fetchInline,
				randomId: () => 'inline-asset-1',
			})
			inlineHost.activate(frame, { taskId: 'task', taskEpoch: 1 })
			await inlineHost.handleRequest(request('probe'))
			const extracted = await inlineHost.handleRequest(
				request('extract', {
					adapter: chaoxingRef(),
					payload: { solverAction: 'answer', solverScope: 'current_page' },
				}),
			)
			const [question] = (extracted as unknown as { ok: true; data: any[] }).data

			const image = await inlineHost.handleRequest(
				request('image_resolve', {
					adapter: chaoxingRef(),
					payload: {
						solverAction: 'answer',
						solverScope: 'current_page',
						locator: question.locator,
						anchorKey: question.visualAnchorKeys[0],
						policy: 'inline_then_bound_crop',
					},
				}),
			)

			expect(fetchInline).toHaveBeenCalledOnce()
			expect(createBitmap).toHaveBeenCalledOnce()
			expect(convertToBlob).toHaveBeenCalledOnce()
			expect(close).toHaveBeenCalledOnce()
			expect(image).toMatchObject({
				ok: true,
				data: {
					kind: 'resolved',
					resolution: 'inline',
					envelope: { mimeType: 'image/jpeg', width: 1_600, height: 800, byteLength: 256 },
				},
			})
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('does not let another run restore or consume a visual transaction', async () => {
		await host.handleRequest(request('probe'))
		const extracted = await host.handleRequest(
			request('extract', {
				adapter: chaoxingRef(),
				payload: { solverAction: 'answer', solverScope: 'current_page' },
			}),
		)
		const [question] = (extracted as unknown as { ok: true; data: any[] }).data
		const image = await host.handleRequest(
			request('image_resolve', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'answer',
					solverScope: 'current_page',
					locator: question.locator,
					anchorKey: question.visualAnchorKeys[0],
					policy: 'inline_then_bound_crop',
				},
			}),
		)
		const transactionId = (image as unknown as { data: { preparation: { transactionId: string } } })
			.data.preparation.transactionId

		const crossRun = await host.handleRequest(
			request('visual_restore', {
				identity: { taskId: 'task', taskEpoch: 1, runId: 'run-2' },
				adapter: chaoxingRef(),
				phase: 'cleanup',
				payload: { transactionId, solverAction: 'answer', solverScope: 'current_page' },
			}),
		)
		expect(crossRun).toMatchObject({
			ok: false,
			error: { code: 'visual_transaction_binding_mismatch' },
		})

		await expect(
			host.handleRequest(
				request('visual_restore', {
					adapter: chaoxingRef(),
					phase: 'cleanup',
					payload: { transactionId, solverAction: 'answer', solverScope: 'current_page' },
				}),
			),
		).resolves.toMatchObject({ ok: true, data: { restored: true } })
	})

	it('admits a control snapshot before exact fill and can restore it', async () => {
		await host.handleRequest(request('probe'))
		const extract = await host.handleRequest(
			request('extract', {
				adapter: chaoxingRef(),
				payload: { solverAction: 'fill', solverScope: 'current_page' },
			}),
		)
		const [question] = (extract as { ok: true; data: any[] }).data
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'single',
			selectedOptions: ['B'],
			evidence: {
				source: 'llm_vision',
				questionFingerprint: question.locator.fingerprint,
				mappingConfidence: 1,
				modelConfidence: 0.9,
				warnings: [],
			},
		}
		const commands: FillCommand[] = [
			{
				locator: question.locator,
				expectedLogicalPageFingerprint: 'logical',
				expectedBindingFingerprint: 'binding',
				answer,
			},
		]
		const captured = await host.handleRequest(
			request('state_capture', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					commands: commands as unknown as JsonValue,
				},
			}),
		)
		expect(captured.ok).toBe(true)
		const snapshot = (captured as unknown as { ok: true; data: ControlSnapshot }).data
		const transaction = {
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1 as const,
			snapshotDigest: snapshot.snapshotDigest,
		}
		const fill = await host.handleRequest(
			request('fill', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					transaction,
					commands: commands as unknown as JsonValue,
				},
			}),
		)
		expect(fill).toMatchObject({ ok: true, data: [{ result: 'written' }] })
		expect((document.querySelector('[value="A"]') as HTMLInputElement).checked).toBe(false)
		expect((document.querySelector('[value="B"]') as HTMLInputElement).checked).toBe(true)

		const restored = await host.handleRequest(
			request('state_restore', {
				adapter: chaoxingRef(),
				phase: 'cleanup',
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					transaction,
					snapshot: snapshot as unknown as JsonValue,
				},
			}),
		)
		expect(restored).toMatchObject({ ok: true, data: { restored: true, verified: true } })
		expect((document.querySelector('[value="A"]') as HTMLInputElement).checked).toBe(true)
	})

	it('rejects fill without journal admission before touching the page', async () => {
		await host.handleRequest(request('probe'))
		const extract = await host.handleRequest(
			request('extract', {
				adapter: chaoxingRef(),
				payload: { solverAction: 'fill', solverScope: 'current_page' },
			}),
		)
		const [question] = (extract as { ok: true; data: any[] }).data
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'single',
			selectedOptions: ['B'],
			evidence: {
				source: 'llm_text',
				questionFingerprint: question.locator.fingerprint,
				mappingConfidence: 1,
				warnings: [],
			},
		}
		const fill = await host.handleRequest(
			request('fill', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					transaction: {
						transactionId: 'missing',
						snapshotDigestVersion: 1,
						snapshotDigest: '0'.repeat(64),
					},
					commands: [
						{
							locator: question.locator,
							expectedLogicalPageFingerprint: 'logical',
							expectedBindingFingerprint: 'binding',
							answer,
						},
					] as unknown as JsonValue,
				},
			}),
		)
		expect(fill).toMatchObject({ ok: false, error: { code: 'control_journal_mismatch' } })
		expect((document.querySelector('[value="A"]') as HTMLInputElement).checked).toBe(true)
	})

	it('uses the content-local canonical snapshot for capability-bound recovery without returning it', async () => {
		const recoveryCapability = 'recovery-capability-kept-by-background-only'
		await host.handleRequest(request('probe'))
		const extracted = await host.handleRequest(
			request('extract', {
				adapter: chaoxingRef(),
				payload: { solverAction: 'fill', solverScope: 'current_page' },
			}),
		)
		const [question] = (extracted as unknown as { ok: true; data: any[] }).data
		const answer: StructuredAnswer = {
			questionFingerprint: question.locator.fingerprint,
			type: 'single',
			selectedOptions: ['B'],
			evidence: {
				source: 'llm_text',
				questionFingerprint: question.locator.fingerprint,
				mappingConfidence: 1,
				warnings: [],
			},
		}
		const commands = [
			{
				locator: question.locator,
				expectedLogicalPageFingerprint: 'logical',
				expectedBindingFingerprint: 'binding',
				answer,
			},
		]
		const captured = await host.handleRequest(
			request('state_capture', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					commands: commands as unknown as JsonValue,
					recoveryCapabilityHash: await sha256Hex(recoveryCapability),
				},
			}),
		)
		const snapshot = (captured as unknown as { ok: true; data: ControlSnapshot }).data
		const transaction = {
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1 as const,
			snapshotDigest: snapshot.snapshotDigest,
		}
		await host.handleRequest(
			request('fill', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'fill',
					solverScope: 'current_page',
					transaction,
					commands: commands as unknown as JsonValue,
				},
			}),
		)
		expect((document.querySelector('[value="B"]') as HTMLInputElement).checked).toBe(true)

		const recovered = await host.handleRecovery({
			type: 'QUESTION_SOLVER_RECOVERY',
			protocolVersion: 1,
			recoveryId: 'recovery-1',
			runId: 'run-1',
			operation: 'state_restore',
			recoveryCapability,
			target: frame,
			transactionId: snapshot.transactionId,
			snapshotDigestVersion: 1,
			snapshotDigest: snapshot.snapshotDigest,
		})

		expect(recovered).toMatchObject({ restored: true, verified: true })
		expect(recovered).not.toHaveProperty('snapshot')
		expect((document.querySelector('[value="A"]') as HTMLInputElement).checked).toBe(true)
	})

	it('fails closed when the frame document token is stale', async () => {
		const stale = { ...frame, documentToken: 'stale' }
		const response = await host.handleRequest(request('probe', { target: stale }))
		expect(response).toMatchObject({ ok: false, error: { code: 'request_binding_mismatch' } })
	})

	it('aborts an admitted request when the same document is rebound to a new task epoch', async () => {
		let resolveFetch!: (response: Response) => void
		const fetchStarted = vi.fn()
		const reboundHost = new QuestionSolverAdapterHost({
			environment: { getUrl: () => URL },
			fetchImpl: vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						fetchStarted()
						resolveFetch = resolve
					}),
			),
			randomId: () => 'rebind-id',
		})
		reboundHost.activate(frame, { taskId: 'task', taskEpoch: 1 })
		await reboundHost.handleRequest(request('probe'))
		const extracted = await reboundHost.handleRequest(
			request('extract', {
				adapter: chaoxingRef(),
				payload: { solverAction: 'answer', solverScope: 'current_page' },
			}),
		)
		const [question] = (extracted as unknown as { ok: true; data: any[] }).data
		const pending = reboundHost.handleRequest(
			request('image_resolve', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'answer',
					solverScope: 'current_page',
					locator: question.locator,
					anchorKey: question.visualAnchorKeys[0],
					policy: 'inline_then_bound_crop',
				},
			}),
		)
		await vi.waitFor(() => expect(fetchStarted).toHaveBeenCalledOnce())

		reboundHost.activate(frame, { taskId: 'task', taskEpoch: 2 })
		resolveFetch(new Response(null, { status: 403 }))

		await expect(pending).resolves.toMatchObject({ ok: false })
	})

	it('releases successful-run DOM and image bindings without deactivating the document', async () => {
		await host.handleRequest(request('probe'))
		const extracted = await host.handleRequest(
			request('extract', {
				adapter: chaoxingRef(),
				payload: { solverAction: 'answer', solverScope: 'current_page' },
			}),
		)
		const [question] = (extracted as unknown as { ok: true; data: any[] }).data
		expect(() =>
			host.releaseRun({
				type: 'QUESTION_SOLVER_RELEASE',
				protocolVersion: 1,
				identity: { taskId: 'task', taskEpoch: 1, runId: 'run-1' },
				target: { ...frame, documentToken: 'stale-document-token' },
				preserveRecovery: false,
			}),
		).toThrow('release_binding_mismatch')
		host.releaseRun({
			type: 'QUESTION_SOLVER_RELEASE',
			protocolVersion: 1,
			identity: { taskId: 'task', taskEpoch: 1, runId: 'run-1' },
			target: frame,
			preserveRecovery: false,
		} satisfies SolverReleaseRequest)

		const staleImage = await host.handleRequest(
			request('image_resolve', {
				adapter: chaoxingRef(),
				payload: {
					solverAction: 'answer',
					solverScope: 'current_page',
					locator: question.locator,
					anchorKey: question.visualAnchorKeys[0],
					policy: 'inline_then_bound_crop',
				},
			}),
		)
		expect(staleImage).toMatchObject({ ok: false, error: { code: 'image_anchor_mismatch' } })

		const fresh = await host.handleRequest(request('probe'))
		expect(fresh).toMatchObject({ ok: true, data: { selected: { ref: chaoxingRef() } } })
	})
})

function request(
	operation: SolverRequest['operation'],
	overrides: Partial<SolverRequest> = {},
): SolverRequest {
	return {
		type: 'QUESTION_SOLVER_CONTROL',
		protocolVersion: 1,
		kind: 'request',
		identity: { taskId: 'task', taskEpoch: 1, runId: 'run-1' },
		requestId: `request-${operation}-${Math.random()}`,
		requestSeq: 1,
		leaseToken: 'l'.repeat(32),
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

function chaoxingRef() {
	return { platform: 'chaoxing', variant: 'chaoxing.modern_work_exam', version: 1 }
}

function fixture(): string {
	return `
		<div class="questionLi" data-question-id="cx-q1">
			<input id="answertype-cx-q1" value="0">
			<h3>Which <img src="diagram.png"> is right?</h3>
			<div class="stem_answer"><div class="answerBg">
				<label class="answer_p" data-option-key="A"><input type="radio" name="q1" value="A" checked>A</label>
				<label class="answer_p" data-option-key="B"><input type="radio" name="q1" value="B">B</label>
			</div></div>
		</div>
		<button onclick="getTheNextQuestion(1)">下一题</button>
	`
}
