import { describe, expect, it } from 'vitest'

import { handleAdminRequest } from '../../admin-api/src/adminApi.mjs'
import { createCloudBaseAdminStore } from '../../admin-api/src/cloudbaseStore.mjs'
import { handleChatCompletions, handleLauncherActivation } from './gateway.mjs'

const ENV_ID = 'wenxue-d8gz76tacc3659f05'
const USER_UID = 'registered-user-uid'
const ADMIN_UID = 'administrator-uid'

describe('registered user administration and gateway access', () => {
	it('discovers a new Auth-only account, blocks its next model request, and restores access', async () => {
		const authUsers = [
			{
				Uid: ADMIN_UID,
				Email: 'admin@example.com',
				NickName: '管理员',
				UserStatus: 'ACTIVE',
				Type: 'internalUser',
			},
			{
				Uid: USER_UID,
				Email: 'new@example.com',
				NickName: '新用户',
				UserStatus: 'ACTIVE',
				Type: 'externalUser',
			},
		]
		const db: Record<string, Record<string, unknown>[]> = {
			admin_users: [{ _id: ADMIN_UID, role: 'admin', status: 'active' }],
			user_accounts: [{ _id: 'legacy-orphan', uid: 'legacy-orphan', active: true }],
			token_usage: [],
			user_permission_audit: [],
		}
		let providerCalls = 0
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input))
			const headers = new Headers(init?.headers)
			const body: Record<string, unknown> = JSON.parse(String(init?.body ?? '{}'))
			if (url.hostname === 'tcb.tencentcloudapi.com') {
				const action = headers.get('x-tc-action')
				expect(body.EnvId).toBe(ENV_ID)
				if (action === 'DescribeUserList') {
					const uids = Array.isArray(body.UidList) ? body.UidList : null
					const users = authUsers.filter((user) => !uids || uids.includes(user.Uid))
					return Response.json({ Response: { Data: { Total: users.length, UserList: users } } })
				}
				if (action === 'ModifyUser') {
					expect(db.user_permission_audit.at(-1)?.outcome).toBe('requested')
					const user = authUsers.find((entry) => entry.Uid === body.Uid)
					if (!user) throw new Error('Unknown synthetic Auth user')
					user.UserStatus = String(body.UserStatus)
					return Response.json({ Response: { Data: { Success: true } } })
				}
			}
			if (url.pathname === '/auth/v1/token/introspect')
				return Response.json({ sub: ADMIN_UID, active: true })
			if (url.pathname === '/auth/v1/user/me') {
				const uid =
					headers.get('authorization') === 'Bearer synthetic-admin-token' ? ADMIN_UID : USER_UID
				const user = authUsers.find((entry) => entry.Uid === uid)
				return Response.json({ sub: uid, status: user?.UserStatus })
			}
			if (url.hostname === 'dashscope.aliyuncs.com') {
				providerCalls += 1
				return Response.json({
					choices: [{ message: { role: 'assistant', content: 'ok' } }],
					usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
				})
			}
			const collectionMatch = url.pathname.match(/\/collections\/([^/]+)\/documents(?:\/([^/]+))?$/)
			if (collectionMatch) {
				const rows = db[collectionMatch[1]]
				if (!rows) throw new Error('Unknown synthetic collection')
				const id = collectionMatch[2] ? decodeURIComponent(collectionMatch[2]) : null
				if (init?.method === 'POST') {
					rows.push(...(body.data as Record<string, unknown>[]))
					return Response.json({ inserted: 1 })
				}
				if (init?.method === 'PATCH' && id) {
					const set = (body.data as { $set: Record<string, unknown> }).$set
					let row = rows.find((entry) => entry._id === id)
					if (!row) {
						row = { _id: id }
						rows.push(row)
					}
					Object.assign(row, set)
					return Response.json({ doc: row })
				}
				if (id) {
					const row = rows.find((entry) => entry._id === id)
					return row ? Response.json(row) : new Response(null, { status: 404 })
				}
				const query: Record<string, unknown> = JSON.parse(url.searchParams.get('query') ?? '{}')
				return Response.json({ data: rows.filter((row) => !query.uid || row.uid === query.uid) })
			}
			throw new Error(`Unexpected synthetic request ${url.pathname}`)
		}
		const env = {
			cloudbaseEnvId: ENV_ID,
			cloudbaseClientId: ENV_ID,
			cloudbaseClientSecret: 'unused',
			cloudbaseUsageApiKey: 'synthetic-db-key',
			tencentCloudSecretId: 'synthetic-secret-id',
			tencentCloudSecretKey: 'synthetic-secret-key',
			dashscopeApiKey: 'synthetic-model-key',
		}
		const transaction = {
			collection(name: string) {
				return {
					doc(id: string) {
						return {
							async get() {
								return { data: db[name].find((row) => row._id === id) ?? null }
							},
							async set(data: Record<string, unknown>) {
								expect(data).not.toHaveProperty('active')
								expect(data).not.toHaveProperty('status')
								const index = db[name].findIndex((row) => row._id === id)
								const record = { _id: id, ...data }
								if (index >= 0) db[name][index] = record
								else db[name].push(record)
								return { updated: 1 }
							},
						}
					},
				}
			},
		}
		const store = createCloudBaseAdminStore({
			envId: ENV_ID,
			apiKey: env.cloudbaseUsageApiKey,
			secretId: env.tencentCloudSecretId,
			secretKey: env.tencentCloudSecretKey,
			transactionDatabase: {
				async runTransaction<T>(callback: (value: typeof transaction) => Promise<T>) {
					return callback(transaction)
				},
			},
			fetchImpl,
		})
		const adminRequest = (path: string, body?: Record<string, unknown>) =>
			handleAdminRequest({
				path,
				method: body ? 'PATCH' : 'GET',
				headers: { authorization: 'Bearer synthetic-admin-token' },
				rawBody: JSON.stringify(body ?? {}),
				env,
				store,
				fetchImpl,
			})
		const chat = () =>
			handleChatCompletions({
				headers: { authorization: 'Bearer synthetic-user-token' },
				rawBody: JSON.stringify({
					model: 'qwen3.7-max',
					stream: false,
					messages: [{ role: 'user', content: 'hello' }],
				}),
				env,
				fetchImpl,
			})

		await expect(
			handleLauncherActivation({
				headers: { authorization: 'Bearer synthetic-user-token' },
				env,
				fetchImpl,
			}),
		).resolves.toMatchObject({ userId: USER_UID })
		expect(db.user_accounts.some((row) => row.uid === USER_UID)).toBe(false)
		const list = await adminRequest('/admin/v1/users')
		expect(list.statusCode).toBe(200)
		expect(JSON.parse(list.body).users).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					userId: USER_UID,
					email: 'new@example.com',
					nickname: '新用户',
					status: 'active',
					totalTokens: 0,
				}),
			]),
		)
		expect(list.body).not.toContain('legacy-orphan')
		const disable = await adminRequest('/admin/v1/users/status', {
			userId: USER_UID,
			status: 'disabled',
			note: 'reviewed',
		})
		expect(disable.statusCode).toBe(200)
		expect(JSON.parse(disable.body).user).toMatchObject({ status: 'disabled', note: 'reviewed' })
		await expect(chat()).rejects.toMatchObject({ status: 403 })
		expect(providerCalls).toBe(0)
		const summary = await adminRequest('/admin/v1/usage/summary')
		expect(JSON.parse(summary.body).userStatus).toEqual({ active: 1, disabled: 1, total: 2 })
		const enable = await adminRequest('/admin/v1/users/status', {
			userId: USER_UID,
			status: 'active',
		})
		expect(enable.statusCode).toBe(200)
		await expect(chat()).resolves.toMatchObject({ usagePersisted: true })
		expect(providerCalls).toBe(1)
		expect(db.user_permission_audit.map((row) => row.outcome)).toEqual([
			'requested',
			'applied',
			'requested',
			'applied',
		])
		const metadata = db.user_accounts.find((row) => row.uid === USER_UID)
		expect(metadata).not.toHaveProperty('active')
		expect(metadata).not.toHaveProperty('status')
	})
})
