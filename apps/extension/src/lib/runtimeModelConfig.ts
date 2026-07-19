import type { LLMConfig } from '@page-agent/llms'

import { DEMO_CONFIG, DEMO_VISION_CONFIG } from '@/agent/constants'
import type { ExtConfig } from '@/agent/useAgent'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_VISION_MODEL_ID,
	normalizeSelectedModelId,
	normalizeVisionModelId,
	resolveSelectedLLMConfig,
	resolveVisionLLMConfig,
	type CustomModelConfig,
} from '@/lib/modelConfig'
import {
	loadExtensionUserSession,
	type ExtensionUserSession,
	type UserSessionStorageArea,
} from '@/lib/userSession'

export const WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY = 'WenXueNamedToolChoiceCapabilities'

const NAMED_TOOL_CHOICE_CAPABILITIES_VERSION = 1
const NAMED_TOOL_CHOICE_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NAMED_TOOL_CHOICE_CAPABILITY_LOCK_NAME = 'wenxue-named-tool-choice-capabilities'

let namedToolChoiceCapabilityStorageQueue: Promise<void> = Promise.resolve()

interface NamedToolChoiceCapabilityEntry {
	expiresAt: number
}

interface NamedToolChoiceCapabilities {
	version: typeof NAMED_TOOL_CHOICE_CAPABILITIES_VERSION
	entries: Record<string, NamedToolChoiceCapabilityEntry>
}

interface LoadedNamedToolChoiceCapabilities {
	capabilities: NamedToolChoiceCapabilities
	shouldPersist: boolean
}

interface LiveNamedToolChoiceCapability {
	disabled: boolean
	configs: Set<LLMConfig>
}

export interface RuntimeAgentModels {
	active: LLMConfig
	vision: LLMConfig
	questionSolverModels: {
		text: LLMConfig
		vision: LLMConfig
	}
	/** @deprecated Use questionSolverModels. */
	chaoxingModels: {
		text: LLMConfig
		vision: LLMConfig
	}
}

export interface RuntimeAgentModelOptions {
	session: ExtensionUserSession | null
	now?: () => number
}

type BuiltInModelId = typeof BUILT_IN_MODEL_ID | typeof BUILT_IN_VISION_MODEL_ID

export async function loadRuntimeAgentModels(
	config: ExtConfig,
	storage: UserSessionStorageArea = chrome.storage.local,
): Promise<RuntimeAgentModels> {
	const [session, capabilities] = await Promise.all([
		loadExtensionUserSession(storage),
		loadNamedToolChoiceCapabilitiesSafely(storage),
	])
	const models = buildRuntimeAgentModels(config, {
		session,
	})

	return attachNamedToolChoiceCapabilities(models, capabilities, storage)
}

async function loadNamedToolChoiceCapabilitiesSafely(
	storage: UserSessionStorageArea,
): Promise<NamedToolChoiceCapabilities> {
	try {
		return await loadNamedToolChoiceCapabilities(storage)
	} catch {
		console.warn('[WenXue] Failed to load named tool_choice compatibility cache')
		return createEmptyNamedToolChoiceCapabilities()
	}
}

export function buildRuntimeAgentModels(
	config: ExtConfig,
	options: RuntimeAgentModelOptions,
): RuntimeAgentModels {
	const customModels = config.customModels ?? []
	const selectedModelId = normalizeSelectedModelId(config.selectedModelId, customModels)
	const visionModelId = normalizeVisionModelId(config.visionModelId, customModels)
	const active = resolveRuntimeSelectedConfig(selectedModelId, customModels, options)
	const vision = resolveRuntimeVisionConfig(visionModelId, customModels, options)

	const questionSolverModels = {
		text: active,
		vision,
	}
	return {
		active,
		vision,
		questionSolverModels,
		chaoxingModels: questionSolverModels,
	}
}

function resolveRuntimeSelectedConfig(
	modelId: string,
	customModels: CustomModelConfig[],
	options: RuntimeAgentModelOptions,
): LLMConfig {
	if (isBuiltInModelId(modelId)) {
		return resolveRuntimeBuiltInConfig(modelId, options)
	}
	return resolveSelectedLLMConfig(modelId, customModels)
}

