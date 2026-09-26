import type { UpdateState } from '@wenxue/client-operations'

export type BrowserStatus = 'idle' | 'launching' | 'running' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface BrowserProfile {
	id: string
	displayName: string
	type: 'persistent'
	colorKey: 'blue' | 'purple' | 'cyan' | 'green' | 'coral' | 'red'
	createdAt: number
	lastUsedAt: number | null
	userDataDir: string
}

export interface LaunchResult {
	ok: boolean
	error?: string
}

export interface ProfileMutationResult extends LaunchResult {
	profile?: BrowserProfile
}

export type WindowCloseChoice = 'cancel' | 'launcherOnly' | 'closeBrowsers' | 'dismiss'

export type WindowClosePurpose = 'close' | 'update-restart' | 'update-quit'

export type WindowClosePromptState = {
	requestId: string
	kind: 'confirm' | 'error'
	purpose?: WindowClosePurpose
} | null

export type OpenLogsResult = LaunchResult

export interface AppVersions {
	app: string
	browser: string
	extension: string
}

export interface AppShellInfo {
	platform: string
	frameless: boolean
	hasSystemTrafficLights: boolean
	isMaximized: boolean
}

export interface UserSession {
	userId: string
	accessToken: string
	refreshToken: string
	expiresAt: number
	gatewayBaseUrl: string
}

export interface PublicUserSession {
	userId: string
	expiresAt: number
	gatewayBaseUrl: string
}

export interface UserSessionResult extends LaunchResult {
	session?: PublicUserSession
}

export interface UpdateMutationResult extends LaunchResult {
	state: UpdateState
}

export interface LauncherLogEntry {
	id: number
	ts: number
	level: LogLevel
	source: 'agent' | 'llm' | 'tabs' | 'page' | 'chaoxing' | 'config' | 'system'
	context: 'background' | 'sidepanel' | 'newtab' | 'hub' | 'content'
	browserId: string
	message: string
	data?: unknown
}

export interface LauncherLogFilter {
	levels?: LogLevel[]
	sources?: LauncherLogEntry['source'][]
	browserIds?: string[]
	sinceTs?: number
	untilTs?: number
	text?: string
	limit?: number
}

export interface LauncherSettings {
	launch: {
		windowWidth: number
		windowHeight: number
		startUrl: string
		concurrencyLimit: number
		staggerMs: number
		profileType: 'persistent' | 'incognito'
		proxyMode: 'none' | 'system' | 'custom'
		language: string
		zoom: number
	}
	behavior: {
		closeAction: 'ask' | 'minimizeToTray' | 'quit'
		exitWithBrowsers: 'ask' | 'launcherOnly' | 'closeBrowsers'
		openAtLogin: boolean
		downloadDir: string
	}
	logs: {
		retentionDays: number
		maxEntries: number
		minLevel: LogLevel
		captureLlmRequests: boolean
		captureLlmResponses: boolean
		defaultExportFormat: 'json' | 'ndjson' | 'text'
	}
	localUser: {
		displayName: string
		colorKey: string
	}
}

export type LauncherSettingsPatch = Partial<{
	[K in keyof LauncherSettings]: Partial<LauncherSettings[K]>
}>

export interface SettingsMutationResult extends LaunchResult {
	settings?: LauncherSettings
}

export interface TokenUsageRecord {
	id: string
	ts: number
	browserId: string
	model: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
	estimatedCostCny: number
}

export interface TokenUsageBucket {
	key: string
	label: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
	estimatedCostCny: number
}

export interface TokenUsageSummary {
	totalInputTokens: number
	totalOutputTokens: number
	totalTokens: number
	estimatedCostCny: number
	byBrowser: TokenUsageBucket[]
	byModel: TokenUsageBucket[]
	daily: TokenUsageBucket[]
	recent: TokenUsageRecord[]
}

declare global {
	interface Window {
		wenxue: {
			browser: {
				launch(): Promise<LaunchResult>
				launchProfile(profileId: string): Promise<LaunchResult>
				stopProfile(profileId: string): Promise<LaunchResult>
				listProfiles(): Promise<BrowserProfile[]>
				addProfile(): Promise<ProfileMutationResult>
				renameProfile(profileId: string, displayName: string): Promise<ProfileMutationResult>
				duplicateProfile(profileId: string): Promise<ProfileMutationResult>
				removeProfile(profileId: string): Promise<ProfileMutationResult>
				openProfileFolder(profileId: string): Promise<LaunchResult>
				getStatus(): Promise<BrowserStatus>
				getStatuses(): Promise<Record<string, BrowserStatus>>
				onStatusChange(cb: (status: BrowserStatus) => void): () => void
				onProfileStatusChange(
					cb: (payload: { profileId: string; status: BrowserStatus }) => void,
				): () => void
			}
			logs: {
				query(filter?: LauncherLogFilter): Promise<LauncherLogEntry[]>
				clear(): Promise<LaunchResult>
			}
			settings: {
				get(): Promise<LauncherSettings>
				update(patch: LauncherSettingsPatch): Promise<SettingsMutationResult>
			}
			tokens: {
				getSummary(): Promise<TokenUsageSummary>
			}
			auth: {
				setSession(session: UserSession): Promise<UserSessionResult>
				getSession(): Promise<UserSessionResult>
				prepareSignOut(): Promise<LaunchResult>
				cancelSignOut(): Promise<LaunchResult>
				clearSession(): Promise<LaunchResult>
			}
			updates: {
				getState(): Promise<UpdateState>
				check(reason?: 'manual' | 'signal'): Promise<UpdateMutationResult>
				download(): Promise<UpdateMutationResult>
				openInstaller(): Promise<UpdateMutationResult>
				restartInstall(): Promise<UpdateMutationResult>
				onStateChange(cb: (state: UpdateState) => void): () => void
			}
			app: {
				getVersions(): Promise<AppVersions>
				getShellInfo(): Promise<AppShellInfo>
				openLogs(): Promise<OpenLogsResult>
				openExternal(url: string): Promise<LaunchResult>
				quit(): Promise<LaunchResult>
				minimizeWindow(): Promise<LaunchResult>
				toggleMaximizeWindow(): Promise<LaunchResult>
				requestClose(): Promise<LaunchResult>
				getClosePrompt(): Promise<WindowClosePromptState>
				respondToClosePrompt(requestId: string, choice: WindowCloseChoice): Promise<LaunchResult>
				onClosePromptChange(cb: (state: WindowClosePromptState) => void): () => void
			}
		}
	}
}

export {}
