import { QuestionSolverBackgroundState, type SessionStorageLike } from './backgroundState'
import { captureVisibleManagedTabPng, cropQuestionAsset, globalTabEffectLock } from './capture'
import type {
	AdapterRef,
	FrameRef,
	JsonValue,
	RunIdentity,
	VisualCapturePreparation,
} from './contracts'
import { executeFixedMainWorldOperation } from './mainWorldOperations'
import { createQuestionSolverAdapterRegistry } from './platforms'
import {
	assertMainWorldParentAllows,
	isSetterOperation,
	parseMainWorldRequest,
	parseSolverControlRequest,
	QUESTION_SOLVER_PROTOCOL_VERSION,
	type FrameHelloAck,
	type FrameHelloChallenge,
	type FrameHelloRegister,
	type MainWorldRequest,
	type MainWorldResponse,
	type QuestionSolverDiscoverMessage,
	type QuestionSolverDiscoverResult,
	type QuestionSolverFrameGeometryRequest,
	type QuestionSolverFrameGeometryResult,
	type QuestionSolverLeaseMessage,
	type QuestionSolverRunMessage,
	type SolverCancelRequest,
	type SolverRecoveryRequest,
	type SolverReleaseRequest,
	type SolverRequest,
	type SolverResponse,
} from './protocol'

interface BrowserFrameDetails {
	frameId: number
	parentFrameId: number
	documentId?: string
}

export interface QuestionSolverBackgroundApi {
	runtimeId: string
	extensionBaseUrl: string
	getAllFrames(tabId: number): Promise<BrowserFrameDetails[]>
	sendTabMessage(
		tabId: number,
		message: unknown,
		options: { frameId?: number; documentId?: string },
	): Promise<unknown>
	executeMainWorld(args: {
		operationId: MainWorldRequest['operationId']
		operationArgs: JsonValue
		target: FrameRef
	}): Promise<JsonValue>
	captureVisiblePng(args: {
		targetTabId: number
		signal?: AbortSignal
	}): Promise<{ dataUrl: string }>
	cropAsset(
		args: Parameters<typeof cropQuestionAsset>[0],
	): Promise<Awaited<ReturnType<typeof cropQuestionAsset>>>
}

const MUTATION_OWNER_OPERATIONS = new Set<SolverRequest['operation']>([
	'embedded_arm',
	'embedded_disarm',
	'image_resolve',
	'state_capture',
	'fill',
	'state_restore',
	'next',
])
const EFFECT_LEDGER_OPERATIONS = new Set<SolverRequest['operation']>([
	'embedded_arm',
	'image_resolve',
	'fill',
	'state_restore',
	'next',
])

export class QuestionSolverBackgroundBridge {
	private readonly registry = createQuestionSolverAdapterRegistry()
	private initialized = false

	constructor(
		readonly state: QuestionSolverBackgroundState,
		private readonly api: QuestionSolverBackgroundApi,
	) {}

	async initialize(): Promise<void> {
		if (this.initialized) return
		await this.state.initialize()
		this.initialized = true
	}

