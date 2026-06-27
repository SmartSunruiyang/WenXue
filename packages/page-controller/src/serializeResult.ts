const MAX_LEN = 8192

/** Turn an arbitrary JS execution result into a readable, bounded string for the LLM. */
export function serializeResult(value: unknown): string {
	let text: string
	if (value === undefined) text = 'undefined'
	else if (value === null) text = 'null'
	else if (typeof value === 'string') text = value
	else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
		text = String(value)
	else if (value instanceof Error) text = `${value.name}: ${value.message}`
	else text = safeStringify(value)

	if (text.length <= MAX_LEN) return text

	const suffix = `…(truncated, ${text.length} chars)`
	return `${text.slice(0, MAX_LEN - suffix.length)}${suffix}`
}

function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>()
	try {
		return (
			JSON.stringify(
				value,
				(_key, val) => {
					if (typeof val === 'function') return '[Function]'
					if (typeof Node !== 'undefined' && val instanceof Node) return describeNode(val)
					if (typeof val === 'object' && val !== null) {
						if (seen.has(val)) return '[Circular]'
						seen.add(val)
					}
					return val
				},
				2,
			) ?? String(value)
		)
	} catch (error) {
		return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`
	}
}

function describeNode(node: Node): string {
	if (node instanceof Element) {
		const id = node.id ? `#${node.id}` : ''
		const cls =
			typeof node.className === 'string' && node.className.trim()
				? `.${node.className.trim().split(/\s+/).join('.')}`
				: ''
		return `<${node.tagName.toLowerCase()}${id}${cls}>`
	}
	return `[${node.nodeName}]`
}
