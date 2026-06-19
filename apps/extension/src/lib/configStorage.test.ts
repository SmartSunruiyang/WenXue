import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEMO_BASE_URL, DEMO_CONFIG, LEGACY_TESTING_ENDPOINTS } from '@/agent/constants'
import type { AdvancedConfig, ExtConfig } from '@/agent/useAgent'
import { loadStoredConfig, saveStoredConfig } from './configStorage'
import { BUILT_IN_MODEL_ID, type CustomModelConfig } from './modelConfig'

type StoredValue = Record<string, unknown>

function createStorage(initial: StoredValue = {}) {
	const data = new Map(Object.entries(initial))
	const storage = {
		get: vi.fn(async (keys: string | string[]) => {
			const names = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(names.map((key) => [key, data.get(key)]))
		}),
		set: vi.fn(async (values: StoredValue) => {
			for (const [key, value] of Object.entries(values)) {
				data.set(key, value)
			}
		}),
		remove: vi.fn(async (key: string) => {
			data.delete(key)
		}),
		data,
	}
	return storage
}

describe('configStorage', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('loads demo defaults and persists them when no config exists', async () => {
		const storage = createStorage()

		const config = await loadStoredConfig(storage)

		expect(config).toEqual({
			...DEMO_CONFIG,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			chaoxingTextModelId: undefined,
			chaoxingVisionModelId: undefined,
		})
		expect(storage.set).toHaveBeenCalledWith({ llmConfig: DEMO_CONFIG })
	})

	it('migrates legacy testing endpoints before returning config', async () => {
		const storage = createStorage({
			llmConfig: {
				baseURL: LEGACY_TESTING_ENDPOINTS[0],
				model: 'legacy-model',
			},
		})

		const config = await loadStoredConfig(storage)

		expect(config.baseURL).toBe(DEMO_BASE_URL)
		expect(config.model).toBe(DEMO_CONFIG.model)
		expect(config.selectedModelId).toBe(BUILT_IN_MODEL_ID)
		expect(config.customModels).toEqual([])
		expect(storage.set).toHaveBeenCalledWith({ llmConfig: DEMO_CONFIG })
	})

	it('merges language, interface language, and advanced config', async () => {
		const advancedConfig: AdvancedConfig = {
			systemInstruction: 'Answer with citations',
			experimentalLlmsTxt: true,
		}
		const storage = createStorage({
			llmConfig: {
				baseURL: 'https://api.example.com/v1',
				model: 'custom-model',
				apiKey: 'sk-test',
			},
			language: 'en-US',
			uiLanguage: 'zh-CN',
			advancedConfig,
		})

		const config = await loadStoredConfig(storage)

		expect(config).toEqual({
			baseURL: 'https://api.example.com/v1',
			model: 'custom-model',
			apiKey: 'sk-test',
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			chaoxingTextModelId: undefined,
			chaoxingVisionModelId: undefined,
			language: 'en-US',
			uiLanguage: 'zh-CN',
			...advancedConfig,
		})
	})

	it('loads stored chaoxing text/vision model ids', async () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-deepseek',
				provider: 'deepseek',
				baseURL: 'https://api.deepseek.com',
				apiKey: 'sk-deepseek',
				model: 'deepseek-chat',
			},
			{
				id: 'model-qwen-vl',
				provider: 'qwen',
				baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
				apiKey: 'sk-qwen',
				model: 'qwen-vl-max',
			},
		]
		const storage = createStorage({
			llmConfig: DEMO_CONFIG,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels,
			chaoxingTextModelId: 'model-deepseek',
			chaoxingVisionModelId: 'model-qwen-vl',
		})

		const config = await loadStoredConfig(storage)

		expect(config.chaoxingTextModelId).toBe('model-deepseek')
		expect(config.chaoxingVisionModelId).toBe('model-qwen-vl')
	})

	it('ignores the legacy step limit while preserving supported advanced config', async () => {
		const legacyStepLimitKey = ['max', 'Steps'].join('')
		const storage = createStorage({
			llmConfig: {
				baseURL: 'https://api.example.com/v1',
				model: 'custom-model',
			},
			advancedConfig: {
				[legacyStepLimitKey]: 20,
				systemInstruction: 'Answer with citations',
				experimentalLlmsTxt: true,
				experimentalIncludeAllTabs: false,
				disableNamedToolChoice: true,
			},
		})

		const config = await loadStoredConfig(storage)

		expect(config).toStrictEqual({
			baseURL: 'https://api.example.com/v1',
			model: 'custom-model',
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			language: undefined,
			uiLanguage: undefined,
			systemInstruction: 'Answer with citations',
			experimentalLlmsTxt: true,
			experimentalIncludeAllTabs: false,
			disableNamedToolChoice: true,
			chaoxingTextModelId: undefined,
			chaoxingVisionModelId: undefined,
		})
		expect(config).not.toHaveProperty(legacyStepLimitKey)
	})

	it('loads a selected custom model as the active LLM config', async () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-deepseek',
				provider: 'deepseek',
				baseURL: 'https://api.deepseek.com',
				apiKey: 'sk-deepseek',
				model: 'deepseek-chat',
			},
		]
		const storage = createStorage({
			llmConfig: DEMO_CONFIG,
			selectedModelId: 'model-deepseek',
			customModels,
		})

		const config = await loadStoredConfig(storage)

		expect(config).toMatchObject({
			baseURL: 'https://api.deepseek.com',
			apiKey: 'sk-deepseek',
			model: 'deepseek-chat',
			selectedModelId: 'model-deepseek',
			customModels,
		})
	})

	it('removes response language when saving system language preference', async () => {
		const storage = createStorage({ language: 'zh-CN' })
		const config: ExtConfig = {
			baseURL: 'https://api.example.com/v1',
			model: 'custom-model',
			apiKey: 'sk-test',
			uiLanguage: 'en-US',
			systemInstruction: 'Be direct',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
			disableNamedToolChoice: true,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
		}

		await saveStoredConfig(storage, config)

		expect(storage.set).toHaveBeenCalledWith({
			llmConfig: DEMO_CONFIG,
		})
		expect(storage.remove).toHaveBeenCalledWith('language')
		expect(storage.set).toHaveBeenCalledWith({ uiLanguage: 'en-US' })
		expect(storage.set).toHaveBeenCalledWith({ selectedModelId: BUILT_IN_MODEL_ID })
		expect(storage.set).toHaveBeenCalledWith({ customModels: [] })
		expect(storage.set).toHaveBeenCalledWith({
			advancedConfig: {
				systemInstruction: 'Be direct',
				experimentalLlmsTxt: false,
				experimentalIncludeAllTabs: true,
				disableNamedToolChoice: true,
			},
		})
		const advancedConfigPayload = storage.set.mock.calls.find(
			([payload]) => 'advancedConfig' in payload,
		)?.[0]
		expect(advancedConfigPayload).toStrictEqual({
			advancedConfig: {
				systemInstruction: 'Be direct',
				experimentalLlmsTxt: false,
				experimentalIncludeAllTabs: true,
				disableNamedToolChoice: true,
			},
		})
	})

	it('saves each custom model with its own API key and persists the selected model', async () => {
		const storage = createStorage()
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-qwen',
				provider: 'qwen',
				baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
				apiKey: 'sk-qwen',
				model: 'qwen-plus',
			},
			{
				id: 'model-moonshot',
				provider: 'custom',
				providerName: 'Moonshot',
				baseURL: 'https://api.moonshot.example/v1',
				apiKey: 'sk-moonshot',
				model: 'moonshot-v1',
			},
		]
		const config: ExtConfig = {
			baseURL: customModels[1].baseURL,
			model: customModels[1].model,
			apiKey: customModels[1].apiKey,
			selectedModelId: 'model-moonshot',
			customModels,
		}

		await saveStoredConfig(storage, config)

		expect(storage.set).toHaveBeenCalledWith({
			llmConfig: {
				baseURL: 'https://api.moonshot.example/v1',
				model: 'moonshot-v1',
				apiKey: 'sk-moonshot',
			},
		})
		expect(storage.set).toHaveBeenCalledWith({ selectedModelId: 'model-moonshot' })
		expect(storage.set).toHaveBeenCalledWith({ customModels })
	})

	it('persists chaoxing text/vision model ids when set and clears them when unset', async () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-deepseek',
				provider: 'deepseek',
				baseURL: 'https://api.deepseek.com',
				apiKey: 'sk-deepseek',
				model: 'deepseek-chat',
			},
		]

		const storageWithIds = createStorage()
		await saveStoredConfig(storageWithIds, {
			baseURL: DEMO_CONFIG.baseURL,
			model: DEMO_CONFIG.model,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels,
			chaoxingTextModelId: 'model-deepseek',
			chaoxingVisionModelId: 'model-deepseek',
		})

		expect(storageWithIds.set).toHaveBeenCalledWith({ chaoxingTextModelId: 'model-deepseek' })
		expect(storageWithIds.set).toHaveBeenCalledWith({ chaoxingVisionModelId: 'model-deepseek' })

		const storageUnset = createStorage({
			chaoxingTextModelId: 'model-deepseek',
			chaoxingVisionModelId: 'model-deepseek',
		})
		const saved = await saveStoredConfig(storageUnset, {
			baseURL: DEMO_CONFIG.baseURL,
			model: DEMO_CONFIG.model,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels,
		})

		expect(storageUnset.remove).toHaveBeenCalledWith('chaoxingTextModelId')
		expect(storageUnset.remove).toHaveBeenCalledWith('chaoxingVisionModelId')
		expect(saved.chaoxingTextModelId).toBeUndefined()
		expect(saved.chaoxingVisionModelId).toBeUndefined()
	})
})
