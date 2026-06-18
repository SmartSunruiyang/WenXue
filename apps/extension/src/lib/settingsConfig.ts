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
	chaoxingTextModelId?: string
	chaoxingVisionModelId?: string
	language?: LanguagePreference
	uiLanguage: UILanguage
	maxSteps?: number
	systemInstruction: string
	experimentalLlmsTxt: boolean
	experimentalIncludeAllTabs: boolean
	disableNamedToolChoice: boolean
}

/**
 * 归一化「超星双模型」角色 id：未设置或指向已删除的模型 → undefined(即跟随当前模型)；
 * 内置或仍存在的自定义模型 → 原样保留。不同于 {@link normalizeSelectedModelId}
 * (未知 id 会被它强制归到内置),这里保留 undefined 以表达「跟随」语义。
 */
function normalizeChaoxingRoleModelId(
	modelId: string | undefined,
	customModels: CustomModelConfig[],
): string | undefined {
	if (!modelId) return undefined
	if (modelId === BUILT_IN_MODEL_ID) return BUILT_IN_MODEL_ID
	return customModels.some((model) => model.id === modelId) ? modelId : undefined
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
		chaoxingTextModelId: normalizeChaoxingRoleModelId(
			values.chaoxingTextModelId,
			values.customModels,
		),
		chaoxingVisionModelId: normalizeChaoxingRoleModelId(
			values.chaoxingVisionModelId,
			values.customModels,
		),
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
		chaoxingTextModelId: config.chaoxingTextModelId,
		chaoxingVisionModelId: config.chaoxingVisionModelId,
		language: config.language,
		uiLanguage: config.uiLanguage,
		maxSteps: config.maxSteps,
		systemInstruction: config.systemInstruction,
		experimentalLlmsTxt: config.experimentalLlmsTxt,
		experimentalIncludeAllTabs: config.experimentalIncludeAllTabs,
		disableNamedToolChoice: config.disableNamedToolChoice,
	})
}
