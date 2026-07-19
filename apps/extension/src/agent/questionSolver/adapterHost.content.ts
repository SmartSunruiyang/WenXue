import { AnchorRegistry, PendingControlJournal } from './contentState'
import type {
	AdapterContext,
	AdapterRef,
	ControlSnapshot,
	ControlTransactionRef,
	FillCommand,
	FixedMainWorldRuntime,
	FrameRef,
	InternalImageEnvelope,
	JsonValue,
	MainWorldOperationId,
	Question,
	QuestionPlatformAdapter,
} from './contracts'
import { sha256Hex } from './fingerprints'
import { IMAGE_ASSET_MAX_BYTES } from './imageAssets'
import { createQuestionSolverAdapterRegistry } from './platforms'
import type { DomAdapterEnvironment } from './platforms/sharedDom'
import {
	isMutatingOperation,
	parseSolverReleaseRequest,
	QUESTION_SOLVER_PROTOCOL_VERSION,
	type FrameHelloAck,
	type FrameHelloChallenge,
	type FrameHelloRegister,
	type MainWorldRequest,
	type MainWorldResponse,
	type SolverCancelRequest,
	type SolverRecoveryRequest,
	type SolverReleaseRequest,
	type SolverRequest,
	type SolverResponse,
} from './protocol'
import { QuestionAdapterRegistry } from './registry'

interface ActiveFrameRegistration {
	frame: FrameRef
	taskId: string
	taskEpoch: number
}

interface ActiveRequest {
	controller: AbortController
	phase: 'business' | 'cleanup'
	laneKey?: string
	generation?: number
}

interface RecoveryTransactionBinding {
	runId: string
	adapter: AdapterRef
	navigationProfileId?: AdapterContext['navigationProfileId']
}

export interface AdapterHostDependencies {
	registry?: QuestionAdapterRegistry
	environment?: Partial<DomAdapterEnvironment>
	anchors?: AnchorRegistry
	journal?: PendingControlJournal
	fetchImpl?: typeof fetch
	executeMainWorld?: (request: MainWorldRequest) => Promise<MainWorldResponse>
	randomId?: () => string
}

export class QuestionSolverAdapterHost {
	private registration?: ActiveFrameRegistration
	private readonly registry: QuestionAdapterRegistry
	private readonly anchors: AnchorRegistry
	private readonly journal: PendingControlJournal
	private readonly fetchImpl: typeof fetch
	private readonly executeMainWorld: (request: MainWorldRequest) => Promise<MainWorldResponse>
	private readonly randomId: () => string
	private readonly activeRequests = new Map<string, ActiveRequest>()
	private readonly selectedProfiles = new Map<string, string>()
	private readonly laneGenerations = new Map<string, { generation: number; requestId: string }>()
	private readonly recoveryControls = new Map<string, RecoveryTransactionBinding>()
	private readonly recoveryVisuals = new Map<string, RecoveryTransactionBinding>()
	private readonly embeddedAdapters = new Map<string, Set<string>>()

	constructor(deps: AdapterHostDependencies = {}) {
		this.registry = deps.registry ?? createQuestionSolverAdapterRegistry(deps.environment)
		this.anchors = deps.anchors ?? new AnchorRegistry()
		this.journal = deps.journal ?? new PendingControlJournal()
		this.fetchImpl = deps.fetchImpl ?? fetch
		this.randomId = deps.randomId ?? (() => crypto.randomUUID())
		this.executeMainWorld = deps.executeMainWorld ?? sendMainWorldRequest
	}

	activate(frame: FrameRef, task: { taskId: string; taskEpoch: number }): void {
		const previous = this.registration
		if (
			previous &&
			(previous.taskId !== task.taskId ||
				previous.taskEpoch !== task.taskEpoch ||
				!sameFrame(previous.frame, frame))
		) {
			for (const active of this.activeRequests.values()) active.controller.abort('frame_rebound')
			this.activeRequests.clear()
		}
		this.registration = { frame: { ...frame }, ...task }
	}

