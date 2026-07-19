import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			'@wenxue/client-operations': fileURLToPath(
				new URL('../../packages/client-operations/index.mjs', import.meta.url),
			),
		},
	},
	test: {
		include: ['src/**/*.test.ts'],
	},
})
