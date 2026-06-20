import type { AgentStepEvent } from '@page-agent/core'

export interface ActionSignature {
	url: string
	name: string
	input: string
	output: string
}

const IGNORED_ACTIONS = new Set(['done', 'ask_user', 'request_user_takeover'])
const ACTION_SIGNATURE_IDENTITY = Symbol('actionSignatureIdentity')

type ActionSignatureWithIdentity = ActionSignature & {
	[ACTION_SIGNATURE_IDENTITY]?: string
}

export function createActionSignature({
	url,
	action,
}: {
	url: string
	action: AgentStepEvent['action']
}): ActionSignature | null {
	if (IGNORED_ACTIONS.has(action.name)) return null

	const normalizedURL = stripHash(url)
	const signature: ActionSignatureWithIdentity = {
		url: normalizedURL,
		name: action.name,
		input: truncate(stableStringify(action.input), 160),
		output: truncate(toStableText(action.output), 240),
	}
	Object.defineProperty(signature, ACTION_SIGNATURE_IDENTITY, {
		value: hashIdentity([
			normalizedURL,
			action.name,
			canonicalStringify(action.input),
			canonicalStringify(action.output),
		]),
	})
	return signature
}

export class StuckActionGuard {
	#lastSignature: string | null = null
	#count = 0

	constructor(readonly threshold = 3) {}

	record(signature: ActionSignature | null): boolean {
		if (!signature) {
			this.reset()
			return false
		}

		const current =
			(signature as ActionSignatureWithIdentity)[ACTION_SIGNATURE_IDENTITY] ??
			hashIdentity([signature.url, signature.name, signature.input, signature.output])
		if (current === this.#lastSignature) {
			this.#count++
		} else {
			this.#lastSignature = current
			this.#count = 1
		}

		return this.#count === this.threshold
	}

	reset(): void {
		this.#lastSignature = null
		this.#count = 0
	}
}

function stripHash(url: string): string {
	const hashIndex = url.indexOf('#')
	return hashIndex === -1 ? url : url.slice(0, hashIndex)
}

function stableStringify(value: unknown): string {
	const unsupported = describeUnsupported(value)
	if (unsupported) return unsupported

	try {
		return JSON.stringify(sortValue(value, new WeakSet())) ?? '[unserializable]'
	} catch {
		return '[unserializable]'
	}
}

function canonicalStringify(value: unknown): string {
	return serializeCanonical(value, new Map(), '$')
}

function serializeCanonical(value: unknown, ancestors: Map<object, string>, path: string): string {
	switch (typeof value) {
		case 'undefined':
			return 'undefined'
		case 'boolean':
			return `boolean:${value ? 'true' : 'false'}`
		case 'number':
			if (Number.isNaN(value)) return 'number:NaN'
			if (value === Number.POSITIVE_INFINITY) return 'number:Infinity'
			if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity'
			if (Object.is(value, -0)) return 'number:-0'
			return `number:${value}`
		case 'bigint':
			return `bigint:${value}`
		case 'string':
			return `string:${JSON.stringify(value)}`
		case 'function':
			return `function:${JSON.stringify(value.name || 'anonymous')}`
		case 'symbol':
			return `symbol:${JSON.stringify(value.description ?? '')}`
		case 'object':
			break
	}

	if (value === null) return 'null'
	const cyclePath = ancestors.get(value)
	if (cyclePath) return `cycle:${JSON.stringify(cyclePath)}`

	ancestors.set(value, path)
	try {
		if (value instanceof Date) {
			const time = value.getTime()
			return `date:${Number.isNaN(time) ? 'invalid' : value.toISOString()}`
		}
		if (Array.isArray(value)) {
			return `array:[${value
				.map((item, index) => serializeCanonical(item, ancestors, `${path}[${index}]`))
				.join(',')}]`
		}
		if (value instanceof Map) {
			const entries = Array.from(value.entries(), ([key, nested]) => {
				const canonicalKey = serializeCanonical(key, ancestors, `${path}.<map-key>`)
				const canonicalValue = serializeCanonical(nested, ancestors, `${path}.<map-value>`)
				return `${canonicalKey}=>${canonicalValue}`
			}).sort()
			return `map:[${entries.join(',')}]`
		}
		if (value instanceof Set) {
			const entries = Array.from(value, (item) =>
				serializeCanonical(item, ancestors, `${path}.<set-value>`),
			).sort()
			return `set:[${entries.join(',')}]`
		}

		const entries = Object.keys(value)
			.sort()
			.map((key) => {
				const nested = (value as Record<string, unknown>)[key]
				return `${JSON.stringify(key)}:${serializeCanonical(
					nested,
					ancestors,
					`${path}[${JSON.stringify(key)}]`,
				)}`
			})
		return `object:{${entries.join(',')}}`
	} catch {
		return `unserializable:${Object.prototype.toString.call(value)}`
	} finally {
		ancestors.delete(value)
	}
}

function hashIdentity(parts: string[]): string {
	let first = 0x811c9dc5
	let second = 0x9e3779b9

	const update = (value: string) => {
		for (let index = 0; index < value.length; index++) {
			const code = value.charCodeAt(index)
			first = Math.imul(first ^ code, 0x01000193)
			second = Math.imul(second ^ code, 0x5bd1e995)
		}
	}

	for (const part of parts) {
		update(`${part.length}:`)
		update(part)
	}

	return `${toHex(first)}${toHex(second)}`
}

function toHex(value: number): string {
	return (value >>> 0).toString(16).padStart(8, '0')
}

function sortValue(value: unknown, ancestors: WeakSet<object>): unknown {
	const unsupported = describeUnsupported(value)
	if (unsupported) return unsupported
	if (!value || typeof value !== 'object') return value
	if (ancestors.has(value)) return '[circular]'

	ancestors.add(value)
	try {
		if (Array.isArray(value)) {
			return value.map((item) => sortValue(item, ancestors))
		}

		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, nested]) => [key, sortValue(nested, ancestors)]),
		)
	} catch {
		return '[unserializable]'
	} finally {
		ancestors.delete(value)
	}
}

function describeUnsupported(value: unknown): string | null {
	switch (typeof value) {
		case 'undefined':
			return '[undefined]'
		case 'bigint':
			return `[bigint:${value}]`
		case 'function':
			return `[function:${value.name || 'anonymous'}]`
		case 'symbol':
			return `[symbol:${value.description ?? ''}]`
		default:
			return null
	}
}

function toStableText(value: unknown): string {
	return typeof value === 'string' ? value : stableStringify(value)
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}
