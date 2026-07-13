import { describe, expect, it, vi } from 'vitest'

import {
	hasNamedToolChoice,
	isNamedToolChoiceCompatibilityError,
	rememberNamedToolChoiceUnsupported,
	shouldDisableNamedToolChoice,
} from './index'
import type { LLMConfig } from './types'

describe('hasNamedToolChoice', () => {
	it.each([
		{ tool_choice: { type: 'function', function: { name: 'submit' } } },
		{ tool_choice: { type: 'tool', name: 'submit' } },
	])('recognizes a named tool selection', (body) => {
		expect(hasNamedToolChoice(body)).toBe(true)
	})

	it.each([
		{ tool_choice: 'required' },
		{ tool_choice: { type: 'any' } },
		{ tool_choice: { type: 'function', function: {} } },
		{},
	])('does not treat a non-named selection as named', (body) => {
		expect(hasNamedToolChoice(body)).toBe(false)
	})
})

describe('isNamedToolChoiceCompatibilityError', () => {
	it.each([
		[400, { error: { message: "Invalid tool_choice type: 'object'" } }],
		[
			422,
			{
				error: {
					param: 'tool_choice',
					message: 'Input should be a valid string; received an object',
				},
			},
		],
		[400, { message: 'tool choice has an invalid format; expected a string' }],
		[422, { error: { message: 'Named tool_choice selections are not supported' } }],
		[
			200,
			{
				statusCode: 400,
				body: JSON.stringify({
					error: { param: 'tool_choice', message: 'Object format is unsupported' },
				}),
			},
		],
		[
			400,
			{
				statusCode: 400,
				body: { error: { message: "Invalid tool_choice type: 'object'" } },
			},
		],
	])('accepts an explicit named tool-choice compatibility error', (status, data) => {
		expect(isNamedToolChoiceCompatibilityError(status, data)).toBe(true)
	})

	it.each([
		[200, { error: { message: "Invalid tool_choice type: 'object'" } }],
		[401, { error: { message: "Invalid tool_choice type: 'object'" } }],
		[403, { error: { message: "Invalid tool_choice type: 'object'" } }],
		[429, { error: { message: "Invalid tool_choice type: 'object'" } }],
		[500, { error: { message: "Invalid tool_choice type: 'object'" } }],
		[400, { error: { message: 'Invalid value for tool_choice' } }],
		[
			400,
			{
				error: {
					param: 'tool_choice',
					message:
						"When thinking is enabled, tool_choice must be 'required'; object is unsupported",
				},
			},
		],
		[
			422,
			{
				error: {
					param: 'tool_choice',
					message: "Unknown tool name 'missing' in the named tool selection",
				},
			},
		],
	])('rejects unrelated or unsafe-to-learn errors', (status, data) => {
		expect(isNamedToolChoiceCompatibilityError(status, data)).toBe(false)
	})
})

describe('rememberNamedToolChoiceUnsupported', () => {
	it('updates the in-memory config and invokes the persistence callback', async () => {
		const callback = vi.fn()
		const config: LLMConfig = {
			baseURL: 'https://example.test/v1',
			model: 'model',
			onNamedToolChoiceUnsupported: callback,
		}

		await rememberNamedToolChoiceUnsupported(config)

		expect(config.disableNamedToolChoice).toBe(true)
		expect(callback).toHaveBeenCalledOnce()
	})

	it('keeps the in-memory fallback when the persistence callback rejects', async () => {
		const config: LLMConfig = {
			baseURL: 'https://example.test/v1',
			model: 'model',
			onNamedToolChoiceUnsupported: vi.fn().mockRejectedValue(new Error('storage failed')),
		}

		await expect(rememberNamedToolChoiceUnsupported(config)).resolves.toBeUndefined()
		expect(config.disableNamedToolChoice).toBe(true)
	})
})

describe('shouldDisableNamedToolChoice', () => {
	it('reads copied configs through a shared runtime getter', () => {
		let disabled = false
		const config: LLMConfig = {
			baseURL: 'https://example.test/v1',
			model: 'model',
			getNamedToolChoiceDisabled: () => disabled,
		}
		const copiedConfig = { ...config }

		disabled = true

		expect(shouldDisableNamedToolChoice(copiedConfig)).toBe(true)
	})
})
