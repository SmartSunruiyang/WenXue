import type {
	BrowserWindow,
	BrowserWindowConstructorOptions,
	Event as ElectronEvent,
} from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createAppLogger } from './AppLogger'
import { AppPaths } from './AppPaths'
import { BrowserProfileStore } from './BrowserProfileStore'
import { createBrowserResources } from './BrowserResources'
import { BrowserSupervisor, type BrowserStatus } from './BrowserSupervisor'
import { ExtensionSessionHandoff } from './ExtensionSessionHandoff'
import { LauncherAuthSession } from './LauncherAuthSession'
import { registerDesktopBridge } from './DesktopBridge'
import { LauncherLogStore } from './LauncherLogStore'
import { LauncherSettingsStore, type LauncherSettings } from './LauncherSettingsStore'
import { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import { ProfileStore } from './ProfileStore'
import { TokenUsageStore } from './TokenUsageStore'
import { UsageCloudClient } from './UsageCloudClient'

type ElectronModule = typeof import('electron')
export type CloseDecision = 'allow' | 'prevented'
type ExitWithBrowsers = LauncherSettings['behavior']['exitWithBrowsers']

export interface ClosePromptDeps {
	status: () => BrowserStatus
	exitWithBrowsers?: () => Promise<ExitWithBrowsers> | ExitWithBrowsers
	showMessageBox: () => Promise<{ response: number }>
	requestShutdown: () => Promise<void>
}

export async function handleBrowserRunningClose(deps: ClosePromptDeps): Promise<CloseDecision> {
	const status = deps.status()
	if (status === 'idle' || status === 'error') {
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
}

export async function startMainBootstrap(): Promise<void> {
	const electron = await import('electron')
	await electron.app.whenReady()

	const paths = new AppPaths(electron.app.getPath('userData'))
	await paths.ensure()
	const iconPath = path.join(__dirname, '../../resources/icon.png')
	electron.app.setName('问学')
	if (process.platform === 'win32') {
		electron.app.setAppUserModelId('com.wenxue.launcher')
	}
	if (process.platform === 'darwin') {
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
	const authSession = new LauncherAuthSession(paths)
	const usageCloudClient = new UsageCloudClient(paths, authSession)
	const extensionSessionHandoff = new ExtensionSessionHandoff()
	const logger = createAppLogger(paths, logStore)
	const supervisor = new BrowserSupervisor({ resources, profiles, logger })
	let currentWindow: BrowserWindow | undefined

	registerDesktopBridge({
		ipcMain: electron.ipcMain,
		supervisor,
		profileStore,
		logStore,
		settingsStore,
		telemetryIngest,
		tokenUsageStore,
		usageCloudClient,
		authSession,
		extensionSessionHandoff,
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
		openPath: (targetPath) => electron.shell.openPath(targetPath),
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
	})

	const createWindow = () => {
		currentWindow = createControlWindow(electron, supervisor, settingsStore, iconPath)
		currentWindow.on('closed', () => {
			if (currentWindow?.isDestroyed()) {
				currentWindow = undefined
			}
		})
	}

	createWindow()

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
	iconPath: string,
): BrowserWindow {
	const win = new electron.BrowserWindow(
		buildControlWindowOptions({
			platform: process.platform,
			iconPath,
			preloadPath: path.join(__dirname, '../preload/index.js'),
		}),
	)
	let allowClose = false

	win.on('close', (event: ElectronEvent) => {
		if (allowClose || supervisor.status() === 'idle' || supervisor.status() === 'error') {
			return
		}

		event.preventDefault()
		void handleBrowserRunningClose({
			status: () => supervisor.status(),
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
		}).then((decision) => {
			if (decision === 'allow' && !win.isDestroyed()) {
				allowClose = true
				win.close()
			}
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
	iconPath: string
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
		icon: input.iconPath,
		webPreferences: {
			preload: input.preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	}
}