function resolveRuntimeVisionConfig(
	modelId: string,
	customModels: CustomModelConfig[],
	options: RuntimeAgentModelOptions,
): LLMConfig {
	if (isBuiltInModelId(modelId)) {
		return resolveRuntimeBuiltInConfig(modelId, options)
	}
	return resolveVisionLLMConfig(modelId, customModels)
}

function resolveRuntimeBuiltInConfig(
	modelId: BuiltInModelId,
	options: RuntimeAgentModelOptions,
): LLMConfig {
	const session = options.session

	return {
		...gatewayConfigForBuiltIn(modelId),
		baseURL: toOpenAIBaseUrl(session?.gatewayBaseUrl),
		apiKey: session?.accessToken ?? '',
	}
}

function isBuiltInModelId(modelId: string): modelId is BuiltInModelId {
	return modelId === BUILT_IN_MODEL_ID || modelId === BUILT_IN_VISION_MODEL_ID
}

function gatewayConfigForBuiltIn(modelId: BuiltInModelId): LLMConfig {
	return modelId === BUILT_IN_VISION_MODEL_ID ? DEMO_VISION_CONFIG : DEMO_CONFIG
}

function toOpenAIBaseUrl(gatewayBaseUrl: string | undefined): string {
	const trimmed = (gatewayBaseUrl ?? DEMO_CONFIG.baseURL).replace(/\/+$/, '')
	return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

async function loadNamedToolChoiceCapabilities(
	storage: UserSessionStorageArea,
): Promise<NamedToolChoiceCapabilities> {
	return serializeNamedToolChoiceCapabilityStorage(async () => {
		const result = await storage.get(WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY)
		const loaded = normalizeNamedToolChoiceCapabilities(
			result[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY],
			Date.now(),
		)

		if (loaded.shouldPersist) {
			await persistNamedToolChoiceCapabilities(storage, loaded.capabilities)
		}

		return loaded.capabilities
	})
}

function normalizeNamedToolChoiceCapabilities(
	value: unknown,
	now: number,
): LoadedNamedToolChoiceCapabilities {
	const empty = createEmptyNamedToolChoiceCapabilities()
	if (value === undefined) return { capabilities: empty, shouldPersist: false }
	if (!isRecord(value) || value.version !== NAMED_TOOL_CHOICE_CAPABILITIES_VERSION) {
		return { capabilities: empty, shouldPersist: true }
	}
	if (!isRecord(value.entries)) return { capabilities: empty, shouldPersist: true }

	const entries: Record<string, NamedToolChoiceCapabilityEntry> = {}
	let shouldPersist =
		Object.keys(value).length !== 2 || !('version' in value) || !('entries' in value)

	for (const [key, candidate] of Object.entries(value.entries)) {
		const identity = parseCapabilityKey(key)
		if (
			!identity ||
			!isRecord(candidate) ||
			typeof candidate.expiresAt !== 'number' ||
			!Number.isFinite(candidate.expiresAt) ||
			candidate.expiresAt <= now
		) {
			shouldPersist = true
			continue
		}

		if (Object.keys(candidate).length !== 1 || !('expiresAt' in candidate)) {
			shouldPersist = true
		}
		entries[key] = { expiresAt: candidate.expiresAt }
	}

	return {
		capabilities: {
			version: NAMED_TOOL_CHOICE_CAPABILITIES_VERSION,
			entries,
		},
		shouldPersist,
	}
}

function attachNamedToolChoiceCapabilities(
	models: RuntimeAgentModels,
	capabilities: NamedToolChoiceCapabilities,
	storage: UserSessionStorageArea,
): RuntimeAgentModels {
	const liveCapabilities = new Map<string, LiveNamedToolChoiceCapability>()

	const withCapability = (config: LLMConfig): LLMConfig => {
		const key = createCapabilityKey(config.baseURL, config.model)
		let liveCapability = liveCapabilities.get(key)
		if (!liveCapability) {
			liveCapability = {
				disabled: (capabilities.entries[key]?.expiresAt ?? 0) > Date.now(),
				configs: new Set(),
			}
			liveCapabilities.set(key, liveCapability)
		}
		const sharedCapability = liveCapability
		const previousCallback = config.onNamedToolChoiceUnsupported

		const runtimeConfig: LLMConfig = {
			...config,
			disableNamedToolChoice: sharedCapability.disabled,
			getNamedToolChoiceDisabled: () => sharedCapability.disabled,
			onNamedToolChoiceUnsupported: async () => {
				sharedCapability.disabled = true
				for (const linkedConfig of sharedCapability.configs) {
					linkedConfig.disableNamedToolChoice = true
				}

				const now = Date.now()
				pruneExpiredNamedToolChoiceCapabilities(capabilities, now)
				const nextExpiresAt = now + NAMED_TOOL_CHOICE_CAPABILITY_TTL_MS
				const expiresAt = Math.max(capabilities.entries[key]?.expiresAt ?? 0, nextExpiresAt)
				capabilities.entries[key] = { expiresAt }
				await mergeNamedToolChoiceCapability(storage, key, expiresAt)
				await previousCallback?.()
			},
		}
		sharedCapability.configs.add(runtimeConfig)
		return runtimeConfig
	}

	const active = withCapability(models.active)
	const vision = withCapability(models.vision)

	const questionSolverModels = {
		text: active,
		vision,
	}
	return {
		active,
		vision,
		questionSolverModels,
		chaoxingModels: questionSolverModels,
	}
}

function createCapabilityKey(baseURL: string, model: string): string {
	return JSON.stringify([normalizeCapabilityBaseURL(baseURL), model])
}

function parseCapabilityKey(value: string): readonly [string, string] | null {
	try {
		const parsed: unknown = JSON.parse(value)
		if (
			!Array.isArray(parsed) ||
			parsed.length !== 2 ||
			typeof parsed[0] !== 'string' ||
			typeof parsed[1] !== 'string' ||
			!parsed[0] ||
			!parsed[1] ||
			createCapabilityKey(parsed[0], parsed[1]) !== value
		) {
			return null
		}
		return [parsed[0], parsed[1]]
	} catch {
		return null
	}
}

function normalizeCapabilityBaseURL(value: string): string {
	const trimmed = value.trim()
	try {
		const url = new URL(trimmed)
		// Provider URLs can contain credentials or signed query params that capability storage never needs.
		url.username = ''
		url.password = ''
		url.search = ''
		url.hash = ''
		url.pathname = url.pathname.replace(/\/+$/, '')
		return url.toString().replace(/\/+$/, '')
	} catch {
		return trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '')
	}
}