	deactivate(): void {
		for (const active of this.activeRequests.values())
			active.controller.abort('document_deactivated')
		this.activeRequests.clear()
		if (this.registration) {
			this.anchors.invalidateDocument(this.registration.frame.documentToken)
			this.journal.invalidateDocument(this.registration.frame.documentToken)
		}
		this.registration = undefined
		this.selectedProfiles.clear()
		this.laneGenerations.clear()
		this.recoveryControls.clear()
		this.recoveryVisuals.clear()
		this.embeddedAdapters.clear()
	}

	async handleRequest(request: SolverRequest): Promise<SolverResponse> {
		try {
			this.assertRequestBinding(request)
			this.admitLane(request)
			const controller = new AbortController()
			this.activeRequests.set(requestKey(request.identity.runId, request.requestId), {
				controller,
				phase: request.phase ?? 'business',
				laneKey: request.laneKey,
				generation: request.generation,
			})
			try {
				const data = await this.dispatch(request, controller.signal)
				this.assertStillCurrent(request)
				return successResponse(request, data)
			} finally {
				this.activeRequests.delete(requestKey(request.identity.runId, request.requestId))
			}
		} catch (error) {
			return failureResponse(request, error)
		}
	}

	cancel(request: SolverCancelRequest): void {
		for (const [key, active] of this.activeRequests) {
			if (!key.startsWith(`${request.identity.runId}\0`) || active.phase === 'cleanup') continue
			active.controller.abort(request.reason)
		}
		this.anchors.releaseRun(request.identity.runId)
	}

	releaseRun(request: SolverReleaseRequest): void {
		const registration = this.requireRegistration()
		if (
			registration.taskId !== request.identity.taskId ||
			registration.taskEpoch !== request.identity.taskEpoch ||
			!sameFrame(registration.frame, request.target)
		) {
			throw new Error('release_binding_mismatch')
		}
		const runId = request.identity.runId
		for (const [key, active] of this.activeRequests) {
			if (!key.startsWith(`${runId}\0`)) continue
			active.controller.abort('run_released')
			this.activeRequests.delete(key)
		}
		this.anchors.releaseRun(runId)
		if (request.preserveRecovery) return
		this.journal.releaseRun(runId, true)
		deleteMapKeysWithPrefix(this.selectedProfiles, `${runId}\0`)
		deleteMapKeysWithPrefix(this.laneGenerations, `${runId}\0`)
		deleteMapKeysWithPrefix(this.recoveryControls, `${runId}\0`)
		for (const [transactionId, binding] of this.recoveryVisuals) {
			if (binding.runId === runId) this.recoveryVisuals.delete(transactionId)
		}
		this.embeddedAdapters.delete(runId)
		for (const adapter of this.registry.adapters) adapter.releaseRun?.(runId)
	}