	async handleMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
		await this.initialize()
		if (!isRecord(message) || typeof message.type !== 'string') {
			throw new Error('invalid_solver_message')
		}
		switch (message.type) {
			case 'QUESTION_SOLVER_LEASE':
				this.assertTrustedOuterSender(sender)
				return this.handleLease(message as unknown as QuestionSolverLeaseMessage)
			case 'QUESTION_SOLVER_RUN':
				this.assertTrustedOuterSender(sender)
				return this.handleRun(message as unknown as QuestionSolverRunMessage)
			case 'QUESTION_SOLVER_DISCOVER':
				this.assertTrustedOuterSender(sender)
				return this.discoverFrames(message as unknown as QuestionSolverDiscoverMessage)
			case 'QUESTION_SOLVER_CONTROL':
				this.assertTrustedOuterSender(sender)
				return this.handleControl(message)
			case 'QUESTION_SOLVER_FRAME_HELLO_REGISTER':
				return this.handleFrameRegister(message as unknown as FrameHelloRegister, sender)
			case 'QUESTION_SOLVER_MAIN_WORLD':
				return this.handleMainWorld(message, sender)
			default:
				throw new Error('unknown_solver_message')
		}
	}

	async invalidateTab(tabId: number): Promise<void> {
		await this.initialize()
		await this.state.invalidateDocument(tabId)
	}

	private async handleLease(message: QuestionSolverLeaseMessage): Promise<JsonValue> {
		assertProtocolVersion(message.protocolVersion)
		if (message.operation === 'register') {
			await this.state.registerTaskLease({
				taskId: message.taskId,
				taskEpoch: message.taskEpoch,
				leaseToken: message.leaseToken,
				managedTabIds: message.managedTabIds,
				targetTabId: message.targetTabId,
			})
			return { ok: true }
		}
		const identity = { taskId: message.taskId, taskEpoch: message.taskEpoch }
		if (message.operation === 'update') {
			if (!Array.isArray(message.managedTabIds) || message.targetTabId === undefined) {
				throw new Error('invalid_task_lease_update')
			}
			await this.state.updateTaskLease(
				identity,
				message.leaseToken,
				message.managedTabIds,
				message.targetTabId,
			)
			return { ok: true }
		}
		if (message.operation === 'revoke') {
			await this.state.revokeTaskLease(identity, message.leaseToken)
			return { ok: true }
		}
		throw new Error('invalid_task_lease_operation')
	}

	private async handleRun(message: QuestionSolverRunMessage): Promise<JsonValue> {
		assertProtocolVersion(message.protocolVersion)
		if (message.operation === 'begin') {
			const result = await this.state.beginRun({
				identity: message.identity,
				leaseToken: message.leaseToken,
				tabId: message.tabId,
				action: message.action,
				scope: message.scope,
			})
			return { ok: true, ...result }
		}
		const run = this.state.requireRun(message.identity, [
			'active',
			'cancelling',
			'cleanup',
			'quarantined',
		])
		await this.state.validateLease(message.identity, message.leaseToken, run.tabId)
		if (message.operation === 'cancel') {
			await this.cancelRun(message.identity, message.leaseToken, 'user')
			return { ok: true }
		}
		if (message.operation === 'enter_cleanup') {
			await this.state.enterCleanup(message.identity)
			return { ok: true }
		}
		if (message.operation === 'finish') {
			const frames = this.state.listFrames(message.identity, run.tabId)
			const lifecycle = await this.state.finishRun(
				message.identity,
				message.cleanupVerified === true,
			)
			await this.releaseRunFrames(message.identity, frames, lifecycle === 'quarantined')
			return { ok: true, lifecycle }
		}
		throw new Error('invalid_run_operation')
	}

	private async discoverFrames(
		message: QuestionSolverDiscoverMessage,
	): Promise<{ ok: true; data: QuestionSolverDiscoverResult }> {
		assertProtocolVersion(message.protocolVersion)
		await this.state.validateLease(message.identity, message.leaseToken, message.tabId)
		const run = this.state.requireRun(message.identity, ['active'])
		if (run.tabId !== message.tabId) throw new Error('run_tab_mismatch')
		const discovered = await this.api.getAllFrames(message.tabId)
		const frames: FrameRef[] = []
		const incompleteFrameIds: number[] = []
		for (const candidate of [...discovered].sort((left, right) => left.frameId - right.frameId)) {
			try {
				const nonce = await this.state.createFrameChallenge({
					identity: message.identity,
					leaseToken: message.leaseToken,
					tabId: message.tabId,
					frameId: candidate.frameId,
					parentFrameId: candidate.parentFrameId,
					documentId: candidate.documentId,
				})
				const challenge: FrameHelloChallenge = {
					type: 'QUESTION_SOLVER_FRAME_HELLO_CHALLENGE',
					protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
					nonce,
					taskId: message.identity.taskId,
					taskEpoch: message.identity.taskEpoch,
				}
				const rawAck = await this.api.sendTabMessage(
					message.tabId,
					challenge,
					targetOptions(candidate),
				)
				if (!isFrameHelloAck(rawAck)) throw new Error('frame_hello_rejected')
				frames.push(rawAck.frame)
			} catch {
				incompleteFrameIds.push(candidate.frameId)
			}
		}
		return { ok: true, data: { frames, incompleteFrameIds } }
	}

	private async handleFrameRegister(
		message: FrameHelloRegister,
		sender: chrome.runtime.MessageSender,
	): Promise<FrameHelloAck> {
		this.assertContentSender(sender)
		assertProtocolVersion(message.protocolVersion)
		if (
			message.type !== 'QUESTION_SOLVER_FRAME_HELLO_REGISTER' ||
			typeof message.nonce !== 'string' ||
			typeof message.documentToken !== 'string' ||
			message.documentToken.length < 8
		) {
			throw new Error('invalid_frame_register')
		}
		const frame = this.state.consumeFrameChallenge(message, sender)
		await this.recoverQuarantinedFrame(frame)
		return { ok: true, protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION, frame }
	}

	private async recoverQuarantinedFrame(frame: FrameRef): Promise<void> {
		const batches = await this.state.listQuarantineRecoveries(frame)
		for (const batch of batches) {
			const recoveryCapability = await this.state.getRecoveryCapability(batch.identity)
			for (const effect of batch.effects.filter(
				(candidate) => candidate.operation === 'embedded_arm',
			)) {
				try {
					await this.api.executeMainWorld({
						operationId: 'common.passive_capture_disarm',
						operationArgs: {},
						target: frame,
					})
					await this.state.settleEffect(batch.identity, effect.requestId)
				} catch {
					// Keep the arm effect quarantined until this exact document can be disarmed.
				}
			}
			const visualEffects = batch.effects.filter(
				(candidate) => candidate.operation === 'image_resolve',
			)
			if (visualEffects.length > 0) {
				const visualRestore: SolverRecoveryRequest = {
					type: 'QUESTION_SOLVER_RECOVERY',
					protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
					recoveryId: crypto.randomUUID(),
					runId: batch.identity.runId,
					operation: 'visual_restore',
					recoveryCapability,
					target: frame,
				}
				try {
					const restore = asRecord(
						await this.api.sendTabMessage(frame.tabId, visualRestore, targetOptions(frame)),
					)
					if (restore.ok === true && asRecord(restore.data).restored === true) {
						for (const effect of visualEffects) {
							await this.state.settleEffect(batch.identity, effect.requestId)
						}
					}
				} catch {
					// Keep visual effects quarantined until this document can restore them.
				}
			}
			const transactions = new Map<
				string,
				{ transactionId: string; snapshotDigest: string; requestIds: string[] }
			>()
			for (const effect of batch.effects) {
				if (!effect.transactionId || !effect.snapshotDigest) continue
				const key = `${effect.transactionId}\0${effect.snapshotDigest}`
				const current = transactions.get(key) ?? {
					transactionId: effect.transactionId,
					snapshotDigest: effect.snapshotDigest,
					requestIds: [],
				}
				current.requestIds.push(effect.requestId)
				transactions.set(key, current)
			}
			for (const transaction of transactions.values()) {
				const base = {
					type: 'QUESTION_SOLVER_RECOVERY' as const,
					protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
					recoveryId: crypto.randomUUID(),
					runId: batch.identity.runId,
					recoveryCapability,
					target: frame,
					transactionId: transaction.transactionId,
					snapshotDigestVersion: 1 as const,
					snapshotDigest: transaction.snapshotDigest,
				}
				const inventoryRequest: SolverRecoveryRequest = { ...base, operation: 'inventory' }
				const inventory = asRecord(
					await this.api.sendTabMessage(frame.tabId, inventoryRequest, targetOptions(frame)),
				)
				if (inventory.ok !== true || asRecord(inventory.data).available !== true) continue
				const restoreRequest: SolverRecoveryRequest = { ...base, operation: 'state_restore' }
				const restore = asRecord(
					await this.api.sendTabMessage(frame.tabId, restoreRequest, targetOptions(frame)),
				)
				const restored = asRecord(restore.data)
				if (restore.ok !== true || restored.verified !== true) continue
				for (const requestId of transaction.requestIds) {
					await this.state.settleEffect(batch.identity, requestId)
				}
			}
			try {
				await this.state.completeQuarantineRecovery(batch.identity, true)
				await this.releaseRunFrames(
					batch.identity,
					this.state.listFrames(batch.identity, frame.tabId),
					false,
				)
			} catch {
				// Other documents/effects remain quarantined until they register or invalidate.
			}
		}
	}

	private async handleControl(message: unknown): Promise<unknown> {
		const parsed = parseSolverControlRequest(message)
		if (parsed.kind === 'cancel') {
			await this.cancelRun(parsed.identity, parsed.leaseToken, parsed.reason)
			return { ok: true }
		}
		try {
			await this.validateOuterRequest(parsed)
			return await this.proxyRequest(parsed)
		} catch (error) {
			return solverFailure(parsed, error)
		}
	}

	private async validateOuterRequest(request: SolverRequest): Promise<void> {
		await this.state.validateLease(request.identity, request.leaseToken, request.target.tabId)
		const run =
			request.phase === 'cleanup'
				? this.state.requireRun(request.identity, ['active', 'cleanup', 'cancelling'])
				: this.state.requireRun(request.identity, ['active'])
		if (run.tabId !== request.target.tabId) throw new Error('run_tab_mismatch')
		this.state.validateFrame(request.target, request.identity)
		assertOperationAuthorized(run.action, run.scope, request)
		if (request.adapter) this.registry.require(request.adapter)
	}

	private async proxyRequest(request: SolverRequest): Promise<SolverResponse> {
		if (MUTATION_OWNER_OPERATIONS.has(request.operation)) {
			await this.state.acquireMutationOwner(request.identity)
		}
		const parent = parentMetadata(request)
		this.state.registerParentRequest(parent)
		let effectRecorded = false
		let effectCompleted = false
		try {
			if (EFFECT_LEDGER_OPERATIONS.has(request.operation)) {
				if (!request.target.documentId) throw new Error('document_identity_unavailable')
				await this.state.recordEffectDispatch(request.identity, {
					requestId: request.requestId,
					operation: request.operation,
					tabId: request.target.tabId,
					documentId: request.target.documentId,
					documentToken: request.target.documentToken,
					transactionId: parent.transactionId,
					snapshotDigest: parent.snapshotDigest,
				})
				effectRecorded = true
			}
			const response =
				request.operation === 'image_resolve'
					? await this.proxyImageResolve(request)
					: await this.sendControlToContent(request)
			if (request.operation === 'embedded_disarm' && response.ok) {
				await this.state.settleEffectsByOperation(request.identity, 'embedded_arm', request.target)
			}
			effectCompleted =
				request.operation !== 'embedded_arm' &&
				response.ok &&
				(request.operation !== 'state_restore' || asRecord(response.data).verified === true)
			return response
		} finally {
			if (effectRecorded && effectCompleted) {
				await this.state.settleEffect(request.identity, request.requestId)
			}
			this.state.closeParentRequest(request.identity.runId, request.requestId)
		}
	}

	private async proxyImageResolve(request: SolverRequest): Promise<SolverResponse> {
		return globalTabEffectLock.runExclusive(request.target.tabId, async () => {
			const response = await this.sendControlToContent(request)
			if (!response.ok) return response
			const data = asRecord(response.data)
			if (data.kind === 'resolved') return response
			if (data.kind !== 'capture_required' || !isVisualPreparation(data.preparation)) {
				throw new Error('image_resolution_invalid')
			}
			const payload = asRecord(request.payload)
			const locator = asRecord(payload.locator)
			const anchorKey = typeof payload.anchorKey === 'string' ? payload.anchorKey : ''
			if (typeof locator.fingerprint !== 'string' || !anchorKey) {
				throw new Error('image_resolution_binding_missing')
			}
			let captured: Awaited<ReturnType<typeof cropQuestionAsset>> | undefined
			let operationError: unknown
			try {
				const preparation = await this.mapPreparationToTopFrame(
					request.identity,
					request.target,
					data.preparation,
				)
				const screenshot = await this.api.captureVisiblePng({ targetTabId: request.target.tabId })
				captured = await this.api.cropAsset({
					dataUrl: screenshot.dataUrl,
					preparation,
					frameTopLeftCssPx: { x: 0, y: 0 },
					runId: request.identity.runId,
					questionFingerprint: locator.fingerprint,
					anchorKey,
				})
			} catch (error) {
				operationError = error
			} finally {
				const restore = await this.proxyRequest({
					...request,
					requestId: crypto.randomUUID(),
					requestSeq: request.requestSeq + 1,
					phase: 'cleanup',
					operation: 'visual_restore',
					payload: {
						solverAction: stringValue(payload.solverAction, 'inspect'),
						solverScope: stringValue(payload.solverScope, 'current_page'),
						transactionId: data.preparation.transactionId,
					},
				})
				if (!restore.ok && !operationError) operationError = new Error(restore.error.code)
			}
			if (operationError) throw operationError
			if (!captured) throw new Error('image_capture_missing')
			return {
				...response,
				data: {
					kind: 'resolved',
					resolution: 'screenshot',
					envelope: captured,
				} as unknown as JsonValue,
			}
		})
	}

	private async mapPreparationToTopFrame(
		identity: RunIdentity,
		target: FrameRef,
		preparation: VisualCapturePreparation,
	): Promise<VisualCapturePreparation> {
		if (!preparation.fullyVisibleInFrame) throw new Error('image_not_fully_visible')
		if (target.frameId === 0) return preparation
		const frames = this.state.listFrames(identity, target.tabId)
		const byFrameId = new Map(frames.map((frame) => [frame.frameId, frame]))
		let current = target
		let rect = { ...preparation.localRectCssPx }
		let viewport = { ...preparation.viewportCssPx }
		const seen = new Set<number>()
		while (current.frameId !== 0) {
			if (seen.has(current.frameId)) throw new Error('frame_geometry_cycle')
			seen.add(current.frameId)
			const nonce = crypto.randomUUID()
			const request: QuestionSolverFrameGeometryRequest = {
				type: 'QUESTION_SOLVER_FRAME_GEOMETRY',
				protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
				nonce,
			}
			const raw = await this.api.sendTabMessage(current.tabId, request, targetOptions(current))
			const geometry = parseGeometryResponse(raw)
			if (!geometry.fullyVisibleInParent || geometry.occluded) {
				throw new Error(geometry.occluded ? 'image_frame_occluded' : 'image_frame_clipped')
			}
			rect = {
				x: geometry.contentLeftCssPx + rect.x * geometry.scaleX,
				y: geometry.contentTopCssPx + rect.y * geometry.scaleY,
				width: rect.width * geometry.scaleX,
				height: rect.height * geometry.scaleY,
			}
			viewport = geometry.parentViewportCssPx
			const parent = byFrameId.get(current.parentFrameId)
			if (!parent) throw new Error('parent_frame_not_registered')
			current = parent
		}
		return { ...preparation, localRectCssPx: rect, viewportCssPx: viewport }
	}

	private async sendControlToContent(request: SolverRequest): Promise<SolverResponse> {
		const raw = await this.api.sendTabMessage(
			request.target.tabId,
			request,
			targetOptions(request.target),
		)
		if (!isSolverResponse(raw)) throw new Error('invalid_content_response')
		if (
			raw.requestId !== request.requestId ||
			raw.identity.runId !== request.identity.runId ||
			raw.identity.taskId !== request.identity.taskId ||
			raw.identity.taskEpoch !== request.identity.taskEpoch ||
			raw.targetDocumentToken !== request.target.documentToken
		) {
			throw new Error('stale_content_response')
		}
		await this.state.validateLease(request.identity, request.leaseToken, request.target.tabId)
		this.state.validateFrame(request.target, request.identity)
		this.state.requireRun(
			request.identity,
			request.phase === 'cleanup' ? ['active', 'cleanup', 'cancelling'] : ['active'],
		)
		return raw
	}

	private async handleMainWorld(
		message: unknown,
		sender: chrome.runtime.MessageSender,
	): Promise<MainWorldResponse> {
		let request: MainWorldRequest | undefined
		try {
			this.assertContentSender(sender)
			request = parseMainWorldRequest(message)
			this.assertExactContentSender(sender, request.target)
			await this.state.validateLease(request.identity, request.leaseToken, request.target.tabId)
			this.state.validateFrame(request.target, request.identity)
			this.state.requireRun(
				request.identity,
				request.phase === 'cleanup' ? ['active', 'cleanup', 'cancelling'] : ['active'],
			)
			const parent = this.state.requireParentRequest(
				request.identity.runId,
				request.parentRequestId,
			)
			if (
				parent.adapterVariant !== request.adapter.variant ||
				parent.phase !== request.phase ||
				!sameFrame(parent.frame, request.target)
			) {
				throw new Error('main_world_parent_binding_mismatch')
			}
			assertMainWorldParentAllows(parent.operation, request.operationId)
			const adapter = this.registry.require(request.adapter)
			assertManifestAllowsMainWorld(adapter.manifest.ref, adapter.manifest, request.operationId)
			if (isSetterOperation(request.operationId)) {
				if (asRecord(request.args).questionFingerprint !== request.questionFingerprint) {
					throw new Error('setter_args_fingerprint_mismatch')
				}
				if (
					parent.transactionId !== request.transactionId ||
					parent.snapshotDigest !== request.snapshotDigest ||
					!parent.questionFingerprints?.includes(request.questionFingerprint ?? '')
				) {
					throw new Error('setter_parent_effect_mismatch')
				}
				await this.state.acquireMutationOwner(request.identity)
			}
			let effectRecorded = false
			let effectCompleted = false
			try {
				if (isSetterOperation(request.operationId)) {
					await this.state.recordEffectDispatch(request.identity, {
						requestId: request.requestId,
						parentRequestId: request.parentRequestId,
						operation: request.operationId,
						tabId: request.target.tabId,
						documentId: request.target.documentId!,
						documentToken: request.target.documentToken,
						transactionId: request.transactionId,
						snapshotDigest: request.snapshotDigest,
						questionFingerprint: request.questionFingerprint,
					})
					effectRecorded = true
				}
				const data = await this.api.executeMainWorld({
					operationId: request.operationId,
					operationArgs: request.args,
					target: request.target,
				})
				effectCompleted = true
				return {
					ok: true,
					identity: request.identity,
					requestId: request.requestId,
					parentRequestId: request.parentRequestId,
					targetDocumentToken: request.target.documentToken,
					data,
				}
			} finally {
				if (effectRecorded && effectCompleted) {
					await this.state.settleEffect(request.identity, request.requestId)
				}
			}
		} catch (error) {
			return mainWorldFailure(request, error)
		}
	}

	private async cancelRun(
		identity: RunIdentity,
		leaseToken: string,
		reason: SolverCancelRequest['reason'],
	): Promise<void> {
		const run = this.state.requireRun(identity, ['active', 'cancelling'])
		await this.state.validateLease(identity, leaseToken, run.tabId)
		await this.state.cancelRun(identity)
		const cancel: SolverCancelRequest = {
			type: 'QUESTION_SOLVER_CONTROL',
			protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
			kind: 'cancel',
			identity,
			leaseToken,
			reason,
		}
		await Promise.allSettled(
			this.state
				.listFrames(identity, run.tabId)
				.map((frame) => this.api.sendTabMessage(frame.tabId, cancel, targetOptions(frame))),
		)
	}

	private async releaseRunFrames(
		identity: RunIdentity,
		frames: FrameRef[],
		preserveRecovery: boolean,
	): Promise<void> {
		await Promise.allSettled(
			frames.map((frame) => {
				const release: SolverReleaseRequest = {
					type: 'QUESTION_SOLVER_RELEASE',
					protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
					identity,
					target: frame,
					preserveRecovery,
				}
				return this.api.sendTabMessage(frame.tabId, release, targetOptions(frame))
			}),
		)
	}

	private assertTrustedOuterSender(sender: chrome.runtime.MessageSender): void {
		if (sender.id !== this.api.runtimeId) throw new Error('untrusted_solver_sender')
		const source = sender.origin ?? sender.url
		const origin = this.api.extensionBaseUrl.replace(/\/$/, '')
		if (!source || (source !== origin && !source.startsWith(this.api.extensionBaseUrl))) {
			throw new Error('outer_solver_sender_not_extension')
		}
	}

	private assertContentSender(sender: chrome.runtime.MessageSender): void {
		if (
			sender.id !== this.api.runtimeId ||
			sender.tab?.id === undefined ||
			sender.frameId === undefined
		) {
			throw new Error('untrusted_content_sender')
		}
	}

	private assertExactContentSender(sender: chrome.runtime.MessageSender, target: FrameRef): void {
		if (
			sender.tab?.id !== target.tabId ||
			sender.frameId !== target.frameId ||
			(target.documentId !== undefined && sender.documentId !== target.documentId)
		) {
			throw new Error('content_sender_binding_mismatch')
		}
	}
}

