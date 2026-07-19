import react from '@eslint-react/eslint-plugin'
import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/.output/**',
			'**/out/**',
			'**/.browsers/**',
			'ocsjs/**',
		],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.{ts,tsx}'],
		...react.configs['recommended-typescript'],
	},
	{
		files: [
			'apps/admin/src/**/*.{ts,tsx}',
			'apps/desktop/src/renderer/**/*.{ts,tsx}',
			'packages/client-operations/**/*.{js,mjs}',
		],
		languageOptions: {
			globals: globals.browser,
		},
	},
	{
		files: [
			'apps/admin-api/src/**/*.{js,mjs,ts}',
			'apps/desktop/src/main/**/*.{ts,tsx}',
			'apps/desktop/src/preload/**/*.{ts,tsx}',
			'apps/desktop/scripts/**/*.{js,mjs,ts}',
			'apps/llm-gateway/src/**/*.{js,mjs,ts}',
			'packages/client-operations/**/*.test.{js,mjs}',
		],
		languageOptions: {
			globals: globals.node,
		},
	},
)
