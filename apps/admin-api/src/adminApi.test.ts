import { describe, expect, it, vi } from 'vitest'

import { buildAdminUsageSummary, handleAdminRequest } from './adminApi.mjs'

const ADMIN_TOKEN = 'admin-access-token'
const USER_ID = 'user_123'

interface StoreState {
	adminRole?: 'admin' | 'viewer'
	adminStatus?: 'active' | 'disabled'
	audits: Record<string, unknown>[]
	user: {
		_id: string
		uid: string
		active: boolean
		firstSeenAt: string
		lastSeenAt: string
		createdAt: string
		updatedAt: string
		note?: string
	}
}

function createStore(state: StoreState) {
	const usage = [
		{
			_id: `${USER_ID}:1`,
			uid: USER_ID,
			model: 'qwen-plus',
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
			latencyMs: 100,
			ts: 1782633600000,
			content: 'must not leak',
		},
		{
			_id: `${USER_ID}:2`,
			uid: USER_ID,
			model: 'qwen3.7-plus',
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
			latencyMs: 80,
			ts: 1782720000000,
		},
	]
	return {
		async getAdminUser(uid: string) {
			if (uid !== 'admin-uid' || !state.adminRole || !state.adminStatus) return null
			return {
				_id: uid,
				role: state.adminRole,
				status: state.adminStatus,
				displayName: 'Ops',
			}
		},
		async listUsageRecords() {
			return usage
		},
		async listUserAccounts() {
			return [state.user]
		},
		async getUserAccount(userId: string) {
			return userId === state.user.uid ? state.user : null
		},
		async updateUserAccount(
			_userId: string,
			patch: Partial<Pick<StoreState['user'], 'active' | 'updatedAt' | 'note'>>,
		) {
			state.user = { ...state.user, ...patch }
			return state.user
		},
		async createUserPermissionAudit(record: Record<string, unknown>) {
			state.audits.push(record)
		},
	}
}

function createState(overrides: Partial<StoreState> = {}): StoreState {
	return {
		adminRole: 'admin',
		adminStatus: 'active',
		audits: [],
		user: {
			_id: USER_ID,
			uid: USER_ID,
			active: true,
			firstSeenAt: '2026-06-30T00:00:00.000Z',
			lastSeenAt: '2026-07-01T12:00:00.000Z',
			createdAt: '2026-07-01T00:00:00.000Z',
			updatedAt: '2026-07-01T00:00:00.000Z',
		},
		...overrides,
	}
}

function createFetch(active = true) {
	return vi.fn(async () => Response.json({ active, sub: 'admin-uid' }))
}

async function request(
	path: string,
	state: StoreState,
	init: { method?: string; body?: unknown } = {},
) {
	return handleAdminRequest({
		method: init.method ?? 'GET',
		path,
		headers: {
			authorization: `Bearer ${ADMIN_TOKEN}`,
		},
		rawBody: init.body ? JSON.stringify(init.body) : '{}',
		env: {
			cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
			cloudbaseClientId: 'client-id',
		},
		store: createStore(state),
		fetchImpl: createFetch(),
		now: () => 1782896640000,
	})
}

function parseBody(response: { body: string }) {
	return response.body ? JSON.parse(response.body) : null
}

describe('AdminApi', () => {
	it('rejects requests without a CloudBase Auth bearer token', async () => {
		const response = await handleAdminRequest({
			method: 'GET',
			path: '/admin/v1/me',
			headers: {},
			env: {
				cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
				cloudbaseClientId: 'client-id',
			},
			store: createStore(createState()),
			fetchImpl: createFetch(),
		})

		expect(response.statusCode).toBe(401)
		expect(parseBody(response).error.message).toBe('Missing admin token')
	})

	it('requires an active admin_users record after CloudBase token introspection', async () => {
		const state = createState({ adminRole: undefined, adminStatus: undefined })
		const response = await request('/admin/v1/me', state)

		expect(response.statusCode).toBe(403)
		expect(parseBody(response).error.message).toBe('Admin user is not allowed')
	})

	it('does not expose unexpected backend error details to the browser', async () => {
		const response = await handleAdminRequest({
			method: 'GET',
			path: '/admin/v1/me',
			headers: {
				authorization: `Bearer ${ADMIN_TOKEN}`,
			},
			env: {
				cloudbaseEnvId: 'wenxue-d8gz76tacc3659f05',
				cloudbaseClientId: 'client-id',
			},
			store: {
				...createStore(createState()),
				async getAdminUser() {
					throw new Error('secret id error: Bearer internal-api-key')
				},
			},
			fetchImpl: createFetch(),
		})

		expect(response.statusCode).toBe(500)
		expect(parseBody(response).error.message).toBe('Admin API internal error')
		expect(response.body).not.toMatch(/secret id|Bearer|internal-api-key/i)
	})

	it('returns a redacted aggregate tokens dashboard by user', async () => {
		const response = await request('/admin/v1/usage/summary', createState())
		const body = parseBody(response)

		expect(response.statusCode).toBe(200)
		expect(body.totalInputTokens).toBe(12)
		expect(body.totalOutputTokens).toBe(8)
		expect(body.totalTokens).toBe(20)
		expect(body.byUser).toEqual([expect.objectContaining({ key: USER_ID, totalTokens: 20 })])
		expect(body.byModel).toEqual([
			expect.objectContaining({ key: 'qwen-plus', totalTokens: 15 }),
			expect.objectContaining({ key: 'qwen3.7-plus', totalTokens: 5 }),
		])
		expect(JSON.stringify(body)).not.toMatch(/content|authorization|bearer|api[_-]?key/i)
	})

	it('lets viewers read but not change user status', async () => {
		const state = createState({ adminRole: 'viewer' })
		const read = await request('/admin/v1/users', state)
		const write = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: {
				userId: USER_ID,
				status: 'disabled',
			},
		})

		expect(read.statusCode).toBe(200)
		expect(parseBody(read).users[0]).toMatchObject({
			userId: USER_ID,
			firstSeenAt: '2026-06-30T00:00:00.000Z',
			lastSeenAt: '2026-07-01T12:00:00.000Z',
			inputTokens: 12,
			outputTokens: 8,
			totalTokens: 20,
		})
		expect(write.statusCode).toBe(403)
		expect(parseBody(write).error.message).toBe('Admin role is required')
	})

	it('updates user status and writes an audit record for admins', async () => {
		const state = createState()
		const response = await request('/admin/v1/users/status', state, {
			method: 'PATCH',
			body: {
				userId: USER_ID,
				status: 'disabled',
				note: 'abnormal usage',
				reason: 'manual review',
			},
		})
		const body = parseBody(response)

		expect(response.statusCode).toBe(200)
		expect(body.user).toMatchObject({
			userId: USER_ID,
			status: 'disabled',
			note: 'abnormal usage',
		})
		expect(state.user).toMatchObject({
			active: false,
			note: 'abnormal usage',
		})
		expect(state.audits).toHaveLength(1)
		expect(state.audits[0]).toMatchObject({
			userId: USER_ID,
			adminUid: 'admin-uid',
			reason: 'manual review',
		})
	})

	it('builds user status counts from user accounts', () => {
		const summary = buildAdminUsageSummary(
			[],
			[
				createState().user,
				{
					...createState().user,
					_id: 'user_disabled',
					uid: 'user_disabled',
					active: false,
				},
			],
		)

		expect(summary.userStatus).toEqual({ active: 1, disabled: 1, total: 2 })
	})
})