let singleton: QuestionSolverBackgroundBridge | undefined

export function getQuestionSolverBackgroundBridge(): QuestionSolverBackgroundBridge {
	if (!singleton) {
		singleton = new QuestionSolverBackgroundBridge(
			new QuestionSolverBackgroundState(sessionStorageAdapter()),
			defaultBackgroundApi(),
		)
	}
	return singleton
}

export function handleQuestionSolverBackgroundMessage(
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
): true | undefined {
	if (!isRecord(message) || !isQuestionSolverMessageType(message.type)) return
	getQuestionSolverBackgroundBridge()
		.handleMessage(message, sender)
		.then(sendResponse, (error) => sendResponse({ ok: false, error: safeWireError(error) }))
	return true
}

export function installQuestionSolverBackgroundLifecycle(): void {
	const bridge = getQuestionSolverBackgroundBridge()
	void bridge.initialize().catch((error: unknown) => {
		console.error('Question solver background initialization failed', error)
	})
	chrome.tabs.onRemoved.addListener((tabId) => {
		void bridge.invalidateTab(tabId).catch((error: unknown) => {
			console.error('Question solver tab invalidation failed', error)
		})
	})
	chrome.webNavigation.onCommitted.addListener((details) => {
		if (details.frameId !== 0) return
		void bridge.invalidateTab(details.tabId).catch((error: unknown) => {
			console.error('Question solver navigation invalidation failed', error)
		})
	})
}

