import { delayWithAbort } from '../asyncControl'
import type {
	AdapterContext,
	AdapterManifest,
	AdapterMatch,
	ContentPart,
	ControlSnapshot,
	ControlTransactionRef,
	ControlValue,
	EmbeddedAnswerCandidate,
	FillAttempt,
	FillCommand,
	InterruptResult,
	NavigationProfileId,
	NavigationResult,
	NavigationState,
	Question,
	QuestionLocator,
	QuestionPlatformAdapter,
	QuestionType,
	ReadinessResult,
	RestoreResult,
	StructuredAnswer,
	VerificationResult,
	VisualCapturePreparation,
} from '../contracts'
import {
	createBindingFingerprint,
	createControlSnapshotDigest,
	createLogicalPageFingerprint,
	createQuestionFingerprint,
	normalizeQuestionText,
	sha256Hex,
} from '../fingerprints'

const DEFAULT_INTERRUPT_SELECTORS: Record<NonNullable<InterruptResult['kind']>, string[]> = {
	login: ['input[type="password"]', '[class*="login-dialog"]', '[class*="loginDialog"]'],
	captcha: ['[class*="captcha"]', '[id*="captcha"]', '.yidun_popup', '.yidun_modal'],
	slider: ['[class*="slider-captcha"]', '[class*="slide-verify"]', '.yidun_slider'],
	face: ['#fcqrimg[src]', '.chapterVideoFaceMaskDiv:not([style*="display: none"])'],
	'2fa': ['input[autocomplete="one-time-code"]', '[class*="two-factor"]'],
	permission: ['[class*="permission-denied"]', '[data-permission-blocked="true"]'],
	anti_abuse: ['[data-anti-abuse="true"]'],
}

export interface DomAdapterEnvironment {
	getDocument: () => Document
	getUrl: () => string
	getWindow: () => Window
	now: () => number
	randomId: () => string
}

export interface DomSubQuestionDefinition {
	containerSelectors: string[]
	stemSelectors?: string[]
	optionSelectors: string[]
	optionScope?: 'container' | 'root'
	optionContentSelectors?: string[]
	sortOptionsByKey?: boolean
	platformQuestionIdAttributes?: string[]
	type?: QuestionType | ((container: HTMLElement, index: number) => QuestionType)
	optionKey?: (option: HTMLElement, index: number) => string
}

export interface DomVariantDefinition {
	manifest: AdapterManifest
	routeMatchers: Array<(url: URL) => boolean>
	probeDom?: (doc: Document) => boolean
	questionRootSelectors: string[]
	stemSelectors: string[]
	materialSelectors?: string[]
	materialScope?: 'root' | 'document'
	optionSelectors?: string[]
	optionContentSelectors?: string[]
	subQuestions?: Partial<Record<QuestionType, DomSubQuestionDefinition>>
	blankSelectors?: string[]
	lineItemSelectors?: string[]
	platformQuestionIdAttributes?: string[]
	detectType?: (root: HTMLElement) => QuestionType
	optionKey?: (option: HTMLElement, index: number) => string
	selectNavigationProfile?: (doc: Document, url: URL) => NavigationProfileId
	findNextControl?: (doc: Document, profileId: NavigationProfileId) => HTMLElement | null
	readEmbeddedAnswers?: (
		ctx: AdapterContext,
		questions: Question[],
	) => Promise<EmbeddedAnswerCandidate[]>
	writeAnswer?: (
		root: HTMLElement,
		answer: StructuredAnswer,
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
	) => Promise<boolean> | boolean
	afterWrite?: (
		root: HTMLElement,
		answer: StructuredAnswer,
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
	) => Promise<void> | void
	readControlValue?: (root: HTMLElement, question: Question) => ControlValue
	restoreControlValue?: (
		root: HTMLElement,
		value: ControlValue,
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
	) => Promise<boolean> | boolean
	afterRestore?: (
		root: HTMLElement,
		value: ControlValue,
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
	) => Promise<void> | void
	interruptSelectors?: Partial<Record<NonNullable<InterruptResult['kind']>, string[]>>
	readinessProbe?: (doc: Document) => boolean
}

