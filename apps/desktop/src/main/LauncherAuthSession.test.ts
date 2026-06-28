import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPaths } from './AppPaths'
import { LauncherAuthSession } from './LauncherAuthSession'

let tempDir: string

beforeEach(async () => {
	tempDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-auth-session-'))
})

afterEach(async () => {
	await rm(tempDir, { force: true, recursive: true })
})

describe('LauncherAuthSession', () => {
	it('logs in a CloudBase external product user and stores only a public session over IPC', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: 'access-token',
					refresh_token: 'refresh-token',
					expires_in: 7200,
					sub: '2071249607247777793',
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					sub: '2071249607247777793',
					username: 'product-user',
					type: 'external',
				}),
			)
		const auth = new LauncherAuthSession(new AppPaths(tempDir), {
			fetchImpl,
			now: () => 1000,
		})

		const session = await auth.login({ username: ' product-user ', password: 'pw' })

		expect(session).toEqual({
			uid: '2071249607247777793',
			username: 'product-user',
			name: undefined,
			type: 'external',
			expiresAt: 7_201_000,
			envId: 'wenxue-d8gz76tacc3659f05',
			region: 'ap-shanghai',
			gatewayBaseUrl:
				'https://wenxue-llm-gateway-4037646-1427406869.ap-shanghai.run.tcloudbase.com',
		})
		expect('accessToken' in session).toBe(false)
		expect(fetchImpl).toHaveBeenNthCalledWith(
			1,
			'https://wenxue-d8gz76tacc3659f05.api.tcloudbasegateway.com/auth/v1/signin?client_id=wenxue-d8gz76tacc3659f05',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ username: 'product-user', password: 'pw' }),
			}),
		)

		const persisted = JSON.parse(
			await readFile(path.join(tempDir, 'cloud-auth-session.json'), 'utf8'),
		) as unknown
		expect(persisted).toEqual(
			expect.objectContaining({
				uid: '2071249607247777793',
				type: 'external',
				accessToken: 'access-token',
				refreshToken: 'refresh-token',
			}),
		)
	})

	it('rejects internal enterprise members even when password login succeeds', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: 'access-token',
					refresh_token: 'refresh-token',
					expires_in: 7200,
					sub: 'internal-uid',
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					sub: 'internal-uid',
					username: 'employee',
					type: 'internal',
				}),
			)
		const auth = new LauncherAuthSession(new AppPaths(tempDir), { fetchImpl })

		await expect(auth.login({ username: 'employee', password: 'pw' })).rejects.toThrow(
			'当前账号不是产品注册用户',
		)
	})

	it('refreshes an expired stored session before extension handoff', async () => {
		const paths = new AppPaths(tempDir)
		const auth = new LauncherAuthSession(paths, {
			fetchImpl: vi
				.fn()
				.mockResolvedValueOnce(
					jsonResponse({
						access_token: 'old-access',
						refresh_token: 'old-refresh',
						expires_in: 1,
						sub: '2071249607247777793',
					}),
				)
				.mockResolvedValueOnce(
					jsonResponse({
						sub: '2071249607247777793',
						username: 'product-user',
						type: 'external',
					}),
				)
				.mockResolvedValueOnce(
					jsonResponse({
						access_token: 'new-access',
						refresh_token: 'new-refresh',
						expires_in: 7200,
						sub: '2071249607247777793',
					}),
				)
				.mockResolvedValueOnce(
					jsonResponse({
						sub: '2071249607247777793',
						username: 'product-user',
						type: 'external',
					}),
				),
			now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000).mockReturnValue(3000),
		})

		await auth.login({ username: 'product-user', password: 'pw' })
		const handoff = await auth.getHandoffSession()

		expect(handoff).toEqual(
			expect.objectContaining({
				uid: '2071249607247777793',
				accessToken: 'new-access',
			}),
		)
	})
})

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}
