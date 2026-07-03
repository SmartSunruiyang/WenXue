import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { UserSessionHandoff } from './UserSessionHandoff'
import type { UserSession } from './UserSessionStore'

const sampleSession: UserSession = {
	userId: 'user_123',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	expiresAt: 1782663600000,
	gatewayBaseUrl: 'https://gateway.example',
}

describe('UserSessionHandoff', () => {
	it('serves a one-shot localhost page and resolves completion', async () => {
		const handoff = new UserSessionHandoff({ timeoutMs: 1000 })
		let openedUrl = ''

		const result = await handoff.run(sampleSession, async (url) => {
			openedUrl = url
			const html = await get(url)
			expect(html).toContain('WENXUE_USER_SESSION')
			expect(html).toContain('access-token')
			expect(html).toContain('refresh-token')
			expect(html).toContain('akldabonmimlicnjlflnapfeklbfemhj')
			await post(`${url}/complete`, { ok: true })
		})

		expect(openedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/wenxue-user-session-handoff\//)
		expect(result).toEqual({ ok: true })
	})

	it('returns extension errors from the complete callback', async () => {
		const handoff = new UserSessionHandoff({ timeoutMs: 1000 })

		const result = await handoff.run(sampleSession, async (url) => {
			await post(`${url}/complete`, { ok: false, error: 'no extension' })
		})

		expect(result).toEqual({ ok: false, error: 'no extension' })
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