export function createDomQuestionAdapter(
	definition: DomVariantDefinition,
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionPlatformAdapter {
	return new DeclarativeDomAdapter(definition, createEnvironment(environment))
}

class DeclarativeDomAdapter implements QuestionPlatformAdapter {
	readonly manifest: AdapterManifest
	private readonly bindings = new Map<string, Map<string, HTMLElement>>()
	private readonly questions = new Map<string, Map<string, Question>>()
	private readonly topLevelQuestionFingerprints = new Map<string, string[]>()
	private readonly imageElements = new Map<string, Map<string, Element>>()
	private readonly snapshots = new Map<string, ControlSnapshot>()
	private readonly visualTransactions = new Map<
		string,
		{ runId: string; window: Window; scrollX: number; scrollY: number }
	>()

	constructor(
		private readonly definition: DomVariantDefinition,
		private readonly environment: DomAdapterEnvironment,
	) {
		this.manifest = definition.manifest
	}

	releaseRun(runId: string): void {
		this.bindings.delete(runId)
		this.questions.delete(runId)
		this.topLevelQuestionFingerprints.delete(runId)
		this.imageElements.delete(runId)
		for (const key of this.snapshots.keys()) {
			if (key.startsWith(`${runId}\0`)) this.snapshots.delete(key)
		}
		for (const [transactionId, transaction] of this.visualTransactions) {
			if (transaction.runId !== runId) continue
			try {
				transaction.window.scrollTo(transaction.scrollX, transaction.scrollY)
				this.visualTransactions.delete(transactionId)
			} catch {
				// Retain the transaction rather than erase the only remaining restore evidence.
			}
		}
	}

	async probe(ctx: AdapterContext): Promise<AdapterMatch> {
		ctx.signal.throwIfAborted()
		const doc = this.environment.getDocument()
		const url = safeUrl(this.environment.getUrl())
		const hostMatched = url ? hostIsAllowed(url.hostname, this.manifest.probe.hosts) : false
		const routeMatched = url ? this.definition.routeMatchers.some((matcher) => matcher(url)) : false
		if (!hostMatched || !routeMatched) {
			return {
				matched: false,
				score: clamp01((hostMatched ? 0.35 : 0) + (routeMatched ? 0.25 : 0)),
				ref: this.manifest.ref,
				navigationProfileId: this.manifest.navigationProfiles[0]?.id ?? 'default',
				surfaceFingerprint: '',
				localRootRectCssPx: { x: 0, y: 0, width: 0, height: 0 },
				questionRootCount: 0,
				evidenceCodes: [
					hostMatched ? 'host_matched' : 'host_mismatch',
					routeMatched ? 'route_matched' : 'route_mismatch',
					'dom_not_evaluated',
				],
			}
		}
		const roots = collectUnique<HTMLElement>(doc, this.definition.questionRootSelectors)
		const domMatched = roots.length > 0 && (this.definition.probeDom?.(doc) ?? true)
		const score = clamp01(
			(hostMatched ? 0.35 : 0) + (routeMatched ? 0.25 : 0) + (domMatched ? 0.4 : 0),
		)
		const matched =
			hostMatched && routeMatched && domMatched && score >= this.manifest.probe.minimumScore
		const profileId = matched
			? this.selectProfile(doc, url as URL)
			: (this.manifest.navigationProfiles[0]?.id ?? 'default')
		const rect = roots[0]?.getBoundingClientRect()
		const surfaceFingerprint = matched
			? await sha256Hex(
					`${this.manifest.ref.variant}\0${roots.length}\0${roots
						.map((root) => normalizeQuestionText(root.textContent ?? '').slice(0, 256))
						.join('\0')}`,
				)
			: ''

		return {
			matched,
			score,
			ref: this.manifest.ref,
			navigationProfileId: profileId,
			surfaceFingerprint,
			localRootRectCssPx: rect
				? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
				: { x: 0, y: 0, width: 0, height: 0 },
			questionRootCount: roots.length,
			evidenceCodes: [
				hostMatched ? 'host_matched' : 'host_mismatch',
				routeMatched ? 'route_matched' : 'route_mismatch',
				domMatched ? 'dom_matched' : 'dom_missing',
			],
		}
	}

	async probeInterrupts(ctx: AdapterContext): Promise<InterruptResult> {
		ctx.signal.throwIfAborted()
		const doc = this.environment.getDocument()
		for (const kind of Object.keys(DEFAULT_INTERRUPT_SELECTORS) as Array<
			keyof typeof DEFAULT_INTERRUPT_SELECTORS
		>) {
			const selectors = [
				...DEFAULT_INTERRUPT_SELECTORS[kind],
				...(this.definition.interruptSelectors?.[kind] ?? []),
			]
			if (
				selectors.some((selector) => isVisibleElement(doc.querySelector<HTMLElement>(selector)))
			) {
				return { blocked: true, kind, evidenceCodes: [`interrupt.${kind}`] }
			}
		}
		return { blocked: false, evidenceCodes: [] }
	}

	async extract(ctx: AdapterContext): Promise<Question[]> {
		ctx.signal.throwIfAborted()
		const doc = this.environment.getDocument()
		const roots = collectUnique<HTMLElement>(doc, this.definition.questionRootSelectors)
		const runBindings = new Map<string, HTMLElement>()
		const runQuestions = new Map<string, Question>()
		const runImages = new Map<string, Element>()
		const questions: Question[] = []

		for (const [index, root] of roots.entries()) {
			ctx.signal.throwIfAborted()
			const question = await this.extractRoot(ctx, root, index, runImages)
			bindQuestionTree(question, root, runBindings, runQuestions)
			questions.push(question)
		}

		this.bindings.set(ctx.identity.runId, runBindings)
		this.questions.set(ctx.identity.runId, runQuestions)
		this.topLevelQuestionFingerprints.set(
			ctx.identity.runId,
			questions.map((question) => question.locator.fingerprint),
		)
		this.imageElements.set(ctx.identity.runId, runImages)
		return questions
	}

	async readEmbeddedAnswers(
		ctx: AdapterContext,
		questions: Question[],
	): Promise<EmbeddedAnswerCandidate[]> {
		ctx.signal.throwIfAborted()
		return this.definition.readEmbeddedAnswers?.(ctx, questions) ?? []
	}

	async prepareVisualCapture(
		ctx: AdapterContext,
		locator: QuestionLocator,
		anchorKey: string,
		allowScroll: boolean,
	): Promise<VisualCapturePreparation> {
		ctx.signal.throwIfAborted()
		await this.requireBoundRoot(ctx, locator)
		const element = this.imageElements.get(ctx.identity.runId)?.get(anchorKey)
		if (!element?.isConnected) throw new Error('image_anchor_expired')
		const win = this.environment.getWindow()
		const before = { scrollX: win.scrollX, scrollY: win.scrollY }
		let rect = element.getBoundingClientRect()
		let scrollWasChanged = false
		if (allowScroll && !rectIntersectsViewport(rect, win)) {
			if (typeof element.scrollIntoView === 'function') {
				element.scrollIntoView({ block: 'center', inline: 'nearest' })
			}
			await Promise.resolve()
			rect = element.getBoundingClientRect()
			scrollWasChanged = win.scrollX !== before.scrollX || win.scrollY !== before.scrollY
		}
		const transactionId = this.environment.randomId()
		this.visualTransactions.set(transactionId, {
			runId: ctx.identity.runId,
			window: win,
			...before,
		})
		return {
			transactionId,
			anchorKey,
			localRectCssPx: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
			viewportCssPx: { width: win.innerWidth, height: win.innerHeight },
			fullyVisibleInFrame: rectFullyInsideViewport(rect, win),
			scrollWasChanged,
		}
	}

	async restoreVisualCapture(ctx: AdapterContext, transactionId: string): Promise<void> {
		const transaction = this.visualTransactions.get(transactionId)
		if (!transaction) return
		if (transaction.runId !== ctx.identity.runId) {
			throw new Error('visual_transaction_binding_mismatch')
		}
		try {
			transaction.window.scrollTo(transaction.scrollX, transaction.scrollY)
			this.visualTransactions.delete(transactionId)
		} catch (error) {
			throw new Error('visual_restore_failed', { cause: error })
		}
	}

	async captureControlState(
		ctx: AdapterContext,
		commands: FillCommand[],
	): Promise<ControlSnapshot> {
		ctx.signal.throwIfAborted()
		const values: ControlValue[] = []
		for (const command of commands) {
			const { root, question } = await this.requireBoundRoot(ctx, command.locator)
			values.push(this.readControlValue(root, question))
		}
		const page = await this.currentPageFingerprints(ctx)
		const transactionId = this.environment.randomId()
		const base = {
			transactionId,
			logicalPageFingerprint: page.logical,
			bindingFingerprint: page.binding,
			values,
			restoreCapability: 'exact' as const,
		}
		const snapshotDigest = await createControlSnapshotDigest(base)
		const snapshot: ControlSnapshot = {
			...base,
			snapshotDigestVersion: 1,
			snapshotDigest,
		}
		this.snapshots.set(snapshotKey(ctx.identity.runId, transactionId), snapshot)
		return snapshot
	}

	async setExactAnswers(
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
		commands: FillCommand[],
	): Promise<FillAttempt[]> {
		ctx.signal.throwIfAborted()
		this.requireTransaction(ctx, transaction)
		const results: FillAttempt[] = []
		for (const command of commands) {
			ctx.signal.throwIfAborted()
			const { root, question } = await this.requireBoundRoot(ctx, command.locator)
			if (!answerIdentityMatchesQuestion(question, command.answer)) {
				results.push({
					questionFingerprint: command.locator.fingerprint,
					result: 'not_written',
					changed: false,
					warningCodes: ['answer_binding_mismatch'],
				})
				continue
			}
			const before = this.readControlValue(root, question)
			if (controlMatchesAnswer(before, command.answer)) {
				results.push({
					questionFingerprint: command.locator.fingerprint,
					result: 'already_exact',
					changed: false,
					warningCodes: [],
				})
				continue
			}
			const changed = this.definition.writeAnswer
				? await this.definition.writeAnswer(root, command.answer, ctx, transaction)
				: writeNativeExact(root, question, command.answer, this.definition)
			if (changed) await this.definition.afterWrite?.(root, command.answer, ctx, transaction)
			results.push({
				questionFingerprint: command.locator.fingerprint,
				result: changed ? 'written' : 'not_written',
				changed,
				warningCodes: changed ? [] : ['writer_unavailable'],
			})
		}
		return results
	}

	async verify(ctx: AdapterContext, commands: FillCommand[]): Promise<VerificationResult[]> {
		ctx.signal.throwIfAborted()
		const results: VerificationResult[] = []
		for (const command of commands) {
			try {
				const { root, question } = await this.requireBoundRoot(ctx, command.locator)
				if (!answerIdentityMatchesQuestion(question, command.answer)) {
					results.push({
						questionFingerprint: command.locator.fingerprint,
						dom: 'mismatch',
						runtime: 'unavailable',
						warningCodes: ['answer_binding_mismatch'],
					})
					continue
				}
				const observed = this.readControlValue(root, question)
				results.push({
					questionFingerprint: command.locator.fingerprint,
					dom: controlMatchesAnswer(observed, command.answer) ? 'matched' : 'mismatch',
					runtime: 'unavailable',
					observed,
					warningCodes: [],
				})
			} catch {
				results.push({
					questionFingerprint: command.locator.fingerprint,
					dom: 'unavailable',
					runtime: 'unavailable',
					warningCodes: ['question_binding_unavailable'],
				})
			}
		}
		return results
	}

	async restoreControlState(
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
		snapshot: ControlSnapshot,
	): Promise<RestoreResult> {
		ctx.signal.throwIfAborted()
		this.requireTransaction(ctx, transaction, snapshot)
		let restored = true
		for (const value of snapshot.values) {
			const bound = this.bindings.get(ctx.identity.runId)?.get(value.questionFingerprint)
			const question = this.questions.get(ctx.identity.runId)?.get(value.questionFingerprint)
			if (!bound?.isConnected || !question) {
				restored = false
				continue
			}
			const didRestore = this.definition.restoreControlValue
				? await this.definition.restoreControlValue(bound, value, ctx, transaction)
				: restoreNativeControl(bound, question, value, this.definition)
			if (didRestore) await this.definition.afterRestore?.(bound, value, ctx, transaction)
			restored = restored && didRestore
		}
		const verified =
			restored &&
			snapshot.values.every((value) => {
				const bound = this.bindings.get(ctx.identity.runId)?.get(value.questionFingerprint)
				const question = this.questions.get(ctx.identity.runId)?.get(value.questionFingerprint)
				return bound && question
					? controlValuesEqual(this.readControlValue(bound, question), value)
					: false
			})
		if (verified) this.snapshots.delete(snapshotKey(ctx.identity.runId, transaction.transactionId))
		return {
			restored,
			verified,
			pageMayRemainModified: !verified,
			warningCodes: verified ? [] : ['restore_unverified'],
		}
	}

	async getNavigation(ctx: AdapterContext): Promise<NavigationState> {
		ctx.signal.throwIfAborted()
		const profile = this.profile(ctx.navigationProfileId)
		const next = this.findNextControl(profile)
		return {
			profileId: profile.id,
			hasNext: Boolean(next && !isDisabled(next)),
			mode:
				profile.readOnly === 'next'
					? 'read_only'
					: profile.afterFill === 'next'
						? 'after_fill'
						: 'none',
			advanceEffect: profile.advanceEffect,
			nextControlFingerprint: next
				? await sha256Hex(`${profile.id}\0${normalizeQuestionText(next.textContent ?? '')}`)
				: undefined,
		}
	}

	async gotoNext(
		ctx: AdapterContext,
		authorization: 'read_only' | 'after_fill',
	): Promise<NavigationResult> {
		ctx.signal.throwIfAborted()
		const profile = this.profile(ctx.navigationProfileId)
		const allowed =
			authorization === 'read_only' ? profile.readOnly === 'next' : profile.afterFill === 'next'
		if (!allowed || !profile.nextSelectorId) {
			return {
				initiated: false,
				oldDocumentExpectedToUnload: false,
				warningCodes: ['navigation_not_authorized'],
			}
		}
		const next = this.findNextControl(profile)
		if (!next || isDisabled(next)) {
			return {
				initiated: false,
				oldDocumentExpectedToUnload: false,
				warningCodes: ['next_unavailable'],
			}
		}
		next.click()
		return { initiated: true, oldDocumentExpectedToUnload: false, warningCodes: [] }
	}

	async waitReady(ctx: AdapterContext, before?: string): Promise<ReadinessResult> {
		ctx.signal.throwIfAborted()
		const deadline = this.environment.now() + this.manifest.readiness.timeoutMs
		for (;;) {
			ctx.signal.throwIfAborted()
			const doc = this.environment.getDocument()
			const ready = this.definition.readinessProbe
				? this.definition.readinessProbe(doc)
				: collectUnique(doc, this.definition.questionRootSelectors).length > 0
			const networkQuietObserved = ready ? await this.networkQuietObserved(ctx) : false
			if (ready && networkQuietObserved) {
				const page = await this.currentPageFingerprints(ctx)
				if (before && page.logical === before) {
					await delay(this.manifest.readiness.pollMs, ctx.signal)
					continue
				}
				return {
					ready: true,
					logicalPageFingerprint: page.logical,
					bindingFingerprint: page.binding,
					networkQuietObserved,
					warningCodes: [],
				}
			}
			if (this.environment.now() >= deadline) {
				return {
					ready: false,
					networkQuietObserved: false,
					warningCodes: [
						'readiness_timeout',
						...(this.manifest.readiness.requireNetworkQuiet ? ['network_quiet_timeout'] : []),
					],
				}
			}
			await delay(this.manifest.readiness.pollMs, ctx.signal)
		}
	}

	private async networkQuietObserved(ctx: AdapterContext): Promise<boolean> {
		if (!this.manifest.readiness.requireNetworkQuiet) return true
		try {
			const raw = await ctx.mainWorld.execute('common.network_quiet_snapshot', {})
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
			const snapshot = raw as Record<string, unknown>
			const activeRequests = finiteNumber(snapshot.activeRequests)
			const lastNetworkAt = finiteNumber(snapshot.lastNetworkActivityAt ?? snapshot.lastNetworkAt)
			const lastMutationAt = finiteNumber(snapshot.lastMutationAt)
			if (activeRequests !== 0 || lastNetworkAt === null || lastMutationAt === null) return false
			const lastActivityAt = Math.max(lastNetworkAt, lastMutationAt)
			return this.environment.now() - lastActivityAt >= this.manifest.readiness.quietWindowMs
		} catch {
			return false
		}
	}

	private async extractRoot(
		ctx: AdapterContext,
		root: HTMLElement,
		index: number,
		runImages: Map<string, Element>,
		registerImages = true,
	): Promise<Question> {
		const type = this.definition.detectType?.(root) ?? inferQuestionType(root, this.definition)
		const stemContainers = queryFirstSelectorGroup(root, this.definition.stemSelectors)
		const materialContainers = queryFirstSelectorGroup(
			this.definition.materialScope === 'document' ? this.environment.getDocument() : root,
			this.definition.materialSelectors ?? [],
		)
		const optionNodes = queryFirstSelectorGroup<HTMLElement>(
			root,
			this.definition.optionSelectors ?? [],
		)
		const visualAnchorKeys: string[] = []
		const extractionWarnings: string[] = []
		const pendingImages: Array<{
			part: Extract<ContentPart, { type: 'image' }>
			element: Element
			role: 'stem' | 'material' | 'option'
			optionKey?: string
			owner?: Question
		}> = []
		const extractParts = (
			container: Element,
			role: 'stem' | 'material' | 'option',
			optionKey?: string,
		) =>
			extractOrderedParts(container, {
				role,
				optionKey,
				pendingImages,
				extractionWarnings,
			})
		const stem = stemContainers.flatMap((container) => extractParts(container, 'stem'))
		const material = materialContainers.flatMap((container) => extractParts(container, 'material'))
		const options = optionNodes.map((node, optionIndex) => {
			const key =
				this.definition.optionKey?.(node, optionIndex) ?? defaultOptionKey(node, optionIndex)
			const contentContainers = queryFirstSelectorGroup(
				node,
				this.definition.optionContentSelectors ?? [],
			)
			const content = (contentContainers.length > 0 ? contentContainers : [node]).flatMap(
				(container) => extractParts(container, 'option', key),
			)
			return {
				key,
				platformId: readPlatformId(node),
				content,
			}
		})
		const blankNodes = queryFirstSelectorGroup(
			root,
			this.definition.blankSelectors ?? DEFAULT_BLANK_SELECTORS,
		)
		const blanks = blankNodes.map((node, blankIndex) => ({ key: readBlankKey(node, blankIndex) }))
		const platformQuestionId = readFirstAttribute(
			root,
			this.definition.platformQuestionIdAttributes ?? DEFAULT_QUESTION_ID_ATTRIBUTES,
		)
		const draft: Question = {
			locator: {
				adapterVersion: this.manifest.ref.version,
				tabId: ctx.frame.tabId,
				frameId: ctx.frame.frameId,
				platform: this.manifest.ref.platform,
				variant: this.manifest.ref.variant,
				platformQuestionId,
				fingerprint: '',
			},
			type,
			stem: stem.length > 0 ? stem : fallbackRootText(root),
			material: material.length > 0 ? material : undefined,
			options,
			blanks: blanks.length > 0 ? blanks : undefined,
			hasRequiredVisuals: false,
			visibility: visibilityOf(root, this.environment.getWindow()),
			visualAnchorKeys,
			extractionWarnings,
		}
		const subQuestionDefinition = this.definition.subQuestions?.[type]
		if (subQuestionDefinition) {
			draft.subQuestions = this.extractSubQuestions(
				root,
				draft,
				subQuestionDefinition,
				pendingImages,
			)
		}
		markPendingImageOwners(pendingImages, draft)
		await assignPendingImageContentHashes(pendingImages)
		await assignQuestionFingerprints(draft, `root:${index + 1}`)
		updateRequiredVisualFlags(draft)
		if (registerImages) {
			for (const pending of pendingImages) {
				const owner = pending.owner ?? draft
				const anchorKey = ctx.anchors.registerImage({
					questionFingerprint: owner.locator.fingerprint,
					role: pending.role,
					optionKey: pending.optionKey,
					element: pending.element,
				})
				pending.part.anchorKey = anchorKey
				runImages.set(anchorKey, pending.element)
				owner.visualAnchorKeys.push(anchorKey)
			}
		}
		if (!platformQuestionId)
			draft.extractionWarnings.push(`question_${index + 1}_uses_fingerprint_identity`)
		return draft
	}

	private extractSubQuestions(
		root: HTMLElement,
		parent: Question,
		definition: DomSubQuestionDefinition,
		pendingImages: Array<{
			part: Extract<ContentPart, { type: 'image' }>
			element: Element
			role: 'stem' | 'material' | 'option'
			optionKey?: string
			owner?: Question
		}>,
	): Question[] {
		const containers = queryFirstSelectorGroup<HTMLElement>(root, definition.containerSelectors)
		return containers.map((container, index) => {
			const pendingStart = pendingImages.length
			const extractionWarnings: string[] = []
			const extractParts = (element: Element, role: 'stem' | 'option', optionKey?: string) =>
				extractOrderedParts(element, {
					role,
					optionKey,
					pendingImages,
					extractionWarnings,
				})
			const stemContainers = queryFirstSelectorGroup(container, definition.stemSelectors ?? [])
			const optionNodes = queryFirstSelectorGroup<HTMLElement>(
				definition.optionScope === 'root' ? root : container,
				definition.optionSelectors,
			)
			const options = optionNodes.map((option, optionIndex) => {
				const key =
					definition.optionKey?.(option, optionIndex) ?? defaultOptionKey(option, optionIndex)
				const contentContainers = queryFirstSelectorGroup(
					option,
					definition.optionContentSelectors ?? [],
				)
				return {
					key,
					platformId: readPlatformId(option),
					content: (contentContainers.length > 0 ? contentContainers : [option]).flatMap(
						(content) => extractParts(content, 'option', key),
					),
				}
			})
			if (definition.sortOptionsByKey) {
				options.sort((left, right) => left.key.localeCompare(right.key))
			}
			const explicitPlatformQuestionId = readFirstAttribute(
				container,
				definition.platformQuestionIdAttributes ?? DEFAULT_QUESTION_ID_ATTRIBUTES,
			)
			const subQuestion: Question = {
				locator: {
					...parent.locator,
					platformQuestionId: explicitPlatformQuestionId,
					fingerprint: '',
				},
				type:
					typeof definition.type === 'function'
						? definition.type(container, index)
						: (definition.type ?? 'single'),
				stem: stemContainers.flatMap((stem) => extractParts(stem, 'stem')),
				options,
				hasRequiredVisuals: false,
				visibility: visibilityOf(container, this.environment.getWindow()),
				visualAnchorKeys: [],
				extractionWarnings,
			}
			for (let pendingIndex = pendingStart; pendingIndex < pendingImages.length; pendingIndex++) {
				pendingImages[pendingIndex].owner = subQuestion
			}
			if (!explicitPlatformQuestionId) {
				subQuestion.extractionWarnings.push(`subquestion_${index + 1}_uses_parent_order_identity`)
			}
			return subQuestion
		})
	}

	private readControlValue(root: HTMLElement, question: Question): ControlValue {
		if (this.definition.readControlValue) return this.definition.readControlValue(root, question)
		return readNativeControl(root, question, this.definition)
	}

	private async requireBoundRoot(
		ctx: AdapterContext,
		locator: QuestionLocator,
	): Promise<{ root: HTMLElement; question: Question }> {
		if (
			locator.platform !== this.manifest.ref.platform ||
			locator.variant !== this.manifest.ref.variant ||
			locator.adapterVersion !== this.manifest.ref.version ||
			locator.tabId !== ctx.frame.tabId ||
			locator.frameId !== ctx.frame.frameId
		) {
			throw new Error('question_locator_mismatch')
		}
		const root = this.bindings.get(ctx.identity.runId)?.get(locator.fingerprint)
		const question = this.questions.get(ctx.identity.runId)?.get(locator.fingerprint)
		if (!root?.isConnected || !question) throw new Error('question_binding_expired')
		const topLevelFingerprints = this.topLevelQuestionFingerprints.get(ctx.identity.runId) ?? []
		const runBindings = this.bindings.get(ctx.identity.runId)
		const rootIndex = topLevelFingerprints.findIndex(
			(fingerprint) => runBindings?.get(fingerprint) === root,
		)
		if (rootIndex < 0) throw new Error('question_binding_expired')
		const currentRoot = await this.extractRoot(ctx, root, rootIndex, new Map(), false)
		if (!findQuestionByFingerprint(currentRoot, locator.fingerprint)) {
			throw new Error('question_fingerprint_mismatch')
		}
		return { root, question }
	}

	private requireTransaction(
		ctx: AdapterContext,
		transaction: ControlTransactionRef,
		expected?: ControlSnapshot,
	): ControlSnapshot {
		const snapshot = this.snapshots.get(snapshotKey(ctx.identity.runId, transaction.transactionId))
		if (
			!snapshot ||
			transaction.snapshotDigestVersion !== 1 ||
			snapshot.snapshotDigest !== transaction.snapshotDigest ||
			(expected && expected.snapshotDigest !== snapshot.snapshotDigest)
		) {
			throw new Error('control_transaction_mismatch')
		}
		return snapshot
	}

	private profile(profileId: NavigationProfileId | undefined) {
		const profile = this.manifest.navigationProfiles.find((candidate) => candidate.id === profileId)
		if (!profile) throw new Error('navigation_profile_mismatch')
		return profile
	}

	private findNextControl(
		profile: AdapterManifest['navigationProfiles'][number],
	): HTMLElement | null {
		const doc = this.environment.getDocument()
		if (this.definition.findNextControl) {
			const candidate = this.definition.findNextControl(doc, profile.id)
			return candidate &&
				isVisibleElement(candidate) &&
				!isDisabled(candidate) &&
				isUnambiguousNextControl(candidate)
				? candidate
				: null
		}
		if (!profile.nextSelectorId) return null
		const candidates = Array.from(
			doc.querySelectorAll<HTMLElement>(selectorForId(profile.nextSelectorId)),
		).filter(
			(candidate) =>
				isVisibleElement(candidate) &&
				!isDisabled(candidate) &&
				isUnambiguousNextControl(candidate),
		)
		return candidates.length === 1 ? candidates[0] : null
	}

	private selectProfile(doc: Document, url: URL): NavigationProfileId {
		const selected =
			this.definition.selectNavigationProfile?.(doc, url) ?? this.manifest.navigationProfiles[0]?.id
		if (!selected || !this.manifest.navigationProfiles.some((profile) => profile.id === selected)) {
			throw new Error('navigation_profile_mismatch')
		}
		return selected
	}

	private async currentPageFingerprints(ctx: AdapterContext): Promise<{
		logical: string
		binding: string
	}> {
		const questionFingerprints = this.topLevelQuestionFingerprints.get(ctx.identity.runId) ?? []
		const logical = await createLogicalPageFingerprint({
			platform: this.manifest.ref.platform,
			variant: this.manifest.ref.variant,
			questionFingerprints,
		})
		const binding = await createBindingFingerprint({
			tabId: ctx.frame.tabId,
			frameId: ctx.frame.frameId,
			documentId: ctx.frame.documentId,
			documentToken: ctx.frame.documentToken,
			urlFingerprint: ctx.frame.urlFingerprint,
			logicalPageFingerprint: logical,
		})
		return { logical, binding }
	}
}

interface ExtractPartsContext {
	role: 'stem' | 'material' | 'option'
	optionKey?: string
	pendingImages: Array<{
		part: Extract<ContentPart, { type: 'image' }>
		element: Element
		role: 'stem' | 'material' | 'option'
		optionKey?: string
	}>
	extractionWarnings: string[]
}

function extractOrderedParts(container: Element, context: ExtractPartsContext): ContentPart[] {
	const parts: ContentPart[] = []
	walk(container)
	return mergeAdjacentText(parts)

	function walk(node: Node): void {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = normalizeQuestionText(node.textContent ?? '')
			if (text) parts.push({ type: 'text', text })
			return
		}
		if (!(node instanceof Element)) return
		if (isHidden(node) || isControlOnlyElement(node)) return
		const latex = readLatex(node)
		if (latex) {
			parts.push({ type: 'text', text: latex })
			return
		}
		if (isVisualElement(node)) {
			const part: Extract<ContentPart, { type: 'image' }> = {
				type: 'image',
				label: readImageLabel(node, parts.length),
				anchorKey: `pending:${context.pendingImages.length}`,
				requiredForAnswer: true,
				resolution: 'failed',
			}
			context.pendingImages.push({
				part,
				element: node,
				role: context.role,
				optionKey: context.optionKey,
			})
			parts.push(part)
			return
		}
		for (const child of Array.from(node.childNodes)) walk(child)
	}
}

