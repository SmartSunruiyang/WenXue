import { readFile, writeFile } from 'node:fs/promises'
import type { AppPaths } from './AppPaths'
import type { LauncherAuthSession } from './LauncherAuthSession'
import type { TokenUsageBucket, TokenUsageRecord, TokenUsageSummary } from './TokenUsageStore'

const USAGE_CACHE_FILE = 'token-usage-summary-cache.json'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface UsageCloudClientOptions {
	fetchImpl?: FetchLike
}

interface UsageCloudCache {
	uid: string
	summary: TokenUsageSummary
}

export class UsageCloudClient {
	private readonly cacheFile: string
	private readonly fetchImpl: FetchLike

	constructor(
		paths: AppPaths,
		private readonly authSession: Pick<LauncherAuthSession, 'getHandoffSession'>,
		options: UsageCloudClientOptions = {},
	) {
		this.cacheFile = paths.dataFile(USAGE_CACHE_FILE)
		this.fetchImpl = options.fetchImpl ?? fetch
	}

	async summary(): Promise<TokenUsageSummary> {
		const session = await this.authSession.getHandoffSession()
		try {
			const response = await this.fetchImpl(
				new URL('/v1/usage/summary', withTrailingSlash(session.gatewayBaseUrl)).toString(),
				{
					method: 'GET',
					headers: {
						Authorization: `Bearer ${session.accessToken}`,
					},
				},
			)
			const payload = await parseJsonResponse(response)
			if (!response.ok) {
				throw new Error(errorMessageFromPayload(payload, `CloudBase 用量读取失败（${response.status}）`))
			}
			const summary = parseTokenUsageSummary(payload)
			await writeFile(
				this.cacheFile,
				`${JSON.stringify({ uid: session.uid, summary }, null, 2)}\n`,
				'utf8',
			)
			return summary
		} catch (error) {
			const cached = await this.readCachedSummary(session.uid)
			if (cached) {
				return cached
			}
			throw error
		}
	}

	private async readCachedSummary(uid: string): Promise<TokenUsageSummary | null> {
		try {
			const cache = parseUsageCloudCache(JSON.parse(await readFile(this.cacheFile, 'utf8')))
			return cache?.uid === uid ? cache.summary : null
		} catch (error) {
			if (!isMissingFile(error)) {
				throw error
			}
			return null
		}
	}
}

async function parseJsonResponse(response: Response): Promise<unknown> {
	const text = await response.text()
	if (!text) return {}
	try {
		return JSON.parse(text) as unknown
	} catch {
		return {}
	}
}

function parseUsageCloudCache(value: unknown): UsageCloudCache | null {
	if (!isRecord(value) || typeof value.uid !== 'string') {
		return null
	}
	return {
		uid: value.uid,
		summary: parseTokenUsageSummary(value.summary),
	}
}

function parseTokenUsageSummary(value: unknown): TokenUsageSummary {
	if (!isRecord(value)) {
		throw new Error('CloudBase 用量响应格式异常')
	}
	return {
		totalInputTokens: readNumberOrThrow(value.totalInputTokens, 'totalInputTokens'),
		totalOutputTokens: readNumberOrThrow(value.totalOutputTokens, 'totalOutputTokens'),
		totalTokens: readNumberOrThrow(value.totalTokens, 'totalTokens'),
		estimatedCostCny: readNumberOrThrow(value.estimatedCostCny, 'estimatedCostCny'),
		byBrowser: readBucketArray(value.byBrowser, 'byBrowser'),
		byModel: readBucketArray(value.byModel, 'byModel'),
		daily: readBucketArray(value.daily, 'daily'),
		recent: readRecordArray(value.recent, 'recent'),
	}
}

function readBucketArray(value: unknown, label: string): TokenUsageBucket[] {
	if (!Array.isArray(value)) {
		throw new Error(`CloudBase 用量响应缺少 ${label}`)
	}
	return value.map(readBucket)
}

function readBucket(value: unknown): TokenUsageBucket {
	if (!isRecord(value)) {
		throw new Error('CloudBase 用量分组格式异常')
	}
	return {
		key: readStringOrThrow(value.key, 'bucket.key'),
		label: readStringOrThrow(value.label, 'bucket.label'),
		inputTokens: readNumberOrThrow(value.inputTokens, 'bucket.inputTokens'),
		outputTokens: readNumberOrThrow(value.outputTokens, 'bucket.outputTokens'),
		totalTokens: readNumberOrThrow(value.totalTokens, 'bucket.totalTokens'),
		estimatedCostCny: readNumberOrThrow(value.estimatedCostCny, 'bucket.estimatedCostCny'),
	}
}

function readRecordArray(value: unknown, label: string): TokenUsageRecord[] {
	if (!Array.isArray(value)) {
		throw new Error(`CloudBase 用量响应缺少 ${label}`)
	}
	return value.map(readRecord)
}

function readRecord(value: unknown): TokenUsageRecord {
	if (!isRecord(value)) {
		throw new Error('CloudBase 用量明细格式异常')
	}
	return {
		id: readStringOrThrow(value.id, 'record.id'),
		ts: readNumberOrThrow(value.ts, 'record.ts'),
		browserId: readStringOrThrow(value.browserId, 'record.browserId'),
		model: readStringOrThrow(value.model, 'record.model'),
		inputTokens: readNumberOrThrow(value.inputTokens, 'record.inputTokens'),
		outputTokens: readNumberOrThrow(value.outputTokens, 'record.outputTokens'),
		totalTokens: readNumberOrThrow(value.totalTokens, 'record.totalTokens'),
		estimatedCostCny: readNumberOrThrow(value.estimatedCostCny, 'record.estimatedCostCny'),
	}
}

function readNumberOrThrow(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`CloudBase 用量响应缺少 ${label}`)
	}
	return value
}

function readStringOrThrow(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`CloudBase 用量响应缺少 ${label}`)
	}
	return value
}

function withTrailingSlash(value: string): string {
	return value.endsWith('/') ? value : `${value}/`
}

function errorMessageFromPayload(value: unknown, fallback: string): string {
	if (!isRecord(value)) return fallback
	if (isRecord(value.error) && typeof value.error.message === 'string') {
		return value.error.message
	}
	if (typeof value.message === 'string') {
		return value.message
	}
	return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === 'ENOENT'
}