	async handleRecovery(request: SolverRecoveryRequest): Promise<JsonValue> {
		const registration = this.requireRegistration()
		if (!sameFrame(registration.frame, request.target)) throw new Error('frame_identity_mismatch')
		if (request.operation === 'inventory') {
			if (!request.transactionId || !request.snapshotDigest) return { available: false }
			try {
				await this.journal.requireRecovery({
					runId: request.runId,
					documentToken: request.target.documentToken,
					transactionId: request.transactionId,
					snapshotDigest: request.snapshotDigest,
					recoveryCapability: request.recoveryCapability,
				})
				return { available: true }
			} catch {
				return { available: false }
			}
		}
		if (request.operation === 'state_restore') {
			if (!request.transactionId || !request.snapshotDigest)
				throw new Error('recovery_snapshot_required')
			const snapshot = await this.journal.requireRecovery({
				runId: request.runId,
				documentToken: request.target.documentToken,
				transactionId: request.transactionId,
				snapshotDigest: request.snapshotDigest,
				recoveryCapability: request.recoveryCapability,
			})
			const binding = this.recoveryControls.get(
				recoveryControlKey(request.runId, request.transactionId, request.snapshotDigest),
			)
			if (!binding) throw new Error('recovery_control_binding_unavailable')
			const adapter = this.registry.require(binding.adapter)
			const result = await adapter.restoreControlState(
				this.createRecoveryContext(request.runId, binding, new AbortController().signal),
				{
					transactionId: request.transactionId,
					snapshotDigestVersion: 1,
					snapshotDigest: request.snapshotDigest,
				},
				snapshot,
			)
			if (result.verified) {
				this.journal.delete(request.runId, request.transactionId, request.snapshotDigest)
				this.recoveryControls.delete(
					recoveryControlKey(request.runId, request.transactionId, request.snapshotDigest),
				)
			}
			return result as unknown as JsonValue
		}
		if (request.operation === 'visual_restore') {
			const transactions = request.transactionId
				? [[request.transactionId, this.recoveryVisuals.get(request.transactionId)] as const]
				: [...this.recoveryVisuals].filter(([, binding]) => binding.runId === request.runId)
			let restoredCount = 0
			for (const [transactionId, binding] of transactions) {
				if (!binding || binding.runId !== request.runId) continue
				const adapter = this.registry.require(binding.adapter)
				await adapter.restoreVisualCapture(
					this.createRecoveryContext(request.runId, binding, new AbortController().signal),
					transactionId,
				)
				this.recoveryVisuals.delete(transactionId)
				restoredCount++
			}
			return { restored: true, restoredCount }
		}
		if (request.operation === 'embedded_disarm') {
			const variants = this.embeddedAdapters.get(request.runId) ?? new Set<string>()
			for (const variant of variants) {
				const adapter = this.registry.getByVariant(variant)
				if (!adapter) continue
				// Recovery cannot create a new business write; fixed MAIN recovery is fail-closed here.
				try {
					await this.createRecoveryContext(
						request.runId,
						{ runId: request.runId, adapter: adapter.manifest.ref },
						new AbortController().signal,
					).mainWorld.execute(
						'common.passive_capture_disarm',
						{},
						{
							transactionId: request.transactionId ?? request.recoveryId,
						},
					)
				} catch {
					throw new Error('recovery_main_world_unavailable')
				}
			}
			this.embeddedAdapters.delete(request.runId)
			return { disarmed: true }
		}
		throw new Error('recovery_operation_not_available')
	}

