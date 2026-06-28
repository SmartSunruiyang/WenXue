import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPaths } from './AppPaths'
import type { LauncherAuthSession } from './LauncherAuthSession'
import type { TokenUsageSummary } from './TokenUsageStore'
import { UsageCloudClient } from './UsageCloudClient'

let userDataDir: string
let paths: AppPaths

beforeEach(async () => {
	userDataDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-usage-cloud-'))
	paths = new AppPaths(userDataDir)
	await paths.ensure()
})

afterEach(async () => {
	await rm(userDataDir, { force: true, recursive: true })
})

describe('UsageCloudClient', () => {
	it('fetches cloud summary with the product user access token and caches it', async () => {
		const calls: Array<{ url: string; authorization: string | null }> = []
		const client = new UsageCloudClient(paths, createAuthSession(), {
			fetchImpl: async (url, init) => {
				const headers = new Headers(init?.headers)
				calls.push({ url, authorization: headers.get('authorization') })
				return Response.json(sampleSummary())
			},
		})

		await expect(client.summary()).resolves.toEqual(sampleSummary())

		expect(calls).toEqual([
			{
				url: 'https://gateway.example/v1/usage/summary',
				authorization: 'Bearer product-access-token',
			},
		])
		const cache = JSON.parse(
			await readFile(paths.dataFile('token-usage-summary-cache.json'), 'utf8'),
		) as unknown
		expect(cache).toEqual({
			uid: 'uid-product',
			summary: sampleSummary(),
		})
	})

	it('returns the same user cache when the cloud request fails', async () => {
		const warmClient = new UsageCloudClient(paths, createAuthSession(), {
			fetchImpl: async () => Response.json(sampleSummary()),
		})
		await warmClient.summary()

		const offlineClient = new UsageCloudClient(paths, createAuthSession(), {
			fetchImpl: async () => {
				throw new Error('offline')
			},
		})

		await expect(offlineClient.summary()).resolves.toEqual(sampleSummary())
	})

	it('rejects invalid summaries when no cache exists', async () => {
		const client = new UsageCloudClient(paths, createAuthSession(), {
			fetchImpl: async () => Response.json({ totalTokens: 'bad' }),
		})

		await expect(client.summary()).rejects.toThrow('CloudBase 用量响应缺少')
	})
})

function createAuthSession(): Pick<LauncherAuthSession, 'getHandoffSession'> {
	return {
		getHandoffSession: vi.fn(async () => ({
			uid: 'uid-product',
			username: 'product-user',
			type: 'external' as const,
			accessToken: 'product-access-token',
			expiresAt: 1782660000000,
			envId: 'wenxue-d8gz76tacc3659f05',
			region: 'ap-shanghai',
			gatewayBaseUrl: 'https://gateway.example',
		})),
	}
}

function sampleSummary(): TokenUsageSummary {
	return {
		totalInputTokens: 10,
		totalOutputTokens: 20,
		totalTokens: 30,
		estimatedCostCny: 0,
		byBrowser: [
			{
				key: 'cloud',
				label: 'cloud',
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				estimatedCostCny: 0,
			},
		],
		byModel: [
			{
				key: 'qwen-plus',
				label: 'qwen-plus',
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				estimatedCostCny: 0,
			},
		],
		daily: [
			{
				key: '2026-06-28',
				label: '2026-06-28',
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				estimatedCostCny: 0,
			},
		],
		recent: [
			{
				id: 'req-1:1782660000000',
				ts: 1782660000000,
				browserId: 'cloud',
				model: 'qwen-plus',
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				estimatedCostCny: 0,
			},
		],
	}
}
