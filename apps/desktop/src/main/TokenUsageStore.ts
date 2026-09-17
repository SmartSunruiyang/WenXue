import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { AppPaths } from './AppPaths'

export interface TokenUsageRecord {
	id: string
	ts: number
	browserId: string
	model: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
	estimatedCostCny: number
}

export interface TokenUsageBucket {
	key: string
	label: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
	estimatedCostCny: number
}

export interface TokenUsageSummary {
	totalInputTokens: number
	totalOutputTokens: number
	totalTokens: number
	estimatedCostCny: number
	byBrowser: TokenUsageBucket[]
	byModel: TokenUsageBucket[]
	daily: TokenUsageBucket[]
	recent: TokenUsageRecord[]
}

interface TokenUsageFile {
	records: TokenUsageRecord[]
}

export class TokenUsageStore {
	private readonly filePath: string
	private operationQueue: Promise<void> = Promise.resolve()

	constructor(paths: AppPaths) {
		this.filePath = paths.dataFile('token-usage.json')
	}

	async summary(): Promise<TokenUsageSummary> {
		return this.enqueue(async () => {
			const records = await this.readRecords()
			return {
				totalInputTokens: sum(records, 'inputTokens'),
				totalOutputTokens: sum(records, 'outputTokens'),
				totalTokens: sum(records, 'totalTokens'),
				estimatedCostCny: roundCurrency(sum(records, 'estimatedCostCny')),
				byBrowser: bucket(records, (record) => record.browserId),
				byModel: bucket(records, (record) => record.model),
				daily: bucket(records, (record) => new Date(record.ts).toISOString().slice(0, 10)),
				recent: records
					.slice()
					.sort((a, b) => b.ts - a.ts)
					.slice(0, 20),
			}
		})
	}

	async append(records: TokenUsageRecord[]): Promise<void> {
		await this.enqueue(async () => {
			const next = [...(await this.readRecords()), ...records.map(sanitizeRecord)]
			await this.writeRecords(next)
		})
	}

	private async readRecords(): Promise<TokenUsageRecord[]> {
		try {
			const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<TokenUsageFile>
			return Array.isArray(raw.records) ? raw.records : []
		} catch (error) {
			if (!isMissingFile(error)) {
				throw error
			}
			return []
		}
	}

	private async writeRecords(records: TokenUsageRecord[]): Promise<void> {
		const temporaryPath = `${this.filePath}.wenxue-${randomUUID()}.tmp`
		try {
			await writeFile(temporaryPath, `${JSON.stringify({ records }, null, 2)}\n`, {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			})
			await rename(temporaryPath, this.filePath)
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined)
			throw error
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationQueue.then(operation)
		this.operationQueue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
}

function bucket(
	records: TokenUsageRecord[],
	keyOf: (record: TokenUsageRecord) => string,
): TokenUsageBucket[] {
	const buckets = new Map<string, TokenUsageBucket>()
	for (const record of records) {
		const key = keyOf(record)
		const current =
			buckets.get(key) ??
			({
				key,
				label: key,
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				estimatedCostCny: 0,
			} satisfies TokenUsageBucket)
		current.inputTokens += record.inputTokens
		current.outputTokens += record.outputTokens
		current.totalTokens += record.totalTokens
		current.estimatedCostCny = roundCurrency(current.estimatedCostCny + record.estimatedCostCny)
		buckets.set(key, current)
	}
	return Array.from(buckets.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

function sum(records: TokenUsageRecord[], key: keyof TokenUsageRecord): number {
	return records.reduce((total, record) => {
		const value = record[key]
		return typeof value === 'number' ? total + value : total
	}, 0)
}

function sanitizeRecord(record: TokenUsageRecord): TokenUsageRecord {
	return {
		id: record.id,
		ts: record.ts,
		browserId: record.browserId,
		model: record.model,
		inputTokens: record.inputTokens,
		outputTokens: record.outputTokens,
		totalTokens: record.totalTokens,
		estimatedCostCny: record.estimatedCostCny,
	}
}

function roundCurrency(value: number): number {
	return Math.round(value * 10000) / 10000
}

function isMissingFile(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