function readNativeControl(
	root: HTMLElement,
	question: Question,
	definition: DomVariantDefinition,
): ControlValue {
	switch (question.type) {
		case 'single':
		case 'multiple':
		case 'judgement': {
			const optionNodes = queryFirstSelectorGroup<HTMLElement>(
				root,
				definition.optionSelectors ?? [],
			)
			return {
				kind: 'choice',
				questionFingerprint: question.locator.fingerprint,
				selectedOptionKeys: optionNodes
					.map((option, index) => ({
						key: definition.optionKey?.(option, index) ?? defaultOptionKey(option, index),
						selected: isOptionSelected(option),
					}))
					.filter((option) => option.selected)
					.map((option) => option.key),
			}
		}
		case 'dropdown': {
			const selects = Array.from(root.querySelectorAll<HTMLSelectElement>('select'))
			return {
				kind: 'dropdown',
				questionFingerprint: question.locator.fingerprint,
				values: selects.map((select, index) => ({
					blankKey: readBlankKey(select, index),
					optionKey: select.value,
				})),
			}
		}
		case 'line': {
			const items = queryFirstSelectorGroup(root, definition.lineItemSelectors ?? [])
			return {
				kind: 'line',
				questionFingerprint: question.locator.fingerprint,
				pairs: items.map((item, index) => ({
					leftKey:
						question.subQuestions?.[index]?.locator.fingerprint ??
						item.getAttribute('data-left-key') ??
						String(index + 1),
					rightKey: readPlatformId(item) ?? normalizeQuestionText(item.textContent ?? ''),
				})),
			}
		}
		default: {
			const blanks = queryFirstSelectorGroup(
				root,
				definition.blankSelectors ?? DEFAULT_BLANK_SELECTORS,
			)
			return {
				kind: 'text',
				questionFingerprint: question.locator.fingerprint,
				values: blanks.map((blank, index) => ({
					blankKey: readBlankKey(blank, index),
					value: readTextControl(blank),
				})),
			}
		}
	}
}