export function resetQuestionSolverBackgroundBridgeForTests(): void {
	singleton = undefined
}

function defaultBackgroundApi(): QuestionSolverBackgroundApi {
	return {
		runtimeId: chrome.runtime.id,
		extensionBaseUrl: chrome.runtime.getURL(''),
		getAllFrames: async (tabId) =>
			((await chrome.webNavigation.getAllFrames({ tabId })) ?? []).map((frame) => ({
				frameId: frame.frameId,
				parentFrameId: frame.parentFrameId,
				documentId: frame.documentId,
			})),
		sendTabMessage: (tabId, message, options) => chrome.tabs.sendMessage(tabId, message, options),
		executeMainWorld: ({ operationId, operationArgs, target }) =>
			executeFixedMainWorldOperation({ operationId, operationArgs, target }),
		captureVisiblePng: ({ targetTabId, signal }) =>
			captureVisibleManagedTabPng({ targetTabId, signal }),
		cropAsset: cropQuestionAsset,
	}
}

function sessionStorageAdapter(): SessionStorageLike | undefined {
	const storage = chrome.storage.session
	if (!storage) return undefined
	return {
		get: (key) => storage.get(key),
		set: (values) => storage.set(values),
		remove: (key) => storage.remove(key),
	}
}

function parentMetadata(
	request: SolverRequest,
): Parameters<QuestionSolverBackgroundState['registerParentRequest']>[0] {
	const payload = asRecord(request.payload)
	const transaction = asRecord(payload.transaction)
	const commands = Array.isArray(payload.commands) ? payload.commands : []
	return {
		runId: request.identity.runId,
		requestId: request.requestId,
		operation: request.operation,
		frame: request.target,
		adapterVariant: request.adapter?.variant ?? '',
		phase: request.phase ?? 'business',
		transactionId:
			typeof transaction.transactionId === 'string' ? transaction.transactionId : undefined,
		snapshotDigest:
			typeof transaction.snapshotDigest === 'string' ? transaction.snapshotDigest : undefined,
		questionFingerprints: commands
			.map((command) => asRecord(asRecord(command).locator).fingerprint)
			.filter((value): value is string => typeof value === 'string'),
	}
}

