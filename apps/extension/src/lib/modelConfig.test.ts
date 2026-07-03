import { describe, expect, it } from 'vitest'

import { DEMO_CONFIG, DEMO_VISION_CONFIG } from '@/agent/constants'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_MODEL_LABEL,
	BUILT_IN_VISION_MODEL_ID,
	type CustomModelConfig,
	normalizeVisionModelId,
	resolveSelectedLLMConfig,
	resolveVisionLLMConfig,
} from './modelConfig'

const customModels: CustomModelConfig[] = [
	{
		id: 'model-deepseek',
		provider: 'deepseek',
		baseURL: 'https://api.deepseek.com',
		apiKey: 'sk-deepseek',
		model: 'deepseek-chat',
	},
	{
		id: 'model-qwen-vl',
		provider: 'qwen',
		baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		apiKey: 'sk-qwen',
		model: 'qwen-vl-max',
	},
]

describe('built-in text model', () => {
	it('uses qwen3.7-max as the default main model', () => {
		expect(BUILT_IN_MODEL_ID).toBe('builtin:qwen3.7-max')
		expect(BUILT_IN_MODEL_LABEL).toContain('qwen3.7-max')
		expect(resolveSelectedLLMConfig(undefined, customModels)).toMatchObject({
			model: 'qwen3.7-max',
		})
	})
})

describe('normalizeVisionModelId', () => {
	it('defaults to the built-in vision model when unset', () => {
		expect(normalizeVisionModelId(undefined, customModels)).toBe(BUILT_IN_VISION_MODEL_ID)
	})

	it('defaults to the built-in vision model for unknown ids', () => {
		expect(normalizeVisionModelId('model-does-not-exist', customModels)).toBe(
			BUILT_IN_VISION_MODEL_ID,
		)
	})

	it('keeps the built-in text model id when explicitly chosen', () => {
		expect(normalizeVisionModelId(BUILT_IN_MODEL_ID, customModels)).toBe(BUILT_IN_MODEL_ID)
	})

	it('keeps a matching custom model id', () => {
		expect(normalizeVisionModelId('model-qwen-vl', customModels)).toBe('model-qwen-vl')
	})
})

describe('resolveVisionLLMConfig', () => {
	it('defaults to the built-in vision config when unset', () => {
		expect(resolveVisionLLMConfig(undefined, customModels)).toEqual({ ...DEMO_VISION_CONFIG })
	})

	it('defaults to the built-in vision config for unknown ids', () => {
		expect(resolveVisionLLMConfig('nope', customModels)).toEqual({ ...DEMO_VISION_CONFIG })
	})

	it('resolves the built-in vision id to the vision demo config', () => {
		expect(resolveVisionLLMConfig(BUILT_IN_VISION_MODEL_ID, customModels)).toEqual({
			...DEMO_VISION_CONFIG,
		})
	})

	it('resolves the built-in text id to the text demo config', () => {
		expect(resolveVisionLLMConfig(BUILT_IN_MODEL_ID, customModels)).toEqual({ ...DEMO_CONFIG })
	})

	it('resolves a matching custom model id to that model', () => {
		expect(resolveVisionLLMConfig('model-qwen-vl', customModels)).toEqual({
			baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
			model: 'qwen-vl-max',
			apiKey: 'sk-qwen',
		})
	})
})

describe('resolveSelectedLLMConfig', () => {
	it('resolves the built-in vision id when chosen as the text model', () => {
		expect(resolveSelectedLLMConfig(BUILT_IN_VISION_MODEL_ID, customModels)).toEqual({
			...DEMO_VISION_CONFIG,
		})
	})

	it('defaults to the built-in text config when unset', () => {
		expect(resolveSelectedLLMConfig(undefined, customModels)).toEqual({ ...DEMO_CONFIG })
	})

	it('resolves a matching custom model id to that model', () => {
		expect(resolveSelectedLLMConfig('model-deepseek', customModels)).toEqual({
			baseURL: 'https://api.deepseek.com',
			model: 'deepseek-chat',
			apiKey: 'sk-deepseek',
		})
	})
})
