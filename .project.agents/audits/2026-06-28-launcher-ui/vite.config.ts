import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const previewPath = resolve(__dirname, 'preview.html')

function auditPreview(): Plugin {
	return {
		name: 'audit-preview',
		configureServer(server) {
			server.middlewares.use('/audit-preview.html', async (_request, response) => {
				response.statusCode = 200
				response.setHeader('Content-Type', 'text/html; charset=utf-8')
				response.end(
					await server.transformIndexHtml(
						'/audit-preview.html',
						readFileSync(previewPath, 'utf8'),
					),
				)
			})
		},
	}
}

export default defineConfig({
	root: resolve(__dirname, '../../../apps/desktop/src/renderer'),
	resolve: {
		alias: {
			'@': resolve(__dirname, '../../../apps/desktop/src/renderer/src'),
		},
	},
	plugins: [auditPreview(), react(), tailwindcss()],
	server: {
		host: '127.0.0.1',
		port: 5176,
		strictPort: true,
	},
})