function assertOperationAuthorized(
	action: 'inspect' | 'answer' | 'fill',
	scope: 'visible' | 'current_page' | 'all_pages',
	request: SolverRequest,
): void {
	if (
		action === 'inspect' &&
		[
			'embedded_arm',
			'embedded_read',
			'embedded_disarm',
			'state_capture',
			'fill',
			'verify',
			'state_restore',
		].includes(request.operation)
	) {
		throw new Error('operation_not_authorized')
	}
	if (
		action === 'answer' &&
		['state_capture', 'fill', 'verify', 'state_restore'].includes(request.operation)
	) {
		throw new Error('operation_not_authorized')
	}
	if (request.operation === 'next') {
		if (scope !== 'all_pages') throw new Error('navigation_scope_not_authorized')
		const authorization = asRecord(request.payload).authorization
		if (
			(action === 'fill' && authorization !== 'after_fill') ||
			(action !== 'fill' && authorization !== 'read_only')
		) {
			throw new Error('navigation_mode_not_authorized')
		}
	}
}

function assertManifestAllowsMainWorld(
	ref: AdapterRef,
	manifest: ReturnType<typeof createQuestionSolverAdapterRegistry>['adapters'][number]['manifest'],
	operationId: MainWorldRequest['operationId'],
): void {
	if (isSetterOperation(operationId)) {
		const allowed =
			operationId === 'common.native_input_set' ||
			(operationId === 'common.vditor_set' && ref.platform === 'zhs') ||
			(operationId === 'icve.ueditor_set' && ref.platform === 'icve') ||
			(operationId === 'unipus.controlled_input_set' && ref.platform === 'unipus')
		if (!allowed) throw new Error('main_world_manifest_mismatch')
		return
	}
	if (
		operationId === 'common.passive_capture_arm' ||
		operationId === 'common.passive_capture_disarm'
	) {
		if (!manifest.embedded.passive) throw new Error('main_world_manifest_mismatch')
		return
	}
	if (operationId === 'common.network_quiet_snapshot') {
		if (!manifest.readiness.requireNetworkQuiet) throw new Error('main_world_manifest_mismatch')
		return
	}
	if (!manifest.embedded.runtimeOperationIds.includes(operationId)) {
		throw new Error('main_world_manifest_mismatch')
	}
}