function writeNativeExact(
	root: HTMLElement,
	question: Question,
	answer: StructuredAnswer,
	definition: DomVariantDefinition,
): boolean {
	if (answer.questionFingerprint !== question.locator.fingerprint) return false
	switch (question.type) {
		case 'single':
		case 'multiple':
		case 'judgement': {
			if (!answer.selectedOptions) return false
			const desired = new Set(answer.selectedOptions)
			const options = queryFirstSelectorGroup<HTMLElement>(root, definition.optionSelectors ?? [])
			for (const [index, option] of options.entries()) {
				const key = definition.optionKey?.(option, index) ?? defaultOptionKey(option, index)
				setOptionSelected(option, desired.has(key))
			}
			return options.length > 0
		}
		case 'dropdown': {
			if (!answer.dropdowns) return false
			const desired = new Map(answer.dropdowns.map((entry) => [entry.key, entry.optionKey]))
			const selects = Array.from(root.querySelectorAll<HTMLSelectElement>('select'))
			for (const [index, select] of selects.entries()) {
				const value = desired.get(readBlankKey(select, index))
				if (value === undefined) continue
				setNativeValue(select, value)
			}
			return selects.length > 0
		}
		case 'line':
			return writeLineOrder(root, question, answer, definition)
		default: {
			if (!answer.blanks) return false
			const desired = new Map(answer.blanks.map((entry) => [entry.key, entry.value]))
			const blanks = queryFirstSelectorGroup(
				root,
				definition.blankSelectors ?? DEFAULT_BLANK_SELECTORS,
			)
			for (const [index, blank] of blanks.entries()) {
				const value = desired.get(readBlankKey(blank, index))
				if (value === undefined) continue
				writeTextControl(blank, value)
			}
			return blanks.length > 0
		}
	}
}

