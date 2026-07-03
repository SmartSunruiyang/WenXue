import { describe, expect, it } from 'vitest'

import { me } from './index.mjs'

describe('Admin API CloudBase adapter', () => {
	it('treats browser CORS preflight headers as OPTIONS when method is omitted', async () => {
		const response = await me(
			{
				headers: {
					origin: 'https://wenxue-admin.example.test',
					'access-control-request-method': 'GET',
					'access-control-request-headers': 'authorization,content-type',
				},
			},
			{},
		)

		expect(response.statusCode).toBe(204)
		expect(response.headers['access-control-allow-methods']).toContain('OPTIONS')
		expect(response.body).toBe('')
	})
})