function pruneExpiredNamedToolChoiceCapabilities(
	capabilities: NamedToolChoiceCapabilities,
	now: number,
): void {
	for (const [key, entry] of Object.entries(capabilities.entries)) {
		if (entry.expiresAt <= now) delete capabilities.entries[key]
	}
}

function createEmptyNamedToolChoiceCapabilities(): NamedToolChoiceCapabilities {
	return {
		version: NAMED_TOOL_CHOICE_CAPABILITIES_VERSION,
		entries: {},
	}
}

function mergeNamedToolChoiceCapability(
	storage: UserSessionStorageArea,
	key: string,
	expiresAt: number,
): Promise<void> {
	return serializeNamedToolChoiceCapabilityStorage(async () => {
		const result = await storage.get(WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY)
		const loaded = normalizeNamedToolChoiceCapabilities(
			result[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY],
			Date.now(),
		)
		const currentExpiresAt = loaded.capabilities.entries[key]?.expiresAt ?? 0
		loaded.capabilities.entries[key] = { expiresAt: Math.max(currentExpiresAt, expiresAt) }
		await persistNamedToolChoiceCapabilities(storage, loaded.capabilities)
	})
}

function serializeNamedToolChoiceCapabilityStorage<T>(callback: () => Promise<T>): Promise<T> {
	const operation = namedToolChoiceCapabilityStorageQueue.then(() =>
		withNamedToolChoiceCapabilityLock(callback),
	)
	namedToolChoiceCapabilityStorageQueue = operation.then(
		() => undefined,
		() => undefined,
	)
	return operation
}

function withNamedToolChoiceCapabilityLock<T>(callback: () => Promise<T>): Promise<T> {
	const locks = globalThis.navigator?.locks
	if (!locks) return callback()
	return locks.request(NAMED_TOOL_CHOICE_CAPABILITY_LOCK_NAME, { mode: 'exclusive' }, callback)
}

function persistNamedToolChoiceCapabilities(
	storage: UserSessionStorageArea,
	capabilities: NamedToolChoiceCapabilities,
): Promise<void> {
	return storage.set({
		[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY]: capabilities,
	})
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