	private async dispatch(request: SolverRequest, signal: AbortSignal): Promise<JsonValue> {
		if (request.operation === 'probe') return this.probe(request, signal)
		const adapter = this.requireAdapter(request.adapter)
		const adapterRuntime = this.createAdapterRuntime(request, adapter.manifest.ref, signal)
		const payload = asRecord(request.payload)
		switch (request.operation) {
			case 'interrupts':
				return (await adapter.probeInterrupts(adapterRuntime)) as unknown as JsonValue
			case 'extract': {
				const questions = await adapter.extract(adapterRuntime)
				const filtered =
					requestScope(request) === 'visible'
						? questions.filter(
								(question) =>
									question.visibility === 'fully_visible' ||
									question.visibility === 'partially_visible' ||
									question.visibility === 'unknown',
							)
						: questions
				return filtered as unknown as JsonValue
			}
			case 'embedded_arm':
				if (!adapter.manifest.embedded.passive) return { armed: false }
				{
					const result = await adapterRuntime.mainWorld.execute(
						'common.passive_capture_arm',
						{
							endpointPatternIds: adapter.manifest.embedded.passive.endpointAllowlist.map(
								(endpoint) => endpoint.routePatternId,
							),
						},
						{ transactionId: String(payload.transactionId ?? this.randomId()) },
					)
					const variants = this.embeddedAdapters.get(request.identity.runId) ?? new Set<string>()
					variants.add(adapter.manifest.ref.variant)
					this.embeddedAdapters.set(request.identity.runId, variants)
					return result as JsonValue
				}
			case 'embedded_read':
				return (await adapter.readEmbeddedAnswers(
					adapterRuntime,
					(payload.questions ?? []) as unknown as Question[],
				)) as unknown as JsonValue
			case 'embedded_disarm':
				if (!adapter.manifest.embedded.passive) return { armed: false }
				{
					const result = await adapterRuntime.mainWorld.execute(
						'common.passive_capture_disarm',
						{},
						{ transactionId: String(payload.transactionId ?? this.randomId()) },
					)
					this.embeddedAdapters.get(request.identity.runId)?.delete(adapter.manifest.ref.variant)
					return result as JsonValue
				}
			case 'image_resolve':
				return this.resolveImage(request, adapter, adapterRuntime, payload)
			case 'visual_prepare':
				return (await adapter.prepareVisualCapture(
					adapterRuntime,
					payload.locator as unknown as Question['locator'],
					String(payload.anchorKey),
					payload.allowScroll === true,
				)) as unknown as JsonValue
			case 'visual_restore': {
				const transactionId = String(payload.transactionId)
				const binding = this.recoveryVisuals.get(transactionId)
				if (
					!binding ||
					binding.runId !== request.identity.runId ||
					binding.adapter.platform !== adapter.manifest.ref.platform ||
					binding.adapter.variant !== adapter.manifest.ref.variant ||
					binding.adapter.version !== adapter.manifest.ref.version
				) {
					throw new Error('visual_transaction_binding_mismatch')
				}
				await adapter.restoreVisualCapture(adapterRuntime, transactionId)
				this.recoveryVisuals.delete(transactionId)
				return { restored: true }
			}
			case 'state_capture': {
				const snapshot = await adapter.captureControlState(
					adapterRuntime,
					(payload.commands ?? []) as unknown as FillCommand[],
				)
				await this.journal.admit({
					runId: request.identity.runId,
					documentToken: request.target.documentToken,
					snapshot,
					recoveryCapabilityHash:
						typeof payload.recoveryCapabilityHash === 'string'
							? payload.recoveryCapabilityHash
							: undefined,
				})
				this.recoveryControls.set(
					recoveryControlKey(
						request.identity.runId,
						snapshot.transactionId,
						snapshot.snapshotDigest,
					),
					{
						runId: request.identity.runId,
						adapter: adapter.manifest.ref,
						navigationProfileId: adapterRuntime.navigationProfileId,
					},
				)
				return snapshot as unknown as JsonValue
			}
			case 'fill': {
				const transaction = payload.transaction as unknown as ControlTransactionRef
				this.journal.require({
					runId: request.identity.runId,
					documentToken: request.target.documentToken,
					transactionId: transaction.transactionId,
					snapshotDigest: transaction.snapshotDigest,
				})
				return (await adapter.setExactAnswers(
					adapterRuntime,
					transaction,
					(payload.commands ?? []) as unknown as FillCommand[],
				)) as unknown as JsonValue
			}
			case 'verify': {
				const results = await adapter.verify(
					adapterRuntime,
					(payload.commands ?? []) as unknown as FillCommand[],
				)
				const transaction = payload.transaction as unknown as ControlTransactionRef | undefined
				if (transaction && results.every((result) => result.dom === 'matched')) {
					this.journal.delete(
						request.identity.runId,
						transaction.transactionId,
						transaction.snapshotDigest,
					)
					this.recoveryControls.delete(
						recoveryControlKey(
							request.identity.runId,
							transaction.transactionId,
							transaction.snapshotDigest,
						),
					)
				}
				return results as unknown as JsonValue
			}
			case 'state_restore': {
				const transaction = payload.transaction as unknown as ControlTransactionRef
				const snapshot =
					(payload.snapshot as unknown as ControlSnapshot | undefined) ??
					this.journal.require({
						runId: request.identity.runId,
						documentToken: request.target.documentToken,
						transactionId: transaction.transactionId,
						snapshotDigest: transaction.snapshotDigest,
					})
				const result = await adapter.restoreControlState(adapterRuntime, transaction, snapshot)
				if (result.verified) {
					this.journal.delete(
						request.identity.runId,
						transaction.transactionId,
						transaction.snapshotDigest,
					)
					this.recoveryControls.delete(
						recoveryControlKey(
							request.identity.runId,
							transaction.transactionId,
							transaction.snapshotDigest,
						),
					)
				}
				return result as unknown as JsonValue
			}
			case 'navigation':
				return (await adapter.getNavigation(adapterRuntime)) as unknown as JsonValue
			case 'next':
				return (await adapter.gotoNext(
					adapterRuntime,
					payload.authorization === 'read_only' ? 'read_only' : 'after_fill',
					String(payload.before ?? ''),
				)) as unknown as JsonValue
			case 'ready':
				return (await adapter.waitReady(
					adapterRuntime,
					typeof payload.before === 'string' ? payload.before : undefined,
				)) as unknown as JsonValue
		}
	}

