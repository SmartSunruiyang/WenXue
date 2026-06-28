import type { LLMConfig } from '@page-agent/llms'

import { DEMO_CONFIG, DEMO_VISION_CONFIG } from '@/agent/constants'
import type { ExtConfig } from '@/agent/useAgent'
import {
	type CloudAuthStorageArea,
	type ExtensionCloudAuthSession,
	loadExtensionCloudAuthSession,
} from '@/lib/cloudAuthSession'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_VISION_MODEL_ID,
	normalizeSelectedModelId,
	normalizeVisionModelId,
	resolveSelectedLLMConfig,
	resolveVisionLLMConfig,
	type CustomModelConfig,
} from '@/lib/modelConfig'

export interface RuntimeAgentModels {
	active: LLMConfig
	chaoxingModels: {
		text: LLMConfig
		vision: LLMConfig
	}
}

export interface RuntimeAgentModelOptions {
	session: ExtensionCloudAuthSession | null
	now?: () => number
}

type BuiltInModelId = typeof BUILT_IN_MODEL_ID | typeof BUILT_IN_VISION_MODEL_ID

export async function loadRuntimeAgentModels(
	config: ExtConfig,
	storage: CloudAuthStorageArea = chrome.storage.local,
): Promise<RuntimeAgentModels> {
	const session = await loadExtensionCloudAuthSession(storage)
	return buildRuntimeAgentModels(config, {
		session,
	})
}

export function buildRuntimeAgentModels(
	config: ExtConfig,
	options: RuntimeAgentModelOptions,
): RuntimeAgentModels {
	const customModels = config.customModels ?? []
	const selectedModelId = normalizeSelectedModelId(config.selectedModelId, customModels)
	const visionModelId = normalizeVisionModelId(config.visionModelId, customModels)
	const active = resolveRuntimeSelectedConfig(selectedModelId, customModels, options)
	const vision = resolveRuntimeVisionConfig(visionModelId, customModels, options)

	return {
		active,
		chaoxingModels: {
			text: active,
			vision,
		},
	}
}

function resolveRuntimeSelectedConfig(
	modelId: string,
	customModels: CustomModelConfig[],
	options: RuntimeAgentModelOptions,
): LLMConfig {
	if (isBuiltInModelId(modelId)) {
		return resolveRuntimeBuiltInConfig(modelId, options)
	}
	return resolveSelectedLLMConfig(modelId, customModels)
}

function resolveRuntimeVisionConfig(
	modelId: string,
	customModels: CustomModelConfig[],
	options: RuntimeAgentModelOptions,
): LLMConfig {
	if (isBuiltInModelId(modelId)) {
		return resolveRuntimeBuiltInConfig(modelId, options)
	}
	return resolveVisionLLMConfig(modelId, customModels)
}

function resolveRuntimeBuiltInConfig(
	modelId: BuiltInModelId,
	options: RuntimeAgentModelOptions,
): LLMConfig {
	const session = options.session
	const now = options.now?.() ?? Date.now()
	if (!session || session.expiresAt <= now) {
		throw new Error('请先在问学启动器登录注册用户，并把会话交接给插件后再使用内置模型。')
	}

	return {
		...gatewayConfigForBuiltIn(modelId),
		baseURL: toOpenAIBaseUrl(session.gatewayBaseUrl),
		apiKey: session.accessToken,
	}
}

function isBuiltInModelId(modelId: string): modelId is BuiltInModelId {
	return modelId === BUILT_IN_MODEL_ID || modelId === BUILT_IN_VISION_MODEL_ID
}

function gatewayConfigForBuiltIn(modelId: BuiltInModelId): LLMConfig {
	return modelId === BUILT_IN_VISION_MODEL_ID ? DEMO_VISION_CONFIG : DEMO_CONFIG
}

function toOpenAIBaseUrl(gatewayBaseUrl: string): string {
	const trimmed = gatewayBaseUrl.replace(/\/+$/, '')
	return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}
