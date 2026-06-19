import type { LLMConfig } from '@page-agent/llms'

import { DEMO_CONFIG, DEMO_MODEL, DEMO_VISION_CONFIG, DEMO_VISION_MODEL } from '@/agent/constants'

export const BUILT_IN_MODEL_ID = 'builtin:qwen3.7-max'
export const BUILT_IN_MODEL_LABEL = `问学默认 · ${DEMO_MODEL}`

export const BUILT_IN_VISION_MODEL_ID = 'builtin:qwen3.7-plus'
export const BUILT_IN_VISION_MODEL_LABEL = `问学默认 · ${DEMO_VISION_MODEL}`

/** 两个内置模型(文本 + 视觉)的解析表，供共享解析器与 UI 选项列表复用。 */
const BUILT_IN_CONFIGS: Record<string, LLMConfig> = {
	[BUILT_IN_MODEL_ID]: DEMO_CONFIG,
	[BUILT_IN_VISION_MODEL_ID]: DEMO_VISION_CONFIG,
}

/**
 * 内置模型的 (id, 标签) 列表，供设置页拼接成下拉选项(连同自定义模型)。
 * 文本与视觉两个下拉共享同一份完整模型列表。
 */
export const BUILT_IN_MODEL_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
	{ id: BUILT_IN_MODEL_ID, label: BUILT_IN_MODEL_LABEL },
	{ id: BUILT_IN_VISION_MODEL_ID, label: BUILT_IN_VISION_MODEL_LABEL },
]

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

/**
 * 共享归一化：内置模型(文本/视觉)与仍存在的自定义模型原样保留；其余(未设置、
 * 已删除、未知)归一化到给定的 `fallbackId`(由各角色提供各自的默认内置模型)。
 */
function normalizeModelId(
	modelId: string | undefined,
	customModels: CustomModelConfig[],
	fallbackId: string,
): string {
	if (modelId && modelId in BUILT_IN_CONFIGS) return modelId
	if (modelId && customModels.some((model) => model.id === modelId)) return modelId
	return fallbackId
}

/**
 * 共享解析：把归一化后的模型 id 解析成 {@link LLMConfig}。两个内置模型都可解析，
 * 故文本/视觉两个角色可以互相选用对方的内置模型。
 */
function resolveModelConfig(
	modelId: string | undefined,
	customModels: CustomModelConfig[],
	fallbackId: string,
): LLMConfig {
	const normalized = normalizeModelId(modelId, customModels, fallbackId)
	const builtIn = BUILT_IN_CONFIGS[normalized]
	if (builtIn) return { ...builtIn }

	const customModel = customModels.find((model) => model.id === normalized)
	if (!customModel) return { ...BUILT_IN_CONFIGS[fallbackId] }

	return {
		baseURL: customModel.baseURL,
		model: customModel.model,
		apiKey: customModel.apiKey,
	}
}

export function normalizeSelectedModelId(
	selectedModelId: string | undefined,
	customModels: CustomModelConfig[],
): string {
	return normalizeModelId(selectedModelId, customModels, BUILT_IN_MODEL_ID)
}

export function resolveSelectedLLMConfig(
	selectedModelId: string | undefined,
	customModels: CustomModelConfig[],
): LLMConfig {
	return resolveModelConfig(selectedModelId, customModels, BUILT_IN_MODEL_ID)
}

/**
 * 归一化系统级「视觉/多模态」模型 id。与文本模型不同，默认回退到
 * {@link BUILT_IN_VISION_MODEL_ID}(qwen3.7-plus)，而非文本内置模型。
 */
export function normalizeVisionModelId(
	visionModelId: string | undefined,
	customModels: CustomModelConfig[],
): string {
	return normalizeModelId(visionModelId, customModels, BUILT_IN_VISION_MODEL_ID)
}

/**
 * 解析系统级「视觉/多模态」模型设置为 {@link LLMConfig}。未设置或未知 id 默认
 * 到视觉内置模型(qwen3.7-plus)；亦可解析文本内置模型与自定义模型。
 */
export function resolveVisionLLMConfig(
	visionModelId: string | undefined,
	customModels: CustomModelConfig[],
): LLMConfig {
	return resolveModelConfig(visionModelId, customModels, BUILT_IN_VISION_MODEL_ID)
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
