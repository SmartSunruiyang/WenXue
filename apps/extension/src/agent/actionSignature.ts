import type { AgentStepEvent } from '@page-agent/core'

export interface ActionSignature {
	url: string
	name: string
	input: string
	output: string
}

const IGNORED_ACTIONS = new Set(['done', 'ask_user', 'request_user_takeover'])

export function createActionSignature({
	url,
	action,
}: {
	url: string
	action: AgentStepEvent['action']
}): ActionSignature | null {
	if (IGNORED_ACTIONS.has(action.name)) return null

	return {
		url: stripHash(url),
		name: action.name,
		input: truncate(stableStringify(action.input), 160),
		output: truncate(toStableText(action.output), 240),
	}
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

		const current = JSON.stringify(signature)
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
