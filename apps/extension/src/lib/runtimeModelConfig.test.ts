import { afterEach, describe, expect, it, vi } from 'vitest'

import { shouldDisableNamedToolChoice } from '@page-agent/llms'

import {
	DEMO_CONFIG,
	WENXUE_GATEWAY_BASE_URL,
	WENXUE_GATEWAY_OPENAI_BASE_URL,
} from '@/agent/constants'
import type { ExtConfig } from '@/agent/useAgent'
import {
	type ExtensionUserSession,
	type UserSessionStorageArea,
	WENXUE_USER_SESSION_KEY,
} from '@/lib/userSession'
import { BUILT_IN_MODEL_ID, type CustomModelConfig } from './modelConfig'
import {
	buildRuntimeAgentModels,
	loadRuntimeAgentModels,
	WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY,
} from './runtimeModelConfig'

const DAY_MS = 24 * 60 * 60 * 1000
const CAPABILITY_TTL_MS = 30 * DAY_MS
const NOW = 1_800_000_000_000

const session: ExtensionUserSession = {
	userId: 'user_123',
	accessToken: 'cloudbase-access-token',
	refreshToken: 'cloudbase-refresh-token',
	expiresAt: 1893456000000,
	gatewayBaseUrl: WENXUE_GATEWAY_BASE_URL,
}

function createStorage(initial: Record<string, unknown>): UserSessionStorageArea {
	return {
		get: vi.fn(async (keys) => {
			const names = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(names.map((key) => [key, initial[key]]))
		}),
		set: vi.fn(async (values) => {
			Object.assign(initial, values)
		}),
		remove: vi.fn(async (key) => {
			delete initial[key]
		}),
	}
}

function createCustomConfig(
	customModels: CustomModelConfig[],
	selectedModelId: string,
	visionModelId: string,
): ExtConfig {
	const selected = customModels.find((model) => model.id === selectedModelId)
	if (!selected) throw new Error(`Missing custom model: ${selectedModelId}`)

	return {
		baseURL: selected.baseURL,
		model: selected.model,
		apiKey: selected.apiKey,
		selectedModelId,
		visionModelId,
		customModels,
	}
}

