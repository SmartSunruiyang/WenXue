import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import type { UILanguage } from '@/lib/i18n'
import {
	BUILT_IN_MODEL_ID,
	type CustomModelConfig,
	normalizeSelectedModelId,
	resolveSelectedLLMConfig,
} from '@/lib/modelConfig'

export interface SettingsFormValues {
	selectedModelId?: string
	customModels: CustomModelConfig[]
	language?: LanguagePreference
	uiLanguage: UILanguage
	maxSteps?: number
	systemInstruction: string
	experimentalLlmsTxt: boolean
	experimentalIncludeAllTabs: boolean
	disableNamedToolChoice: boolean
}

export function buildSettingsConfig(values: SettingsFormValues): ExtConfig {
	const selectedModelId = normalizeSelectedModelId(
		values.selectedModelId ?? BUILT_IN_MODEL_ID,
		values.customModels,
	)
	const llmConfig = resolveSelectedLLMConfig(selectedModelId, values.customModels)

	return {
		...llmConfig,
		selectedModelId,
		customModels: values.customModels,
		language: values.language,
		uiLanguage: values.uiLanguage,
		maxSteps: values.maxSteps || undefined,
		systemInstruction: values.systemInstruction || undefined,
		experimentalLlmsTxt: values.experimentalLlmsTxt,
		experimentalIncludeAllTabs: values.experimentalIncludeAllTabs,
		disableNamedToolChoice: values.disableNamedToolChoice,
	}
}

export function settingsConfigKey(config: ExtConfig): string {
	return JSON.stringify({
		apiKey: config.apiKey,
		baseURL: config.baseURL,
		model: config.model,
		selectedModelId: config.selectedModelId,
		customModels: config.customModels ?? [],
		language: config.language,
		uiLanguage: config.uiLanguage,
		maxSteps: config.maxSteps,
		systemInstruction: config.systemInstruction,
		experimentalLlmsTxt: config.experimentalLlmsTxt,
		experimentalIncludeAllTabs: config.experimentalIncludeAllTabs,
		disableNamedToolChoice: config.disableNamedToolChoice,
	})
}
