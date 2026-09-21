import { request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { UserSessionHandoff } from './UserSessionHandoff'
import type { UserSession } from './UserSessionStore'

const sampleSession: UserSession & { browserId: string } = {
	userId: 'user_123',
	browserId: 'research',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	expiresAt: 1782663600000,
	gatewayBaseUrl: 'https://gateway.example',
}

describe('UserSessionHandoff', () => {
	it('serves a one-shot localhost page and resolves completion', async () => {
		const log = vi.fn()
		const handoff = new UserSessionHandoff({ log }, { timeoutMs: 1000 })
		let openedUrl = ''

		const result = await handoff.run(sampleSession, async (url) => {
			openedUrl = url
			const html = await get(url)
			expect(html).toContain('WENXUE_USER_SESSION')
			expect(html).toContain('"browserId":"research"')
			expect(html).toContain('access-token')
			expect(html).toContain('refresh-token')
			expect(html).toContain('akldabonmimlicnjlflnapfeklbfemhj')
			expect(html).toContain('WENXUE_USER_SESSION_HANDOFF_CLOSE')
			expect(html).not.toContain('正在同步问学账号')
			expect(html).not.toContain('账号已同步')
			await post(`${url}/complete`, { ok: true })
		})

		expect(openedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/wenxue-user-session-handoff\//)
		expect(result).toEqual({ ok: true })
		expect(log).toHaveBeenCalledWith(
			'UserSessionHandoff',
			'info',
			'session handoff completed for profile research',
		)
		expect(JSON.stringify(log.mock.calls)).not.toContain('access-token')
		expect(JSON.stringify(log.mock.calls)).not.toContain('refresh-token')
		expect(JSON.stringify(log.mock.calls)).not.toContain('/wenxue-user-session-handoff/')
	})

	it('returns extension errors from the complete callback', async () => {
		const log = vi.fn()
		const handoff = new UserSessionHandoff({ log }, { timeoutMs: 1000 })

		const result = await handoff.run(sampleSession, async (url) => {
			await post(`${url}/complete`, { ok: false, error: 'no extension' })
		})

		expect(result).toEqual({ ok: false, error: 'no extension' })
		expect(log).toHaveBeenCalledWith(
			'UserSessionHandoff',
			'warn',
			'session handoff rejected for profile research',
		)
		expect(JSON.stringify(log.mock.calls)).not.toContain('no extension')
	})

	it('logs a credential-free failure when the handoff times out', async () => {
		const log = vi.fn()
		const handoff = new UserSessionHandoff({ log }, { timeoutMs: 10 })

		await expect(handoff.run(sampleSession, async () => undefined)).rejects.toThrow(
			'问学账号同步超时',
		)
		expect(log).toHaveBeenLastCalledWith(
			'UserSessionHandoff',
			'error',
			'session handoff failed for profile research',
		)
		expect(JSON.stringify(log.mock.calls)).not.toContain('access-token')
		expect(JSON.stringify(log.mock.calls)).not.toContain('refresh-token')
	})
})

async function get(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = request(url, (res) => {
			let body = ''
			res.setEncoding('utf8')
			res.on('data', (chunk) => {
				body += chunk
			})
			res.on('end', () => resolve(body))
		})
		req.on('error', reject)
		req.end()
	})
}

async function post(url: string, payload: unknown): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const body = JSON.stringify(payload)
		const req = request(
			url,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body).toString(),
				},
			},
			(res) => {
				res.resume()
				res.on('end', resolve)
			},
		)
		req.on('error', reject)
		req.write(body)
		req.end()
	})
}
