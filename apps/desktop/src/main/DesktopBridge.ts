import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserResources } from './BrowserResources'
import type { BrowserStatus, BrowserSupervisor } from './BrowserSupervisor'

export interface IpcMainLike {
	handle(channel: string, handler: (...args: unknown[]) => unknown): void
}

export interface AppVersions {
	app: string
	browser: string
	extension: string
}

export interface LaunchResult {
	ok: boolean
	error?: string
}

export interface DesktopBridgeOptions {
	ipcMain: IpcMainLike
	supervisor: Pick<BrowserSupervisor, 'launch' | 'status' | 'onStatusChange'>
	resources: BrowserResources
	getAppVersion: () => string
	sendStatus: (status: BrowserStatus) => void
}

export function registerDesktopBridge(options: DesktopBridgeOptions): () => void {
	options.ipcMain.handle('browser:launch', async (): Promise<LaunchResult> => {
		try {
			await options.supervisor.launch()
			return { ok: true }
		} catch (error) {
			return { ok: false, error: toUserSafeMessage(error) }
		}
	})

	options.ipcMain.handle('browser:getStatus', async (): Promise<BrowserStatus> => {
		return options.supervisor.status()
	})

	options.ipcMain.handle('app:getVersions', async (): Promise<AppVersions> => {
		return {
			app: options.getAppVersion(),
			browser: options.resources.browserVersion(),
			extension: readExtensionVersion(options.resources.extensionDir()),
		}
	})

	return options.supervisor.onStatusChange(options.sendStatus)
}

function readExtensionVersion(extensionDir: string): string {
	try {
		const manifestPath = path.join(extensionDir, 'manifest.json')
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
		if (typeof manifest.version === 'string' && manifest.version.length > 0) {
			return manifest.version
		}
	} catch {
		return 'unknown'
	}

	return 'unknown'
}

function toUserSafeMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message
	}
	if (typeof error === 'string' && error.length > 0) {
		return error
	}

	return 'Unknown launch error'
}
