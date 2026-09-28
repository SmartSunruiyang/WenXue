import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('../src/renderer', import.meta.url))
const entry = 'virtual:windows-ui-preview'
const fixtures = `${entry}/fixtures`
const mockedModules = new Set([
	'cloudbase',
	'DesktopAnnouncementService',
	'DesktopReleaseSignalService',
	'EmailAuthScreen',
])

const fixtureSource = `
import type { BrowserProfile, BrowserStatus, LauncherLogEntry, LauncherSettings, TokenUsageSummary, WindowClosePromptState } from '/src/wenxue'

const now = Date.now()
const copy = <T,>(value: T): T => structuredClone(value)
const ok = async () => ({ ok: true })
export const notice = (message: string) => parent.postMessage({ type: 'windows-ui-preview', message }, location.origin)
export const session = {
  userId: 'preview-user', email: 'preview@example.com', nickname: '问学体验者',
  accessToken: 'preview-only', refreshToken: 'preview-only', expiresAt: now + 86_400_000,
  gatewayBaseUrl: 'https://preview.invalid',
}
const profiles: BrowserProfile[] = [
  ['research', '资料检索', 'blue', 0],
  ['writing', '写作工作台', 'purple', 30],
  ['learning', '在线学习', 'cyan', 75],
  ['daily', '日常浏览', 'green', 140],
  ['reading', '阅读收藏', 'coral', 380],
  ['experiment', '灵感实验室', 'red', 1440],
].map(([id, displayName, colorKey, minutes]) => ({
  id, displayName, colorKey, type: 'persistent', createdAt: now - 7 * 86_400_000,
  lastUsedAt: now - Number(minutes) * 60_000, userDataDir: 'C:/Preview/' + id,
})) as BrowserProfile[]
const statuses: Record<string, BrowserStatus> = { research: 'running', writing: 'running' }
const profileListeners = new Set<(payload: { profileId: string; status: BrowserStatus }) => void>()
const closeListeners = new Set<(state: WindowClosePromptState) => void>()
let closePrompt: WindowClosePromptState = null
let profileSequence = 0
let maximized = false
let settings: LauncherSettings = {
  launch: { windowWidth: 1280, windowHeight: 820, startUrl: 'chrome://newtab', concurrencyLimit: 3,
    staggerMs: 400, profileType: 'persistent', proxyMode: 'none', language: 'zh-CN', zoom: 100 },
  behavior: { closeAction: 'ask', exitWithBrowsers: 'ask', openAtLogin: false, downloadDir: '' },
  logs: { retentionDays: 3, maxEntries: 5000, minLevel: 'info', captureLlmRequests: true,
    captureLlmResponses: false, defaultExportFormat: 'json' },
  localUser: { displayName: '问学体验者', colorKey: 'purple' },
}
let logs: LauncherLogEntry[] = [
  ['system', '浏览器已就绪，工作空间已恢复', 'info'],
  ['tabs', '已打开 3 个资料标签页', 'info'],
  ['agent', '开始整理选中的公开资料', 'info'],
  ['page', '页面内容读取完成', 'info'],
  ['llm', '模型调用完成 · 2,840 tokens', 'info'],
  ['page', '页面仍在加载，等待内容就绪', 'warn'],
  ['agent', '资料摘要整理完成', 'info'],
  ['config', '浏览器偏好设置已更新', 'info'],
].map(([source, message, level], index) => ({
  id: index + 1, ts: now - (9 - index) * 60_000, source, message, level,
  context: 'sidepanel', browserId: index % 2 ? 'writing' : 'research',
  data: { preview: true, durationMs: 480 + index * 120 },
})) as LauncherLogEntry[]
const bucket = (key: string, label: string, inputTokens: number, outputTokens: number) => ({
  key, label, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
  estimatedCostCny: inputTokens * 0.000002 + outputTokens * 0.000004,
})
const totals = bucket('total', '全部', 82400, 18600)
const tokens: TokenUsageSummary = {
  totalInputTokens: totals.inputTokens, totalOutputTokens: totals.outputTokens,
  totalTokens: totals.totalTokens, estimatedCostCny: totals.estimatedCostCny,
  byBrowser: [bucket('research', '资料检索', 51000, 11200), bucket('writing', '写作工作台', 31400, 7400)],
  byModel: [bucket('qwen-plus', 'qwen-plus', 82400, 18600)],
  daily: [bucket('2026-09-27', '09-27', 19200, 4200), bucket('2026-09-28', '09-28', 29200, 6800), bucket('2026-09-29', '09-29', 34000, 7600)],
  recent: [0, 1, 2, 3].map(index => ({ id: 'usage-' + index, ts: now - index * 360000,
    browserId: index % 2 ? 'writing' : 'research', model: 'qwen-plus', inputTokens: 2200,
    outputTokens: 640, totalTokens: 2840, estimatedCostCny: 0.00696 })),
}
const setStatus = async (profileId: string, status: BrowserStatus) => {
  statuses[profileId] = status
  profileListeners.forEach(listener => listener({ profileId, status }))
  return { ok: true }
}
const createProfile = (displayName = '新的浏览器', colorKey: BrowserProfile['colorKey'] = 'blue') => {
  const profile: BrowserProfile = { id: 'preview-' + ++profileSequence, displayName, colorKey,
    type: 'persistent', createdAt: Date.now(), lastUsedAt: null, userDataDir: 'C:/Preview' }
  profiles.push(profile)
  return { ok: true, profile: copy(profile) }
}
const platform = new URLSearchParams(location.search).get('platform') === 'macos' ? 'darwin' : 'win32'
const shellInfo = () => ({ platform, frameless: platform !== 'darwin', hasSystemTrafficLights: platform === 'darwin', isMaximized: maximized })
const close = async () => {
  closePrompt = { requestId: 'preview-close', kind: 'confirm' }
  closeListeners.forEach(listener => listener(closePrompt))
  return { ok: true }
}
export const bridge = {
  browser: {
    launch: async () => setStatus(profiles[0].id, 'running'),
    launchProfile: async (id: string) => setStatus(id, 'running'),
    stopProfile: async (id: string) => setStatus(id, 'idle'),
    listProfiles: async () => copy(profiles),
    addProfile: async () => createProfile(),
    renameProfile: async (id: string, displayName: string) => {
      const profile = profiles.find(item => item.id === id)!
      profile.displayName = displayName
      return { ok: true, profile: copy(profile) }
    },
    duplicateProfile: async (id: string) => {
      const profile = profiles.find(item => item.id === id)!
      return createProfile(profile.displayName + ' 副本', profile.colorKey)
    },
    removeProfile: async (id: string) => { profiles.splice(profiles.findIndex(item => item.id === id), 1); return { ok: true } },
    openProfileFolder: async () => { notice('示例画像保存在内存中，未打开本机目录。'); return { ok: true } },
    getStatus: async () => 'running' as const,
    getStatuses: async () => copy(statuses),
    onStatusChange: () => () => {},
    onProfileStatusChange: (listener: (payload: { profileId: string; status: BrowserStatus }) => void) => {
      profileListeners.add(listener); return () => { profileListeners.delete(listener) }
    },
  },
  logs: { query: async () => copy(logs), clear: async () => { logs = []; return { ok: true } } },
  settings: {
    get: async () => copy(settings),
    update: async (patch: Partial<{ [K in keyof LauncherSettings]: Partial<LauncherSettings[K]> }>) => {
      settings = { launch: { ...settings.launch, ...patch.launch }, behavior: { ...settings.behavior, ...patch.behavior },
        logs: { ...settings.logs, ...patch.logs }, localUser: { ...settings.localUser, ...patch.localUser } }
      return { ok: true, settings: copy(settings) }
    },
  },
  tokens: { getSummary: async () => copy(tokens) },
  auth: { setSession: ok, getSession: async () => ({ ok: true, session: { userId: session.userId,
    expiresAt: session.expiresAt, gatewayBaseUrl: session.gatewayBaseUrl } }),
    prepareSignOut: ok, cancelSignOut: ok, clearSession: ok },
  updates: {
    getState: async () => ({ phase: 'idle' as const }),
    check: async () => { notice('预览不连接更新服务。'); return { ok: true, state: { phase: 'idle' as const } } },
    download: async () => ({ ok: true, state: { phase: 'idle' as const } }),
    openInstaller: async () => ({ ok: true, state: { phase: 'idle' as const } }),
    onStateChange: () => () => {},
  },
  app: {
    getVersions: async () => ({ app: '0.0.1-beta', browser: '138.0.7204.49', extension: '0.1.0' }),
    getShellInfo: async () => shellInfo(),
    openLogs: async () => { notice('预览未打开本机日志目录。'); return { ok: true } },
    openExternal: async () => { notice('预览未打开外部链接。'); return { ok: true } },
    quit: close,
    minimizeWindow: async () => { notice('最小化操作已模拟，预览保持可见。'); return { ok: true } },
    toggleMaximizeWindow: async () => { maximized = !maximized; notice(maximized ? '已模拟最大化状态。' : '已模拟还原状态。'); return { ok: true } },
    requestClose: close,
    getClosePrompt: async () => closePrompt,
    respondToClosePrompt: async (_id: string, choice: string) => {
      closePrompt = null
      closeListeners.forEach(listener => listener(null))
      if (choice !== 'cancel') notice('关闭操作已模拟，未关闭真实窗口或浏览器。')
      return { ok: true }
    },
    onClosePromptChange: (listener: (state: WindowClosePromptState) => void) => {
      closeListeners.add(listener); return () => { closeListeners.delete(listener) }
    },
  },
} satisfies Window['wenxue']
`

