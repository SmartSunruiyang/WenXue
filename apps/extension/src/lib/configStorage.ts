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
	'chaoxingTextModelId',
	'chaoxingVisionModelId',
]

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
	let llmConfig = hasStoredModelSelection
		? resolveSelectedLLMConfig(selectedModelId, customModels)
		: ((result.llmConfig as LLMConfig | undefined) ?? DEMO_CONFIG)
	const language = (result.language as SupportedLanguage | undefined) || undefined
	const uiLanguage = (result.uiLanguage as UILanguage | undefined) || undefined
	const advancedConfig = (result.advancedConfig as AdvancedConfig | undefined) ?? {}
	const chaoxingTextModelId =
		typeof result.chaoxingTextModelId === 'string' ? result.chaoxingTextModelId : undefined
	const chaoxingVisionModelId =
		typeof result.chaoxingVisionModelId === 'string' ? result.chaoxingVisionModelId : undefined

	const migrated = migrateLegacyEndpoint(llmConfig)
	if (migrated !== llmConfig) {
		llmConfig = migrated
		await storage.set({ llmConfig: migrated })
	} else if (!result.llmConfig) {
		await storage.set({ llmConfig })
	}

	return {
		...llmConfig,
		...advancedConfig,
		language,
		uiLanguage,
		selectedModelId,
		customModels,
		chaoxingTextModelId,
		chaoxingVisionModelId,
	}
}

export async function saveStoredConfig(
	storage: ConfigStorageArea,
	{
		language,
		uiLanguage,
		maxSteps,
		systemInstruction,
		experimentalLlmsTxt,
		experimentalIncludeAllTabs,
		disableNamedToolChoice,
		selectedModelId,
		customModels: rawCustomModels,
		chaoxingTextModelId,
		chaoxingVisionModelId,
		...legacyLLMConfig
	}: ExtConfig,
): Promise<ExtConfig> {
	const customModels = normalizeCustomModels(rawCustomModels)
	const normalizedSelectedModelId = normalizeSelectedModelId(selectedModelId, customModels)
	const llmConfig =
		rawCustomModels || selectedModelId
			? resolveSelectedLLMConfig(normalizedSelectedModelId, customModels)
			: legacyLLMConfig

	await storage.set({ llmConfig })
	await storage.set({ selectedModelId: normalizedSelectedModelId })
	await storage.set({ customModels })
	if (chaoxingTextModelId) {
		await storage.set({ chaoxingTextModelId })
	} else {
		await storage.remove('chaoxingTextModelId')
	}
	if (chaoxingVisionModelId) {
		await storage.set({ chaoxingVisionModelId })
	} else {
		await storage.remove('chaoxingVisionModelId')
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
		maxSteps,
		systemInstruction,
		experimentalLlmsTxt,
		experimentalIncludeAllTabs,
		disableNamedToolChoice,
	}
	await storage.set({ advancedConfig })

	return {
		...llmConfig,
		...advancedConfig,
		language,
		uiLanguage,
		selectedModelId: normalizedSelectedModelId,
		customModels,
		chaoxingTextModelId: chaoxingTextModelId || undefined,
		chaoxingVisionModelId: chaoxingVisionModelId || undefined,
	}
}