function restoreNativeControl(
	root: HTMLElement,
	question: Question,
	value: ControlValue,
	definition: DomVariantDefinition,
): boolean {
	const evidence = {
		source: 'visible_solution' as const,
		questionFingerprint: question.locator.fingerprint,
		mappingConfidence: 1,
		warnings: [],
	}
	switch (value.kind) {
		case 'choice':
			return writeNativeExact(
				root,
				question,
				{
					questionFingerprint: question.locator.fingerprint,
					type: question.type,
					selectedOptions: value.selectedOptionKeys,
					evidence,
				},
				definition,
			)
		case 'text':
			return writeNativeExact(
				root,
				question,
				{
					questionFingerprint: question.locator.fingerprint,
					type: question.type,
					blanks: value.values.map((entry) => ({ key: entry.blankKey, value: entry.value })),
					evidence,
				},
				definition,
			)
		case 'dropdown':
			return writeNativeExact(
				root,
				question,
				{
					questionFingerprint: question.locator.fingerprint,
					type: question.type,
					dropdowns: value.values.map((entry) => ({
						key: entry.blankKey,
						optionKey: entry.optionKey,
					})),
					evidence,
				},
				definition,
			)
		case 'line':
			return writeNativeExact(
				root,
				question,
				{
					questionFingerprint: question.locator.fingerprint,
					type: question.type,
					linePairs: value.pairs,
					evidence,
				},
				definition,
			)
	}
}

function controlMatchesAnswer(value: ControlValue, answer: StructuredAnswer): boolean {
	if (value.questionFingerprint !== answer.questionFingerprint) return false
	switch (value.kind) {
		case 'choice':
			return setEqual(value.selectedOptionKeys, selectedOptionKeysForAnswer(answer))
		case 'text':
			return keyedValuesEqual(
				value.values,
				(answer.blanks ?? []).map((entry) => ({ blankKey: entry.key, value: entry.value })),
			)
		case 'dropdown':
			return keyedValuesEqual(
				value.values.map((entry) => ({ blankKey: entry.blankKey, value: entry.optionKey })),
				(answer.dropdowns ?? []).map((entry) => ({ blankKey: entry.key, value: entry.optionKey })),
			)
		case 'line':
			return canonicalPairs(value.pairs) === canonicalPairs(answer.linePairs ?? [])
	}
}

