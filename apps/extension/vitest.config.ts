import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
	.version as string

export default defineConfig({
	define: {
		__DISPLAY_VERSION__: JSON.stringify(`v${packageVersion.replace(/-beta(?=\.|$)/i, 'beta')}`),
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