	private async probe(request: SolverRequest, signal: AbortSignal): Promise<JsonValue> {
		const generic = this.registry.getByVariant('generic.standard_html')
		const known = this.registry.adapters.filter(
			(adapter) => adapter.manifest.ref.variant !== 'generic.standard_html',
		)
		const matches = await Promise.all(
			known.map((adapter) =>
				adapter.probe(this.createAdapterRuntime(request, adapter.manifest.ref, signal)),
			),
		)
		const matchedKnown = matches.filter((match) => match.matched).sort((a, b) => b.score - a.score)
		if (matchedKnown.length === 0 && generic) {
			const fallback = await generic.probe(
				this.createAdapterRuntime(request, generic.manifest.ref, signal),
			)
			if (fallback.matched) matchedKnown.push(fallback)
		}
		const ambiguous =
			matchedKnown.length > 1 && Math.abs(matchedKnown[0].score - matchedKnown[1].score) < 0.05
		const selected = ambiguous ? undefined : matchedKnown[0]
		if (selected) {
			this.selectedProfiles.set(
				selectionKey(request.identity.runId, selected.ref.variant),
				selected.navigationProfileId,
			)
		}
		return {
			matches: matchedKnown as unknown as JsonValue,
			selected: selected as unknown as JsonValue,
			ambiguous,
		}
	}

	private createAdapterRuntime(
		request: SolverRequest,
		adapter: AdapterRef,
		signal: AbortSignal,
	): AdapterContext {
		const profile = this.selectedProfiles.get(selectionKey(request.identity.runId, adapter.variant))
		return {
			identity: request.identity,
			frame: request.target,
			action: requestAction(request),
			scope: requestScope(request),
			navigationProfileId: profile as AdapterContext['navigationProfileId'],
			signal,
			anchors: this.anchors.forRun(request.identity.runId, request.target.documentToken),
			mainWorld: this.createMainWorldRuntime(request, adapter),
		}
	}

	private createMainWorldRuntime(
		parent: SolverRequest,
		adapter: AdapterRef,
	): FixedMainWorldRuntime {
		const execute = async (
			operationId: MainWorldOperationId,
			args: JsonValue,
			effect?: {
				transactionId: string
				snapshotDigestVersion?: 1
				snapshotDigest?: string
				questionFingerprint?: string
			},
		): Promise<JsonValue> => {
			const request: MainWorldRequest = {
				type: 'QUESTION_SOLVER_MAIN_WORLD',
				protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
				kind: 'request',
				identity: parent.identity,
				requestId: this.randomId(),
				parentRequestId: parent.requestId,
				phase: parent.phase ?? 'business',
				leaseToken: parent.leaseToken,
				target: parent.target,
				adapter,
				operationId,
				args,
				...(effect ?? {}),
			}
			const response = await this.executeMainWorld(request)
			if (!response.ok) throw new Error(response.error.code)
			if (
				response.parentRequestId !== parent.requestId ||
				response.targetDocumentToken !== parent.target.documentToken
			) {
				throw new Error('main_world_response_binding_mismatch')
			}
			return response.data
		}
		return { execute } as FixedMainWorldRuntime
	}

