export type BrowserStatus = 'idle' | 'launching' | 'running' | 'error'

export interface LaunchResult {
	ok: boolean
	error?: string
}

export type OpenLogsResult = LaunchResult

export interface AppVersions {
	app: string
	browser: string
	extension: string
}

declare global {
	interface Window {
		wenxue: {
			browser: {
				launch(): Promise<LaunchResult>
				getStatus(): Promise<BrowserStatus>
				onStatusChange(cb: (status: BrowserStatus) => void): () => void
			}
			app: {
				getVersions(): Promise<AppVersions>
				openLogs(): Promise<OpenLogsResult>
			}
		}
	}
}

export {}
