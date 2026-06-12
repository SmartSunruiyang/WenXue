import type { LLMConfig } from '@page-agent/llms'

// Default LLM — Alibaba Cloud Bailian (DashScope)
export const DEMO_MODEL = 'qwen3.7-max'
export const DEMO_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const DEMO_API_KEY = 'sk-a9ac41248a5a4d21b070faf475d0007f'

export const DEMO_CONFIG: LLMConfig = {
	baseURL: DEMO_BASE_URL,
	model: DEMO_MODEL,
	apiKey: DEMO_API_KEY,
}

/** Legacy testing endpoints that should be auto-migrated to DEMO_BASE_URL */
export const LEGACY_TESTING_ENDPOINTS = [
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
