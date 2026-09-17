import type {
	BrowserWindow,
	BrowserWindowConstructorOptions,
	Event as ElectronEvent,
} from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createAppLogger, type AppLogger } from './AppLogger'
import { AppPaths } from './AppPaths'
import { BrowserProfileStore } from './BrowserProfileStore'
import { createBrowserResources } from './BrowserResources'
import { BrowserSupervisor } from './BrowserSupervisor'
import { registerDesktopBridge } from './DesktopBridge'
import { DesktopUpdateService } from './DesktopUpdateService'
import { LauncherLogStore } from './LauncherLogStore'
import { LauncherSettingsStore, type LauncherSettings } from './LauncherSettingsStore'
import { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import { ProfileStore } from './ProfileStore'
import { TokenUsageStore } from './TokenUsageStore'
import { UsageCloudClient } from './UsageCloudClient'
import { UserSessionHandoff } from './UserSessionHandoff'
import { UserSessionStore, WENXUE_GATEWAY_BASE_URL } from './UserSessionStore'

declare const __WENXUE_RELEASE_ED25519_PUBLIC_KEY__: string
declare const __WENXUE_UPDATE_CHANNEL__: string

type ElectronModule = typeof import('electron')
export type CloseDecision = 'allow' | 'prevented'
type ExitWithBrowsers = LauncherSettings['behavior']['exitWithBrowsers']

const DESKTOP_ICON_FILES: Record<'darwin' | 'win32' | 'fallback', string> = {
	darwin: 'app-icon-macos-1024.png',
	win32: 'app-icon-windows.ico',
	fallback: 'app-icon-windows-256.png',
}

export interface ClosePromptDeps {
	hasActiveProfiles: () => boolean
	exitWithBrowsers?: () => Promise<ExitWithBrowsers> | ExitWithBrowsers
	showMessageBox: () => Promise<{ response: number }>
	requestShutdown: () => Promise<void>
	onError?: (error: unknown) => void
}

export async function handleBrowserRunningClose(deps: ClosePromptDeps): Promise<CloseDecision> {
	try {
		if (!deps.hasActiveProfiles()) {
			return 'allow'
		}

		const exitWithBrowsers = (await deps.exitWithBrowsers?.()) ?? 'ask'
		if (exitWithBrowsers === 'launcherOnly') {
			return 'allow'
		}
		if (exitWithBrowsers === 'closeBrowsers') {
			await deps.requestShutdown()
			return 'allow'
		}

		const { response } = await deps.showMessageBox()
		if (response === 1) {
			await deps.requestShutdown()
		}

		return 'allow'
	} catch (error) {
		try {
			deps.onError?.(error)
		} catch {
			// The close boundary must remain fail-closed even if error reporting itself fails.
		}
		return 'prevented'
	}
}

export async function startMainBootstrap(): Promise<void> {
	const electron = await import('electron')
	let currentWindow: BrowserWindow | undefined
	if (!electron.app.requestSingleInstanceLock()) {
		electron.app.quit()
		return
	}
	electron.app.on('second-instance', () => {
		if (!currentWindow || currentWindow.isDestroyed()) return
		if (currentWindow.isMinimized()) currentWindow.restore()
		currentWindow.show()
		currentWindow.focus()
	})
	await electron.app.whenReady()

	const paths = new AppPaths(electron.app.getPath('userData'))
	await paths.ensure()
	const iconPath = electron.app.isPackaged
		? undefined
		: path.join(__dirname, '../../resources', desktopIconFile(process.platform))
	electron.app.setName('问学')
	if (process.platform === 'win32') {
		electron.app.setAppUserModelId('com.wenxue.launcher')
	}
	if (process.platform === 'darwin' && iconPath) {
		electron.app.dock?.setIcon(iconPath)
	}

	const resources = createBrowserResources({
		repoRoot: resolveRepoRoot(electron.app.getAppPath()),
		isPackaged: electron.app.isPackaged,
		resourcesPath: process.resourcesPath,
	})
	const profiles = new ProfileStore(paths)
	const profileStore = new BrowserProfileStore(paths, profiles)
	const settingsStore = new LauncherSettingsStore(paths)
	const logStore = new LauncherLogStore(paths, settingsStore)
	const tokenUsageStore = new TokenUsageStore(paths)
	const telemetryIngest = new LauncherTelemetryIngest(logStore, tokenUsageStore)
	const userSessionStore = new UserSessionStore()
	const usageCloudClient = new UsageCloudClient(paths, userSessionStore)
	const userSessionHandoff = new UserSessionHandoff()
	const logger = createAppLogger(paths, logStore)
	const supervisor = new BrowserSupervisor({ resources, profiles, logger })
	const updateService = new DesktopUpdateService({
		paths,
		openPath: (targetPath) => electron.shell.openPath(targetPath),
		isPackaged: electron.app.isPackaged,
		currentVersion: electron.app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		channel: updateChannel(__WENXUE_UPDATE_CHANNEL__),
		policyBaseUrl: WENXUE_GATEWAY_BASE_URL,
		manifestPublicKey: __WENXUE_RELEASE_ED25519_PUBLIC_KEY__,
		onError: (message) => logger.log('DesktopUpdateService', 'warn', message),
	})

	registerDesktopBridge({
		ipcMain: electron.ipcMain,
		supervisor,
		profileStore,
		logStore,
		settingsStore,
		telemetryIngest,
		tokenUsageStore,
		usageCloudClient,
		userSessionStore,
		userSessionHandoff,
		updateService,
		resources,
		getAppVersion: () => electron.app.getVersion(),
		getShellInfo: () => ({
			platform: process.platform,
			frameless: process.platform !== 'darwin',
			hasSystemTrafficLights: process.platform === 'darwin',
			isMaximized: currentWindow?.isMaximized() ?? false,
		}),
		openLogs: async () => {
			const message = await electron.shell.openPath(paths.logsDir())
			if (message.length > 0) {
				throw new Error(message)
			}
		},
		openExternal: async (url) => {
			await electron.shell.openExternal(url)
		},
		openPath: (targetPath) => electron.shell.openPath(targetPath),
		quitApp: async () => {
			await supervisor.requestShutdown()
			electron.app.quit()
		},
		minimizeWindow: () => currentWindow?.minimize(),
		toggleMaximizeWindow: () => {
			if (!currentWindow) return
			if (currentWindow.isMaximized()) {
				currentWindow.unmaximize()
			} else {
				currentWindow.maximize()
			}
		},
		requestClose: () => currentWindow?.close(),
		sendStatus: (status) => currentWindow?.webContents.send('browser:status-changed', status),
		sendProfileStatus: (payload) =>
			currentWindow?.webContents.send('browser:profile-status-changed', payload),
		sendUpdateState: (state) => currentWindow?.webContents.send('updates:state-changed', state),
	})

	const createWindow = () => {
		currentWindow = createControlWindow(electron, supervisor, settingsStore, logger, iconPath)
		currentWindow.on('closed', () => {
			if (currentWindow?.isDestroyed()) {
				currentWindow = undefined
			}
		})
	}

	createWindow()
	updateService.start()
	electron.app.on('before-quit', () => updateService.stop())

	electron.app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			electron.app.quit()
		}
	})

	electron.app.on('activate', () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) {
			createWindow()
		}
	})
}

