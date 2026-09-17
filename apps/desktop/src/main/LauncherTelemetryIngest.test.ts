import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppPaths } from './AppPaths'
import { LauncherLogStore } from './LauncherLogStore'
import { LauncherSettingsStore } from './LauncherSettingsStore'
import { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import { TokenUsageStore } from './TokenUsageStore'

let userDataDir: string
let logStore: LauncherLogStore
let tokenUsageStore: TokenUsageStore
let ingest: LauncherTelemetryIngest

beforeEach(async () => {
	userDataDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-telemetry-'))
	const appPaths = new AppPaths(userDataDir)
	await appPaths.ensure()
	const settingsStore = new LauncherSettingsStore(appPaths)
	logStore = new LauncherLogStore(appPaths, settingsStore)
	tokenUsageStore = new TokenUsageStore(appPaths)
	ingest = new LauncherTelemetryIngest(logStore, tokenUsageStore)
})

afterEach(async () => {
	await rm(userDataDir, { force: true, recursive: true })
})

describe('LauncherTelemetryIngest', () => {
	it('persists launcher logs and extracts token usage from LLM usage payloads', async () => {
		const ts = Date.now()

		await expect(
			ingest.ingest({
				browserId: 'research',
				logs: [
					{
						ts,
						level: 'info',
						source: 'llm',
						context: 'background',
						message: 'LLM 200 https://api.openai.com/v1/chat/completions',
						data: {
							apiKey: 'sk-secret',
							tokenCount: 42,
							request: { model: 'gpt-5-mini' },
							response: {
								body: {
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
									},
								},
							},
						},
					},
				],
			}),
		).resolves.toEqual({ logs: 1, tokenUsage: 1 })

		const [entry] = await logStore.query({ limit: 10 })
		expect(entry).toEqual(
			expect.objectContaining({
				browserId: 'research',
				context: 'background',
				level: 'info',
				message: expect.stringContaining('LLM 200'),
				source: 'llm',
			}),
		)
		expect(entry.data).toEqual(
			expect.objectContaining({
				apiKey: '[redacted]',
				tokenCount: 42,
			}),
		)

		const summary = await tokenUsageStore.summary()
		expect(summary).toEqual(
			expect.objectContaining({
				totalInputTokens: 10,
				totalOutputTokens: 5,
				totalTokens: 15,
			}),
		)
		expect(summary.byModel[0]).toEqual(
			expect.objectContaining({
				key: 'gpt-5-mini',
				totalTokens: 15,
			}),
		)
	})

	it('accepts explicit token usage records and rejects payloads without a browser id', async () => {
		await expect(
			ingest.ingest({
				browserId: 'course',
				tokenUsage: [
					{
						id: 'usage-1',
						ts: Date.now(),
						model: 'gpt-5',
						inputTokens: 20,
						outputTokens: 8,
						totalTokens: 28,
						estimatedCostCny: 0.01,
					},
				],
			}),
		).resolves.toEqual({ logs: 0, tokenUsage: 1 })

		await expect(ingest.ingest({ logs: [{ message: 'missing browser' }] })).rejects.toThrow(
			'Telemetry browserId is required',
		)
	})

	it('keeps every token record from concurrent telemetry ingestion', async () => {
		await Promise.all(
			Array.from({ length: 25 }, (_, index) =>
				ingest.ingest({
					browserId: 'course',
					tokenUsage: [
						{
							id: `usage-${index}`,
							ts: Date.now() + index,
							model: 'qwen3.7-max',
							inputTokens: 1,
							outputTokens: 1,
							totalTokens: 2,
							estimatedCostCny: 0,
						},
					],
				}),
			),
		)

		await expect(tokenUsageStore.summary()).resolves.toMatchObject({ totalTokens: 50 })
	})
})
