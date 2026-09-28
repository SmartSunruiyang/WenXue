import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const publicVersion = pkg.version
	.replace(/-beta(?=\.|$)/i, 'beta')
	.replace(/-preview(?=\.|$)/i, ' preview')
const defaultGatewayBaseUrl =
	'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com'
const gatewayBaseUrl = resolveGatewayBaseUrl(process.env.WENXUE_GATEWAY_BASE_URL)

function resolveGatewayBaseUrl(value) {
	const candidate = value?.trim() || defaultGatewayBaseUrl
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

// See https://wxt.dev/api/config.html
export default defineConfig({
	srcDir: 'src',
	modules: ['@wxt-dev/module-react'],
	webExt: {
		chromiumProfile: chromeProfile,
		keepProfileChanges: true,
		chromiumArgs: ['--hide-crash-restore-bubble'],
	},
	vite: () => ({
		plugins: [tailwindcss()],
		define: {
			__VERSION__: JSON.stringify(pkg.version),
			__DISPLAY_VERSION__: JSON.stringify(`v${publicVersion}`),
			__WENXUE_GATEWAY_BASE_URL__: JSON.stringify(gatewayBaseUrl),
		},
		optimizeDeps: {
			force: true,
		},
		build: {
			minify: false,
			chunkSizeWarningLimit: 2000,
			cssCodeSplit: true,
			rollupOptions: {
				onwarn: function (message, handler) {
					if (message.code === 'EVAL') return
					handler(message)
				},
			},
		},
	}),
	zip: {
		artifactTemplate: 'page-agent-ext-{{version}}-{{browser}}.zip',
	},
	manifest: {
		version_name: publicVersion,
		key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqbzT0iTYeYlnCvDJIGDnGU8oarJgZILDzSfLi/ufuSxXEPDKuMyD892GhvrMCZNVHS11Sh6NYUOc/PcUOhtaR2urHtcNkrpSJNV10zUamY7fxBdVEkOucfyLu8INVy+teis62MoRWYPaUPkfZUjrLGW8MsZ9aFzARfu9GGDEp2EAYsWDN6w6vyz9LJ82pm542EWnVT4MjmDPgvYFCWGBtaU/dfHD+GAX6URJFapsCvryVURKJ+76c/GO9/I3EX1IBfbY6dec78bLCMvVxiTmiv36KyGPwX1OpakW8IiCpXWdbAxjm+plbYlp5t5zTyyoE3sOSFeXsBH0Kg27o8GcvQIDAQAB',
		default_locale: 'en',
		name: '__MSG_extName__',
		description: '__MSG_extDescription__',
		content_security_policy: {
			extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data:;",
		},
		homepage_url: 'https://alibaba.github.io/page-agent/',
		permissions: [
			'tabs',
			'tabGroups',
			'sidePanel',
			'storage',
			'alarms',
			'webNavigation',
			'scripting',
		],
		host_permissions: ['<all_urls>'],
		icons: {
			16: 'assets/page-agent-16.png',
			32: 'assets/page-agent-32.png',
			48: 'assets/page-agent-48.png',
			64: 'assets/page-agent-64.png',
			128: 'assets/page-agent-128.png',
		},
		action: {
			default_title: '__MSG_extActionTitle__',
			default_icon: {
				16: 'assets/page-agent-16.png',
				32: 'assets/page-agent-32.png',
				48: 'assets/page-agent-48.png',
				64: 'assets/page-agent-64.png',
				128: 'assets/page-agent-128.png',
			},
		},
		web_accessible_resources: [
			{
				resources: ['main-world.js', 'main-world-executor.js'],
				matches: ['*://*/*'],
			},
		],
		side_panel: {
			default_path: 'sidepanel/index.html',
		},
		externally_connectable: {
			matches: ['http://localhost/*', 'http://127.0.0.1/*'],
		},
	},
})