const moduleSources = {
	cloudbase: `
import { session, notice } from '${fixtures}'
export const getLauncherSession = async () => ({ ...session })
export const refreshLauncherSession = getLauncherSession
export const toPublicUser = ({ accessToken, refreshToken, ...user }) => user
export const readCloudBaseErrorMessage = (error, fallback) => error instanceof Error ? error.message : fallback
export const signOutLauncher = async () => { throw new Error('当前是独立布局预览；未执行账号退出。') }
export const updateLauncherProfile = async ({ nickname, avatar }) => {
  session.nickname = nickname
  if (avatar) session.avatarUrl = URL.createObjectURL(avatar)
  notice('示例资料只在本次预览内更新。')
  return toPublicUser(session)
}
`,
	DesktopAnnouncementService: `
export class DesktopAnnouncementService {
  subscribe(listener) { listener({ current: null, error: null }); return () => {} }
  async start() {}
  async resume() {}
  async acknowledge() {}
  stop() {}
}
`,
	DesktopReleaseSignalService: `
export class DesktopReleaseSignalService { start() {} stop() {} }
`,
	EmailAuthScreen: `
import { createElement } from 'react'
export function EmailAuthScreen() {
  return createElement('main', { className: 'auth-shell' }, '布局预览不连接真实账号。刷新页面恢复示例工作台。')
}
`,
}

