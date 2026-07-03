import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloudbaseMock = vi.hoisted(() => ({
	init: vi.fn(),
	signInWithPassword: vi.fn(),
	signOut: vi.fn(),
	getSession: vi.fn(),
	fetch: vi.fn(),
}))

vi.mock('@cloudbase/js-sdk', () => ({
	default: {
		init: cloudbaseMock.init,
	},
}))

import {
	cloudbaseConfig,
	readCloudBaseErrorMessage,
	readLauncherAuthSession,
	registerLauncher,
} from './cloudbase'

describe('desktop CloudBase auth session parsing', () => {
	beforeEach(() => {
		cloudbaseMock.init.mockReturnValue({
			auth: () => ({
				signInWithPassword: cloudbaseMock.signInWithPassword,
				signOut: cloudbaseMock.signOut,
				getSession: cloudbaseMock.getSession,
			}),
		})
		cloudbaseMock.signInWithPassword.mockReset()
		cloudbaseMock.signOut.mockReset()
		cloudbaseMock.getSession.mockReset()
		cloudbaseMock.fetch.mockReset()
		cloudbaseMock.getSession.mockResolvedValue({ data: null, error: null })
		vi.stubGlobal('fetch', cloudbaseMock.fetch)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('initializes auth with the bundled publishable key when env override is absent', () => {
		expect(cloudbaseConfig.hasAccessKey).toBe(true)
	})

	it('registers through the backend account API without requiring email or phone', async () => {
		cloudbaseMock.fetch.mockResolvedValue(Response.json({ ok: true }, { status: 201 }))
		cloudbaseMock.signInWithPassword.mockResolvedValue({
			data: {
				session: {
					access_token: 'access-token',
					refresh_token: 'refresh-token',
					expires_in: 3600,
					user: {
						id: 'user_123',
						user_metadata: {
							username: 'alice',
						},
					},
				},
			},
			error: null,
		})

		await expect(registerLauncher('alice', 'pass123')).resolves.toEqual(
			expect.objectContaining({
				userId: 'user_123',
				username: 'alice',
				accessToken: 'access-token',
			}),
		)

		expect(cloudbaseMock.fetch).toHaveBeenCalledWith(
			'https://wenxue-llm-gateway-4037646-1427406869.ap-shanghai.run.tcloudbase.com/v1/auth/register',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					username: 'alice',
					password: 'pass123',
				}),
			}),
		)
		expect(cloudbaseMock.signInWithPassword).toHaveBeenCalledWith({
			username: 'alice',
			password: 'pass123',
		})
	})

	it('normalizes a username/password session into the main-process handoff shape', () => {
		const session = readLauncherAuthSession(
			{
				session: {
					access_token: 'access-token',
					refresh_token: 'refresh-token',
					expires_in: 3600,
					user: {
						id: 'user_123',
						user_metadata: {
							username: 'alice',
						},
					},
				},
			},
			{
				now: () => 1000,
				gatewayBaseUrl: 'https://gateway.example',
			},
		)

		expect(session).toEqual({
			userId: 'user_123',
			username: 'alice',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: 3601000,
			gatewayBaseUrl: 'https://gateway.example',
		})
	})

	it('returns null when CloudBase does not provide a real session', () => {
		expect(readLauncherAuthSession({ session: undefined })).toBeNull()
		expect(readLauncherAuthSession({ session: { access_token: 'token' } })).toBeNull()
	})

	it('surfaces backend object errors from username registration', async () => {
		cloudbaseMock.fetch.mockResolvedValue(
			Response.json(
				{
					error: {
						code: 'USERNAME_EXISTS',
						message: '用户名已存在',
					},
				},
				{ status: 409 },
			),
		)

		await expect(registerLauncher('alice', 'pass123')).rejects.toThrow('用户名已存在')
	})

	it('reads CloudBase JSON error messages', () => {
		expect(
			readCloudBaseErrorMessage(
				new Error('{"code":"INVALID_PARAMS","msg":"用户名格式不正确"}'),
				'账号操作失败',
			),
		).toBe('用户名格式不正确')
	})

	it('reads nested backend error messages', () => {
		expect(
			readCloudBaseErrorMessage(
				{
					error: {
						message: '注册服务未配置',
					},
				},
				'账号操作失败',
			),
		).toBe('注册服务未配置')
	})
})