	private createRecoveryContext(
		runId: string,
		binding: RecoveryTransactionBinding,
		signal: AbortSignal,
	): AdapterContext {
		const registration = this.requireRegistration()
		return {
			identity: {
				taskId: registration.taskId,
				taskEpoch: registration.taskEpoch,
				runId,
			},
			frame: registration.frame,
			action: 'fill',
			scope: 'current_page',
			navigationProfileId: binding.navigationProfileId,
			signal,
			anchors: this.anchors.forRun(runId, registration.frame.documentToken),
			mainWorld: {
				execute: async () => {
					throw new Error('recovery_main_world_unavailable')
				},
			} as FixedMainWorldRuntime,
		}
	}

	private async resolveImage(
		request: SolverRequest,
		adapter: QuestionPlatformAdapter,
		adapterRuntime: AdapterContext,
		payload: Record<string, JsonValue | undefined>,
	): Promise<JsonValue> {
		const locator = payload.locator as unknown as Question['locator']
		const anchorKey = String(payload.anchorKey)
		if (typeof payload.expectedBindingFingerprint === 'string') {
			const readiness = await adapter.waitReady(adapterRuntime)
			if (!readiness.ready || readiness.bindingFingerprint !== payload.expectedBindingFingerprint) {
				throw new Error('image_binding_fingerprint_mismatch')
			}
		}
		const element = this.anchors.resolve({
			runId: request.identity.runId,
			documentToken: request.target.documentToken,
			questionFingerprint: locator.fingerprint,
			anchorKey,
		})
		if (payload.policy !== 'bound_crop_only') {
			const envelope = await this.tryInlineImage(
				element,
				request.identity.runId,
				locator.fingerprint,
				anchorKey,
			)
			if (envelope)
				return {
					kind: 'resolved',
					resolution: 'inline',
					envelope: envelope as unknown as JsonValue,
				}
		}
		const preparation = await adapter.prepareVisualCapture(adapterRuntime, locator, anchorKey, true)
		this.recoveryVisuals.set(preparation.transactionId, {
			runId: request.identity.runId,
			adapter: adapter.manifest.ref,
			navigationProfileId: adapterRuntime.navigationProfileId,
		})
		return { kind: 'capture_required', preparation: preparation as unknown as JsonValue }
	}