const appSource = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '/src/App.tsx'
import '@wenxue/client-operations/styles.css'
import '/src/account-settings.css'
import '/src/BrowserPage.css'
import '/src/index.css'
import { bridge, notice } from '${fixtures}'
window.wenxue = bridge
document.addEventListener('click', event => {
  if (event.target instanceof Element && event.target.closest('a[download]')) {
    event.preventDefault()
    notice('导出已模拟，预览不会保存文件。')
  }
}, true)
createRoot(document.getElementById('root')).render(createElement(App))
`

const wallpaper = `
radial-gradient(ellipse at 18% 80%, #c3d7fa 0%, transparent 48%),
radial-gradient(ellipse at 90% 12%, #c4dfea 0%, transparent 50%),
linear-gradient(135deg, #dce5f4 5%, #c9d5e7 44%, #ece5ef 100%)`

function previewHtml() {
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>问学 · Windows 布局预览</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; padding: 26px 24px 40px; color: #344154; font: 13px system-ui, sans-serif; background: ${wallpaper}; }
.preview-toolbar { max-width: 1120px; margin: 0 auto 18px; display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.preview-badge { font-weight: 600; font-size: 12px; letter-spacing: .02em; }
.preview-controls { display: flex; align-items: center; gap: 8px; }
select, button { color: inherit; font: inherit; padding: 7px 10px; background: #ffffff85; border: 1px solid #ffffffa8; border-radius: 8px; }
button { cursor: pointer; }
.preview-stage { margin: 0 auto; }
.preview-window { display: block; transform-origin: top left; width: 1120px; height: 720px; margin: 0 auto; border: 0; outline: 1px solid #ffffffb8; border-radius: 9px; box-shadow: 0 24px 70px #3143602b, 0 2px 8px #263e621c; overflow: hidden; }
.preview-note { max-width: 1120px; margin: 16px auto 0; color: #526279; font-size: 12px; line-height: 1.8; }
#preview-notice { min-height: 22px; margin-top: 6px; color: #344154; }
</style></head>
<body>
<header class="preview-toolbar">
  <span class="preview-badge" id="preview-badge">Windows 布局预览 · 毛玻璃示意 · 示例数据</span>
  <div class="preview-controls">
    <select id="preview-platform" aria-label="预览平台"><option value="windows">Windows 11</option><option value="macos">macOS 对照</option></select>
    <select id="preview-size" aria-label="窗口尺寸"><option value="1120x720">1120 × 720</option><option value="920x600">920 × 600</option></select>
    <button id="preview-reset" type="button">重置预览</button>
  </div>
</header>
<div class="preview-stage" id="preview-stage"><iframe class="preview-window" id="preview-window" title="问学桌面布局预览" src="/app?platform=windows" sandbox="allow-scripts allow-same-origin"></iframe></div>
<footer class="preview-note">可切换浏览器、日志、Tokens 和设置，体验搜索与菜单。浏览器中仅示意毛玻璃，Windows Acrylic 需在实机确认。<div id="preview-notice" role="status" aria-live="polite"></div></footer>
<script>
const frame = document.getElementById('preview-window')
const platform = document.getElementById('preview-platform')
const size = document.getElementById('preview-size')
const query = new URLSearchParams(location.search)
if (query.get('size') === '920x600') size.value = '920x600'
if (query.get('platform') === 'macos') platform.value = 'macos'
function resize() {
  const [width, height] = size.value.split('x').map(Number)
  const scale = Math.min(1, (document.documentElement.clientWidth - 48) / width)
  const stage = document.getElementById('preview-stage')
  stage.style.width = width * scale + 'px'
  stage.style.height = height * scale + 'px'
  frame.style.transform = 'scale(' + scale + ')'
  frame.style.width = width + 'px'
  frame.style.height = height + 'px'
}
function reset() {
  frame.src = '/app?platform=' + platform.value
  document.getElementById('preview-badge').textContent = (platform.value === 'macos' ? 'macOS 对照预览' : 'Windows 布局预览') + ' · 毛玻璃示意 · 示例数据'
  document.getElementById('preview-notice').textContent = ''
}
size.addEventListener('change', resize)
window.addEventListener('resize', resize)
platform.addEventListener('change', reset)
document.getElementById('preview-reset').addEventListener('click', reset)
window.addEventListener('message', event => {
  if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'windows-ui-preview') {
    document.getElementById('preview-notice').textContent = event.data.message
  }
})
resize()
reset()
</script></body></html>`
}

function appHtml(platform) {
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>问学 · 预览工作台</title>
<style>
body::before { content: ''; position: fixed; inset: 0; z-index: -1; background: ${wallpaper}; }
#root { background: rgb(247 250 255 / .74); backdrop-filter: blur(38px) saturate(1.2); }
${platform === 'macos' ? `body::after { content: ''; pointer-events: none; position: fixed; top: 20px; left: 10px; z-index: 2000; width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; box-shadow: 19px 0 #febc2e, 38px 0 #28c840; }` : ''}
</style></head><body><div id="root"></div><script type="module" src="/@id/${entry}"></script></body></html>`
}

const server = await createServer({
	configFile: false,
	root,
	appType: 'custom',
	define: { __WENXUE_UPDATE_CHANNEL__: JSON.stringify('stable') },
	resolve: { dedupe: ['react', 'react-dom'] },
	plugins: [
		{
			name: 'windows-ui-preview-fixtures',
			enforce: 'pre',
			resolveId(id, importer) {
				if (id === entry || id === fixtures) return `\0${id}`
				const name = id.replace(/^\.\//, '').replace(/\.tsx?$/, '')
				if (importer?.startsWith(root) && mockedModules.has(name)) return `\0${entry}/${name}`
			},
			async load(id) {
				if (id === `\0${entry}`) return appSource
				if (id === `\0${fixtures}`) {
					return (
						await transformWithEsbuild(fixtureSource, 'windows-preview-fixtures.ts', {
							loader: 'ts',
						})
					).code
				}
				if (id.startsWith(`\0${entry}/`)) return moduleSources[id.slice(entry.length + 2)]
			},
			configureServer(vite) {
				vite.middlewares.use(async (request, response, next) => {
					const url = new URL(request.url ?? '/', 'http://127.0.0.1:5199')
					if (url.pathname !== '/' && url.pathname !== '/app') return next()
					try {
						const html = await vite.transformIndexHtml(
							url.pathname,
							url.pathname === '/app' ? appHtml(url.searchParams.get('platform')) : previewHtml(),
						)
						response.setHeader('Content-Type', 'text/html; charset=utf-8')
						response.setHeader(
							'Content-Security-Policy',
							"connect-src 'self' ws://127.0.0.1:5199; img-src 'self' data: blob:; form-action 'none'",
						)
						response.end(html)
					} catch (error) {
						next(error)
					}
				})
			},
		},
		react(),
		tailwindcss(),
	],
	server: { host: '127.0.0.1', port: 5199, strictPort: true },
})
await server.listen()
server.printUrls()
