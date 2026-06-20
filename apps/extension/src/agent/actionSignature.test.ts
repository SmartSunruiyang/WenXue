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

	it('keeps equal previews distinct when full input suffixes differ', () => {
		const prefix = 'a'.repeat(300)
		const first = createActionSignature({
			url: 'https://example.com',
			action: {
				name: 'input_text',
				input: { text: `${prefix}first` },
				output: 'ok',
			},
		})!
		const second = createActionSignature({
			url: 'https://example.com',
			action: {
				name: 'input_text',
				input: { text: `${prefix}second` },
				output: 'ok',
			},
		})!
		const guard = new StuckActionGuard(2)

		expect(first.input).toBe(second.input)
		expect(guard.record(first)).toBe(false)
		expect(guard.record(second)).toBe(false)
	})

	it('uses typed deterministic identities for special values', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		const equivalentCycle: Record<string, unknown> = {}
		equivalentCycle.self = equivalentCycle

		const cases: Array<{
			label: string
			special: unknown
			equivalent: unknown
			ordinaryCollision: unknown
		}> = [
			{
				label: 'undefined',
				special: { value: undefined },
				equivalent: { value: undefined },
				ordinaryCollision: { value: '[undefined]' },
			},
			{
				label: 'bigint',
				special: { value: 42n },
				equivalent: { value: 42n },
				ordinaryCollision: { value: '[bigint:42]' },
			},
			{
				label: 'NaN',
				special: { value: Number.NaN },
				equivalent: { value: Number.NaN },
				ordinaryCollision: { value: null },
			},
			{
				label: 'Infinity',
				special: { value: Number.POSITIVE_INFINITY },
				equivalent: { value: Number.POSITIVE_INFINITY },
				ordinaryCollision: { value: null },
			},
			{
				label: 'Date',
				special: new Date('2026-06-19T00:00:00.000Z'),
				equivalent: new Date('2026-06-19T00:00:00.000Z'),
				ordinaryCollision: {},
			},
			{
				label: 'Map',
				special: new Map([['answer', 42]]),
				equivalent: new Map([['answer', 42]]),
				ordinaryCollision: {},
			},
			{
				label: 'Set',
				special: new Set(['answer']),
				equivalent: new Set(['answer']),
				ordinaryCollision: {},
			},
			{
				label: 'cycle',
				special: cyclic,
				equivalent: equivalentCycle,
				ordinaryCollision: { self: '[circular]' },
			},
		]

		for (const { label, special, equivalent, ordinaryCollision } of cases) {
			const create = (input: unknown) =>
				createActionSignature({
					url: 'https://example.com',
					action: { name: 'custom_action', input, output: 'ok' },
				})!
			const stabilityGuard = new StuckActionGuard(2)
			const collisionGuard = new StuckActionGuard(2)

			expect(stabilityGuard.record(create(special)), label).toBe(false)
			expect(stabilityGuard.record(create(equivalent)), label).toBe(true)
			expect(collisionGuard.record(create(special)), label).toBe(false)
			expect(collisionGuard.record(create(ordinaryCollision)), label).toBe(false)
		}
	})

	it('does not collide special output values with ordinary strings', () => {
		const special = createActionSignature({
			url: 'https://example.com',
			action: {
				name: 'custom_action',
				input: {},
				output: undefined as unknown as string,
			},
		})!
		const ordinary = createActionSignature({
			url: 'https://example.com',
			action: {
				name: 'custom_action',
				input: {},
				output: '[undefined]',
			},
		})!
		const guard = new StuckActionGuard(2)

		expect(special.output).toBe(ordinary.output)
		expect(guard.record(special)).toBe(false)
		expect(guard.record(ordinary)).toBe(false)
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

	it('resets when full output changes beyond the shared preview', () => {
		const prefix = 'a'.repeat(300)
		const first = createActionSignature({
			url: signature.url,
			action: {
				name: signature.name,
				input: { index: 1 },
				output: `${prefix}first`,
			},
		})!
		const changed = createActionSignature({
			url: signature.url,
			action: {
				name: signature.name,
				input: { index: 1 },
				output: `${prefix}second`,
			},
		})!
		const guard = new StuckActionGuard(3)

		expect(first.output).toBe(changed.output)
		expect(guard.record(first)).toBe(false)
		expect(guard.record(first)).toBe(false)
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