function answerIdentityMatchesQuestion(question: Question, answer: StructuredAnswer): boolean {
	if (
		answer.questionFingerprint !== question.locator.fingerprint ||
		answer.type !== question.type
	) {
		return false
	}
	const subQuestions = question.subQuestions ?? []
	if ((question.type === 'fill' || question.type === 'reader') && subQuestions.length > 0) {
		const subAnswers = answer.subAnswers ?? []
		return (
			subAnswers.length === subQuestions.length &&
			subAnswers.every((subAnswer, index) =>
				answerIdentityMatchesQuestion(subQuestions[index], subAnswer),
			)
		)
	}
	if (question.type === 'line' && subQuestions.length > 0) {
		const pairs = answer.linePairs ?? []
		if (pairs.length !== subQuestions.length) return false
		const byLeft = new Map(pairs.map((pair) => [pair.leftKey, pair.rightKey]))
		if (byLeft.size !== pairs.length) return false
		return subQuestions.every((subQuestion) => {
			const rightKey = byLeft.get(subQuestion.locator.fingerprint)
			return rightKey !== undefined && subQuestion.options.some((option) => option.key === rightKey)
		})
	}
	if (answer.subAnswers !== undefined) return false
	if (question.type === 'single' || question.type === 'judgement') {
		return exactKnownKeys(
			answer.selectedOptions,
			question.options.map(({ key }) => key),
			1,
		)
	}
	if (question.type === 'multiple') {
		return exactKnownKeys(
			answer.selectedOptions,
			question.options.map(({ key }) => key),
		)
	}
	if (
		question.type === 'completion' ||
		question.type === 'fill' ||
		question.type === 'translation'
	) {
		return exactKeyedEntries(
			answer.blanks?.map(({ key }) => key),
			(question.blanks ?? []).map(({ key }) => key),
		)
	}
	if (question.type === 'dropdown') {
		return (
			exactKeyedEntries(
				answer.dropdowns?.map(({ key }) => key),
				(question.blanks ?? []).map(({ key }) => key),
			) &&
			(answer.dropdowns ?? []).every(({ optionKey }) =>
				question.options.some(({ key }) => key === optionKey),
			)
		)
	}
	return false
}

function exactKnownKeys(
	actual: string[] | undefined,
	known: string[],
	exactLength?: number,
): boolean {
	if (!actual || actual.length === 0 || new Set(actual).size !== actual.length) return false
	if (exactLength !== undefined && actual.length !== exactLength) return false
	return actual.every((key) => known.includes(key))
}

function exactKeyedEntries(actual: string[] | undefined, expected: string[]): boolean {
	if (!actual || actual.length !== expected.length || new Set(actual).size !== actual.length) {
		return false
	}
	const actualKeys = new Set(actual)
	return expected.every((key) => actualKeys.has(key))
}

function selectedOptionKeysForAnswer(answer: StructuredAnswer): string[] {
	if (answer.selectedOptions) return answer.selectedOptions
	return (answer.subAnswers ?? []).flatMap((subAnswer, index) =>
		(subAnswer.selectedOptions ?? []).map((key) => `${index}:${key}`),
	)
}

function controlValuesEqual(left: ControlValue, right: ControlValue): boolean {
	if (left.kind !== right.kind || left.questionFingerprint !== right.questionFingerprint)
		return false
	if (left.kind === 'choice' && right.kind === 'choice') {
		return setEqual(left.selectedOptionKeys, right.selectedOptionKeys)
	}
	if (left.kind === 'text' && right.kind === 'text')
		return keyedValuesEqual(left.values, right.values)
	if (left.kind === 'dropdown' && right.kind === 'dropdown') {
		return keyedValuesEqual(
			left.values.map((entry) => ({ blankKey: entry.blankKey, value: entry.optionKey })),
			right.values.map((entry) => ({ blankKey: entry.blankKey, value: entry.optionKey })),
		)
	}
	return left.kind === 'line' && right.kind === 'line'
		? canonicalPairs(left.pairs) === canonicalPairs(right.pairs)
		: false
}

function writeLineOrder(
	root: HTMLElement,
	question: Question,
	answer: StructuredAnswer,
	definition: DomVariantDefinition,
): boolean {
	if (!answer.linePairs) return false
	const items = queryFirstSelectorGroup(root, definition.lineItemSelectors ?? [])
	const byRight = new Map(items.map((item) => [readPlatformId(item) ?? '', item]))
	const parent = items[0]?.parentElement
	if (!parent) return false
	const pairByLeft = new Map(answer.linePairs.map((pair) => [pair.leftKey, pair]))
	const orderedPairs =
		question.subQuestions && question.subQuestions.length > 0
			? question.subQuestions.map((subQuestion) => pairByLeft.get(subQuestion.locator.fingerprint))
			: answer.linePairs
	if (orderedPairs.some((pair) => !pair)) return false
	for (const pair of orderedPairs) {
		if (!pair) return false
		const item = byRight.get(pair.rightKey)
		if (!item) return false
		parent.append(item)
		item.dispatchEvent(new Event('change', { bubbles: true }))
	}
	return true
}

function inferQuestionType(root: HTMLElement, definition: DomVariantDefinition): QuestionType {
	const explicit = normalizeQuestionText(
		root.getAttribute('data-question-type') ??
			root.querySelector('[data-question-type]')?.getAttribute('data-question-type') ??
			'',
	).toLowerCase()
	const aliases: Record<string, QuestionType> = {
		single: 'single',
		multiple: 'multiple',
		judgement: 'judgement',
		judgment: 'judgement',
		completion: 'completion',
		dropdown: 'dropdown',
		line: 'line',
		fill: 'fill',
		reader: 'reader',
		translation: 'translation',
	}
	if (aliases[explicit]) return aliases[explicit]
	if (root.querySelector('input[type="checkbox"]')) return 'multiple'
	if (root.querySelector('input[type="radio"]')) return 'single'
	if (root.querySelector('select')) return 'dropdown'
	if (queryFirstSelectorGroup(root, definition.lineItemSelectors ?? []).length > 0) return 'line'
	if (
		queryFirstSelectorGroup(root, definition.blankSelectors ?? DEFAULT_BLANK_SELECTORS).length > 0
	) {
		return 'completion'
	}
	return 'unknown'
}

function extractPlatformKey(text: string): string | null {
	const matched = /^\s*([A-Za-z0-9一二三四五六七八九十]+)\s*[.、:：)）]/.exec(text)
	return matched?.[1] ?? null
}

function defaultOptionKey(option: HTMLElement, index: number): string {
	return (
		option.getAttribute('data-option-key') ??
		option.getAttribute('data-key') ??
		extractPlatformKey(option.textContent ?? '') ??
		String.fromCharCode(65 + index)
	)
}

function readPlatformId(element: Element): string | undefined {
	return (
		element.getAttribute('data-option-id') ??
		element.getAttribute('data-id') ??
		element.getAttribute('value') ??
		undefined
	)
}

function readBlankKey(element: Element, index: number): string {
	return (
		element.getAttribute('data-blank-key') ??
		element.getAttribute('name') ??
		element.getAttribute('id') ??
		String(index + 1)
	)
}

function isOptionSelected(option: HTMLElement): boolean {
	const input = option.matches('input') ? option : option.querySelector<HTMLInputElement>('input')
	if (input) return input.checked
	return (
		option.getAttribute('aria-checked') === 'true' ||
		option.getAttribute('aria-selected') === 'true' ||
		/(?:^|\s)(?:selected|checked|active|on|is-checked)(?:\s|$)/i.test(option.className)
	)
}

function setOptionSelected(option: HTMLElement, desired: boolean): void {
	const input = option.matches('input')
		? (option as HTMLInputElement)
		: option.querySelector<HTMLInputElement>('input')
	if (input) {
		if (input.checked === desired) return
		const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')
		descriptor?.set?.call(input, desired)
		input.dispatchEvent(new Event('input', { bubbles: true }))
		input.dispatchEvent(new Event('change', { bubbles: true }))
		return
	}
	if (isOptionSelected(option) !== desired) option.click()
}