export function resolveRepoRoot(start: string): string {
	let current = start
	while (true) {
		if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
			return current
		}

		const parent = path.dirname(current)
		if (parent === current) {
			return start
		}
		current = parent
	}
}

function createControlWindow(
	electron: ElectronModule,
	supervisor: BrowserSupervisor,
	settingsStore: LauncherSettingsStore,
	logger: AppLogger,
	iconPath: string | undefined,
): BrowserWindow {
	const win = new electron.BrowserWindow(
		buildControlWindowOptions({
			platform: process.platform,
			iconPath,
			preloadPath: path.join(__dirname, '../preload/index.js'),
		}),
	)
	let allowClose = false
	let resolvingClose = false

	win.on('close', (event: ElectronEvent) => {
		if (allowClose || !supervisor.hasActiveProfiles()) {
			return
		}

		event.preventDefault()
		if (resolvingClose) return
		resolvingClose = true
		void handleBrowserRunningClose({
			hasActiveProfiles: () => supervisor.hasActiveProfiles(),
			exitWithBrowsers: async () => (await settingsStore.get()).behavior.exitWithBrowsers,
			showMessageBox: () =>
				electron.dialog.showMessageBox(win, {
					type: 'question',
					title: '浏览器仍在运行',
					message: '浏览器仍在运行',
					detail: '可以只退出问学，也可以一并关闭当前问学浏览器。',
					buttons: ['仅退出问学', '一并关闭浏览器'],
					defaultId: 0,
					cancelId: 0,
				}),
			requestShutdown: () => supervisor.requestShutdown(),
			onError: (error) => {
				logger.log(
					'MainBootstrap',
					'error',
					`failed to close active browsers: ${errorMessage(error)}`,
				)
				if (win.isDestroyed()) return
				void electron.dialog
					.showMessageBox(win, {
						type: 'error',
						title: '浏览器未能安全关闭',
						message: '问学暂未退出',
						detail: '仍有浏览器进程未能安全关闭，请稍后重试。',
						buttons: ['知道了'],
					})
					.catch((dialogError) => {
						logger.log(
							'MainBootstrap',
							'error',
							`failed to show close error: ${errorMessage(dialogError)}`,
						)
					})
			},
		})
			.then((decision) => {
				if (decision === 'allow' && !win.isDestroyed()) {
					allowClose = true
					win.close()
				}
			})
			.catch((error: unknown) => {
				logger.log(
					'MainBootstrap',
					'error',
					error instanceof Error ? error.message : 'Failed to resolve the close request',
				)
			})
			.finally(() => {
				resolvingClose = false
			})
	})

	if (process.env.ELECTRON_RENDERER_URL) {
		void win.loadURL(process.env.ELECTRON_RENDERER_URL)
	} else {
		void win.loadFile(path.join(__dirname, '../renderer/index.html'))
	}

	return win
}

export function buildControlWindowOptions(input: {
	platform: NodeJS.Platform
	iconPath?: string
	preloadPath: string
}): BrowserWindowConstructorOptions {
	return {
		title: '问学',
		width: 1120,
		height: 720,
		minWidth: 920,
		minHeight: 600,
		resizable: true,
		maximizable: true,
		frame: input.platform === 'darwin',
		autoHideMenuBar: true,
		trafficLightPosition: input.platform === 'darwin' ? { x: 18, y: 18 } : undefined,
		titleBarStyle: input.platform === 'darwin' ? 'hiddenInset' : 'hidden',
		...(input.iconPath ? { icon: input.iconPath } : {}),
		webPreferences: {
			preload: input.preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	}
}

export function desktopIconFile(platform: NodeJS.Platform): string {
	if (platform === 'darwin' || platform === 'win32') {
		return DESKTOP_ICON_FILES[platform]
	}
	return DESKTOP_ICON_FILES.fallback
}

export function updateChannel(value: string): 'dev' | 'beta' | 'stable' {
	if (value === 'dev' || value === 'beta' || value === 'stable') return value
	return 'stable'
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : String(error)
}
