import type { SupportedLanguage } from '@page-agent/core'
import type { LLMConfig } from '@page-agent/llms'

import { DEMO_CONFIG, migrateLegacyEndpoint } from '@/agent/constants'
import type { AdvancedConfig, ExtConfig } from '@/agent/useAgent'
import type { UILanguage } from '@/lib/i18n'
import {
	BUILT_IN_MODEL_ID,
	normalizeCustomModels,
	normalizeSelectedModelId,
	resolveSelectedLLMConfig,
} from '@/lib/modelConfig'

export interface ConfigStorageArea {
	get(keys: string | string[]): Promise<Record<string, unknown>>
	set(values: Record<string, unknown>): Promise<void>
	remove(key: string): Promise<void>
}

const CONFIG_STORAGE_KEYS = [
	'llmConfig',
	'language',
	'advancedConfig',
	'uiLanguage',
	'selectedModelId',
	'customModels',
	'visionModelId',
]

function sanitizePersistedLLMConfig(config: LLMConfig): LLMConfig {
	if (!Object.prototype.hasOwnProperty.call(config, 'disableNamedToolChoice')) return config

	const sanitized = { ...config }
	delete sanitized.disableNamedToolChoice
	return sanitized
}

export async function loadStoredConfig(
	storage: ConfigStorageArea = chrome.storage.local,
): Promise<ExtConfig> {
	const result = await storage.get(CONFIG_STORAGE_KEYS)
	const customModels = normalizeCustomModels(result.customModels)
	const selectedModelId = normalizeSelectedModelId(
		typeof result.selectedModelId === 'string'
			? (result.selectedModelId as string)
			: BUILT_IN_MODEL_ID,
		customModels,
	)
	const hasStoredModelSelection = typeof result.selectedModelId === 'string'
	const rawStoredLLMConfig = (result.llmConfig as LLMConfig | undefined) ?? DEMO_CONFIG
	const storedLLMConfig = sanitizePersistedLLMConfig(rawStoredLLMConfig)
	let llmConfig = hasStoredModelSelection
		? resolveSelectedLLMConfig(selectedModelId, customModels)
		: storedLLMConfig
	const language = (result.language as SupportedLanguage | undefined) || undefined
	const uiLanguage = (result.uiLanguage as UILanguage | undefined) || undefined
	const rawStoredAdvancedConfig = result.advancedConfig
	const storedAdvancedConfig =
		typeof rawStoredAdvancedConfig === 'object' && rawStoredAdvancedConfig !== null
			? (rawStoredAdvancedConfig as AdvancedConfig)
			: {}
	const advancedConfig: AdvancedConfig = {
		systemInstruction: storedAdvancedConfig.systemInstruction,
		experimentalLlmsTxt: storedAdvancedConfig.experimentalLlmsTxt ?? false,
		experimentalIncludeAllTabs: storedAdvancedConfig.experimentalIncludeAllTabs ?? true,
		logRetentionDays: storedAdvancedConfig.logRetentionDays,
		logMaxEntries: storedAdvancedConfig.logMaxEntries,
	}
	if (
		typeof rawStoredAdvancedConfig === 'object' &&
		rawStoredAdvancedConfig !== null &&
		'disableNamedToolChoice' in rawStoredAdvancedConfig
	) {
		await storage.set({ advancedConfig })
	}
	const visionModelId = typeof result.visionModelId === 'string' ? result.visionModelId : undefined

	const migrated = migrateLegacyEndpoint(llmConfig)
	if (migrated !== llmConfig) {
		llmConfig = migrated
		await storage.set({ llmConfig: migrated })
	} else if (!result.llmConfig || storedLLMConfig !== rawStoredLLMConfig) {
		await storage.set({ llmConfig: result.llmConfig ? storedLLMConfig : llmConfig })
	}

	return {
		...llmConfig,
		...advancedConfig,
		language,
		uiLanguage,
		selectedModelId,
		customModels,
		visionModelId,
	}
}

export async function saveStoredConfig(
	storage: ConfigStorageArea,
	{
		language,
		uiLanguage,
		systemInstruction,
		experimentalLlmsTxt,
		experimentalIncludeAllTabs,
		logRetentionDays,
		logMaxEntries,
		selectedModelId,
		customModels: rawCustomModels,
		visionModelId,
		...legacyLLMConfig
	}: ExtConfig,
): Promise<ExtConfig> {
	const customModels = normalizeCustomModels(rawCustomModels)
	const normalizedSelectedModelId = normalizeSelectedModelId(selectedModelId, customModels)
	const llmConfig = sanitizePersistedLLMConfig(
		rawCustomModels || selectedModelId
			? resolveSelectedLLMConfig(normalizedSelectedModelId, customModels)
			: legacyLLMConfig,
	)

	await storage.set({ llmConfig })
	await storage.set({ selectedModelId: normalizedSelectedModelId })
	await storage.set({ customModels })
	if (visionModelId) {
		await storage.set({ visionModelId })
	} else {
		await storage.remove('visionModelId')
	}
	if (language) {
		await storage.set({ language })
	} else {
		await storage.remove('language')
	}
	if (uiLanguage) {
		await storage.set({ uiLanguage })
	}

	const advancedConfig: AdvancedConfig = {
		systemInstruction,
		experimentalLlmsTxt: experimentalLlmsTxt ?? false,
		experimentalIncludeAllTabs: experimentalIncludeAllTabs ?? true,
		logRetentionDays,
		logMaxEntries,
	}
	await storage.set({ advancedConfig })

	return {
		...llmConfig,
		...advancedConfig,
		language,
		uiLanguage,
		selectedModelId: normalizedSelectedModelId,
		customModels,
		visionModelId: visionModelId || undefined,
	}
}
