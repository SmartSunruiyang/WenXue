import type { LogLevel } from './AppLogger'
import type {
	LauncherLogContext,
	LauncherLogEntry,
	LauncherLogSource,
	LauncherLogStore,
} from './LauncherLogStore'
import type { TokenUsageRecord, TokenUsageStore } from './TokenUsageStore'

export interface LauncherTelemetryIngestResult {
	logs: number
	tokenUsage: number
}

type TelemetryLogDraft = Partial<Omit<LauncherLogEntry, 'id' | 'browserId'>> & {
	browserId?: unknown
}

type TelemetryTokenUsageDraft = Partial<TokenUsageRecord> & {
	browserId?: unknown
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
const LOG_SOURCES: LauncherLogSource[] = [
	'agent',
	'llm',
	'tabs',
	'page',
	'chaoxing',
	'config',
	'system',
]
const LOG_CONTEXTS: LauncherLogContext[] = ['background', 'sidepanel', 'newtab', 'hub', 'content']

export class LauncherTelemetryIngest {
	constructor(
		private readonly logStore: Pick<LauncherLogStore, 'append'>,
		private readonly tokenUsageStore: Pick<TokenUsageStore, 'append'>,
	) {}

	async ingest(message: unknown): Promise<LauncherTelemetryIngestResult> {
		const payload = asRecord(message)
		const browserId = asNonEmptyString(payload.browserId)
		if (!browserId) {
			throw new Error('Telemetry browserId is required')
		}

		const logs = normalizeLogs(payload.logs, browserId)
		const explicitTokenUsage = normalizeTokenUsageBatch(payload.tokenUsage, browserId)
		const inferredTokenUsage = logs
			.map((entry, index) => extractTokenUsage(entry, index))
			.filter((record): record is TokenUsageRecord => record !== undefined)
		const tokenUsage = [...explicitTokenUsage, ...inferredTokenUsage]

		if (logs.length > 0) {
			await this.logStore.append(logs)
		}
		if (tokenUsage.length > 0) {
			await this.tokenUsageStore.append(tokenUsage)
		}

		return {
			logs: logs.length,
			tokenUsage: tokenUsage.length,
		}
	}
}

function normalizeLogs(value: unknown, fallbackBrowserId: string): Omit<LauncherLogEntry, 'id'>[] {
	if (!Array.isArray(value)) return []

	return value
		.map((item) => normalizeLog(item, fallbackBrowserId))
		.filter((entry): entry is Omit<LauncherLogEntry, 'id'> => entry !== undefined)
}

function normalizeLog(
	value: unknown,
	fallbackBrowserId: string,
): Omit<LauncherLogEntry, 'id'> | undefined {
	const draft = asRecord(value) as TelemetryLogDraft
	const message = asNonEmptyString(draft.message)
	if (!message) return undefined

	return {
		ts: asFiniteNumber(draft.ts) ?? Date.now(),
		level: oneOf(draft.level, LOG_LEVELS) ?? 'info',
		source: oneOf(draft.source, LOG_SOURCES) ?? 'system',
		context: oneOf(draft.context, LOG_CONTEXTS) ?? 'background',
		browserId: asNonEmptyString(draft.browserId) ?? fallbackBrowserId,
		message,
		data: draft.data,
	}
}

function normalizeTokenUsageBatch(value: unknown, fallbackBrowserId: string): TokenUsageRecord[] {
	if (!Array.isArray(value)) return []

	return value
		.map((item, index) => normalizeTokenUsage(item, fallbackBrowserId, index))
		.filter((record): record is TokenUsageRecord => record !== undefined)
}

function normalizeTokenUsage(
	value: unknown,
	fallbackBrowserId: string,
	index: number,
): TokenUsageRecord | undefined {
	const draft = asRecord(value) as TelemetryTokenUsageDraft
	const ts = asFiniteNumber(draft.ts) ?? Date.now()
	const browserId = asNonEmptyString(draft.browserId) ?? fallbackBrowserId
	const model = asNonEmptyString(draft.model) ?? 'unknown'
	const inputTokens = asNonNegativeNumber(draft.inputTokens) ?? 0
	const outputTokens = asNonNegativeNumber(draft.outputTokens) ?? 0
	const totalTokens = asNonNegativeNumber(draft.totalTokens) ?? inputTokens + outputTokens

	if (totalTokens <= 0) return undefined

	return {
		id: asNonEmptyString(draft.id) ?? usageId(browserId, ts, index, totalTokens),
		ts,
		browserId,
		model,
		inputTokens,
		outputTokens,
		totalTokens,
		estimatedCostCny: asNonNegativeNumber(draft.estimatedCostCny) ?? 0,
	}
}

function extractTokenUsage(
	entry: Omit<LauncherLogEntry, 'id'>,
	index: number,
): TokenUsageRecord | undefined {
	if (entry.source !== 'llm') return undefined

	const usage = findUsageObject(entry.data)
	if (!usage) return undefined

	const inputTokens =
		asNonNegativeNumber(usage.inputTokens) ??
		asNonNegativeNumber(usage.input_tokens) ??
		asNonNegativeNumber(usage.promptTokens) ??
		asNonNegativeNumber(usage.prompt_tokens) ??
		0
	const outputTokens =
		asNonNegativeNumber(usage.outputTokens) ??
		asNonNegativeNumber(usage.output_tokens) ??
		asNonNegativeNumber(usage.completionTokens) ??
		asNonNegativeNumber(usage.completion_tokens) ??
		0
	const totalTokens =
		asNonNegativeNumber(usage.totalTokens) ??
		asNonNegativeNumber(usage.total_tokens) ??
		inputTokens + outputTokens

	if (totalTokens <= 0) return undefined

	return {
		id: usageId(entry.browserId, entry.ts, index, totalTokens),
		ts: entry.ts,
		browserId: entry.browserId,
		model: findStringByKey(entry.data, 'model') ?? 'unknown',
		inputTokens,
		outputTokens,
		totalTokens,
		estimatedCostCny: 0,
	}
}

function findUsageObject(value: unknown, depth = 0): Record<string, unknown> | undefined {
	if (depth > 8) return undefined
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findUsageObject(item, depth + 1)
			if (found) return found
		}
		return undefined
	}
	const record = asRecord(value)
	if (Object.keys(record).length === 0) return undefined

	if (
		record.usage &&
		typeof record.usage === 'object' &&
		(hasTokenCount(record.usage) || hasTokenCount(asRecord(record.usage)))
	) {
		return asRecord(record.usage)
	}
	if (hasTokenCount(record)) {
		return record
	}
	for (const child of Object.values(record)) {
		const found = findUsageObject(child, depth + 1)
		if (found) return found
	}
	return undefined
}

