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
import { registerDesktopBridge } from './DesktopBridge'
import { LauncherLogStore } from './LauncherLogStore'
import { LauncherSettingsStore } from './LauncherSettingsStore'
import { LauncherTelemetryIngest } from './LauncherTelemetryIngest'
import { ProfileStore } from './ProfileStore'
import { TokenUsageStore } from './TokenUsageStore'

type ElectronModule = typeof import('electron')
export type CloseDecision = 'allow' | 'prevented'

export interface ClosePromptDeps {
	status: () => BrowserStatus
	showMessageBox: () => Promise<{ response: number }>
	requestShutdown: () => Promise<void>
}

export async function handleBrowserRunningClose(deps: ClosePromptDeps): Promise<CloseDecision> {
	const status = deps.status()
	if (status === 'idle' || status === 'error') {
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
		resources,
		getAppVersion: () => electron.app.getVersion(),
		openLogs: async () => {
			const message = await electron.shell.openPath(paths.logsDir())
			if (message.length > 0) {
				throw new Error(message)
			}
		},
		openPath: (targetPath) => electron.shell.openPath(targetPath),
		sendStatus: (status) => currentWindow?.webContents.send('browser:status-changed', status),
		sendProfileStatus: (payload) =>
			currentWindow?.webContents.send('browser:profile-status-changed', payload),
	})

	const createWindow = () => {
		currentWindow = createControlWindow(electron, supervisor)
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
): BrowserWindow {
	const win = new electron.BrowserWindow(
		buildControlWindowOptions({
			platform: process.platform,
			iconPath: path.join(__dirname, '../../resources/icon.png'),
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
		width: 1120,
		height: 720,
		minWidth: 920,
		minHeight: 600,
		resizable: true,
		maximizable: true,
		titleBarStyle: input.platform === 'darwin' ? 'hiddenInset' : 'hidden',
		titleBarOverlay:
			input.platform === 'win32'
				? {
						color: '#FAFAFA',
						symbolColor: '#060606',
						height: 32,
					}
				: undefined,
		icon: input.iconPath,
		webPreferences: {
			preload: input.preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	}
}
