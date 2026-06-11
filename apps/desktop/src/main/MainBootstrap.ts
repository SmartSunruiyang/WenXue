import { existsSync } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, Event as ElectronEvent } from 'electron'
import { createAppLogger } from './AppLogger'
import { AppPaths } from './AppPaths'
import { BrowserSupervisor, type BrowserStatus } from './BrowserSupervisor'
import { createBrowserResources } from './BrowserResources'
import { registerDesktopBridge } from './DesktopBridge'
import { ProfileStore } from './ProfileStore'

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

	const logger = createAppLogger(paths)
	const resources = createBrowserResources({
		repoRoot: resolveRepoRoot(electron.app.getAppPath()),
		isPackaged: electron.app.isPackaged,
		resourcesPath: process.resourcesPath,
	})
	const profiles = new ProfileStore(paths)
	const supervisor = new BrowserSupervisor({ resources, profiles, logger })
	let currentWindow: BrowserWindow | undefined

	registerDesktopBridge({
		ipcMain: electron.ipcMain,
		supervisor,
		resources,
		getAppVersion: () => electron.app.getVersion(),
		sendStatus: (status) => currentWindow?.webContents.send('browser:status-changed', status),
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
	const win = new electron.BrowserWindow({
		width: 480,
		height: 360,
		resizable: true,
		maximizable: false,
		webPreferences: {
			preload: path.join(__dirname, '../preload/index.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	})
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
