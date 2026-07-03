import { describe, expect, it } from 'vitest'

import { createCloudBaseAdminStore } from './cloudbaseStore.mjs'

const ENV_ID = 'wenxue-d8gz76tacc3659f05'
const API_KEY = 'admin-api-key'
const USER_ID = 'user_123'

interface RequestCall {
	url: string
	init?: RequestInit
}

function createFetch(responses: Response[]) {
	const calls: RequestCall[] = []
	const fetchImpl: typeof fetch = async (input, init) => {
		calls.push({
			url: input instanceof Request ? input.url : String(input),
			init,
		})
		const response = responses.shift()
		if (!response) {
			throw new Error('Unexpected fetch call')
		}
		return response
	}
	return { calls, fetchImpl }
}

function readHeader(headers: HeadersInit | undefined, name: string) {
	return new Headers(headers).get(name)
}

function readJsonBody(init: RequestInit | undefined) {
	if (typeof init?.body !== 'string') {
		throw new Error('Expected JSON request body')
	}
	return JSON.parse(init.body) as Record<string, unknown>
}

describe('createCloudBaseAdminStore', () => {
	it('reads admin users through the NoSQL REST document endpoint', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({
				_id: 'admin-uid',
				role: 'admin',
				status: 'active',
			}),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(store.getAdminUser('admin-uid')).resolves.toMatchObject({
			_id: 'admin-uid',
			role: 'admin',
		})

		expect(calls).toHaveLength(1)
		expect(calls[0].url).toContain('/collections/admin_users/documents/admin-uid')
		expect(calls[0].init?.method).toBe('GET')
		expect(readHeader(calls[0].init?.headers, 'authorization')).toBe(`Bearer ${API_KEY}`)
	})

	it('queries usage records with REST filters and normalizes strict EJSON numbers', async () => {
		const { calls, fetchImpl } = createFetch([
			Response.json({
				list: [
					{
						_id: 'usage-1',
						uid: USER_ID,
						model: 'qwen-plus',
						inputTokens: { $numberInt: '7' },
						outputTokens: { $numberInt: '5' },
						totalTokens: { $numberInt: '12' },
						ts: { $numberLong: '1782896640000' },
					},
				],
			}),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		const records = await store.listUsageRecords({
			limit: 25,
			userId: USER_ID,
			model: 'qwen-plus',
			from: 1782890000000,
			to: 1782900000000,
		})

		expect(records).toEqual([
			expect.objectContaining({
				uid: USER_ID,
				inputTokens: 7,
				outputTokens: 5,
				totalTokens: 12,
				ts: 1782896640000,
			}),
		])
		const url = new URL(calls[0].url)
		expect(JSON.parse(url.searchParams.get('query') ?? '')).toEqual({
			ts: { $gte: 1782890000000, $lte: 1782900000000 },
			uid: USER_ID,
			model: 'qwen-plus',
		})
		expect(url.searchParams.get('order')).toBe('[{"field":"ts","direction":"desc"}]')
		expect(url.searchParams.get('limit')).toBe('25')
	})

	it('patches user status with $set and asks CloudBase to return the updated document', async () => {
		const updatedAt = '2026-07-01T00:00:00.000Z'
		const { calls, fetchImpl } = createFetch([
			Response.json({
				doc: {
					_id: USER_ID,
					uid: USER_ID,
					status: 'disabled',
					note: 'manual review',
					updatedAt,
				},
			}),
		])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await expect(
			store.updateUserAccount(USER_ID, {
				status: 'disabled',
				note: 'manual review',
				updatedAt,
			}),
		).resolves.toMatchObject({
			uid: USER_ID,
			status: 'disabled',
			note: 'manual review',
		})

		expect(calls).toHaveLength(1)
		expect(calls[0].url).toContain(`/collections/user_accounts/documents/${USER_ID}`)
		expect(calls[0].init?.method).toBe('PATCH')
		expect(readJsonBody(calls[0].init)).toMatchObject({
			data: {
				$set: {
					status: 'disabled',
					note: 'manual review',
					updatedAt,
				},
			},
			replaceMode: false,
			returnDoc: true,
		})
	})

	it('inserts user permission audit records through the REST collection endpoint', async () => {
		const { calls, fetchImpl } = createFetch([Response.json({ insertedIds: ['audit-1'] }, { status: 201 })])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, apiKey: API_KEY, fetchImpl })

		await store.createUserPermissionAudit({
			_id: 'audit-1',
			userId: USER_ID,
		})

		expect(calls).toHaveLength(1)
		expect(calls[0].url).toContain('/collections/user_permission_audit/documents')
		expect(calls[0].init?.method).toBe('POST')
		expect(readJsonBody(calls[0].init)).toEqual({
			data: [
				{
					_id: 'audit-1',
					userId: USER_ID,
				},
			],
		})
	})

	it('fails before making CloudBase requests when the API key is missing', async () => {
		const { calls, fetchImpl } = createFetch([])
		const store = createCloudBaseAdminStore({ envId: ENV_ID, fetchImpl })

		await expect(store.getAdminUser('admin-uid')).rejects.toThrow(
			'CLOUDBASE_ADMIN_API_KEY is not configured',
		)
		expect(calls).toHaveLength(0)
	})
})