function parseGeometryResponse(value: unknown): QuestionSolverFrameGeometryResult {
	const response = asRecord(value)
	const data = asRecord(response.data)
	const viewport = asRecord(data.parentViewportCssPx)
	if (
		response.ok !== true ||
		![
			data.contentLeftCssPx,
			data.contentTopCssPx,
			data.scaleX,
			data.scaleY,
			viewport.width,
			viewport.height,
		].every((entry) => typeof entry === 'number' && Number.isFinite(entry)) ||
		(data.scaleX as number) <= 0 ||
		(data.scaleY as number) <= 0
	) {
		throw new Error('frame_geometry_invalid')
	}
	return {
		contentLeftCssPx: data.contentLeftCssPx as number,
		contentTopCssPx: data.contentTopCssPx as number,
		scaleX: data.scaleX as number,
		scaleY: data.scaleY as number,
		parentViewportCssPx: { width: viewport.width as number, height: viewport.height as number },
		fullyVisibleInParent: data.fullyVisibleInParent === true,
		occluded: data.occluded === true,
	}
}

function isVisualPreparation(value: unknown): value is VisualCapturePreparation {
	const record = asRecord(value)
	const rect = asRecord(record.localRectCssPx)
	const viewport = asRecord(record.viewportCssPx)
	return (
		typeof record.transactionId === 'string' &&
		typeof record.anchorKey === 'string' &&
		[rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(
			(entry) => typeof entry === 'number' && Number.isFinite(entry),
		)
	)
}

function solverFailure(request: SolverRequest, error: unknown): SolverResponse {
	const code = errorCode(error)
	return {
		ok: false,
		identity: request.identity,
		requestId: request.requestId,
		requestSeq: request.requestSeq,
		laneKey: request.laneKey,
		generation: request.generation,
		targetDocumentToken: request.target.documentToken,
		error: {
			domain: 'protocol',
			code,
			message: safeMessage(code),
			retryable: code.includes('stale') || code.includes('expired'),
			requiresTakeover: code.includes('interrupt') || code === 'tab_not_visible',
		},
	}
}

function mainWorldFailure(
	request: MainWorldRequest | undefined,
	error: unknown,
): MainWorldResponse {
	const code = errorCode(error)
	return {
		ok: false,
		identity: request?.identity ?? { taskId: 'invalid', taskEpoch: 0, runId: 'invalid' },
		requestId: request?.requestId ?? 'invalid',
		parentRequestId: request?.parentRequestId ?? 'invalid',
		targetDocumentToken: request?.target.documentToken,
		error: {
			domain: 'protocol',
			code,
			message: safeMessage(code),
			retryable: false,
			requiresTakeover: false,
		},
	}
}

function safeWireError(error: unknown): { code: string; message: string } {
	const code = errorCode(error)
	return { code, message: safeMessage(code) }
}

function errorCode(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error)
	return /^[a-z][a-z0-9_]{1,80}$/.test(raw) ? raw : 'question_solver_internal_error'
}

