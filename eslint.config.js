import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from '@eslint-react/eslint-plugin'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    ...react.configs['recommended-typescript'],
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.output/**'],
  }
)
