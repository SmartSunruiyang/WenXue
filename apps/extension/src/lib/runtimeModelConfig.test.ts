import { describe, expect, it, vi } from 'vitest'

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
import { buildRuntimeAgentModels, loadRuntimeAgentModels } from './runtimeModelConfig'

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
})