function hasTokenCount(value: unknown): boolean {
	const record = asRecord(value)
	return [
		'inputTokens',
		'input_tokens',
		'promptTokens',
		'prompt_tokens',
		'outputTokens',
		'output_tokens',
		'completionTokens',
		'completion_tokens',
		'totalTokens',
		'total_tokens',
	].some((key) => asNonNegativeNumber(record[key]) !== undefined)
}

function findStringByKey(value: unknown, key: string, depth = 0): string | undefined {
	if (depth > 8) return undefined
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findStringByKey(item, key, depth + 1)
			if (found) return found
		}
		return undefined
	}
	const record = asRecord(value)
	if (Object.keys(record).length === 0) return undefined
	const direct = asNonEmptyString(record[key])
	if (direct) return direct
	for (const child of Object.values(record)) {
		const found = findStringByKey(child, key, depth + 1)
		if (found) return found
	}
	return undefined
}

function usageId(browserId: string, ts: number, index: number, totalTokens: number): string {
	return `usage-${browserId}-${Math.trunc(ts)}-${index}-${Math.trunc(totalTokens)}`
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | undefined {
	return typeof value === 'string' && values.includes(value as T) ? (value as T) : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asNonNegativeNumber(value: unknown): number | undefined {
	const number = asFiniteNumber(value)
	return number !== undefined && number >= 0 ? number : undefined
}
