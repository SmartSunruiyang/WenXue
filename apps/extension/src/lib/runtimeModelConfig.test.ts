import { describe, expect, it, vi } from 'vitest'

import { DEMO_CONFIG } from '@/agent/constants'
import type { ExtConfig } from '@/agent/useAgent'
import {
	type CloudAuthStorageArea,
	WENXUE_CLOUD_AUTH_SESSION_KEY,
	type ExtensionCloudAuthSession,
} from '@/lib/cloudAuthSession'
import { BUILT_IN_MODEL_ID, type CustomModelConfig } from './modelConfig'
import { buildRuntimeAgentModels, loadRuntimeAgentModels } from './runtimeModelConfig'

const session: ExtensionCloudAuthSession = {
	uid: '2071249607247777793',
	type: 'external',
	accessToken: 'access-token',
	expiresAt: Date.now() + 120_000,
	envId: 'wenxue-d8gz76tacc3659f05',
	region: 'ap-shanghai',
	gatewayBaseUrl: 'https://gateway.example',
}

function createStorage(initial: Record<string, unknown>): CloudAuthStorageArea {
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
	it('uses the CloudBase product-user access token for built-in text and vision models', () => {
		const models = buildRuntimeAgentModels(
			{
				...DEMO_CONFIG,
				selectedModelId: BUILT_IN_MODEL_ID,
				customModels: [],
			},
			{ session, now: () => Date.now() },
		)

		expect(models.active).toMatchObject({
			baseURL: 'https://gateway.example/v1',
			model: DEMO_CONFIG.model,
			apiKey: 'access-token',
		})
		expect(models.chaoxingModels.text).toEqual(models.active)
		expect(models.chaoxingModels.vision).toMatchObject({
			baseURL: 'https://gateway.example/v1',
			model: 'qwen3.7-plus',
			apiKey: 'access-token',
		})
	})

	it('keeps custom BYO-Key models direct and does not require CloudBase auth', () => {
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

	it('fails closed for built-in models when no valid CloudBase session exists', () => {
		expect(() =>
			buildRuntimeAgentModels(
				{ ...DEMO_CONFIG, selectedModelId: BUILT_IN_MODEL_ID, customModels: [] },
				{ session: null, now: () => Date.now() },
			),
		).toThrow('请先在问学启动器登录注册用户')

		expect(() =>
			buildRuntimeAgentModels(
				{ ...DEMO_CONFIG, selectedModelId: BUILT_IN_MODEL_ID, customModels: [] },
				{
					session: { ...session, expiresAt: Date.now() - 1 },
					now: () => Date.now(),
				},
			),
		).toThrow('请先在问学启动器登录注册用户')
	})

	it('loads the persisted CloudBase auth session and ignores obsolete fallback flags', async () => {
		const storage = createStorage({
			[WENXUE_CLOUD_AUTH_SESSION_KEY]: { ...session, gatewayBaseUrl: 'https://gateway.example/v1/' },
			WenXueUseLocalBuiltinLlmFallback: true,
		})

		const models = await loadRuntimeAgentModels(
			{ ...DEMO_CONFIG, selectedModelId: BUILT_IN_MODEL_ID, customModels: [] },
			storage,
		)

		expect(models.active).toMatchObject({
			baseURL: 'https://gateway.example/v1',
			apiKey: 'access-token',
		})
	})
})