function readTextControl(element: Element): string {
	if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
		return element.value
	if (element instanceof HTMLIFrameElement) {
		return normalizeQuestionText(element.contentDocument?.body.textContent ?? '')
	}
	return normalizeQuestionText(element.textContent ?? '')
}

function writeTextControl(element: Element, value: string): void {
	if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
		setNativeValue(element, value)
		return
	}
	if (element instanceof HTMLIFrameElement) {
		const body = element.contentDocument?.body
		if (!body) return
		body.textContent = value
		body.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
		body.dispatchEvent(new Event('change', { bubbles: true }))
		return
	}
	if (
		element instanceof HTMLElement &&
		(element.isContentEditable || element.hasAttribute('contenteditable'))
	) {
		element.textContent = value
		element.dispatchEvent(
			new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
		)
		element.dispatchEvent(new Event('change', { bubbles: true }))
	}
}

function setNativeValue(
	element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	value: string,
): void {
	const prototype = Object.getPrototypeOf(element) as object
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
	descriptor?.set?.call(element, value)
	element.dispatchEvent(new Event('input', { bubbles: true }))
	element.dispatchEvent(new Event('change', { bubbles: true }))
}

function queryFirstSelectorGroup<T extends Element>(root: ParentNode, selectors: string[]): T[] {
	for (const selector of selectors) {
		const matches = Array.from(root.querySelectorAll<T>(selector))
		if (matches.length > 0) return matches
	}
	return []
}

function collectUnique<T extends Element>(root: ParentNode, selectors: string[]): T[] {
	const seen = new Set<Element>()
	const result: T[] = []
	for (const selector of selectors) {
		for (const element of Array.from(root.querySelectorAll<T>(selector))) {
			if (seen.has(element)) continue
			seen.add(element)
			result.push(element)
		}
	}
	return result
}

function selectorForId(selectorId: string): string {
	const separator = selectorId.indexOf(':')
	return separator >= 0 ? selectorId.slice(separator + 1) : selectorId
}

function hostIsAllowed(hostname: string, hosts: string[]): boolean {
	const normalized = hostname.toLowerCase()
	return hosts.some(
		(host) => host === '*' || normalized === host || normalized.endsWith(`.${host}`),
	)
}

function safeUrl(value: string): URL | null {
	try {
		return new URL(value)
	} catch {
		return null
	}
}

function fallbackRootText(root: HTMLElement): ContentPart[] {
	const chunks: string[] = []
	walk(root)
	const text = normalizeQuestionText(chunks.join(' '))
	return text ? [{ type: 'text', text }] : []

	function walk(node: Node): void {
		if (node.nodeType === Node.TEXT_NODE) {
			const value = normalizeQuestionText(node.textContent ?? '')
			if (value) chunks.push(value)
			return
		}
		if (!(node instanceof Element) || isHidden(node) || isControlOnlyElement(node)) return
		for (const child of Array.from(node.childNodes)) walk(child)
	}
}

function mergeAdjacentText(parts: ContentPart[]): ContentPart[] {
	const merged: ContentPart[] = []
	for (const part of parts) {
		const previous = merged.at(-1)
		if (part.type === 'text' && previous?.type === 'text') {
			previous.text = normalizeQuestionText(`${previous.text} ${part.text}`)
		} else {
			merged.push(part)
		}
	}
	return merged
}

