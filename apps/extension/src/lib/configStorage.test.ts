import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEMO_BASE_URL, DEMO_CONFIG, LEGACY_TESTING_ENDPOINTS } from '@/agent/constants'
import type { AdvancedConfig, ExtConfig } from '@/agent/useAgent'
import { isConfigStorageChange, loadStoredConfig, saveStoredConfig } from './configStorage'
import { BUILT_IN_MODEL_ID, BUILT_IN_VISION_MODEL_ID, type CustomModelConfig } from './modelConfig'

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
			systemInstruction: undefined,
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
			logRetentionDays: undefined,
			logMaxEntries: undefined,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			visionModelId: undefined,
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
			visionModelId: undefined,
			language: 'en-US',
			uiLanguage: 'zh-CN',
			...advancedConfig,
			experimentalIncludeAllTabs: true,
			logRetentionDays: undefined,
			logMaxEntries: undefined,
		})
	})

	it('loads the stored system vision model id', async () => {
		const customModels: CustomModelConfig[] = [
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
			visionModelId: 'model-qwen-vl',
		})

		const config = await loadStoredConfig(storage)

		expect(config.visionModelId).toBe('model-qwen-vl')
	})

	it('migrates the text-only built-in id out of the vision role', async () => {
		const storage = createStorage({
			llmConfig: DEMO_CONFIG,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			visionModelId: BUILT_IN_MODEL_ID,
		})

		const config = await loadStoredConfig(storage)

		expect(config.visionModelId).toBe(BUILT_IN_VISION_MODEL_ID)
		expect(storage.set).toHaveBeenCalledWith({ visionModelId: BUILT_IN_VISION_MODEL_ID })
	})

	it('identifies only local configuration storage changes', () => {
		const modelChange = { selectedModelId: { oldValue: 'old', newValue: 'new' } }
		const unrelatedChange = { unrelated: { oldValue: 1, newValue: 2 } }

		expect(isConfigStorageChange(modelChange, 'local')).toBe(true)
		expect(isConfigStorageChange(modelChange, 'sync')).toBe(false)
		expect(isConfigStorageChange(unrelatedChange, 'local')).toBe(false)
	})

	it('ignores the legacy step limit while preserving supported advanced config', async () => {
		const legacyStepLimitKey = ['max', 'Steps'].join('')
		const storage = createStorage({
			llmConfig: {
				baseURL: 'https://api.example.com/v1',
				model: 'custom-model',
				disableNamedToolChoice: true,
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
			visionModelId: undefined,
			logRetentionDays: undefined,
			logMaxEntries: undefined,
		})
		expect(config).not.toHaveProperty(legacyStepLimitKey)
		expect(config).not.toHaveProperty('disableNamedToolChoice')
		expect(storage.set).toHaveBeenCalledWith({
			llmConfig: {
				baseURL: 'https://api.example.com/v1',
				model: 'custom-model',
			},
		})
		expect(storage.set).toHaveBeenCalledWith({
			advancedConfig: {
				systemInstruction: 'Answer with citations',
				experimentalLlmsTxt: true,
				experimentalIncludeAllTabs: false,
				logRetentionDays: undefined,
				logMaxEntries: undefined,
			},
		})
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

	it('atomically clears response language when saving system language preference', async () => {
		const storage = createStorage({ language: 'zh-CN' })
		const config: ExtConfig = {
			baseURL: 'https://api.example.com/v1',
			model: 'custom-model',
			apiKey: 'sk-test',
			uiLanguage: 'en-US',
			systemInstruction: 'Be direct',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
		}

		await saveStoredConfig(storage, config)

		expect(storage.set).toHaveBeenCalledTimes(1)
		expect(storage.remove).not.toHaveBeenCalled()
		expect(storage.set).toHaveBeenCalledWith({
			llmConfig: DEMO_CONFIG,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			visionModelId: null,
			language: null,
			uiLanguage: 'en-US',
			advancedConfig: {
				systemInstruction: 'Be direct',
				experimentalLlmsTxt: false,
				experimentalIncludeAllTabs: true,
				logRetentionDays: undefined,
				logMaxEntries: undefined,
			},
		})
		expect(storage.data.get('language')).toBeNull()
		expect((await loadStoredConfig(storage)).language).toBeUndefined()
	})

	it('strips the legacy named-tool flag when saving an old config shape', async () => {
		const storage = createStorage()
		const config: ExtConfig = {
			baseURL: 'https://api.example.com/v1',
			model: 'custom-model',
			disableNamedToolChoice: true,
		}

		const saved = await saveStoredConfig(storage, config)

		expect(storage.set).toHaveBeenCalledTimes(1)
		expect(storage.set).toHaveBeenCalledWith(
			expect.objectContaining({
				llmConfig: {
					baseURL: 'https://api.example.com/v1',
					model: 'custom-model',
				},
				visionModelId: null,
				language: null,
				advancedConfig: {
					systemInstruction: undefined,
					experimentalLlmsTxt: false,
					experimentalIncludeAllTabs: true,
					logRetentionDays: undefined,
					logMaxEntries: undefined,
				},
			}),
		)
		expect(saved).not.toHaveProperty('disableNamedToolChoice')
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

		expect(storage.set).toHaveBeenCalledTimes(1)
		expect(storage.set).toHaveBeenCalledWith(
			expect.objectContaining({
				llmConfig: {
					baseURL: 'https://api.moonshot.example/v1',
					model: 'moonshot-v1',
					apiKey: 'sk-moonshot',
				},
				selectedModelId: 'model-moonshot',
				customModels,
			}),
		)
	})

	it('persists the system vision model id when set and clears it when unset', async () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-qwen-vl',
				provider: 'qwen',
				baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
				apiKey: 'sk-qwen',
				model: 'qwen-vl-max',
			},
		]

		const storageWithId = createStorage()
		await saveStoredConfig(storageWithId, {
			baseURL: DEMO_CONFIG.baseURL,
			model: DEMO_CONFIG.model,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels,
			visionModelId: 'model-qwen-vl',
		})

		expect(storageWithId.set).toHaveBeenCalledTimes(1)
		expect(storageWithId.set).toHaveBeenCalledWith(
			expect.objectContaining({ visionModelId: 'model-qwen-vl' }),
		)

		const storageUnset = createStorage({
			visionModelId: 'model-qwen-vl',
		})
		const saved = await saveStoredConfig(storageUnset, {
			baseURL: DEMO_CONFIG.baseURL,
			model: DEMO_CONFIG.model,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels,
		})

		expect(storageUnset.set).toHaveBeenCalledTimes(1)
		expect(storageUnset.remove).not.toHaveBeenCalled()
		expect(storageUnset.data.get('visionModelId')).toBeNull()
		expect((await loadStoredConfig(storageUnset)).visionModelId).toBeUndefined()
		expect(saved.visionModelId).toBeUndefined()
	})

	it('never persists the text-only built-in model as the vision model', async () => {
		const storage = createStorage()

		const saved = await saveStoredConfig(storage, {
			baseURL: DEMO_CONFIG.baseURL,
			model: DEMO_CONFIG.model,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			visionModelId: BUILT_IN_MODEL_ID,
		})

		expect(storage.set).toHaveBeenCalledTimes(1)
		expect(storage.set).toHaveBeenCalledWith(
			expect.objectContaining({ visionModelId: BUILT_IN_VISION_MODEL_ID }),
		)
		expect(saved.visionModelId).toBe(BUILT_IN_VISION_MODEL_ID)
	})
})
