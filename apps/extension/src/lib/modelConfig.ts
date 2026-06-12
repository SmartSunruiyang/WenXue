import type { LLMConfig } from '@page-agent/llms'

import { DEMO_CONFIG, DEMO_MODEL } from '@/agent/constants'

export const BUILT_IN_MODEL_ID = 'builtin:qwen3.7-max'
export const BUILT_IN_MODEL_LABEL = `问学默认 · ${DEMO_MODEL}`

export type BuiltInModelProvider = 'deepseek' | 'qwen'
export type ModelProvider = BuiltInModelProvider | 'custom'

export interface ModelProviderPreset {
	id: BuiltInModelProvider
	label: string
	baseURL: string
}

export interface CustomModelConfig {
	id: string
	provider: ModelProvider
	providerName?: string
	baseURL: string
	apiKey?: string
	model: string
}

export const MODEL_PROVIDER_PRESETS = [
	{
		id: 'deepseek',
		label: 'DeepSeek',
		baseURL: 'https://api.deepseek.com',
	},
	{
		id: 'qwen',
		label: '千问',
		baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	},
] as const satisfies readonly ModelProviderPreset[]

export function getModelProviderPreset(provider: ModelProvider): ModelProviderPreset | undefined {
	return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === provider)
}

export function getCustomModelProviderLabel(model: CustomModelConfig): string {
	if (model.provider === 'custom') {
		return model.providerName?.trim() || '自定义厂商'
	}
	return getModelProviderPreset(model.provider)?.label ?? '自定义厂商'
}

export function getCustomModelLabel(model: CustomModelConfig): string {
	return `${getCustomModelProviderLabel(model)} · ${model.model}`
}

export function normalizeSelectedModelId(
	selectedModelId: string | undefined,
	customModels: CustomModelConfig[],
): string {
	if (selectedModelId === BUILT_IN_MODEL_ID) return BUILT_IN_MODEL_ID
	if (selectedModelId && customModels.some((model) => model.id === selectedModelId)) {
		return selectedModelId
	}
	return BUILT_IN_MODEL_ID
}

export function resolveSelectedLLMConfig(
	selectedModelId: string | undefined,
	customModels: CustomModelConfig[],
): LLMConfig {
	const normalizedSelectedModelId = normalizeSelectedModelId(selectedModelId, customModels)
	if (normalizedSelectedModelId === BUILT_IN_MODEL_ID) return { ...DEMO_CONFIG }

	const customModel = customModels.find((model) => model.id === normalizedSelectedModelId)
	if (!customModel) return { ...DEMO_CONFIG }

	return {
		baseURL: customModel.baseURL,
		model: customModel.model,
		apiKey: customModel.apiKey,
	}
}

export function normalizeCustomModels(value: unknown): CustomModelConfig[] {
	if (!Array.isArray(value)) return []

	return value.flatMap((item) => {
		if (!item || typeof item !== 'object') return []
		const candidate = item as Partial<CustomModelConfig>
		if (
			typeof candidate.id !== 'string' ||
			typeof candidate.baseURL !== 'string' ||
			typeof candidate.model !== 'string'
		) {
			return []
		}

		const provider =
			candidate.provider === 'deepseek' ||
			candidate.provider === 'qwen' ||
			candidate.provider === 'custom'
				? candidate.provider
				: 'deepseek'

		return [
			{
				id: candidate.id,
				provider,
				providerName:
					typeof candidate.providerName === 'string' ? candidate.providerName : undefined,
				baseURL: candidate.baseURL,
				apiKey: typeof candidate.apiKey === 'string' ? candidate.apiKey : undefined,
				model: candidate.model,
			},
		]
	})
}
