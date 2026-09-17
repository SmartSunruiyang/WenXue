import { describe, expect, it } from 'vitest'
import { REDACTED, redact } from './logRedaction'

describe('redact', () => {
	it('redacts secret fields and bearer strings', () => {
		const output = redact({
			apiKey: 'sk-api-key',
			api_key: 'sk-api-underscore',
			'api-key': 'sk-api-hyphen',
			headers: { Authorization: 'Bearer sk-authorization' },
			nested: {
				token: 'plain-token',
				secret: 'plain-secret',
				bearer: 'plain-bearer',
				message: 'Bearer sk-inline',
			},
		}) as Record<string, any>

		expect(output.apiKey).toBe(REDACTED)
		expect(output.api_key).toBe(REDACTED)
		expect(output['api-key']).toBe(REDACTED)
		expect(output.headers.Authorization).toBe(REDACTED)
		expect(output.nested.token).toBe(REDACTED)
		expect(output.nested.secret).toBe(REDACTED)
		expect(output.nested.bearer).toBe(REDACTED)
		expect(output.nested.message).toBe(REDACTED)
		expect(JSON.stringify(output)).not.toContain('sk-')
	})

	it('redacts bearer credentials anywhere inside a string', () => {
		const output = redact({
			message: 'request failed: Bearer secret-token; retry disabled',
		}) as Record<string, string>

		expect(output.message).toBe('request failed: *** retry disabled')
		expect(output.message).not.toContain('secret-token')
	})

	it('redacts common secret key and authorization header variants', () => {
		const output = redact({
			'x-api-key': 'hyphen-key',
			x_api_key: 'underscore-key',
			' X Authorization ': 'authorization-value',
			'access-token': 'access-token-value',
			client_secret: 'client-secret-value',
			bearer_token: 'bearer-token-value',
			monkey: 'business-value',
			secretary: 'business-value',
			tokenCount: 42,
		}) as Record<string, unknown>

		expect(output['x-api-key']).toBe(REDACTED)
		expect(output.x_api_key).toBe(REDACTED)
		expect(output[' X Authorization ']).toBe(REDACTED)
		expect(output['access-token']).toBe(REDACTED)
		expect(output.client_secret).toBe(REDACTED)
		expect(output.bearer_token).toBe(REDACTED)
		expect(output.monkey).toBe('business-value')
		expect(output.secretary).toBe('business-value')
		expect(output.tokenCount).toBe(42)
	})

	it('truncates data URIs and long strings with their original lengths', () => {
		const dataUri = `data:image/png;base64,${'A'.repeat(5000)}`
		const longText = 'x'.repeat(2500)
		const output = redact({ dataUri, longText }) as Record<string, string>

		expect(output.dataUri).toBe(`data:image/png;base64,…[${dataUri.length}字符]`)
		expect(output.dataUri.length).toBeLessThan(80)
		expect(output.longText).toBe(`${'x'.repeat(2000)}…[2500字符]`)
	})

	it('bounds data URI headers, nesting, nodes, and total serialized output', () => {
		const hugeHeaderDataUri = `data:${'x'.repeat(100_000)},payload`
		const wide: Record<string, unknown> = {}
		for (let index = 0; index < 20_000; index += 1) {
			wide[`field-${index}-${'k'.repeat(100)}`] = 'v'.repeat(2000)
		}

		let deep: Record<string, unknown> = { authorization: 'Bearer deepest-secret' }
		for (let index = 0; index < 10_000; index += 1) {
			deep = { child: deep }
		}

		const output = redact({ hugeHeaderDataUri, wide, deep })
		const serialized = JSON.stringify(output)

		expect(serialized).not.toContain('deepest-secret')
		expect(serialized).toContain('[Truncated')
		expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(64 * 1024)
	})

	it('deeply copies arrays without mutating the input', () => {
		const input = {
			messages: [{ content: 'visible', token: 'private' }],
		}

		const output = redact(input) as Record<string, any>

		expect(output).not.toBe(input)
		expect(output.messages).not.toBe(input.messages)
		expect(output.messages[0]).not.toBe(input.messages[0])
		expect(output.messages[0]).toEqual({ content: 'visible', token: REDACTED })
		expect(input).toEqual({
			messages: [{ content: 'visible', token: 'private' }],
		})
	})

	it('handles circular and non-plain values without throwing or leaking secrets', () => {
		const input: Record<string, unknown> = {
			createdAt: new Date('2026-06-21T00:00:00.000Z'),
			payload: new Blob(['private blob'], { type: 'text/plain' }),
			authorization: 'Bearer circular-secret',
		}
		input.self = input

		let output: unknown
		expect(() => {
			output = redact(input)
		}).not.toThrow()

		const serialized = JSON.stringify(output)
		expect(serialized).not.toContain('circular-secret')
		expect(serialized).not.toContain('private blob')
		expect(serialized).toContain(REDACTED)
		expect(serialized).toContain('[Circular]')
	})

	it('summarizes errors and special objects with bounded diagnostic details', () => {
		const cause = new Error('request failed: Bearer cause-secret')
		const error = new TypeError('top-level failure')
		error.stack = `TypeError: top-level failure\n${'frame\n'.repeat(1000)}Bearer stack-secret`
		error.cause = cause

		const output = redact({
			error,
			url: new URL('https://example.com/path?query=value'),
			regexp: /secret-pattern/giu,
			bytes: new Uint8Array(100_000),
		}) as Record<string, any>

		expect(output.error.name).toBe('TypeError')
		expect(output.error.message).toBe('top-level failure')
		expect(output.error.stack).toMatch(/…\[\d+字符\]$/)
		expect(output.error.stack).not.toContain('stack-secret')
		expect(output.error.cause.message).toBe('request failed: ***')
		expect(output.url).toBe('https://example.com/path?query=value')
		expect(output.regexp).toBe('/secret-pattern/giu')
		expect(output.bytes).toBe('[Uint8Array length=100000 byteLength=100000]')
		expect(JSON.stringify(output).length).toBeLessThan(10_000)
	})

	it('redacts URL credentials and sensitive query parameters without mutating the URL', () => {
		const input = new URL(
			'https://user:password@example.com/path?api_key=key-secret&apiKey=camel-secret' +
				'&access_token=access-secret&authorization=Bearer%20query-secret' +
				'&secret=plain-secret&query=visible',
		)
		const original = input.toString()

		const output = redact(input) as string

		expect(output).not.toContain('user')
		expect(output).not.toContain('password')
		expect(output).not.toContain('key-secret')
		expect(output).not.toContain('camel-secret')
		expect(output).not.toContain('access-secret')
		expect(output).not.toContain('query-secret')
		expect(output).not.toContain('plain-secret')
		expect(output).toContain('api_key=***')
		expect(output).toContain('query=visible')
		expect(input.toString()).toBe(original)
	})

	it('redacts credentials inside string URLs and query assignments', () => {
		const output = redact(
			'failed https://user:password@example.com/v1?api_key=query-secret token=plain-secret',
		) as string

		expect(output).not.toContain('user:password')
		expect(output).not.toContain('query-secret')
		expect(output).not.toContain('plain-secret')
		expect(output).toContain(REDACTED)
	})
})