	private async tryInlineImage(
		element: Element,
		runId: string,
		questionFingerprint: string,
		anchorKey: string,
	): Promise<InternalImageEnvelope | null> {
		const url = readVisualUrl(element)
		if (!url || url.startsWith('data:')) return null
		try {
			const response = await this.fetchImpl(url, { credentials: 'include', cache: 'force-cache' })
			if (!response.ok) return null
			let blob = await response.blob()
			if (
				!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) ||
				blob.size > 8 * 1024 * 1024
			) {
				return null
			}
			const bitmap = await createImageBitmap(blob)
			let width = bitmap.width
			let height = bitmap.height
			let mimeType = blob.type as InternalImageEnvelope['mimeType']
			try {
				if (blob.size > IMAGE_ASSET_MAX_BYTES || Math.max(width, height) > 1_600) {
					const scale = Math.min(1, 1_600 / Math.max(width, height))
					width = Math.max(1, Math.round(width * scale))
					height = Math.max(1, Math.round(height * scale))
					const canvas = new OffscreenCanvas(width, height)
					const context = canvas.getContext('2d')
					if (!context) return null
					context.drawImage(bitmap, 0, 0, width, height)
					blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
					mimeType = 'image/jpeg'
				}
			} finally {
				bitmap.close()
			}
			const bytes = new Uint8Array(await blob.arrayBuffer())
			if (bytes.byteLength > IMAGE_ASSET_MAX_BYTES) return null
			return {
				kind: 'question_solver_image_asset',
				assetId: this.randomId(),
				runId,
				questionFingerprint,
				anchorKey,
				mimeType,
				base64: bytesToBase64(bytes),
				sha256: await sha256Hex(bytes),
				width,
				height,
				byteLength: bytes.byteLength,
			}
		} catch {
			return null
		}
	}

	private assertRequestBinding(request: SolverRequest): void {
		const registration = this.requireRegistration()
		if (
			registration.taskId !== request.identity.taskId ||
			registration.taskEpoch !== request.identity.taskEpoch ||
			!sameFrame(registration.frame, request.target)
		) {
			throw new Error('request_binding_mismatch')
		}
		if (!request.target.documentId && isMutatingOperation(request.operation)) {
			throw new Error('document_identity_unavailable')
		}
	}

	private admitLane(request: SolverRequest): void {
		if (!request.laneKey || request.generation === undefined) return
		const key = `${request.identity.runId}\0${request.laneKey}`
		const current = this.laneGenerations.get(key)
		if (current && request.generation <= current.generation) throw new Error('request_superseded')
		if (current) {
			this.activeRequests
				.get(requestKey(request.identity.runId, current.requestId))
				?.controller.abort('request_superseded')
		}
		this.laneGenerations.set(key, {
			generation: request.generation,
			requestId: request.requestId,
		})
	}

	private assertStillCurrent(request: SolverRequest): void {
		this.assertRequestBinding(request)
		if (!request.laneKey || request.generation === undefined) return
		const current = this.laneGenerations.get(`${request.identity.runId}\0${request.laneKey}`)
		if (current?.requestId !== request.requestId || current.generation !== request.generation) {
			throw new Error('request_superseded')
		}
	}

	private requireAdapter(ref: AdapterRef | undefined): QuestionPlatformAdapter {
		if (!ref) throw new Error('adapter_required')
		return this.registry.require(ref)
	}

	private requireRegistration(): ActiveFrameRegistration {
		if (!this.registration) throw new Error('frame_not_registered')
		return this.registration
	}
}

export function initQuestionSolverAdapterHost(): QuestionSolverAdapterHost {
	const documentToken = crypto.randomUUID()
	const host = new QuestionSolverAdapterHost()
	const urlFingerprintPromise = sha256Hex(location.href)

	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (sender.id !== chrome.runtime.id || !isRecord(message)) return
		if (message.type === 'QUESTION_SOLVER_FRAME_HELLO_CHALLENGE') {
			const challenge = message as unknown as FrameHelloChallenge
			Promise.resolve(urlFingerprintPromise)
				.then(async (urlFingerprint) => {
					const register: FrameHelloRegister = {
						type: 'QUESTION_SOLVER_FRAME_HELLO_REGISTER',
						protocolVersion: QUESTION_SOLVER_PROTOCOL_VERSION,
						nonce: challenge.nonce,
						documentToken,
						urlFingerprint,
					}
					const ack = (await chrome.runtime.sendMessage(register)) as FrameHelloAck
					if (ack?.ok) {
						host.activate(ack.frame, {
							taskId: challenge.taskId,
							taskEpoch: challenge.taskEpoch,
						})
					}
					sendResponse(ack)
				})
				.catch((error) => sendResponse({ ok: false, error: errorMessage(error) }))
			return true
		}
		if (message.type === 'QUESTION_SOLVER_CONTROL' && message.kind === 'request') {
			host.handleRequest(message as unknown as SolverRequest).then(sendResponse)
			return true
		}
		if (message.type === 'QUESTION_SOLVER_CONTROL' && message.kind === 'cancel') {
			host.cancel(message as unknown as SolverCancelRequest)
			sendResponse({ ok: true })
			return
		}
		if (message.type === 'QUESTION_SOLVER_RELEASE') {
			try {
				host.releaseRun(parseSolverReleaseRequest(message))
				sendResponse({ ok: true })
			} catch (error) {
				sendResponse({ ok: false, error: errorMessage(error) })
			}
			return
		}
		if (message.type === 'QUESTION_SOLVER_RECOVERY') {
			host.handleRecovery(message as unknown as SolverRecoveryRequest).then(
				(data) => sendResponse({ ok: true, data }),
				(error) => sendResponse({ ok: false, error: errorMessage(error) }),
			)
			return true
		}
		if (message.type === 'QUESTION_SOLVER_FRAME_GEOMETRY') {
			// A page-visible postMessage handshake cannot authenticate cross-origin frame geometry.
			// Until this travels over an extension-only channel, child-frame screenshot fallback
			// is deliberately unavailable; inline image extraction remains supported.
			sendResponse({
				ok: false,
				error: 'cross_frame_capture_requires_authenticated_geometry',
			})
			return
		}
	})
	window.addEventListener('pagehide', () => host.deactivate(), { once: true })
	return host
}

