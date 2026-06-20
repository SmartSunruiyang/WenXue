export const REDACTED = '***'

const CIRCULAR = '[Circular]'
const UNSERIALIZABLE = '[Unserializable]'
const MAX_DEPTH = 32
const MAX_NODES = 500
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_STRING_LENGTH = 2000
const MAX_DATA_URI_HEADER_LENGTH = 120
const MAX_KEY_LENGTH = 200
const STRING_BUDGET = 8000
const SENSITIVE_KEYS = new Set([
	'accesstoken',
	'apikey',
	'apisecret',
	'authorization',
	'authtoken',
	'bearer',
	'bearertoken',
	'clientsecret',
	'idtoken',
	'refreshtoken',
	'secret',
	'token',
	'xapikey',
	'xauthorization',
])

interface RedactionBudget {
	nodes: number
	stringChars: number
}

function lengthMarker(length: number): string {
	return `…[${length}字符]`
}

function replaceBearerCredentials(value: string): string {
	return value.replace(/\bBearer\s+\S+/gi, REDACTED)
}

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[-_\s]/g, ''))
}

function truncateString(value: string, maxLength: number, originalLength = value.length): string {
	if (value.length <= maxLength) {
		return value
	}
	return `${value.slice(0, maxLength)}${lengthMarker(originalLength)}`
}

function redactString(value: string, budget: RedactionBudget): string {
	const withoutBearer = replaceBearerCredentials(value)
	let output: string

	if (/^data:/i.test(withoutBearer)) {
		const commaIndex = withoutBearer.indexOf(',')
		const rawHeader = commaIndex >= 0 ? withoutBearer.slice(0, commaIndex + 1) : 'data:'
		const header = truncateString(rawHeader, MAX_DATA_URI_HEADER_LENGTH, rawHeader.length)
		output = `${header}${lengthMarker(value.length)}`
	} else {
		output = truncateString(withoutBearer, MAX_STRING_LENGTH, value.length)
	}

	const remaining = STRING_BUDGET - budget.stringChars
	if (remaining <= 0) {
		return '[Truncated: character budget]'
	}

	output = truncateString(output, remaining, output.length)
	budget.stringChars += output.length
	return output
}

function redactKey(key: string, budget: RedactionBudget): string {
	return redactString(truncateString(key, MAX_KEY_LENGTH), budget)
}

function truncated(reason: 'depth' | 'node'): string {
	return `[Truncated: ${reason} limit]`
}

function typedArraySummary(value: ArrayBufferView): string {
	const name = value.constructor.name || 'TypedArray'
	const length =
		'length' in value && typeof value.length === 'number' ? ` length=${value.length}` : ''
	return `[${name}${length} byteLength=${value.byteLength}]`
}

function redactUrl(value: URL, budget: RedactionBudget): string {
	const output = new URL(value.toString())
	output.username = ''
	output.password = ''

	for (const [key, queryValue] of output.searchParams) {
		output.searchParams.set(key, isSensitiveKey(key) ? REDACTED : redactString(queryValue, budget))
	}

	return redactString(output.toString(), budget)
}

function redactError(
	error: Error,
	ancestors: WeakSet<object>,
	budget: RedactionBudget,
	depth: number,
): Record<string, unknown> {
	const output: Record<string, unknown> = {
		name: redactString(error.name, budget),
		message: redactString(error.message, budget),
	}
	if (error.stack) {
		output.stack = redactString(error.stack, budget)
	}
	if ('cause' in error && error.cause !== undefined) {
		output.cause = redactValue(error.cause, ancestors, budget, depth + 1)
	}
	return output
}

function redactObject(
	value: object,
	ancestors: WeakSet<object>,
	budget: RedactionBudget,
	depth: number,
): unknown {
	if (ancestors.has(value)) {
		return CIRCULAR
	}
	if (depth >= MAX_DEPTH) {
		return truncated('depth')
	}

	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString()
	}
	if (value instanceof Error) {
		ancestors.add(value)
		try {
			return redactError(value, ancestors, budget, depth)
		} finally {
			ancestors.delete(value)
		}
	}
	if (typeof URL !== 'undefined' && value instanceof URL) {
		return redactUrl(value, budget)
	}
	if (value instanceof RegExp) {
		return redactString(value.toString(), budget)
	}
	if (typeof Blob !== 'undefined' && value instanceof Blob) {
		const type = redactString(value.type || 'unknown', budget)
		return `[Blob type=${type} size=${value.size}]`
	}
	if (ArrayBuffer.isView(value)) {
		return redactString(typedArraySummary(value), budget)
	}
	if (value instanceof ArrayBuffer) {
		return `[ArrayBuffer byteLength=${value.byteLength}]`
	}
	if (value instanceof Map) {
		return `[Map size=${value.size}]`
	}
	if (value instanceof Set) {
		return `[Set size=${value.size}]`
	}

	ancestors.add(value)
	try {
		if (Array.isArray(value)) {
			const output: unknown[] = []
			for (const item of value) {
				if (budget.nodes >= MAX_NODES || budget.stringChars >= STRING_BUDGET) {
					output.push('[Truncated: collection budget]')
					break
				}
				output.push(redactValue(item, ancestors, budget, depth + 1))
			}
			return output
		}

		const output: Record<string, unknown> = {}
		for (const key of Object.keys(value)) {
			if (budget.nodes >= MAX_NODES || budget.stringChars >= STRING_BUDGET) {
				output['[Truncated]'] = '[Truncated: collection budget]'
				break
			}

			const outputKey = redactKey(key, budget)
			const redactedValue = isSensitiveKey(key)
				? REDACTED
				: redactValue((value as Record<string, unknown>)[key], ancestors, budget, depth + 1)
			Object.defineProperty(output, outputKey, {
				configurable: true,
				enumerable: true,
				value: redactedValue,
				writable: true,
			})
		}
		return output
	} finally {
		ancestors.delete(value)
	}
}

function redactValue(
	value: unknown,
	ancestors: WeakSet<object>,
	budget: RedactionBudget,
	depth: number,
): unknown {
	try {
		if (budget.nodes >= MAX_NODES) {
			return truncated('node')
		}
		budget.nodes += 1

		if (typeof value === 'string') {
			return redactString(value, budget)
		}
		if (typeof value === 'bigint') {
			return redactString(`${value}n`, budget)
		}
		if (typeof value === 'symbol') {
			return redactString(String(value), budget)
		}
		if (typeof value === 'function') {
			return redactString(`[Function ${value.name || 'anonymous'}]`, budget)
		}
		if (!value || typeof value !== 'object') {
			return value
		}
		return redactObject(value, ancestors, budget, depth)
	} catch {
		return UNSERIALIZABLE
	}
}

export function redact(value: unknown): unknown {
	const output = redactValue(value, new WeakSet(), { nodes: 0, stringChars: 0 }, 0)
	try {
		const serialized = JSON.stringify(output)
		if (serialized && new TextEncoder().encode(serialized).byteLength > MAX_OUTPUT_BYTES) {
			return `[Truncated: output exceeded ${MAX_OUTPUT_BYTES} bytes]`
		}
		return output
	} catch {
		return UNSERIALIZABLE
	}
}
