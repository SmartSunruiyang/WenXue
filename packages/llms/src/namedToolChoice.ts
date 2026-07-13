import type { LLMConfig } from './types'

const TOOL_CHOICE_PATTERN = /\btool\s+choice\b/i
const THINKING_PATTERN = /\b(?:thinking|reasoning)\b/i
const REQUIRED_PATTERN = /\brequired\b/i
const OBJECT_PATTERN = /\bobject\b/i
const TYPE_OR_FORMAT_PATTERN = /\b(?:type|format|string)\b/i
const NAMED_OR_OBJECT_PATTERN = /\b(?:named|object)\b/i
const REJECTION_PATTERN =
	/\b(?:invalid|unsupported|expected|received|got|cannot|must|should)\b|\bnot\s+supported\b|\bdoes\s+not\s+support\b|\bdoes\s+not\s+accept\b/i
const UNSUPPORTED_PATTERN =
	/\bunsupported\b|\bnot\s+supported\b|\bdoes\s+not\s+support\b|\bdoes\s+not\s+accept\b|\bcannot\s+(?:be|accept)\b/i
const INVALID_TOOL_NAME_PATTERNS = [
	/\b(?:unknown|invalid|unrecognized|missing|nonexistent)\s+(?:tool|function)\s+name\b/i,
	/\b(?:tool|function)\s+name\b.{0,48}\b(?:not\s+found|does\s+not\s+exist|unknown|invalid)\b/i,
	/\b(?:tool|function)\s+['"`][^'"`]+['"`]\s+(?:not\s+found|does\s+not\s+exist)\b/i,
	/\bno\s+such\s+(?:tool|function)\b/i,
]

export function hasNamedToolChoice(body: unknown): boolean {
	const requestBody = readRecord(body)
	const toolChoice = readRecord(requestBody?.tool_choice)
	if (!toolChoice) return false

	const openAiFunction = readRecord(toolChoice.function)
	if (
		toolChoice.type === 'function' &&
		typeof openAiFunction?.name === 'string' &&
		openAiFunction.name.length > 0
	) {
		return true
	}

	return (
		(toolChoice.type === 'tool' || toolChoice.type === 'function') &&
		typeof toolChoice.name === 'string' &&
		toolChoice.name.length > 0
	)
}

export function shouldDisableNamedToolChoice(config: LLMConfig): boolean {
	return config.disableNamedToolChoice === true || config.getNamedToolChoiceDisabled?.() === true
}

export function isNamedToolChoiceCompatibilityError(status: number, data: unknown): boolean {
	const normalized = normalizeErrorResponse(status, data)
	if (normalized.status !== 400 && normalized.status !== 422) return false

	const payload = readRecord(normalized.data)
	const error = readRecord(payload?.error)
	const message =
		readString(error?.message) ?? readString(payload?.message) ?? readString(normalized.data)
	const param = readString(error?.param) ?? readString(payload?.param)
	const type = readString(error?.type) ?? readString(payload?.type)
	const code = readString(error?.code) ?? readString(payload?.code)
	const toolChoiceReference = normalizeDiagnosticText([message, param])
	if (!TOOL_CHOICE_PATTERN.test(toolChoiceReference)) return false

	const evidence = normalizeDiagnosticText([message, type, code])
	if (
		THINKING_PATTERN.test(evidence) &&
		REQUIRED_PATTERN.test(evidence) &&
		OBJECT_PATTERN.test(evidence)
	) {
		return false
	}
	if (INVALID_TOOL_NAME_PATTERNS.some((pattern) => pattern.test(evidence))) return false

	const rejectsTypeOrFormat =
		TYPE_OR_FORMAT_PATTERN.test(evidence) && REJECTION_PATTERN.test(evidence)
	const rejectsNamedOrObject =
		NAMED_OR_OBJECT_PATTERN.test(evidence) && UNSUPPORTED_PATTERN.test(evidence)
	return rejectsTypeOrFormat || rejectsNamedOrObject
}

export async function rememberNamedToolChoiceUnsupported(config: LLMConfig): Promise<void> {
	config.disableNamedToolChoice = true
	try {
		await config.onNamedToolChoiceUnsupported?.()
	} catch {
		console.warn('[LLM] Failed to persist named tool_choice compatibility')
	}
}

function normalizeErrorResponse(status: number, data: unknown): { status: number; data: unknown } {
	const envelope = readRecord(data)
	const logicalStatus = readNumber(envelope?.statusCode)
	if (!logicalStatus) return { status, data }
	if ((status < 200 || status >= 300) && status !== 400 && status !== 422) {
		return { status, data }
	}

	const body = envelope?.body
	return {
		status: status >= 200 && status < 300 ? logicalStatus : status,
		data: typeof body === 'string' ? parseJson(body) : body,
	}
}

function normalizeDiagnosticText(values: (string | undefined)[]): string {
	return values
		.filter((value): value is string => Boolean(value))
		.join(' ')
		.replace(/[_-]+/g, ' ')
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