function readLatex(element: Element): string | null {
	const value =
		element.getAttribute('data-latex') ??
		element.getAttribute('data-tex') ??
		element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
		(element instanceof HTMLImageElement && /\\\(|\\\[|\$/.test(element.alt) ? element.alt : '')
	const normalized = normalizeQuestionText(value)
	return normalized || null
}

function isVisualElement(element: Element): boolean {
	if (element.matches('img,canvas,svg')) return true
	if (!(element instanceof HTMLElement)) return false
	try {
		return getComputedStyle(element).backgroundImage !== 'none'
	} catch {
		return false
	}
}

function readImageLabel(element: Element, index: number): string {
	return normalizeQuestionText(
		element.getAttribute('alt') ?? element.getAttribute('title') ?? `image ${index + 1}`,
	)
}

function isControlOnlyElement(element: Element): boolean {
	return element.matches('input,textarea,select,option,button,script,style,noscript')
}

function isHidden(element: Element): boolean {
	for (let current: Element | null = element; current; current = current.parentElement) {
		if (
			current.getAttribute('aria-hidden') === 'true' ||
			current.hasAttribute('hidden') ||
			current.hasAttribute('inert') ||
			current.matches('input[type="hidden"]')
		) {
			return true
		}
		try {
			const style = current.ownerDocument.defaultView?.getComputedStyle(current)
			if (style && renderedStyleIsHidden(style)) return true
		} catch {
			// A missing style engine is not evidence that the node is hidden.
		}
	}
	return false
}

function renderedStyleIsHidden(style: CSSStyleDeclaration): boolean {
	if (
		style.display === 'none' ||
		style.visibility === 'hidden' ||
		style.visibility === 'collapse' ||
		style.opacity === '0' ||
		cssPixelValue(style.fontSize) === 0 ||
		isFullyTransparentColor(style.color) ||
		isFullyTransparentColor(style.getPropertyValue('-webkit-text-fill-color')) ||
		/opacity\(\s*(?:0(?:\.0+)?|0%)\s*\)/.test(style.filter.toLowerCase()) ||
		style.getPropertyValue('content-visibility') === 'hidden'
	) {
		return true
	}
	const clip = style.clip.trim().toLowerCase()
	if (clip && clip !== 'auto' && /rect\([^)]*\b0(?:px)?\b[^)]*\)/.test(clip)) return true
	const clipPath = style.getPropertyValue('clip-path').trim().toLowerCase()
	if (/(?:inset\(\s*(?:50|100)%|circle\(\s*0(?:px|%|\b)|ellipse\(\s*0(?:px|%|\b))/.test(clipPath)) {
		return true
	}
	const transform = style.transform.replace(/\s+/g, '').toLowerCase()
	if (
		/(?:^|\))scale(?:x|y|3d)?\((?:0(?:,0(?:,0)?)?)\)(?:$|\()/.test(transform) ||
		/^matrix\(0,0,0,0,/.test(transform) ||
		/^matrix3d\(0,0,0,0,0,0,0,0,0,0,0,0,/.test(transform)
	) {
		return true
	}
	const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`.toLowerCase()
	const width = cssPixelValue(style.width)
	const height = cssPixelValue(style.height)
	if ((width === 0 || height === 0) && /\b(?:hidden|clip)\b/.test(overflow)) return true
	const positioned = style.position === 'absolute' || style.position === 'fixed'
	if (
		positioned &&
		[cssPixelValue(style.left), cssPixelValue(style.top)].some(
			(value) => value !== undefined && value <= -1_000,
		)
	) {
		return true
	}
	const textIndent = cssPixelValue(style.textIndent)
	return Boolean(
		textIndent !== undefined && textIndent <= -1_000 && /\b(?:hidden|clip)\b/.test(overflow),
	)
}

function isFullyTransparentColor(value: string): boolean {
	const normalized = value.trim().toLowerCase()
	return (
		normalized === 'transparent' ||
		/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(normalized) ||
		/^rgb\([^)]*\/\s*0%?\s*\)$/.test(normalized)
	)
}

function cssPixelValue(value: string): number | undefined {
	const normalized = value.trim().toLowerCase()
	if (!/^-?\d+(?:\.\d+)?px$/.test(normalized)) return undefined
	const parsed = Number.parseFloat(normalized)
	return Number.isFinite(parsed) ? parsed : undefined
}

export function isVisibleElement(element: HTMLElement | null): boolean {
	if (!element || isHidden(element)) return false
	const style = element.style
	return style.visibility !== 'hidden' && style.opacity !== '0'
}

function isDisabled(element: HTMLElement): boolean {
	return (
		element.hasAttribute('disabled') ||
		element.getAttribute('aria-disabled') === 'true' ||
		/(?:^|\s)(?:disabled|is-disabled)(?:\s|$)/i.test(element.className)
	)
}

function isUnambiguousNextControl(element: HTMLElement): boolean {
	const associatedForm =
		element instanceof HTMLButtonElement || element instanceof HTMLInputElement
			? element.form
			: element.closest('form')
	if (
		associatedForm &&
		((element instanceof HTMLButtonElement && element.type === 'submit') ||
			(element instanceof HTMLInputElement && ['submit', 'image'].includes(element.type)))
	) {
		return false
	}
	const actionText = normalizeQuestionText(
		[
			element.getAttribute('href'),
			element.getAttribute('formaction'),
			element.getAttribute('data-action'),
			element.getAttribute('onclick'),
			associatedForm?.getAttribute('action'),
		]
			.filter((value): value is string => typeof value === 'string')
			.join(' '),
	).toLowerCase()
	if (
		/(?:submit|hand.?in|finish|complete|(?:^|[\s/_.?&#=-])(?:done|end|final)(?:$|[\s/_.?&#=()-])|提\s*交|交\s*卷|完\s*成|结\s*束)/.test(
			actionText,
		)
	) {
		return false
	}
	const semanticText = normalizeQuestionText(
		[
			element.textContent,
			element.getAttribute('aria-label'),
			element.getAttribute('title'),
			element.getAttribute('value'),
			element.getAttribute('data-action'),
			element.getAttribute('onclick'),
			element.getAttribute('href'),
			element.getAttribute('formaction'),
			element.getAttribute('type'),
			associatedForm?.getAttribute('action'),
			element.id,
			element.className,
		]
			.filter((value): value is string => typeof value === 'string')
			.join(' '),
	).toLowerCase()
	if (
		/(?:提\s*交|交\s*卷|完\s*成\s*考\s*试|结\s*束\s*答\s*题|确\s*认\s*提\s*交|submit|hand\s*in|finish\s*(?:exam|test|quiz)|complete\s*(?:exam|test|quiz))/.test(
			semanticText,
		)
	) {
		return false
	}
	return /(?:下\s*一\s*题|下\s*一\s*页|下\s*一\s*个|继\s*续|\bnext\b|paging[_-]?next|getthenextquestion)/.test(
		semanticText,
	)
}

function visibilityOf(element: HTMLElement, win: Window): Question['visibility'] {
	const rect = element.getBoundingClientRect()
	if (rect.width === 0 && rect.height === 0) return 'unknown'
	if (rectFullyInsideViewport(rect, win)) return 'fully_visible'
	if (rectIntersectsViewport(rect, win)) return 'partially_visible'
	return 'offscreen'
}

function rectIntersectsViewport(rect: DOMRect, win: Window): boolean {
	return (
		rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth
	)
}

function rectFullyInsideViewport(rect: DOMRect, win: Window): boolean {
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= win.innerHeight &&
		rect.right <= win.innerWidth
	)
}

function bindQuestionTree(
	question: Question,
	root: HTMLElement,
	bindings: Map<string, HTMLElement>,
	questions: Map<string, Question>,
): void {
	bindings.set(question.locator.fingerprint, root)
	questions.set(question.locator.fingerprint, question)
	for (const subQuestion of question.subQuestions ?? []) {
		bindQuestionTree(subQuestion, root, bindings, questions)
	}
}

function findQuestionByFingerprint(question: Question, fingerprint: string): Question | null {
	if (question.locator.fingerprint === fingerprint) return question
	for (const subQuestion of question.subQuestions ?? []) {
		const found = findQuestionByFingerprint(subQuestion, fingerprint)
		if (found) return found
	}
	return null
}

function markPendingImageOwners(
	pendingImages: Array<{
		owner?: Question
	}>,
	owner: Question,
): void {
	for (const pending of pendingImages) pending.owner ??= owner
}

async function assignPendingImageContentHashes(
	pendingImages: Array<{
		part: Extract<ContentPart, { type: 'image' }>
		element: Element
	}>,
): Promise<void> {
	await Promise.all(
		pendingImages.map(async ({ part, element }) => {
			part.contentHash = await sha256Hex(visualSourceIdentity(element))
		}),
	)
}

function visualSourceIdentity(element: Element): string {
	const attributes = ['src', 'data-src', 'data-original', 'srcset', 'href', 'xlink:href', 'style']
		.map((name) => `${name}=${element.getAttribute(name) ?? ''}`)
		.join('\0')
	const dimensions =
		element instanceof HTMLCanvasElement
			? `${element.width}x${element.height}`
			: `${element.getAttribute('width') ?? ''}x${element.getAttribute('height') ?? ''}`
	const vectorMarkup = element instanceof SVGElement ? element.outerHTML : ''
	return `${element.tagName.toLowerCase()}\0${attributes}\0${dimensions}\0${vectorMarkup}`
}

async function assignQuestionFingerprints(question: Question, identityPath: string): Promise<void> {
	for (const [index, subQuestion] of (question.subQuestions ?? []).entries()) {
		await assignQuestionFingerprints(subQuestion, `${identityPath}/sub:${index + 1}`)
	}
	const contentFingerprint = await createQuestionFingerprint(question)
	const stableIdentity = question.locator.platformQuestionId ?? identityPath
	question.locator.fingerprint = await sha256Hex(`${contentFingerprint}\0${stableIdentity}`)
}

function updateRequiredVisualFlags(question: Question): boolean {
	let nested = false
	for (const subQuestion of question.subQuestions ?? []) {
		nested = updateRequiredVisualFlags(subQuestion) || nested
	}
	question.hasRequiredVisuals = hasDirectRequiredVisuals(question) || nested
	return question.hasRequiredVisuals
}

function hasDirectRequiredVisuals(question: Question): boolean {
	const collections = [
		question.stem,
		question.material ?? [],
		...question.options.map((option) => option.content),
	]
	return collections.some((parts) =>
		parts.some((part) => part.type === 'image' && part.requiredForAnswer),
	)
}

function readFirstAttribute(element: Element, attributes: string[]): string | undefined {
	for (const attribute of attributes) {
		const value = element.getAttribute(attribute)
		if (value) return value
	}
	return undefined
}

function setEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false
	const expected = new Set(right)
	return left.every((value) => expected.has(value))
}

function keyedValuesEqual(
	left: Array<{ blankKey: string; value: string }>,
	right: Array<{ blankKey: string; value: string }>,
): boolean {
	if (left.length !== right.length) return false
	const expected = new Map(right.map((entry) => [entry.blankKey, entry.value]))
	return left.every((entry) => expected.get(entry.blankKey) === entry.value)
}

function canonicalPairs(pairs: Array<{ leftKey: string; rightKey: string }>): string {
	return [...pairs]
		.sort((left, right) => left.leftKey.localeCompare(right.leftKey))
		.map((pair) => `${pair.leftKey}\0${pair.rightKey}`)
		.join('\x01')
}

function snapshotKey(runId: string, transactionId: string): string {
	return `${runId}\0${transactionId}`
}

function createEnvironment(partial: Partial<DomAdapterEnvironment>): DomAdapterEnvironment {
	return {
		getDocument: partial.getDocument ?? (() => document),
		getUrl: partial.getUrl ?? (() => location.href),
		getWindow: partial.getWindow ?? (() => window),
		now: partial.now ?? (() => Date.now()),
		randomId: partial.randomId ?? (() => crypto.randomUUID()),
	}
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value))
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return delayWithAbort(ms, signal)
}

const DEFAULT_BLANK_SELECTORS = [
	'input:not([type])',
	'input[type="text"]',
	'textarea',
	'[contenteditable="true"]',
]

const DEFAULT_QUESTION_ID_ATTRIBUTES = ['data-question-id', 'data-id', 'data-questionid', 'id']
