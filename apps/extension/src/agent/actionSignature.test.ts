import { describe, expect, it } from 'vitest'

import { StuckActionGuard, createActionSignature } from './actionSignature'

describe('createActionSignature', () => {
	it('normalizes URL hashes and recursively sorts object keys', () => {
		expect(
			createActionSignature({
				url: 'https://example.com/path#section',
				action: {
					name: 'click_element_by_index',
					input: { z: [{ b: 2, a: 1 }], b: { d: 4, c: 3 }, a: 0 },
					output: 'ok',
				},
			}),
		).toEqual({
			url: 'https://example.com/path',
			name: 'click_element_by_index',
			input: '{"a":0,"b":{"c":3,"d":4},"z":[{"a":1,"b":2}]}',
			output: 'ok',
		})
	})

	it.each(['done', 'ask_user', 'request_user_takeover'])('ignores %s actions', (name) => {
		expect(
			createActionSignature({
				url: 'https://example.com',
				action: { name, input: {}, output: 'ignored' },
			}),
		).toBeNull()
	})

	it('truncates input and output to their limits', () => {
		const signature = createActionSignature({
			url: 'https://example.com',
			action: {
				name: 'input_text',
				input: { text: 'a'.repeat(300) },
				output: 'b'.repeat(300),
			},
		})

		expect(signature?.input).toHaveLength(160)
		expect(signature?.input.endsWith('…')).toBe(true)
		expect(signature?.output).toHaveLength(240)
		expect(signature?.output.endsWith('…')).toBe(true)
	})

	it('handles undefined and unsupported values deterministically', () => {
		const input = {
			undefinedValue: undefined,
			bigintValue: 42n,
			functionValue: function sample() {},
			symbolValue: Symbol('sample'),
		}

		const first = createActionSignature({
			url: 'https://example.com',
			action: { name: 'custom_action', input, output: undefined as unknown as string },
		})
		const second = createActionSignature({
			url: 'https://example.com',
			action: { name: 'custom_action', input, output: undefined as unknown as string },
		})

		expect(first).toEqual(second)
		expect(first?.input).toContain('[undefined]')
		expect(first?.input).toContain('[bigint:42]')
		expect(first?.input).toContain('[function:sample]')
		expect(first?.input).toContain('[symbol:sample]')
		expect(first?.output).toBe('[undefined]')
	})

	it('handles cyclic inputs deterministically', () => {
		const input: Record<string, unknown> = { z: 1 }
		input.self = input

		const create = () =>
			createActionSignature({
				url: 'https://example.com',
				action: { name: 'custom_action', input, output: 'ok' },
			})

		expect(create()).toEqual(create())
		expect(create()?.input).toBe('{"self":"[circular]","z":1}')
	})
})

describe('StuckActionGuard', () => {
	const signature = {
		url: 'https://example.com',
		name: 'click_element_by_index',
		input: '{"index":1}',
		output: 'Clicked',
	}

	it('triggers on the third consecutive identical signature', () => {
		const guard = new StuckActionGuard(3)

		expect(guard.record(signature)).toBe(false)
		expect(guard.record(signature)).toBe(false)
		expect(guard.record(signature)).toBe(true)
	})

	it('resets when the signature changes', () => {
		const guard = new StuckActionGuard(3)
		const changed = { ...signature, input: '{"index":2}' }

		expect(guard.record(signature)).toBe(false)
		expect(guard.record(signature)).toBe(false)
		expect(guard.record(changed)).toBe(false)
		expect(guard.record(changed)).toBe(false)
		expect(guard.record(changed)).toBe(true)
	})

	it('resets when the signature is null', () => {
		const guard = new StuckActionGuard(3)

		expect(guard.record(signature)).toBe(false)
		expect(guard.record(signature)).toBe(false)
		expect(guard.record(null)).toBe(false)
		expect(guard.record(signature)).toBe(false)
	})
})