async function sendMainWorldRequest(request: MainWorldRequest): Promise<MainWorldResponse> {
	return chrome.runtime.sendMessage(request) as Promise<MainWorldResponse>
}

function successResponse(request: SolverRequest, data: JsonValue): SolverResponse {
	return {
		ok: true,
		identity: request.identity,
		requestId: request.requestId,
		requestSeq: request.requestSeq,
		laneKey: request.laneKey,
		generation: request.generation,
		targetDocumentToken: request.target.documentToken,
		data,
	}
}

function failureResponse(request: SolverRequest, error: unknown): SolverResponse {
	const code = error instanceof Error ? error.message : String(error)
	return {
		ok: false,
		identity: request.identity,
		requestId: request.requestId,
		requestSeq: request.requestSeq,
		laneKey: request.laneKey,
		generation: request.generation,
		targetDocumentToken: request.target.documentToken,
		error: {
			domain: domainForOperation(request.operation),
			code,
			message: code,
			retryable: code.includes('expired') || code.includes('superseded'),
			requiresTakeover: code.includes('interrupt'),
		},
	}
}

function domainForOperation(operation: SolverRequest['operation']) {
	if (operation === 'probe') return 'detect' as const
	if (operation === 'extract') return 'extract' as const
	if (operation.startsWith('embedded')) return 'embedded' as const
	if (operation.includes('image') || operation.startsWith('visual')) return 'image' as const
	if (operation === 'fill' || operation.startsWith('state')) return 'fill' as const
	if (operation === 'verify') return 'verify' as const
	if (operation === 'interrupts') return 'interrupt' as const
	return 'navigation' as const
}

function readVisualUrl(element: Element): string | null {
	if (element instanceof HTMLImageElement) return element.currentSrc || element.src || null
	if (element instanceof SVGImageElement) return element.href.baseVal || null
	const background = getComputedStyle(element).backgroundImage
	const match = /^url\(["']?(.*?)["']?\)$/.exec(background)
	return match?.[1] ?? null
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	}
	return btoa(binary)
}

function selectionKey(runId: string, variant: string): string {
	return `${runId}\0${variant}`
}

function requestKey(runId: string, requestId: string): string {
	return `${runId}\0${requestId}`
}

function recoveryControlKey(runId: string, transactionId: string, snapshotDigest: string): string {
	return `${runId}\0${transactionId}\0${snapshotDigest}`
}

function deleteMapKeysWithPrefix<T>(map: Map<string, T>, prefix: string): void {
	for (const key of map.keys()) {
		if (key.startsWith(prefix)) map.delete(key)
	}
}

function requestAction(request: SolverRequest): AdapterContext['action'] {
	const action = asRecord(request.payload).solverAction
	return action === 'answer' || action === 'fill' ? action : 'inspect'
}

function requestScope(request: SolverRequest): AdapterContext['scope'] {
	const scope = asRecord(request.payload).solverScope
	return scope === 'visible' || scope === 'all_pages' ? scope : 'current_page'
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

function asRecord(value: JsonValue | undefined): Record<string, JsonValue | undefined> {
	return isRecord(value) ? (value as Record<string, JsonValue | undefined>) : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
