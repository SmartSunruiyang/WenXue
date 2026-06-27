// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { serializeResult } from './serializeResult'

describe('serializeResult', () => {
	it('passes strings through and stringifies primitives', () => {
		expect(serializeResult('hi')).toBe('hi')
		expect(serializeResult(42)).toBe('42')
		expect(serializeResult(true)).toBe('true')
		expect(serializeResult(undefined)).toBe('undefined')
		expect(serializeResult(null)).toBe('null')
	})

	it('JSON-stringifies objects and arrays (no [object Object])', () => {
		expect(serializeResult({ a: 1 })).toContain('"a": 1')
		expect(serializeResult([{ name: 'x' }])).toContain('"name": "x"')
	})

	it('handles circular references without throwing', () => {
		const o: any = { a: 1 }
		o.self = o
		expect(serializeResult(o)).toContain('[Circular]')
	})

	it('renders functions and DOM nodes as summaries', () => {
		expect(serializeResult({ fn: () => 1 })).toContain('[Function]')
		const el = document.createElement('div')
		el.id = 'main'
		el.className = 'a b'
		expect(serializeResult({ el })).toContain('<div#main.a.b>')
	})

	it('formats Error as name: message', () => {
		expect(serializeResult(new TypeError('boom'))).toBe('TypeError: boom')
	})

	it('truncates beyond 8KB and annotates length', () => {
		const out = serializeResult('x'.repeat(9000))
		expect(out).toMatch(/…\(truncated, 9000 chars\)$/)
		expect(out.length).toBeLessThanOrEqual(8192)
	})
})
