import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../src/renderer', import.meta.url))
const entry = 'virtual:onboarding-preview'
const server = await createServer({
	configFile: false,
	root,
	appType: 'custom',
	plugins: [
		react(),
		tailwindcss(),
		{
			name: 'onboarding-preview',
			resolveId(id) {
				if (id === entry) return `\0${entry}`
			},
			load(id) {
				if (id !== `\0${entry}`) return
				return `
import { createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { OnboardingTour, OnboardingBrandFinish } from '/src/OnboardingTour.tsx'
import '/src/index.css'
const root = createRoot(document.getElementById('root'))
function showTour() {
  root.render(createElement(OnboardingTour, {
    onExit: (reason) => root.render(createElement('main', {
      style: {padding: '80px', fontFamily: 'system-ui', textAlign: 'center'}
    }, createElement('h1', null, reason === 'completed' ? '教程预览完成' : '已跳过教程预览'),
      createElement('p', null, '这里只预览教程。实际应用会进入浏览器工作台。'),
      createElement('button', {onClick: showTour}, '重新预览')))
  }))
}
if (window.location.pathname === '/ending') {
  root.render(createElement('main', {className: 'auth-shell onboarding-tour'},
    createElement('div', {className: 'onboarding-tour__panel'},
      createElement(OnboardingBrandFinish, {
        headingRef: createRef(),
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        disabled: false,
        onStart: () => root.render(createElement('p', {style: {padding: '80px'}}, '品牌收尾预览完成。实际应用会进入浏览器工作台。')),
        onReplay: showTour
      }))))
} else showTour()
`
			},
			configureServer(vite) {
				vite.middlewares.use(async (request, response, next) => {
					if (request.url !== '/' && request.url !== '/ending') return next()
					try {
						const html = await vite.transformIndexHtml(
							'/',
							`<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>问学使用引导 · 预览</title></head>
<body><div id="root"></div><script type="module" src="/@id/${entry}"></script></body></html>`,
						)
						response.setHeader('Content-Type', 'text/html; charset=utf-8')
						response.end(html)
					} catch (error) {
						next(error)
					}
				})
			},
		},
	],
	server: { host: '127.0.0.1', port: 5198, strictPort: true },
})
await server.listen()
server.printUrls()