function storedCapabilityKey(baseURL: string, model: string): string {
	return JSON.stringify([baseURL, model])
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('runtimeModelConfig', () => {
	it('uses the user access token for built-in text and vision models', () => {
		const models = buildRuntimeAgentModels(
			{
				...DEMO_CONFIG,
				selectedModelId: BUILT_IN_MODEL_ID,
				customModels: [],
			},
			{ session, now: () => Date.now() },
		)

		expect(models.active).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			model: DEMO_CONFIG.model,
			apiKey: 'cloudbase-access-token',
		})
		expect(models.chaoxingModels.text).toEqual(models.active)
		expect(models.chaoxingModels.vision).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			model: 'qwen3.7-plus',
			apiKey: 'cloudbase-access-token',
		})
		expect(models.vision).toEqual(models.chaoxingModels.vision)
	})

	it('keeps custom BYO-Key models direct and does not require a user session', () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'custom-moonshot',
				provider: 'custom',
				providerName: 'Moonshot',
				baseURL: 'https://api.moonshot.example/v1',
				apiKey: 'sk-user-owned',
				model: 'moonshot-v1',
			},
		]
		const config: ExtConfig = {
			baseURL: customModels[0].baseURL,
			model: customModels[0].model,
			apiKey: customModels[0].apiKey,
			selectedModelId: 'custom-moonshot',
			visionModelId: 'custom-moonshot',
			customModels,
		}

		const models = buildRuntimeAgentModels(config, {
			session: null,
			now: () => Date.now(),
		})

		expect(models.active).toEqual({
			baseURL: 'https://api.moonshot.example/v1',
			model: 'moonshot-v1',
			apiKey: 'sk-user-owned',
		})
		expect(models.chaoxingModels.vision).toEqual(models.active)
		expect(models.vision).toEqual(models.active)
	})

	it('keeps built-in models usable without a user session until the first send', () => {
		const models = buildRuntimeAgentModels(
			{ ...DEMO_CONFIG, selectedModelId: BUILT_IN_MODEL_ID, customModels: [] },
			{ session: null, now: () => Date.now() },
		)

		expect(models.active).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			model: DEMO_CONFIG.model,
			apiKey: '',
		})
		expect(models.chaoxingModels.vision).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			model: 'qwen3.7-plus',
			apiKey: '',
		})
		expect(models.vision).toEqual(models.chaoxingModels.vision)
	})

	it('loads the persisted user session and ignores obsolete fallback flags', async () => {
		const storage = createStorage({
			[WENXUE_USER_SESSION_KEY]: {
				...session,
				gatewayBaseUrl: `${WENXUE_GATEWAY_BASE_URL}/v1/`,
			},
			WenXueUseLocalBuiltinLlmFallback: true,
		})

		const models = await loadRuntimeAgentModels(
			{ ...DEMO_CONFIG, selectedModelId: BUILT_IN_MODEL_ID, customModels: [] },
			storage,
		)

		expect(models.active).toMatchObject({
			baseURL: WENXUE_GATEWAY_OPENAI_BASE_URL,
			apiKey: 'cloudbase-access-token',
		})
	})

	it('shares live capability state without aliasing configs for the same endpoint and model', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const customModels: CustomModelConfig[] = [
			{
				id: 'custom-text',
				provider: 'custom',
				baseURL: 'https://API.EXAMPLE.com/v1/',
				model: 'shared-model',
				apiKey: 'text-key',
			},
			{
				id: 'custom-vision',
				provider: 'custom',
				baseURL: 'https://api.example.com/v1',
				model: 'shared-model',
				apiKey: 'vision-key',
			},
		]
		const stored: Record<string, unknown> = {}
		const storage = createStorage(stored)
		const config = createCustomConfig(customModels, 'custom-text', 'custom-vision')

		const models = await loadRuntimeAgentModels(config, storage)
		const copiedVisionConfig = { ...models.vision }

		expect(models.active).not.toBe(models.vision)
		expect(models.active.apiKey).toBe('text-key')
		expect(models.vision.apiKey).toBe('vision-key')
		expect(models.chaoxingModels.text).toBe(models.active)
		expect(models.chaoxingModels.vision).toBe(models.vision)
		await models.active.onNamedToolChoiceUnsupported?.()
		expect(models.active.disableNamedToolChoice).toBe(true)
		expect(models.vision.disableNamedToolChoice).toBe(true)
		expect(shouldDisableNamedToolChoice(copiedVisionConfig)).toBe(true)

		const reloaded = await loadRuntimeAgentModels(config, storage)
		expect(reloaded.active.disableNamedToolChoice).toBe(true)
		expect(reloaded.vision.disableNamedToolChoice).toBe(true)
		expect(reloaded.active.apiKey).toBe('text-key')
		expect(reloaded.vision.apiKey).toBe('vision-key')
	})

	it('isolates capabilities when either the normalized endpoint or exact model differs', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const customModels: CustomModelConfig[] = [
			{
				id: 'primary',
				provider: 'custom',
				baseURL: 'https://one.example/v1',
				model: 'model-a',
			},
			{
				id: 'different-endpoint',
				provider: 'custom',
				baseURL: 'https://two.example/v1',
				model: 'model-a',
			},
			{
				id: 'different-model',
				provider: 'custom',
				baseURL: 'https://one.example/v1',
				model: 'model-b',
			},
		]
		const stored: Record<string, unknown> = {}
		const storage = createStorage(stored)
		const primaryConfig = createCustomConfig(customModels, 'primary', 'different-endpoint')
		const primaryModels = await loadRuntimeAgentModels(primaryConfig, storage)
		await primaryModels.active.onNamedToolChoiceUnsupported?.()

		const endpointIsolation = await loadRuntimeAgentModels(primaryConfig, storage)
		expect(endpointIsolation.active.disableNamedToolChoice).toBe(true)
		expect(endpointIsolation.vision.disableNamedToolChoice).toBe(false)

		const modelIsolation = await loadRuntimeAgentModels(
			createCustomConfig(customModels, 'different-model', 'primary'),
			storage,
		)
		expect(modelIsolation.active.disableNamedToolChoice).toBe(false)
		expect(modelIsolation.vision.disableNamedToolChoice).toBe(true)
	})

	it('ignores and prunes expired or invalid stored entries', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const expiredKey = storedCapabilityKey('https://expired.example/v1', 'expired-model')
		const invalidExpiryKey = storedCapabilityKey('https://invalid.example/v1', 'invalid-model')
		const stored: Record<string, unknown> = {
			[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY]: {
				version: 1,
				entries: {
					[expiredKey]: { expiresAt: NOW },
					[invalidExpiryKey]: { expiresAt: 'later' },
					'not-json': { expiresAt: NOW + CAPABILITY_TTL_MS },
				},
			},
		}
		const storage = createStorage(stored)

		const models = await loadRuntimeAgentModels(
			{
				...DEMO_CONFIG,
				selectedModelId: BUILT_IN_MODEL_ID,
				customModels: [],
			},
			storage,
		)

		expect(models.active.disableNamedToolChoice).toBe(false)
		expect(stored[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY]).toEqual({
			version: 1,
			entries: {},
		})
		expect(storage.set).toHaveBeenCalledTimes(1)
	})

	it('persists callbacks with a fresh 30-day expiry and extends it on later marks', async () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const stored: Record<string, unknown> = {}
		const storage = createStorage(stored)
		const models = await loadRuntimeAgentModels(
			{
				...DEMO_CONFIG,
				selectedModelId: BUILT_IN_MODEL_ID,
				customModels: [],
			},
			storage,
		)
		await models.active.onNamedToolChoiceUnsupported?.()

		const firstState = stored[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY]
		expect(firstState).toEqual({
			version: 1,
			entries: {
				[storedCapabilityKey(WENXUE_GATEWAY_OPENAI_BASE_URL, DEMO_CONFIG.model)]: {
					expiresAt: NOW + CAPABILITY_TTL_MS,
				},
			},
		})

		now.mockReturnValue(NOW + DAY_MS)
		await models.active.onNamedToolChoiceUnsupported?.()
		const extendedState = stored[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY] as {
			entries: Record<string, { expiresAt: number }>
		}
		expect(
			extendedState.entries[storedCapabilityKey(WENXUE_GATEWAY_OPENAI_BASE_URL, DEMO_CONFIG.model)]
				.expiresAt,
		).toBe(NOW + DAY_MS + CAPABILITY_TTL_MS)

		const reloaded = await loadRuntimeAgentModels(
			{
				...DEMO_CONFIG,
				selectedModelId: BUILT_IN_MODEL_ID,
				customModels: [],
			},
			storage,
		)
		expect(reloaded.active.disableNamedToolChoice).toBe(true)
	})

	it('merges concurrent capability writes from independently loaded runtimes', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-a',
				provider: 'custom',
				baseURL: 'https://one.example/v1',
				model: 'model-a',
			},
			{
				id: 'model-b',
				provider: 'custom',
				baseURL: 'https://two.example/v1',
				model: 'model-b',
			},
		]
		const stored: Record<string, unknown> = {}
		const storage = createStorage(stored)
		const runtimeA = await loadRuntimeAgentModels(
			createCustomConfig(customModels, 'model-a', 'model-a'),
			storage,
		)
		const runtimeB = await loadRuntimeAgentModels(
			createCustomConfig(customModels, 'model-b', 'model-b'),
			storage,
		)

		await Promise.all([
			runtimeA.active.onNamedToolChoiceUnsupported?.(),
			runtimeB.active.onNamedToolChoiceUnsupported?.(),
		])

		expect(stored[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY]).toEqual({
			version: 1,
			entries: {
				[storedCapabilityKey('https://one.example/v1', 'model-a')]: {
					expiresAt: NOW + CAPABILITY_TTL_MS,
				},
				[storedCapabilityKey('https://two.example/v1', 'model-b')]: {
					expiresAt: NOW + CAPABILITY_TTL_MS,
				},
			},
		})
	})

	it('never persists a custom model API key or error payload', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const customModels: CustomModelConfig[] = [
			{
				id: 'secret-model',
				provider: 'custom',
				baseURL: 'https://secret.example/v1',
				model: 'model-secret',
				apiKey: 'sk-never-store-this',
			},
		]
		const stored: Record<string, unknown> = {}
		const storage = createStorage(stored)
		const models = await loadRuntimeAgentModels(
			createCustomConfig(customModels, 'secret-model', 'secret-model'),
			storage,
		)

		await models.active.onNamedToolChoiceUnsupported?.()

		const serialized = JSON.stringify(stored[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY])
		expect(serialized).not.toContain('sk-never-store-this')
		expect(serialized).not.toContain('apiKey')
		expect(serialized).not.toContain('error')
	})

	it('keeps the agent usable when optional capability-cache cleanup fails', async () => {
		const storage = createStorage({
			[WENXUE_NAMED_TOOL_CHOICE_CAPABILITIES_KEY]: { version: 0, entries: {} },
		})
		vi.mocked(storage.set).mockRejectedValue(new Error('storage unavailable'))
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const models = await loadRuntimeAgentModels(
			{
				...DEMO_CONFIG,
				selectedModelId: BUILT_IN_MODEL_ID,
				customModels: [],
			},
			storage,
		)

		expect(models.active.model).toBe(DEMO_CONFIG.model)
		expect(shouldDisableNamedToolChoice(models.active)).toBe(false)
		expect(warning).toHaveBeenCalledWith(
			'[WenXue] Failed to load named tool_choice compatibility cache',
		)
	})

	it('propagates callback persistence failures', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const storage = createStorage({})
		const models = await loadRuntimeAgentModels(
			{
				...DEMO_CONFIG,
				selectedModelId: BUILT_IN_MODEL_ID,
				customModels: [],
			},
			storage,
		)
		vi.mocked(storage.set).mockRejectedValueOnce(new Error('storage unavailable'))

		await expect(models.active.onNamedToolChoiceUnsupported?.()).rejects.toThrow(
			'storage unavailable',
		)
	})
})
