import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

const DEFAULT_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com'
const gatewayBaseUrl = resolveGatewayBaseUrl(process.env.WENXUE_GATEWAY_BASE_URL)

function resolveGatewayBaseUrl(value: string | undefined): string {
	const candidate = value?.trim() || DEFAULT_GATEWAY_BASE_URL
	const url = new URL(candidate)
	const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	if (
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error(
			'WENXUE_GATEWAY_BASE_URL must be an HTTPS origin (or loopback HTTP) without credentials, paths, queries, or fragments',
		)
	}
	return url.origin
}

export default defineConfig({
	main: {
		define: {
			__WENXUE_GATEWAY_BASE_URL__: JSON.stringify(gatewayBaseUrl),
			__WENXUE_RELEASE_ED25519_PUBLIC_KEY__: JSON.stringify(
				process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY ?? '',
			),
			__WENXUE_UPDATE_CHANNEL__: JSON.stringify(process.env.WENXUE_UPDATE_CHANNEL ?? 'stable'),
		},
		plugins: [
			externalizeDepsPlugin({
				exclude: ['@puppeteer/browsers', '@wenxue/client-operations'],
			}),
		],
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
	},
	renderer: {
		define: {
			__WENXUE_GATEWAY_BASE_URL__: JSON.stringify(gatewayBaseUrl),
			__WENXUE_UPDATE_CHANNEL__: JSON.stringify(process.env.WENXUE_UPDATE_CHANNEL ?? 'stable'),
		},
		resolve: {
			alias: {
				'@': resolve('src/renderer/src'),
			},
		},
		plugins: [react(), tailwindcss()],
	},
})