function safeMessage(code: string): string {
	return `Question solver request could not be completed (${code}).`
}

function assertProtocolVersion(value: unknown): void {
	if (value !== QUESTION_SOLVER_PROTOCOL_VERSION) throw new Error('protocol_version_mismatch')
}

function targetOptions(target: Pick<FrameRef, 'frameId' | 'documentId'>): {
	frameId?: number
	documentId?: string
} {
	return target.documentId ? { documentId: target.documentId } : { frameId: target.frameId }
}

function isFrameHelloAck(value: unknown): value is FrameHelloAck {
	return (
		isRecord(value) &&
		value.ok === true &&
		value.protocolVersion === QUESTION_SOLVER_PROTOCOL_VERSION &&
		isRecord(value.frame)
	)
}

function isSolverResponse(value: unknown): value is SolverResponse {
	return (
		isRecord(value) &&
		typeof value.ok === 'boolean' &&
		isRecord(value.identity) &&
		typeof value.requestId === 'string' &&
		typeof value.requestSeq === 'number'
	)
}

function sameFrame(left: FrameRef, right: FrameRef): boolean {
	return (
		left.tabId === right.tabId &&
		left.frameId === right.frameId &&
		left.parentFrameId === right.parentFrameId &&
		left.documentId === right.documentId &&
		left.documentToken === right.documentToken &&
		left.urlFingerprint === right.urlFingerprint
	)
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isQuestionSolverMessageType(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		[
			'QUESTION_SOLVER_LEASE',
			'QUESTION_SOLVER_RUN',
			'QUESTION_SOLVER_DISCOVER',
			'QUESTION_SOLVER_CONTROL',
			'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
			'QUESTION_SOLVER_MAIN_WORLD',
		].includes(value)
	)
}
