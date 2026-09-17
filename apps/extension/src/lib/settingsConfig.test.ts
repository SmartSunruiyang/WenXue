import { describe, expect, it } from 'vitest'

import { DEMO_CONFIG } from '@/agent/constants'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_VISION_MODEL_ID,
	type CustomModelConfig,
	getCustomModelLabel,
} from './modelConfig'
import { buildSettingsConfig, settingsConfigKey } from './settingsConfig'

describe('settingsConfig', () => {
	it('normalizes empty optional values for auto-save', () => {
		const config = buildSettingsConfig({
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			language: undefined,
			uiLanguage: 'zh-CN',
			systemInstruction: '',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		})

		expect(config).toStrictEqual({
			...DEMO_CONFIG,
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			visionModelId: undefined,
			language: undefined,
			uiLanguage: 'zh-CN',
			systemInstruction: undefined,
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		})
	})

	it('passes through the system vision model id when set', () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-qwen-vl',
				provider: 'qwen',
				baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
				apiKey: 'sk-qwen',
				model: 'qwen-vl-max',
			},
		]

		const config = buildSettingsConfig({
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels,
			visionModelId: 'model-qwen-vl',
			language: undefined,
			uiLanguage: 'zh-CN',
			systemInstruction: '',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: false,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		})

		expect(config).toMatchObject({
			visionModelId: 'model-qwen-vl',
		})
	})

	it('clears the system vision model id when it points at a removed model', () => {
		const config = buildSettingsConfig({
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			visionModelId: 'model-does-not-exist',
			language: undefined,
			uiLanguage: 'zh-CN',
			systemInstruction: '',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: false,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		})

		expect(config.visionModelId).toBeUndefined()
	})

	it('clears the text-only built-in id from the vision role', () => {
		const config = buildSettingsConfig({
			selectedModelId: BUILT_IN_MODEL_ID,
			customModels: [],
			visionModelId: BUILT_IN_MODEL_ID,
			language: undefined,
			uiLanguage: 'zh-CN',
			systemInstruction: '',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		})

		expect(config.visionModelId).toBeUndefined()
		expect(BUILT_IN_VISION_MODEL_ID).not.toBe(BUILT_IN_MODEL_ID)
	})

	it('uses the selected custom model as the active LLM config', () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-deepseek',
				provider: 'deepseek',
				baseURL: 'https://api.deepseek.com',
				apiKey: 'sk-deepseek',
				model: 'deepseek-chat',
			},
		]

		const config = buildSettingsConfig({
			selectedModelId: 'model-deepseek',
			customModels,
			language: undefined,
			uiLanguage: 'zh-CN',
			systemInstruction: '',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: false,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		})

		expect(config).toMatchObject({
			baseURL: 'https://api.deepseek.com',
			apiKey: 'sk-deepseek',
			model: 'deepseek-chat',
			selectedModelId: 'model-deepseek',
			customModels,
		})
	})

	it('keeps user-entered custom provider names for model labels', () => {
		const customModel: CustomModelConfig = {
			id: 'model-moonshot',
			provider: 'custom',
			providerName: 'Moonshot',
			baseURL: 'https://api.moonshot.example/v1',
			apiKey: 'sk-moonshot',
			model: 'moonshot-v1',
		}

		const config = buildSettingsConfig({
			selectedModelId: 'model-moonshot',
			customModels: [customModel],
			language: undefined,
			uiLanguage: 'zh-CN',
			systemInstruction: '',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: false,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		})

		expect(getCustomModelLabel(customModel)).toBe('Moonshot · moonshot-v1')
		expect(config).toMatchObject({
			baseURL: 'https://api.moonshot.example/v1',
			apiKey: 'sk-moonshot',
			model: 'moonshot-v1',
			customModels: [customModel],
		})
	})

	it('creates a stable key for equivalent settings', () => {
		const customModels: CustomModelConfig[] = [
			{
				id: 'model-qwen',
				provider: 'qwen',
				baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
				apiKey: 'sk-qwen',
				model: 'qwen-plus',
			},
		]
		const config = {
			...customModels[0],
			selectedModelId: 'model-qwen',
			customModels,
			visionModelId: 'model-qwen',
			language: 'en-US' as const,
			uiLanguage: 'en-US' as const,
			systemInstruction: 'Be concise',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: false,
		}

		expect(settingsConfigKey(config)).toBe(settingsConfigKey({ ...config }))
		expect(settingsConfigKey(config)).toBe(
			settingsConfigKey({ ...config, disableNamedToolChoice: true }),
		)
	})
})
