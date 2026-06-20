import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import type { UILanguage } from '@/lib/i18n'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_VISION_MODEL_ID,
	type CustomModelConfig,
	normalizeSelectedModelId,
	resolveSelectedLLMConfig,
} from '@/lib/modelConfig'

export interface SettingsFormValues {
	selectedModelId?: string
	customModels: CustomModelConfig[]
	visionModelId?: string
	language?: LanguagePreference
	uiLanguage: UILanguage
	systemInstruction: string
	experimentalLlmsTxt: boolean
	experimentalIncludeAllTabs: boolean
	disableNamedToolChoice: boolean
	logRetentionDays: number
	logMaxEntries: number
}

/**
 * 归一化系统级「视觉模型」id：未设置或指向已删除的模型 → undefined(解析时回退到
 * 视觉内置模型)；内置(文本或视觉)或仍存在的自定义模型 → 原样保留。不同于
 * {@link normalizeSelectedModelId}(未知 id 会被它强制归到内置),这里保留 undefined。
 */
function normalizeOptionalModelId(
	modelId: string | undefined,
	customModels: CustomModelConfig[],
): string | undefined {
	if (!modelId) return undefined
	if (modelId === BUILT_IN_MODEL_ID || modelId === BUILT_IN_VISION_MODEL_ID) return modelId
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
		visionModelId: normalizeOptionalModelId(values.visionModelId, values.customModels),
		language: values.language,
		uiLanguage: values.uiLanguage,
		systemInstruction: values.systemInstruction || undefined,
		experimentalLlmsTxt: values.experimentalLlmsTxt,
		experimentalIncludeAllTabs: values.experimentalIncludeAllTabs,
		disableNamedToolChoice: values.disableNamedToolChoice,
		logRetentionDays: values.logRetentionDays,
		logMaxEntries: values.logMaxEntries,
	}
}

export function settingsConfigKey(config: ExtConfig): string {
	return JSON.stringify({
		apiKey: config.apiKey,
		baseURL: config.baseURL,
		model: config.model,
		selectedModelId: config.selectedModelId,
		customModels: config.customModels ?? [],
		visionModelId: config.visionModelId,
		language: config.language,
		uiLanguage: config.uiLanguage,
		systemInstruction: config.systemInstruction,
		experimentalLlmsTxt: config.experimentalLlmsTxt,
		experimentalIncludeAllTabs: config.experimentalIncludeAllTabs,
		disableNamedToolChoice: config.disableNamedToolChoice,
		logRetentionDays: config.logRetentionDays,
		logMaxEntries: config.logMaxEntries,
	})
}
