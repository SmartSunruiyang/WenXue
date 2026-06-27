// @ts-check
import chalk from 'chalk'
import { dirname, resolve } from 'path'
import dts from 'unplugin-dts/vite'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

const __dirname = dirname(fileURLToPath(import.meta.url))

console.log(chalk.cyan(`📦 Building @page-agent/page-controller`))

export default defineConfig({
	clearScreen: false,
	plugins: [
		dts({
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts'],
			bundleTypes: true,
			compilerOptions: {
				composite: true,
				noEmit: false,
				emitDeclarationOnly: true,
				declaration: true,
			},
		}),
		cssInjectedByJsPlugin({ relativeCSSInjection: true }),
	],
	publicDir: false,
	build: {
		lib: {
			entry: {
				'page-controller': resolve(__dirname, 'src/PageController.ts'),
				serializeResult: resolve(__dirname, 'src/serializeResult.ts'),
			},
			name: 'PageController',
			fileName: (_format, entryName) => `${entryName}.js`,
			formats: ['es'],
		},
		outDir: resolve(__dirname, 'dist', 'lib'),
		rollupOptions: {
			external: ['@page-agent/*', 'ai-motion'],
			onwarn: function (message, handler) {
				if (message.code === 'EVAL') return
				handler(message)
			},
		},
		minify: false,
		sourcemap: true,
		cssCodeSplit: true,
	},
	define: {
		'process.env.NODE_ENV': '"production"',
	},
})
