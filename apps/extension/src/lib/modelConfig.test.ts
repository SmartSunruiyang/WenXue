import { describe, expect, it } from 'vitest'

import { DEMO_CONFIG } from '@/agent/constants'
import {
	BUILT_IN_MODEL_ID,
	type CustomModelConfig,
	resolveChaoxingModelConfigs,
	resolveSelectedLLMConfig,
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

describe('resolveChaoxingModelConfigs', () => {
	it('defaults both roles to the selected model when role ids are unset', () => {
		const result = resolveChaoxingModelConfigs({ selectedModelId: 'model-deepseek' }, customModels)

		const expected = resolveSelectedLLMConfig('model-deepseek', customModels)
		expect(result.text).toEqual(expected)
		expect(result.vision).toEqual(expected)
	})

	it('falls back to the built-in model when nothing is selected', () => {
		const result = resolveChaoxingModelConfigs({}, [])

		expect(result.text).toEqual({ ...DEMO_CONFIG })
		expect(result.vision).toEqual({ ...DEMO_CONFIG })
	})

	it('resolves each role to its own configured model when ids are set', () => {
		const result = resolveChaoxingModelConfigs(
			{
				chaoxingTextModelId: 'model-deepseek',
				chaoxingVisionModelId: 'model-qwen-vl',
				selectedModelId: BUILT_IN_MODEL_ID,
			},
			customModels,
		)

		expect(result.text).toEqual(resolveSelectedLLMConfig('model-deepseek', customModels))
		expect(result.vision).toEqual(resolveSelectedLLMConfig('model-qwen-vl', customModels))
	})

	it('lets each role independently fall back to the selected model', () => {
		const result = resolveChaoxingModelConfigs(
			{
				chaoxingVisionModelId: 'model-qwen-vl',
				selectedModelId: 'model-deepseek',
			},
			customModels,
		)

		// text role unset → follows selected model
		expect(result.text).toEqual(resolveSelectedLLMConfig('model-deepseek', customModels))
		// vision role set → its own model
		expect(result.vision).toEqual(resolveSelectedLLMConfig('model-qwen-vl', customModels))
	})

	it('normalizes unknown role ids back to the built-in model', () => {
		const result = resolveChaoxingModelConfigs(
			{
				chaoxingTextModelId: 'model-does-not-exist',
				chaoxingVisionModelId: 'another-missing-id',
				selectedModelId: 'model-deepseek',
			},
			customModels,
		)

		expect(result.text).toEqual({ ...DEMO_CONFIG })
		expect(result.vision).toEqual({ ...DEMO_CONFIG })
	})
})
