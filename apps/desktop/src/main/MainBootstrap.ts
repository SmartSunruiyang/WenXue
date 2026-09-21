import type {
	BrowserWindow,
	BrowserWindowConstructorOptions,
	Event as ElectronEvent,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createAppLogger, type AppLogger } from './AppLogger'
import { AppPaths } from './AppPaths'
import { BrowserProfileStore } from './BrowserProfileStore'
import { createBrowserResources } from './BrowserResources'
import { BrowserSupervisor } from './BrowserSupervisor'
import {
	registerDesktopBridge,
	type WindowCloseChoice,
	type WindowClosePromptState,
} from './DesktopBridge'
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
	requestConfirmation: () => Promise<Exclude<WindowCloseChoice, 'dismiss'>>
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

		const choice = await deps.requestConfirmation()
		if (choice === 'cancel') return 'prevented'
		if (choice === 'closeBrowsers') {
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

export function createWindowClosePrompt(
	sendState: (state: WindowClosePromptState) => void,
	isAvailable: () => boolean,
) {
	let state: WindowClosePromptState = null
	let pending: {
		promise: Promise<Exclude<WindowCloseChoice, 'dismiss'>>
		resolve: (choice: Exclude<WindowCloseChoice, 'dismiss'>) => void
	} | null = null

	const cancel = () => {
		const current = pending
		pending = null
		state = null
		current?.resolve('cancel')
	}

	return {
		getState: (): WindowClosePromptState => state,
		requestConfirmation: (): Promise<Exclude<WindowCloseChoice, 'dismiss'>> => {
			if (!isAvailable()) return Promise.resolve('cancel')
			if (pending) return pending.promise
			let resolve!: (choice: Exclude<WindowCloseChoice, 'dismiss'>) => void
			const promise = new Promise<Exclude<WindowCloseChoice, 'dismiss'>>((done) => {
				resolve = done
			})
			pending = { promise, resolve }
			state = { requestId: randomUUID(), kind: 'confirm' }
			try {
				sendState(state)
			} catch {
				cancel()
			}
			return promise
		},
		respond: (requestId: string, choice: WindowCloseChoice): boolean => {
			if (!state || state.requestId !== requestId) return false
			if (state.kind === 'error') {
				if (choice !== 'dismiss') return false
				state = null
				sendState(null)
				return true
			}
			if (choice === 'dismiss' || !pending) return false
			const current = pending
			pending = null
			state = null
			current.resolve(choice)
			sendState(null)
			return true
		},
		showFailure: () => {
			cancel()
			if (!isAvailable()) return
			state = { requestId: randomUUID(), kind: 'error' }
			sendState(state)
		},
		cancel,
	}
}

export async function startMainBootstrap(): Promise<void> {
	const electron = await import('electron')
	let currentWindow: BrowserWindow | undefined
	let closePrompt: ReturnType<typeof createWindowClosePrompt> | undefined
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
	if (process.platform === 'darwin') {
		electron.nativeTheme.themeSource = 'light'
	}

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
	const logger = createAppLogger(paths, logStore)
	const userSessionHandoff = new UserSessionHandoff(logger)
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
		getControlWindowWebContents: () =>
			currentWindow && !currentWindow.isDestroyed() ? currentWindow.webContents : undefined,
		getClosePrompt: () => closePrompt?.getState() ?? null,
		respondToClosePrompt: (requestId, choice) => closePrompt?.respond(requestId, choice) ?? false,
		sendStatus: (status) => currentWindow?.webContents.send('browser:status-changed', status),
		sendProfileStatus: (payload) =>
			currentWindow?.webContents.send('browser:profile-status-changed', payload),
		sendUpdateState: (state) => currentWindow?.webContents.send('updates:state-changed', state),
	})

	const createWindow = () => {
		const controlWindow = createControlWindow(electron, supervisor, settingsStore, logger, iconPath)
		currentWindow = controlWindow.window
		closePrompt = controlWindow.closePrompt
		currentWindow.on('closed', () => {
			if (currentWindow?.isDestroyed()) {
				currentWindow = undefined
				closePrompt = undefined
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

export function createControlWindow(
	electron: ElectronModule,
	supervisor: BrowserSupervisor,
	settingsStore: LauncherSettingsStore,
	logger: AppLogger,
	iconPath: string | undefined,
): { window: BrowserWindow; closePrompt: ReturnType<typeof createWindowClosePrompt> } {
	const win = new electron.BrowserWindow(
		buildControlWindowOptions({
			platform: process.platform,
			iconPath,
			preloadPath: path.join(__dirname, '../preload/index.js'),
		}),
	)
	let allowClose = false
	let resolvingClose = false
	let rendererReady = false
	let generation = 0
	const closePrompt = createWindowClosePrompt(
		(state) => win.webContents.send('app:close-prompt-changed', state),
		() => rendererReady && !win.isDestroyed() && !win.webContents.isDestroyed(),
	)
	const cancelClose = () => {
		generation += 1
		rendererReady = false
		closePrompt.cancel()
	}
	win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
		if (isMainFrame && !isInPlace) cancelClose()
	})
	win.webContents.on('did-finish-load', () => {
		rendererReady = true
	})
	win.webContents.on('render-process-gone', cancelClose)
	win.webContents.on('destroyed', cancelClose)
	win.on('closed', cancelClose)

	win.on('close', (event: ElectronEvent) => {
		if (allowClose || !supervisor.hasActiveProfiles()) {
			return
		}

		event.preventDefault()
		if (resolvingClose) return
		resolvingClose = true
		const closeGeneration = generation
		void handleBrowserRunningClose({
			hasActiveProfiles: () => supervisor.hasActiveProfiles(),
			exitWithBrowsers: async () => (await settingsStore.get()).behavior.exitWithBrowsers,
			requestConfirmation: () =>
				closeGeneration === generation
					? closePrompt.requestConfirmation()
					: Promise.resolve('cancel'),
			requestShutdown: async () => {
				if (closeGeneration === generation) await supervisor.requestShutdown()
			},
			onError: (error) => {
				logger.log(
					'MainBootstrap',
					'error',
					`failed to close active browsers: ${errorMessage(error)}`,
				)
				if (closeGeneration === generation) closePrompt.showFailure()
			},
		})
			.then((decision) => {
				if (decision === 'allow' && closeGeneration === generation && !win.isDestroyed()) {
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

	return { window: win, closePrompt }
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
		titleBarStyle: input.platform === 'darwin' ? 'hiddenInset' : 'hidden',
		...(input.platform === 'darwin'
			? {
					trafficLightPosition: { x: 10, y: 20 },
					backgroundColor: '#00000000',
					vibrancy: 'under-window',
					visualEffectState: 'active',
				}
			: {}),
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
