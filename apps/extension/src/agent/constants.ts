import type { LLMConfig } from '@page-agent/llms'

export const WENXUE_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com'
export const WENXUE_GATEWAY_OPENAI_BASE_URL = `${WENXUE_GATEWAY_BASE_URL}/v1`

// Default built-in LLM — WenXue CloudBase LLM Gateway.
export const DEMO_MODEL = 'qwen3.7-max'
export const DEMO_BASE_URL = WENXUE_GATEWAY_OPENAI_BASE_URL
export const DEMO_API_KEY = ''

export const DEMO_CONFIG: LLMConfig = {
	baseURL: DEMO_BASE_URL,
	model: DEMO_MODEL,
	apiKey: DEMO_API_KEY,
}

// Default vision / multimodal model — same gateway endpoint + runtime auth token.
export const DEMO_VISION_MODEL = 'qwen3.7-plus'

export const DEMO_VISION_CONFIG: LLMConfig = {
	baseURL: DEMO_BASE_URL,
	model: DEMO_VISION_MODEL,
	apiKey: DEMO_API_KEY,
}

const LEGACY_DASHSCOPE_OPENAI_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

/** Legacy direct/testing endpoints that should be auto-migrated to DEMO_BASE_URL */
export const LEGACY_TESTING_ENDPOINTS = [
	LEGACY_DASHSCOPE_OPENAI_BASE_URL,
	'https://hwcxiuzfylggtcktqgij.supabase.co/functions/v1/llm-testing-proxy',
]

export function isTestingEndpoint(url: string): boolean {
	const normalized = url.replace(/\/+$/, '')
	return normalized === DEMO_BASE_URL || LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)
}

export function migrateLegacyEndpoint(config: LLMConfig): LLMConfig {
	const normalized = config.baseURL.replace(/\/+$/, '')
	if (LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)) {
		return { ...DEMO_CONFIG }
	}
	return config
}
