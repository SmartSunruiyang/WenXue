import type { LucideIcon } from 'lucide-react'
import {
	Activity,
	Check,
	ChevronDown,
	CircleDollarSign,
	Copy,
	Download,
	Focus,
	FolderOpen,
	Globe2,
	Info,
	LoaderCircle,
	LogIn,
	LogOut,
	Maximize2,
	Minus,
	MoreHorizontal,
	Pause,
	Pencil,
	Play,
	Plus,
	RefreshCw,
	ScrollText,
	Search,
	Settings,
	Square,
	Trash2,
	UserPlus,
	X,
} from 'lucide-react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
	getLauncherSession,
	readCloudBaseErrorMessage,
	registerLauncher,
	signInLauncher,
	signOutLauncher,
	toPublicUser,
	type LauncherAuthSession,
	type LauncherPublicUser,
} from './cloudbase'
import { strings } from './strings'
import type {
	AppShellInfo,
	AppVersions,
	BrowserProfile,
	BrowserStatus,
	LauncherLogEntry,
	LauncherSettings,
	LauncherSettingsPatch,
	LogLevel,
	TokenUsageBucket,
	TokenUsageSummary,
} from './wenxue'

const isMacPlatform = navigator.userAgent.includes('Macintosh')

type RouteId = 'browsers' | 'logs' | 'tokens' | 'settings'
type SettingsSectionId = 'launch' | 'behavior' | 'logs' | 'kernel' | 'about'
type ProfileSortMode = 'recent' | 'name' | 'status'
type LogSource = LauncherLogEntry['source']

const routeItems: Array<{ id: RouteId; label: string; icon: LucideIcon }> = [
	{ id: 'logs', label: '日志', icon: ScrollText },
	{ id: 'tokens', label: 'Tokens', icon: CircleDollarSign },
]

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
	{ id: 'launch', label: '批量启动' },
	{ id: 'behavior', label: '启动器行为' },
	{ id: 'logs', label: '日志' },
	{ id: 'kernel', label: '浏览器内核' },
	{ id: 'about', label: '关于' },
]

const statusLabels: Record<BrowserStatus, string> = {
	idle: '空闲',
	launching: '启动中',
	running: '运行中',
	error: '异常',
}

const statusPriority: Record<BrowserStatus, number> = {
	running: 0,
	launching: 1,
	error: 2,
	idle: 3,
}

const logSources: LogSource[] = ['agent', 'llm', 'tabs', 'page', 'chaoxing', 'config', 'system']

const defaultSettings: LauncherSettings = {
	launch: {
		windowWidth: 1280,
		windowHeight: 820,
		startUrl: 'chrome://newtab',
		concurrencyLimit: 3,
		staggerMs: 400,
		profileType: 'persistent',
		proxyMode: 'none',
		language: 'zh-CN',
		zoom: 100,
	},
	behavior: {
		closeAction: 'ask',
		exitWithBrowsers: 'ask',
		openAtLogin: false,
		downloadDir: '',
	},
	logs: {
		retentionDays: 3,
		maxEntries: 5000,
		minLevel: 'info',
		captureLlmRequests: true,
		captureLlmResponses: false,
		defaultExportFormat: 'json',
	},
	localUser: {
		displayName: '本地用户',
		colorKey: 'purple',
	},
}

const emptyTokenSummary: TokenUsageSummary = {
	totalInputTokens: 0,
	totalOutputTokens: 0,
	totalTokens: 0,
	estimatedCostCny: 0,
	byBrowser: [],
	byModel: [],
	daily: [],
	recent: [],
}

const defaultShellInfo: AppShellInfo = {
	platform: isMacPlatform ? 'darwin' : 'win32',
	frameless: !isMacPlatform,
	hasSystemTrafficLights: isMacPlatform,
	isMaximized: false,
}

export default function App() {
	const [route, setRoute] = useState<RouteId>('browsers')
	const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('launch')
	const [authReady, setAuthReady] = useState(false)
	const [authUser, setAuthUser] = useState<LauncherPublicUser | null>(null)
	const [profiles, setProfiles] = useState<BrowserProfile[]>([])
	const [statuses, setStatuses] = useState<Record<string, BrowserStatus>>({})
	const [logs, setLogs] = useState<LauncherLogEntry[]>([])
	const [settings, setSettings] = useState<LauncherSettings>(defaultSettings)
	const [tokens, setTokens] = useState<TokenUsageSummary>(emptyTokenSummary)
	const [versions, setVersions] = useState<AppVersions>({
		app: 'unknown',
		browser: 'unknown',
		extension: 'unknown',
	})
	const [shellInfo, setShellInfo] = useState<AppShellInfo>(defaultShellInfo)
	const [selectedIds, setSelectedIds] = useState<string[]>([])
	const [editingId, setEditingId] = useState<string | null>(null)
	const [draftName, setDraftName] = useState('')
	const [query, setQuery] = useState('')
	const [profileSort, setProfileSort] = useState<ProfileSortMode>('recent')
	const [logQuery, setLogQuery] = useState('')
	const [logLevels, setLogLevels] = useState<LogLevel[]>(['info', 'warn', 'error'])
	const [activeLogSources, setActiveLogSources] = useState<LogSource[]>(logSources)
	const [followLogs, setFollowLogs] = useState(true)
	const [avatarOpen, setAvatarOpen] = useState(false)
	const [addingProfile, setAddingProfile] = useState(false)
	const [batchLaunching, setBatchLaunching] = useState(false)
	const [logsMutating, setLogsMutating] = useState(false)
	const [pendingProfileIds, setPendingProfileIds] = useState<string[]>([])
	const [logoutBusy, setLogoutBusy] = useState(false)
	const [savingSettings, setSavingSettings] = useState(false)
	const [tokensLoading, setTokensLoading] = useState(false)
	const [savedTick, setSavedTick] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const avatarButtonRef = useRef<HTMLButtonElement>(null)
	const addingProfileRef = useRef(false)
	const batchLaunchingRef = useRef(false)
	const logoutBusyRef = useRef(false)
	const logRefreshErrorRef = useRef<string | null>(null)
	const logsMutationBusyRef = useRef(false)
	const pendingProfileActionsRef = useRef(new Set<string>())
	const settingsErrorRef = useRef<string | null>(null)
	const settingsQueueRef = useRef<Promise<void>>(Promise.resolve())
	const settingsPendingRef = useRef(0)
	const savedTimerRef = useRef<number | null>(null)
	const tokenRequestIdRef = useRef(0)
	const workspaceGenerationRef = useRef(0)

	const beginProfileAction = useCallback((profileId: string) => {
		if (logoutBusyRef.current || pendingProfileActionsRef.current.has(profileId)) return false
		pendingProfileActionsRef.current.add(profileId)
		setPendingProfileIds(Array.from(pendingProfileActionsRef.current))
		return true
	}, [])

	const endProfileAction = useCallback((profileId: string) => {
		pendingProfileActionsRef.current.delete(profileId)
		setPendingProfileIds(Array.from(pendingProfileActionsRef.current))
	}, [])

	const refreshProfiles = useCallback(async () => {
		const [nextProfiles, nextStatuses] = await Promise.all([
			window.wenxue.browser.listProfiles(),
			window.wenxue.browser.getStatuses(),
		])
		setProfiles(nextProfiles)
		setStatuses(nextStatuses)
	}, [])

	const refreshLogs = useCallback(async () => {
		if (logoutBusyRef.current || logsMutationBusyRef.current) return
		const generation = workspaceGenerationRef.current
		try {
			const nextLogs = await window.wenxue.logs.query({ limit: 600 })
			if (
				logoutBusyRef.current ||
				logsMutationBusyRef.current ||
				generation !== workspaceGenerationRef.current
			) {
				return
			}
			setLogs(nextLogs.sort((a, b) => a.ts - b.ts))
			const previousError = logRefreshErrorRef.current
			logRefreshErrorRef.current = null
			if (previousError) {
				setMessage((current) => (current === previousError ? null : current))
			}
		} catch (error) {
			if (
				logoutBusyRef.current ||
				logsMutationBusyRef.current ||
				generation !== workspaceGenerationRef.current
			) {
				return
			}
			const nextError = readCloudBaseErrorMessage(error, strings.error.refreshLogs)
			logRefreshErrorRef.current = nextError
			setMessage(nextError)
		}
	}, [])

	const refreshTokens = useCallback(async () => {
		if (!authUser || logoutBusyRef.current) return
		const requestId = ++tokenRequestIdRef.current
		setTokensLoading(true)
		setMessage(null)
		try {
			const nextTokens = await window.wenxue.tokens.getSummary()
			if (requestId === tokenRequestIdRef.current) setTokens(nextTokens)
		} catch (error) {
			if (requestId === tokenRequestIdRef.current) {
				setMessage(readCloudBaseErrorMessage(error, strings.error.refreshTokens))
			}
		} finally {
			if (requestId === tokenRequestIdRef.current) {
				setTokensLoading(false)
			}
		}
	}, [authUser])

	const loadWorkspaceData = useCallback(async () => {
		const [nextProfiles, nextStatuses, nextLogs, nextSettings, nextTokens, nextVersions] =
			await Promise.all([
				window.wenxue.browser.listProfiles(),
				window.wenxue.browser.getStatuses(),
				window.wenxue.logs.query({ limit: 600 }),
				window.wenxue.settings.get(),
				window.wenxue.tokens.getSummary(),
				window.wenxue.app.getVersions(),
			])
		setProfiles(nextProfiles)
		setStatuses(nextStatuses)
		setLogs(nextLogs.sort((a, b) => a.ts - b.ts))
		setSettings(nextSettings)
		setTokens(nextTokens)
		setVersions(nextVersions)
	}, [])

	useEffect(() => {
		let mounted = true
		const load = async () => {
			const [session, nextShellInfo] = await Promise.all([
				getLauncherSession(),
				window.wenxue.app.getShellInfo(),
			])
			if (!mounted) return
			setShellInfo(nextShellInfo)
			if (!session) {
				setAuthReady(true)
				return
			}
			const synced = await window.wenxue.auth.setSession(session)
			if (!synced.ok) {
				throw new Error(synced.error ?? '账号 session 同步失败')
			}
			await loadWorkspaceData()
			if (mounted) {
				setAuthUser(toPublicUser(session))
				setAuthReady(true)
			}
		}

		void load().catch((error: unknown) => {
			setMessage(readCloudBaseErrorMessage(error, '启动器数据加载失败'))
			setAuthReady(true)
		})

		const unsubscribeProfile = window.wenxue.browser.onProfileStatusChange((payload) => {
			setStatuses((current) => ({ ...current, [payload.profileId]: payload.status }))
		})

		return () => {
			mounted = false
			unsubscribeProfile()
		}
	}, [loadWorkspaceData])

	useEffect(() => {
		if (!authUser || route !== 'logs' || !followLogs) return
		const logTimer = window.setInterval(() => void refreshLogs(), 2200)
		return () => window.clearInterval(logTimer)
	}, [authUser, followLogs, refreshLogs, route])

	useEffect(() => {
		if (authUser && route === 'tokens') void refreshTokens()
	}, [authUser, refreshTokens, route])

	useEffect(() => {
		if (!avatarOpen) return
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			setAvatarOpen(false)
			avatarButtonRef.current?.focus()
		}
		window.addEventListener('keydown', closeOnEscape)
		return () => window.removeEventListener('keydown', closeOnEscape)
	}, [avatarOpen])

	useEffect(
		() => () => {
			if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
		},
		[],
	)

	const visibleProfiles = useMemo(() => {
		const text = query.trim().toLowerCase()
		const filtered = text
			? profiles.filter(
					(profile) =>
						profile.displayName.toLowerCase().includes(text) ||
						profile.id.toLowerCase().includes(text) ||
						profile.userDataDir.toLowerCase().includes(text),
				)
			: profiles
		return sortProfiles(filtered, profileSort, statuses)
	}, [profileSort, profiles, query, statuses])

	const visibleLogs = useMemo(() => {
		const text = logQuery.trim().toLowerCase()
		return logs
			.filter((entry) => logLevels.includes(entry.level))
			.filter((entry) => activeLogSources.includes(entry.source))
			.filter(
				(entry) =>
					!text ||
					entry.message.toLowerCase().includes(text) ||
					entry.source.toLowerCase().includes(text) ||
					entry.browserId.toLowerCase().includes(text),
			)
			.slice(-160)
	}, [activeLogSources, logLevels, logQuery, logs])

	const launchProfile = useCallback(
		async (profileId: string) => {
			if (!beginProfileAction(profileId)) return false
			setMessage(null)
			setStatuses((current) => ({ ...current, [profileId]: 'launching' }))
			try {
				const result = await window.wenxue.browser.launchProfile(profileId)
				if (!result.ok) throw new Error(result.error ?? '浏览器启动失败')
				setStatuses((current) => ({ ...current, [profileId]: 'running' }))
				try {
					await refreshProfiles()
				} catch (error) {
					setMessage(readCloudBaseErrorMessage(error, strings.error.refreshProfiles))
				}
				return true
			} catch (error) {
				setStatuses((current) => ({ ...current, [profileId]: 'error' }))
				setMessage(readCloudBaseErrorMessage(error, strings.error.launchBrowser))
				return false
			} finally {
				endProfileAction(profileId)
			}
		},
		[beginProfileAction, endProfileAction, refreshProfiles],
	)

	const stopProfile = useCallback(
		async (profileId: string) => {
			if (!beginProfileAction(profileId)) return
			setMessage(null)
			try {
				const result = await window.wenxue.browser.stopProfile(profileId)
				if (!result.ok) throw new Error(result.error ?? '浏览器停止失败')
				setStatuses((current) => ({ ...current, [profileId]: 'idle' }))
			} catch (error) {
				setMessage(readCloudBaseErrorMessage(error, strings.error.stopBrowser))
			} finally {
				endProfileAction(profileId)
			}
		},
		[beginProfileAction, endProfileAction],
	)

	const addProfile = useCallback(async () => {
		if (logoutBusyRef.current || addingProfileRef.current) return
		addingProfileRef.current = true
		setAddingProfile(true)
		setMessage(null)
		try {
			const result = await window.wenxue.browser.addProfile()
			if (!result.ok || !result.profile) throw new Error(result.error ?? '无法添加浏览器画像')
			setProfiles((current) => [...current, result.profile!])
			setQuery('')
			setEditingId(result.profile.id)
			setDraftName(result.profile.displayName)
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.error.addProfile))
		} finally {
			addingProfileRef.current = false
			setAddingProfile(false)
		}
	}, [])

	const duplicateProfile = useCallback(
		async (profileId: string) => {
			if (!beginProfileAction(profileId)) return
			setMessage(null)
			try {
				const result = await window.wenxue.browser.duplicateProfile(profileId)
				if (!result.ok || !result.profile) throw new Error(result.error ?? '复制画像失败')
				setProfiles((current) => [...current, result.profile!])
				setQuery('')
				setEditingId(result.profile.id)
				setDraftName(result.profile.displayName)
			} catch (error) {
				setMessage(readCloudBaseErrorMessage(error, strings.error.duplicateProfile))
			} finally {
				endProfileAction(profileId)
			}
		},
		[beginProfileAction, endProfileAction],
	)

	const removeProfile = useCallback(
		async (profileId: string) => {
			if (!window.confirm('删除该浏览器画像？登录态、Cookie 与缓存会一并清除。')) return
			if (!beginProfileAction(profileId)) return
			setMessage(null)
			try {
				const result = await window.wenxue.browser.removeProfile(profileId)
				if (!result.ok) throw new Error(result.error ?? '删除画像失败')
				setProfiles((current) => current.filter((profile) => profile.id !== profileId))
				setSelectedIds((current) => current.filter((id) => id !== profileId))
				setStatuses((current) => {
					const next = { ...current }
					delete next[profileId]
					return next
				})
			} catch (error) {
				setMessage(readCloudBaseErrorMessage(error, strings.error.removeProfile))
			} finally {
				endProfileAction(profileId)
			}
		},
		[beginProfileAction, endProfileAction],
	)

	const openProfileFolder = useCallback(
		async (profileId: string) => {
			if (!beginProfileAction(profileId)) return
			setMessage(null)
			try {
				const result = await window.wenxue.browser.openProfileFolder(profileId)
				if (!result.ok) throw new Error(result.error ?? '打开画像目录失败')
			} catch (error) {
				setMessage(readCloudBaseErrorMessage(error, strings.error.openProfileFolder))
			} finally {
				endProfileAction(profileId)
			}
		},
		[beginProfileAction, endProfileAction],
	)

	const commitRename = useCallback(
		async (profileId: string) => {
			const nextName = draftName.trim()
			if (!nextName) {
				setMessage(strings.error.emptyProfileName)
				return
			}
			if (!beginProfileAction(profileId)) return
			setMessage(null)
			try {
				const result = await window.wenxue.browser.renameProfile(profileId, nextName)
				if (!result.ok || !result.profile) throw new Error(result.error ?? '重命名失败')
				setProfiles((current) =>
					current.map((profile) => (profile.id === profileId ? result.profile! : profile)),
				)
				setEditingId(null)
				setDraftName('')
			} catch (error) {
				setMessage(readCloudBaseErrorMessage(error, strings.error.renameProfile))
			} finally {
				endProfileAction(profileId)
			}
		},
		[beginProfileAction, draftName, endProfileAction],
	)

	const launchSelected = useCallback(async () => {
		if (logoutBusyRef.current || batchLaunchingRef.current) return
		const visibleIds = new Set(visibleProfiles.map((profile) => profile.id))
		const ids = selectedIds.filter((id) => visibleIds.has(id))
		if (ids.length === 0) return
		batchLaunchingRef.current = true
		setBatchLaunching(true)
		setMessage(null)
		const failedIds = new Set<string>()
		try {
			const limit = Math.max(1, settings.launch.concurrencyLimit)
			for (let i = 0; i < ids.length; i += limit) {
				const batch = ids.slice(i, i + limit)
				const outcomes = await Promise.all(
					batch.map(async (profileId, index) => {
						await new Promise<void>((resolve) =>
							window.setTimeout(resolve, index * settings.launch.staggerMs),
						)
						return { profileId, launched: await launchProfile(profileId) }
					}),
				)
				for (const outcome of outcomes) {
					if (!outcome.launched) failedIds.add(outcome.profileId)
				}
			}
			setSelectedIds(Array.from(failedIds))
			if (failedIds.size > 0) {
				setMessage(`${failedIds.size} 个画像未能启动，已保留选择。可重试或查看日志。`)
			}
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.error.batchLaunch))
		} finally {
			batchLaunchingRef.current = false
			setBatchLaunching(false)
		}
	}, [
		launchProfile,
		selectedIds,
		settings.launch.concurrencyLimit,
		settings.launch.staggerMs,
		visibleProfiles,
	])

	const updateSettings = useCallback(async (patch: LauncherSettingsPatch): Promise<boolean> => {
		if (logoutBusyRef.current) return false
		const previousError = settingsErrorRef.current
		settingsErrorRef.current = null
		if (previousError) {
			setMessage((current) => (current === previousError ? null : current))
		}
		settingsPendingRef.current += 1
		setSavingSettings(true)
		setSavedTick(false)

		let saved = false
		const operation = settingsQueueRef.current.then(async () => {
			try {
				const result = await window.wenxue.settings.update(patch)
				if (!result.ok || !result.settings) throw new Error(result.error ?? '设置保存失败')
				setSettings(result.settings)
				const saveError = settingsErrorRef.current
				settingsErrorRef.current = null
				if (saveError) setMessage((current) => (current === saveError ? null : current))
				saved = true
			} catch (error) {
				const nextError = readCloudBaseErrorMessage(error, strings.error.saveSettings)
				settingsErrorRef.current = nextError
				setMessage(nextError)
			}
		})
		settingsQueueRef.current = operation
		await operation

		settingsPendingRef.current -= 1
		if (settingsPendingRef.current === 0) {
			setSavingSettings(false)
			if (saved) {
				setSavedTick(true)
				if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
				savedTimerRef.current = window.setTimeout(() => setSavedTick(false), 1400)
			}
		}
		return saved
	}, [])

	const clearLogs = useCallback(async () => {
		if (logoutBusyRef.current || logsMutationBusyRef.current) return
		logsMutationBusyRef.current = true
		workspaceGenerationRef.current += 1
		setLogsMutating(true)
		setMessage(null)
		try {
			const result = await window.wenxue.logs.clear()
			if (!result.ok) throw new Error(result.error ?? '清空日志失败')
			setLogs([])
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.error.clearLogs))
		} finally {
			logsMutationBusyRef.current = false
			setLogsMutating(false)
		}
	}, [])

	const syncSignedInSession = useCallback(
		async (session: LauncherAuthSession) => {
			const result = await window.wenxue.auth.setSession(session)
			if (!result.ok) {
				throw new Error(result.error ?? '账号 session 同步失败')
			}
			await loadWorkspaceData()
			setAuthUser(toPublicUser(session))
		},
		[loadWorkspaceData],
	)

	const handleLogin = useCallback(
		async (username: string, password: string) => {
			const session = await signInLauncher(username, password)
			await syncSignedInSession(session)
			setMessage(null)
		},
		[syncSignedInSession],
	)

	const handleRegister = useCallback(
		async (username: string, password: string) => {
			const session = await registerLauncher(username, password)
			await syncSignedInSession(session)
			setMessage(null)
		},
		[syncSignedInSession],
	)

	const handleLogout = useCallback(async () => {
		if (
			logoutBusyRef.current ||
			addingProfileRef.current ||
			batchLaunchingRef.current ||
			pendingProfileActionsRef.current.size > 0 ||
			settingsPendingRef.current > 0 ||
			logsMutationBusyRef.current
		) {
			return
		}
		logoutBusyRef.current = true
		workspaceGenerationRef.current += 1
		tokenRequestIdRef.current += 1
		setTokensLoading(false)
		setLogoutBusy(true)
		setMessage(null)
		let signedOut = false
		try {
			await signOutLauncher()
			signedOut = true
			const result = await window.wenxue.auth.clearSession()
			if (!result.ok) throw new Error(result.error ?? '主进程 session 清理失败')
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.error.logout))
		} finally {
			if (signedOut) {
				setTokensLoading(false)
				setAuthUser(null)
				setProfiles([])
				setStatuses({})
				setLogs([])
				setTokens(emptyTokenSummary)
				setSettings(defaultSettings)
				setSelectedIds([])
				setEditingId(null)
				setDraftName('')
				setQuery('')
				setProfileSort('recent')
				setLogQuery('')
				setLogLevels(['info', 'warn', 'error'])
				setActiveLogSources(logSources)
				setFollowLogs(true)
				setSettingsSection('launch')
				setSavedTick(false)
				setRoute('browsers')
				setAvatarOpen(false)
			}
			logoutBusyRef.current = false
			setLogoutBusy(false)
		}
	}, [])

	if (!authReady) {
		return (
			<main className={`auth-shell ${shellInfo.frameless ? 'app-shell--frameless' : ''}`}>
				<div className="top-drag-zone drag-region" />
				<WindowControls onError={setMessage} shellInfo={shellInfo} setShellInfo={setShellInfo} />
				<div className="auth-loading">
					<LoaderCircle className="spin" size={18} />
					<span>正在检查登录状态</span>
				</div>
			</main>
		)
	}

	if (!authUser) {
		return (
			<AuthScreen
				error={message}
				onLogin={handleLogin}
				onRegister={handleRegister}
				shellInfo={shellInfo}
				setMessage={setMessage}
				setShellInfo={setShellInfo}
			/>
		)
	}

	return (
		<main className={`app-shell ${shellInfo.frameless ? 'app-shell--frameless' : ''}`}>
			<aside
				className={`sidebar drag-region ${shellInfo.hasSystemTrafficLights ? 'sidebar--traffic' : ''}`}
				aria-label="启动器导航"
			>
				<button
					aria-expanded={avatarOpen}
					aria-haspopup="menu"
					aria-label="账号菜单"
					className="avatar-button no-drag"
					onClick={() => setAvatarOpen((open) => !open)}
					ref={avatarButtonRef}
					type="button"
				>
					<img src="logo.png" alt="" />
				</button>
				<nav className="sidebar-nav no-drag">
					<RailButton
						active={route === 'browsers'}
						icon={Globe2}
						label="浏览器"
						onClick={() => {
							setRoute('browsers')
							setAvatarOpen(false)
						}}
					/>
					{routeItems.map((item) => (
						<RailButton
							active={route === item.id}
							icon={item.icon}
							key={item.id}
							label={item.label}
							onClick={() => {
								setRoute(item.id)
								setAvatarOpen(false)
							}}
						/>
					))}
				</nav>
				<div className="sidebar-bottom no-drag">
					<RailButton
						active={route === 'settings'}
						icon={Settings}
						label="设置"
						onClick={() => {
							setRoute('settings')
							setAvatarOpen(false)
						}}
					/>
				</div>
				{avatarOpen ? (
					<AvatarMenu
						logoutBusy={logoutBusy}
						setAvatarOpen={setAvatarOpen}
						setRoute={setRoute}
						setSettingsSection={setSettingsSection}
						settings={settings}
						user={authUser}
						versions={versions}
						workspaceBusy={
							addingProfile ||
							batchLaunching ||
							pendingProfileIds.length > 0 ||
							savingSettings ||
							logsMutating
						}
						onLogout={handleLogout}
					/>
				) : null}
			</aside>

			<section
				aria-busy={logoutBusy}
				className={`main-surface ${logoutBusy ? 'main-surface--busy' : ''}`}
				onPointerDown={() => setAvatarOpen(false)}
			>
				<div className="top-drag-zone drag-region" />
				<WindowControls onError={setMessage} shellInfo={shellInfo} setShellInfo={setShellInfo} />
				{message ? (
					<div aria-live="assertive" className="toast toast--error no-drag" role="alert">
						<Info size={15} />
						<span>{message}</span>
						<button aria-label="关闭错误提示" onClick={() => setMessage(null)} type="button">
							<X size={14} />
						</button>
					</div>
				) : null}
				{route === 'browsers' ? (
					<BrowserPage
						addProfile={addProfile}
						addingProfile={addingProfile}
						allProfiles={profiles}
						batchLaunching={batchLaunching}
						commitRename={commitRename}
						draftName={draftName}
						duplicateProfile={duplicateProfile}
						editingId={editingId}
						launchProfile={launchProfile}
						launchSelected={launchSelected}
						openProfileFolder={openProfileFolder}
						profileSort={profileSort}
						profiles={visibleProfiles}
						pendingProfileIds={pendingProfileIds}
						query={query}
						removeProfile={removeProfile}
						selectedIds={selectedIds}
						setDraftName={setDraftName}
						setEditingId={setEditingId}
						setProfileSort={setProfileSort}
						setQuery={setQuery}
						setSelectedIds={setSelectedIds}
						statuses={statuses}
						stopProfile={stopProfile}
						viewLogs={() => setRoute('logs')}
					/>
				) : null}
				{route === 'logs' ? (
					<LogsPage
						clearLogs={clearLogs}
						clearingLogs={logsMutating}
						followLogs={followLogs}
						logLevels={logLevels}
						logQuery={logQuery}
						logs={visibleLogs}
						totalLogCount={logs.length}
						activeLogSources={activeLogSources}
						profiles={profiles}
						settings={settings}
						setActiveLogSources={setActiveLogSources}
						setFollowLogs={setFollowLogs}
						setLogLevels={setLogLevels}
						setLogQuery={setLogQuery}
					/>
				) : null}
				{route === 'tokens' ? (
					<TokensPage loading={tokensLoading} onRefresh={refreshTokens} summary={tokens} />
				) : null}
				{route === 'settings' ? (
					<SettingsPage
						savedTick={savedTick}
						saving={savingSettings}
						section={settingsSection}
						setMessage={setMessage}
						setSection={setSettingsSection}
						settings={settings}
						updateSettings={updateSettings}
						versions={versions}
					/>
				) : null}
			</section>
		</main>
	)
}

interface RailButtonProps {
	active: boolean
	children?: ReactNode
	icon?: LucideIcon
	label: string
	onClick: () => void
}

function WindowControls({
	onError,
	shellInfo,
	setShellInfo,
}: {
	onError: (message: string) => void
	shellInfo: AppShellInfo
	setShellInfo: (info: AppShellInfo) => void
}) {
	if (!shellInfo.frameless) return null

	const runWindowAction = async (
		action: () => Promise<{ ok: boolean; error?: string }>,
		fallback: string,
		refresh = false,
	) => {
		try {
			const result = await action()
			if (!result.ok) throw new Error(result.error ?? fallback)
			if (refresh) setShellInfo(await window.wenxue.app.getShellInfo())
		} catch (error) {
			onError(readCloudBaseErrorMessage(error, fallback))
		}
	}

	return (
		<div className="window-controls no-drag" aria-label="窗口控制">
			<button
				aria-label="最小化"
				onClick={() =>
					void runWindowAction(
						() => window.wenxue.app.minimizeWindow(),
						strings.error.minimizeWindow,
					)
				}
				type="button"
			>
				<Minus size={14} />
			</button>
			<button
				aria-label={shellInfo.isMaximized ? '还原窗口' : '最大化'}
				onClick={() => {
					void runWindowAction(
						() => window.wenxue.app.toggleMaximizeWindow(),
						strings.error.resizeWindow,
						true,
					)
				}}
				type="button"
			>
				<Maximize2 size={13} />
			</button>
			<button
				aria-label="关闭"
				className="window-controls__close"
				onClick={() =>
					void runWindowAction(() => window.wenxue.app.requestClose(), strings.error.closeWindow)
				}
				type="button"
			>
				<X size={14} />
			</button>
		</div>
	)
}

function RailButton({ active, children, icon: Icon, label, onClick }: RailButtonProps) {
	return (
		<button
			aria-current={active ? 'page' : undefined}
			aria-label={label}
			className={`rail-button ${active ? 'rail-button--active' : ''}`}
			onClick={onClick}
			title={label}
			type="button"
		>
			{Icon ? <Icon size={20} /> : children}
			<span>{label}</span>
		</button>
	)
}

function AuthScreen({
	error,
	onLogin,
	onRegister,
	shellInfo,
	setMessage,
	setShellInfo,
}: {
	error: string | null
	onLogin: (username: string, password: string) => Promise<void>
	onRegister: (username: string, password: string) => Promise<void>
	shellInfo: AppShellInfo
	setMessage: (message: string | null) => void
	setShellInfo: (info: AppShellInfo) => void
}) {
	const [mode, setMode] = useState<'login' | 'register'>('login')
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [busy, setBusy] = useState(false)
	const [localError, setLocalError] = useState<string | null>(null)
	const isRegister = mode === 'register'

	const submit = async (event?: FormEvent<HTMLFormElement>) => {
		event?.preventDefault()
		if (busy) return
		const nextUsername = username.trim()
		setLocalError(null)
		setMessage(null)
		if (!nextUsername || !password) {
			setLocalError('请输入用户 id 和密码')
			return
		}
		if (isRegister && password !== confirmPassword) {
			setLocalError('两次输入的密码不一致')
			return
		}
		setBusy(true)
		try {
			if (isRegister) {
				await onRegister(nextUsername, password)
			} else {
				await onLogin(nextUsername, password)
			}
		} catch (nextError) {
			setLocalError(readCloudBaseErrorMessage(nextError, '账号操作失败'))
		} finally {
			setBusy(false)
		}
	}

	return (
		<main className={`auth-shell ${shellInfo.frameless ? 'app-shell--frameless' : ''}`}>
			<div className="top-drag-zone drag-region" />
			<WindowControls onError={setMessage} shellInfo={shellInfo} setShellInfo={setShellInfo} />
			<form aria-busy={busy} className="auth-card no-drag" onSubmit={(event) => void submit(event)}>
				<div className="auth-brand">
					<img src="logo.png" alt="" />
					<div>
						<strong>问学</strong>
						<span>ask for everything</span>
					</div>
				</div>
				<div className="auth-card__head">
					<h1>{isRegister ? '注册账号' : '登录账号'}</h1>
					<p>
						{isRegister ? '使用用户 id 和密码创建问学账号。' : '登录后才能进入工作台并启动浏览器。'}
					</p>
				</div>
				<div className="segmented-control auth-card__modes" aria-label="账号入口">
					<button
						aria-pressed={!isRegister}
						className={!isRegister ? 'segmented-control__active' : ''}
						disabled={busy}
						onClick={() => {
							setMode('login')
							setLocalError(null)
						}}
						type="button"
					>
						<LogIn size={15} />
						登录
					</button>
					<button
						aria-pressed={isRegister}
						className={isRegister ? 'segmented-control__active' : ''}
						disabled={busy}
						onClick={() => {
							setMode('register')
							setLocalError(null)
						}}
						type="button"
					>
						<UserPlus size={15} />
						注册
					</button>
				</div>
				<label className="auth-field">
					<span>用户 id</span>
					<input
						autoComplete="username"
						autoFocus
						disabled={busy}
						onChange={(event) => setUsername(event.target.value)}
						type="text"
						value={username}
					/>
				</label>
				<label className="auth-field">
					<span>密码</span>
					<input
						autoComplete={isRegister ? 'new-password' : 'current-password'}
						disabled={busy}
						onChange={(event) => setPassword(event.target.value)}
						type="password"
						value={password}
					/>
				</label>
				{isRegister ? (
					<label className="auth-field">
						<span>确认密码</span>
						<input
							autoComplete="new-password"
							disabled={busy}
							onChange={(event) => setConfirmPassword(event.target.value)}
							type="password"
							value={confirmPassword}
						/>
					</label>
				) : null}
				{localError || error ? (
					<div className="auth-alert" role="alert">
						{localError ?? error}
					</div>
				) : null}
				<button
					className="primary-button auth-submit"
					disabled={busy || !username.trim() || !password || (isRegister && !confirmPassword)}
					type="submit"
				>
					{busy ? (
						<LoaderCircle className="spin" size={16} />
					) : isRegister ? (
						<UserPlus size={16} />
					) : (
						<LogIn size={16} />
					)}
					{busy ? '处理中' : isRegister ? '注册并登录' : '登录'}
				</button>
			</form>
		</main>
	)
}

function AvatarMenu({
	logoutBusy,
	onLogout,
	setAvatarOpen,
	setRoute,
	setSettingsSection,
	settings,
	user,
	versions,
	workspaceBusy,
}: {
	logoutBusy: boolean
	onLogout: () => Promise<void>
	setAvatarOpen: (open: boolean) => void
	setRoute: (route: RouteId) => void
	setSettingsSection: (section: SettingsSectionId) => void
	settings: LauncherSettings
	user: LauncherPublicUser
	versions: AppVersions
	workspaceBusy: boolean
}) {
	const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
		const items = Array.from(
			event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
		)
		const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
		event.preventDefault()
		if (event.key === 'Home' || event.key === 'End') {
			items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
			return
		}
		const direction = event.key === 'ArrowDown' ? 1 : -1
		items[(activeIndex + direction + items.length) % items.length]?.focus()
	}

	return (
		<div
			aria-label="账号菜单"
			className="avatar-menu no-drag"
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setAvatarOpen(false)
			}}
			onKeyDown={handleMenuKeyDown}
			role="menu"
		>
			<div className="avatar-menu__head">
				<div className="avatar-menu__mark">
					<img src="logo.png" alt="" />
				</div>
				<div>
					<strong>{user.username ?? settings.localUser.displayName ?? user.userId}</strong>
					<span>{user.userId}</span>
				</div>
			</div>
			<button
				autoFocus
				onClick={() => {
					setSettingsSection('launch')
					setRoute('settings')
					setAvatarOpen(false)
				}}
				role="menuitem"
				type="button"
			>
				<Settings size={15} />
				设置
			</button>
			<button
				onClick={() => {
					setSettingsSection('about')
					setRoute('settings')
					setAvatarOpen(false)
				}}
				role="menuitem"
				type="button"
			>
				<Info size={15} />
				关于 {versions.app}
			</button>
			<button
				disabled={logoutBusy || workspaceBusy}
				onClick={() => void onLogout()}
				role="menuitem"
				title={workspaceBusy ? '请等待当前操作完成后再退出' : undefined}
				type="button"
			>
				{logoutBusy ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
				{logoutBusy ? '正在退出' : '退出登录'}
			</button>
		</div>
	)
}

interface BrowserPageProps {
	addProfile: () => Promise<void>
	addingProfile: boolean
	allProfiles: BrowserProfile[]
	batchLaunching: boolean
	commitRename: (profileId: string) => Promise<void>
	draftName: string
	duplicateProfile: (profileId: string) => Promise<void>
	editingId: string | null
	launchProfile: (profileId: string) => Promise<boolean>
	launchSelected: () => Promise<void>
	openProfileFolder: (profileId: string) => Promise<void>
	profileSort: ProfileSortMode
	profiles: BrowserProfile[]
	pendingProfileIds: string[]
	query: string
	removeProfile: (profileId: string) => Promise<void>
	selectedIds: string[]
	setDraftName: (name: string) => void
	setEditingId: (profileId: string | null) => void
	setProfileSort: (mode: ProfileSortMode) => void
	setQuery: (query: string) => void
	setSelectedIds: (ids: string[]) => void
	statuses: Record<string, BrowserStatus>
	stopProfile: (profileId: string) => Promise<void>
	viewLogs: () => void
}

function BrowserPage(props: BrowserPageProps) {
	const runningCount = props.allProfiles.filter(
		(profile) => props.statuses[profile.id] === 'running',
	).length
	const launchingCount = props.allProfiles.filter(
		(profile) => props.statuses[profile.id] === 'launching',
	).length
	const errorCount = props.allProfiles.filter(
		(profile) => props.statuses[profile.id] === 'error',
	).length
	const selectionBusy = props.selectedIds.some((id) => props.pendingProfileIds.includes(id))

	return (
		<div className="page page--browsers">
			<header className="page-header safe-actions">
				<div>
					<h1>浏览器</h1>
					<p>持久画像、多账号隔离与批量启动。</p>
				</div>
				<div className="header-actions">
					<label aria-label="搜索浏览器画像" className="search-field">
						<Search size={16} />
						<input
							disabled={props.batchLaunching}
							onChange={(event) => {
								props.setQuery(event.target.value)
								props.setSelectedIds([])
							}}
							placeholder="搜索画像、ID 或目录"
							value={props.query}
						/>
					</label>
					<div className="segmented-control" aria-label="画像排序">
						<button
							aria-pressed={props.profileSort === 'recent'}
							className={props.profileSort === 'recent' ? 'segmented-control__active' : ''}
							disabled={props.batchLaunching}
							onClick={() => props.setProfileSort('recent')}
							type="button"
						>
							最近
						</button>
						<button
							aria-pressed={props.profileSort === 'status'}
							className={props.profileSort === 'status' ? 'segmented-control__active' : ''}
							disabled={props.batchLaunching}
							onClick={() => props.setProfileSort('status')}
							type="button"
						>
							状态
						</button>
						<button
							aria-pressed={props.profileSort === 'name'}
							className={props.profileSort === 'name' ? 'segmented-control__active' : ''}
							disabled={props.batchLaunching}
							onClick={() => props.setProfileSort('name')}
							type="button"
						>
							名称
						</button>
					</div>
					<button
						className="primary-button"
						disabled={props.addingProfile || props.batchLaunching}
						onClick={() => void props.addProfile()}
						type="button"
					>
						{props.addingProfile ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
						{props.addingProfile ? '正在添加' : '添加浏览器'}
					</button>
				</div>
			</header>

			<div className="browser-summary" aria-label="浏览器状态概览">
				<span>
					<strong>{props.allProfiles.length}</strong> 个画像
				</span>
				<span className="browser-summary__running">
					<strong>{runningCount}</strong> 运行中
				</span>
				<span>
					<strong>{launchingCount}</strong> 启动中
				</span>
				{errorCount > 0 ? (
					<span className="browser-summary__error">
						<strong>{errorCount}</strong> 个异常
					</span>
				) : null}
			</div>

			{props.allProfiles.length === 0 ? (
				<EmptyState
					action={() => void props.addProfile()}
					actionLabel="添加第一个浏览器"
					title="还没有浏览器画像"
				>
					创建一个持久画像后，登录态、Cookie 与缓存会保存在独立目录中。
				</EmptyState>
			) : props.profiles.length === 0 ? (
				<EmptyState
					action={() => props.setQuery('')}
					actionIcon={X}
					actionLabel="清除搜索"
					title="没有匹配的浏览器"
				>
					换一个名称、ID 或目录关键词，或者清除当前搜索。
				</EmptyState>
			) : (
				<div className="profile-list">
					<div className="profile-row profile-row--head">
						<span />
						<span>画像</span>
						<span>状态</span>
						<span>上次使用</span>
						<span>操作</span>
					</div>
					{props.profiles.map((profile) => (
						<ProfileRow key={profile.id} profile={profile} {...props} />
					))}
				</div>
			)}

			{props.selectedIds.length > 0 ? (
				<div className="selection-bar">
					<div>
						<Activity size={16} />
						<span>已选择 {props.selectedIds.length} 个画像</span>
					</div>
					<button
						className="primary-button"
						disabled={props.batchLaunching || selectionBusy}
						onClick={() => void props.launchSelected()}
						type="button"
					>
						{props.batchLaunching ? (
							<LoaderCircle className="spin" size={16} />
						) : (
							<Play size={16} />
						)}
						{props.batchLaunching ? '正在启动' : `打开选中 (${props.selectedIds.length})`}
					</button>
					<button
						className="soft-button"
						disabled={props.batchLaunching}
						onClick={() => props.setSelectedIds([])}
						type="button"
					>
						取消选择
					</button>
				</div>
			) : null}
		</div>
	)
}

function ProfileRow(props: BrowserPageProps & { profile: BrowserProfile }) {
	const status = props.statuses[props.profile.id] ?? 'idle'
	const selected = props.selectedIds.includes(props.profile.id)
	const running = status === 'running'
	const launching = status === 'launching'
	const failed = status === 'error'
	const actionPending = props.pendingProfileIds.includes(props.profile.id)
	const menuButtonRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const [menuOpen, setMenuOpen] = useState(false)
	const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null)

	const closeMenu = useCallback((returnFocus = false) => {
		setMenuOpen(false)
		if (returnFocus) {
			window.requestAnimationFrame(() => menuButtonRef.current?.focus())
		}
	}, [])

	const toggleMenu = () => {
		if (menuOpen) {
			closeMenu(true)
			return
		}

		const trigger = menuButtonRef.current
		if (!trigger) return
		const bounds = trigger.getBoundingClientRect()
		const menuWidth = 164
		const estimatedHeight = failed ? 192 : 156
		const fitsBelow = bounds.bottom + 6 + estimatedHeight <= window.innerHeight - 8
		setMenuPosition({
			left: Math.min(
				Math.max(8, bounds.right - menuWidth),
				Math.max(8, window.innerWidth - menuWidth - 8),
			),
			top: fitsBelow ? bounds.bottom + 6 : Math.max(8, bounds.top - estimatedHeight - 6),
		})
		setMenuOpen(true)
	}

	useEffect(() => {
		if (!menuOpen) return

		const focusFrame = window.requestAnimationFrame(() => {
			menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
		})
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null
			if (menuButtonRef.current?.contains(target) || menuRef.current?.contains(target)) return
			closeMenu()
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault()
				closeMenu(true)
				return
			}

			const menu = menuRef.current
			if (!menu?.contains(document.activeElement)) return
			const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
			const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)

			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				const direction = event.key === 'ArrowDown' ? 1 : -1
				items[(activeIndex + direction + items.length) % items.length]?.focus()
				return
			}
			if (event.key === 'Home' || event.key === 'End') {
				event.preventDefault()
				items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
				return
			}
			if (event.key === 'Tab') {
				event.preventDefault()
				const backwards = event.shiftKey
				setMenuOpen(false)
				window.requestAnimationFrame(() => {
					const trigger = menuButtonRef.current
					if (!trigger) return
					if (backwards) {
						trigger.focus()
						return
					}
					const controls = Array.from(
						document.querySelectorAll<HTMLElement>(
							'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
						),
					)
					controls[controls.indexOf(trigger) + 1]?.focus()
				})
			}
		}
		const handleViewportChange = () => closeMenu()

		document.addEventListener('pointerdown', handlePointerDown, true)
		document.addEventListener('keydown', handleKeyDown)
		window.addEventListener('resize', handleViewportChange)
		window.addEventListener('scroll', handleViewportChange, true)
		return () => {
			window.cancelAnimationFrame(focusFrame)
			document.removeEventListener('pointerdown', handlePointerDown, true)
			document.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('resize', handleViewportChange)
			window.removeEventListener('scroll', handleViewportChange, true)
		}
	}, [closeMenu, menuOpen])

	const toggleSelected = () => {
		if (props.batchLaunching || actionPending) return
		props.setSelectedIds(
			selected
				? props.selectedIds.filter((id) => id !== props.profile.id)
				: [...props.selectedIds, props.profile.id],
		)
	}

	return (
		<div
			className={`profile-row profile-row--${status} ${selected ? 'profile-row--selected' : ''}`}
		>
			<label className="checkbox-control">
				<input
					aria-label={`选择 ${props.profile.displayName}`}
					checked={selected}
					disabled={props.batchLaunching || actionPending}
					onChange={toggleSelected}
					type="checkbox"
				/>
				<span />
			</label>
			<div className="profile-identity">
				<div className={`profile-avatar profile-avatar--${props.profile.colorKey}`}>
					{props.profile.displayName.slice(0, 1)}
				</div>
				<div className="profile-copy">
					{props.editingId === props.profile.id ? (
						<div className="rename-field">
							<input
								aria-label={`重命名 ${props.profile.displayName}`}
								autoFocus
								disabled={actionPending || props.batchLaunching}
								onChange={(event) => props.setDraftName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') props.commitRename(props.profile.id)
									if (event.key === 'Escape') props.setEditingId(null)
								}}
								value={props.draftName}
							/>
							<button
								aria-label="确认重命名"
								disabled={actionPending || props.batchLaunching}
								onClick={() => void props.commitRename(props.profile.id)}
								type="button"
							>
								<Check size={14} />
							</button>
							<button
								aria-label="取消重命名"
								disabled={actionPending || props.batchLaunching}
								onClick={() => props.setEditingId(null)}
								type="button"
							>
								<X size={14} />
							</button>
						</div>
					) : (
						<strong className="profile-name">{props.profile.displayName}</strong>
					)}
					{props.editingId === props.profile.id ? null : (
						<span className="profile-id">{props.profile.id}</span>
					)}
					<StatusBadge compact status={status} />
				</div>
			</div>
			<StatusBadge status={status} />
			<span className="mono-text">{formatRelativeTime(props.profile.lastUsedAt)}</span>
			<div className="row-actions">
				<button
					className="row-primary-action"
					disabled={launching || actionPending || props.batchLaunching}
					onClick={() => void props.launchProfile(props.profile.id)}
					title={running ? '聚焦' : failed ? '重新启动' : '打开'}
					type="button"
				>
					{launching ? (
						<LoaderCircle className="spin" size={15} />
					) : running ? (
						<Focus size={15} />
					) : failed ? (
						<RefreshCw size={15} />
					) : (
						<Play size={15} />
					)}
					<span>{launching ? '启动中' : running ? '聚焦' : failed ? '重试' : '打开'}</span>
				</button>
				{running ? (
					<button
						aria-label={`停止 ${props.profile.displayName}`}
						disabled={actionPending || props.batchLaunching}
						onClick={() => void props.stopProfile(props.profile.id)}
						title="停止"
						type="button"
					>
						<Square size={15} />
					</button>
				) : null}
				<div className="row-more">
					<button
						aria-controls={`profile-menu-${props.profile.id}`}
						aria-expanded={menuOpen}
						aria-haspopup="menu"
						aria-label={`${props.profile.displayName} 的更多操作`}
						className="row-more__trigger"
						disabled={actionPending || props.batchLaunching}
						onClick={toggleMenu}
						onKeyDown={(event) => {
							if (event.key !== 'ArrowDown' || menuOpen) return
							event.preventDefault()
							toggleMenu()
						}}
						ref={menuButtonRef}
						title="更多操作"
						type="button"
					>
						<MoreHorizontal size={16} />
					</button>
				</div>
			</div>
			{menuOpen && menuPosition
				? createPortal(
						<div
							aria-label={`${props.profile.displayName} 的更多操作`}
							className="row-more__menu"
							id={`profile-menu-${props.profile.id}`}
							ref={menuRef}
							role="menu"
							style={menuPosition}
						>
							{failed ? (
								<button
									onClick={() => {
										closeMenu()
										props.viewLogs()
									}}
									role="menuitem"
									type="button"
								>
									<ScrollText size={15} />
									查看日志
								</button>
							) : null}
							<button
								onClick={() => {
									closeMenu()
									props.setEditingId(props.profile.id)
									props.setDraftName(props.profile.displayName)
								}}
								role="menuitem"
								type="button"
							>
								<Pencil size={15} />
								重命名
							</button>
							<button
								disabled={launching || running}
								onClick={() => {
									closeMenu()
									void props.duplicateProfile(props.profile.id)
								}}
								role="menuitem"
								type="button"
							>
								<Copy size={15} />
								复制画像
							</button>
							<button
								onClick={() => {
									closeMenu()
									void props.openProfileFolder(props.profile.id)
								}}
								role="menuitem"
								type="button"
							>
								<FolderOpen size={15} />
								打开目录
							</button>
							<button
								className="danger-icon"
								disabled={launching || running}
								onClick={() => {
									closeMenu()
									void props.removeProfile(props.profile.id)
								}}
								role="menuitem"
								type="button"
							>
								<Trash2 size={15} />
								删除画像
							</button>
						</div>,
						document.body,
					)
				: null}
		</div>
	)
}

function LogsPage({
	activeLogSources,
	clearLogs,
	clearingLogs,
	followLogs,
	logLevels,
	logQuery,
	logs,
	totalLogCount,
	profiles,
	settings,
	setActiveLogSources,
	setFollowLogs,
	setLogLevels,
	setLogQuery,
}: {
	activeLogSources: LogSource[]
	clearLogs: () => Promise<void>
	clearingLogs: boolean
	followLogs: boolean
	logLevels: LogLevel[]
	logQuery: string
	logs: LauncherLogEntry[]
	totalLogCount: number
	profiles: BrowserProfile[]
	settings: LauncherSettings
	setActiveLogSources: (sources: LogSource[]) => void
	setFollowLogs: (follow: boolean) => void
	setLogLevels: (levels: LogLevel[]) => void
	setLogQuery: (query: string) => void
}) {
	const logStreamRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!followLogs || !logStreamRef.current) return
		logStreamRef.current.scrollTop = logStreamRef.current.scrollHeight
	}, [followLogs, logs])

	const resetFilters = () => {
		setLogQuery('')
		setLogLevels(['debug', 'info', 'warn', 'error'])
		setActiveLogSources(logSources)
	}

	return (
		<div className="page">
			<header className="page-header safe-actions">
				<div>
					<h1>日志</h1>
					<p>实时 tail、筛选、详情与保留裁剪。</p>
				</div>
				<div className="header-actions">
					<button
						aria-pressed={followLogs}
						className={`soft-button ${followLogs ? 'soft-button--active' : ''}`}
						onClick={() => setFollowLogs(!followLogs)}
						type="button"
					>
						{followLogs ? <Activity size={15} /> : <Pause size={15} />}
						{followLogs ? '跟随最新' : '已暂停'}
					</button>
					<button
						className="soft-button"
						disabled={clearingLogs}
						onClick={() => {
							if (window.confirm('清空全部日志？此操作不可撤销。')) void clearLogs()
						}}
						type="button"
					>
						{clearingLogs ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
						{clearingLogs ? '正在清空' : '清空'}
					</button>
					<button
						className="primary-button"
						disabled={logs.length === 0}
						onClick={() => exportLauncherLogs(logs, settings.logs.defaultExportFormat)}
						type="button"
					>
						<Download size={15} />
						导出
					</button>
				</div>
			</header>

			<div className="log-toolbar">
				<label aria-label="搜索日志" className="search-field">
					<Search size={16} />
					<input
						onChange={(event) => setLogQuery(event.target.value)}
						placeholder="搜索消息、来源或画像"
						value={logQuery}
					/>
				</label>
				<div className="level-filter">
					{(['debug', 'info', 'warn', 'error'] as LogLevel[]).map((level) => (
						<button
							aria-pressed={logLevels.includes(level)}
							className={logLevels.includes(level) ? 'level-filter__item--active' : ''}
							key={level}
							onClick={() =>
								setLogLevels(
									logLevels.includes(level)
										? logLevels.filter((item) => item !== level)
										: [...logLevels, level],
								)
							}
							type="button"
						>
							<span className={`level-dot level-dot--${level}`} />
							{level}
						</button>
					))}
				</div>
				<div className="source-filter" aria-label="日志来源筛选">
					{logSources.map((source) => (
						<button
							aria-pressed={activeLogSources.includes(source)}
							className={activeLogSources.includes(source) ? 'source-filter__item--active' : ''}
							key={source}
							onClick={() =>
								setActiveLogSources(
									activeLogSources.includes(source)
										? activeLogSources.filter((item) => item !== source)
										: [...activeLogSources, source],
								)
							}
							type="button"
						>
							{source}
						</button>
					))}
				</div>
			</div>

			<div className="legend-row">
				<span>
					画像维度：
					{profiles.length > 0
						? profiles.map((profile) => profile.displayName).join(' / ')
						: '暂无画像'}
				</span>
				<span>保留策略由设置页控制</span>
			</div>

			{totalLogCount === 0 ? (
				<EmptyState title="还没有启动器日志">
					插件日志通道连接后，会在这里按时间线实时出现。
				</EmptyState>
			) : logs.length === 0 ? (
				<EmptyState
					action={resetFilters}
					actionIcon={X}
					actionLabel="重置筛选"
					title="没有匹配的日志"
				>
					调整关键词、级别或来源，或者重置全部筛选条件。
				</EmptyState>
			) : (
				<div
					className="log-stream"
					onScroll={(event) => {
						if (!followLogs) return
						const { clientHeight, scrollHeight, scrollTop } = event.currentTarget
						if (scrollHeight - scrollTop - clientHeight > 48) setFollowLogs(false)
					}}
					ref={logStreamRef}
				>
					{logs.map((entry) => (
						<LogRow entry={entry} key={entry.id} />
					))}
				</div>
			)}
		</div>
	)
}

function LogRow({ entry }: { entry: LauncherLogEntry }) {
	const [open, setOpen] = useState(false)
	const detailsId = `log-details-${entry.id}`
	return (
		<div className={`log-row log-row--${entry.level}`}>
			<button
				aria-controls={detailsId}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				type="button"
			>
				<span className="mono-text">{formatTime(entry.ts)}</span>
				<span className={`level-dot level-dot--${entry.level}`} />
				<span className="log-tag">{entry.source}</span>
				<span className="log-tag">{entry.browserId}</span>
				<strong>{entry.message}</strong>
				<ChevronDown className={open ? 'log-row__chevron--open' : ''} size={14} />
			</button>
			{open ? (
				<pre id={detailsId}>
					{JSON.stringify(entry.data ?? { context: entry.context }, null, 2)}
				</pre>
			) : null}
		</div>
	)
}

function TokensPage({
	loading,
	onRefresh,
	summary,
}: {
	loading: boolean
	onRefresh: () => Promise<void>
	summary: TokenUsageSummary
}) {
	const hasData = summary.totalTokens > 0
	return (
		<div className="page page--tokens">
			<header className="page-header safe-actions">
				<div>
					<h1>Tokens</h1>
					<p>当前账号的用量归因；成本按已配置模型价格估算，仅供参考。</p>
				</div>
				<div className="header-actions">
					<button
						className="soft-button"
						disabled={loading}
						onClick={() => void onRefresh()}
						type="button"
					>
						<RefreshCw className={loading ? 'spin' : ''} size={15} />
						{loading ? '同步中' : '刷新'}
					</button>
					<button
						className="primary-button"
						disabled={!hasData}
						onClick={() => exportTokenUsageSummary(summary)}
						type="button"
					>
						<Download size={15} />
						导出统计
					</button>
				</div>
			</header>

			<section aria-label="Tokens 总览" className="token-overview">
				<div className="token-overview__total">
					<span>总 tokens</span>
					<strong>{formatNumber(summary.totalTokens)}</strong>
				</div>
				<div className="token-overview__details">
					<div>
						<span>输入</span>
						<strong>{formatNumber(summary.totalInputTokens)}</strong>
					</div>
					<div>
						<span>输出</span>
						<strong>{formatNumber(summary.totalOutputTokens)}</strong>
					</div>
					<div>
						<span>估算成本</span>
						<strong>¥{summary.estimatedCostCny.toFixed(4)}</strong>
					</div>
				</div>
			</section>

			{hasData ? (
				<div className="token-sections">
					<div className="token-distributions">
						<TokenPanel title="按浏览器画像" buckets={summary.byBrowser} />
						<TokenPanel title="按模型" buckets={summary.byModel} />
					</div>
					<TokenPanel flow title="日期趋势" buckets={summary.daily} />
					<section className="usage-history">
						<h2>最近调用</h2>
						<table>
							<thead>
								<tr>
									<th>时间</th>
									<th>模型</th>
									<th>用量</th>
								</tr>
							</thead>
							<tbody>
								{summary.recent.length > 0 ? (
									summary.recent.map((record) => (
										<tr key={record.id}>
											<td className="mono-text">{formatTime(record.ts)}</td>
											<td>{record.model}</td>
											<td>{formatNumber(record.totalTokens)} tokens</td>
										</tr>
									))
								) : (
									<tr>
										<td className="usage-history__empty" colSpan={3}>
											暂无最近调用
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</section>
				</div>
			) : (
				<EmptyState title={loading ? '正在同步 tokens' : '还没有 tokens 记录'}>
					{loading
						? '正在读取当前账号的网关计量与本地缓存。'
						: '完成一次模型调用后，这里会汇总网关计量或已脱敏的本地缓存。'}
				</EmptyState>
			)}
		</div>
	)
}

function TokenPanel({
	buckets,
	flow = false,
	title,
}: {
	buckets: TokenUsageBucket[]
	flow?: boolean
	title: string
}) {
	const max = Math.max(...buckets.map((bucket) => bucket.totalTokens), 1)
	return (
		<section className={flow ? 'token-flow' : 'token-panel'}>
			<h2>{title}</h2>
			{buckets.map((bucket) => (
				<div className="usage-bar" key={bucket.key}>
					<div>
						<strong>{bucket.label}</strong>
						<span>{formatNumber(bucket.totalTokens)} tokens</span>
					</div>
					<span>
						<i style={{ width: `${Math.max(6, (bucket.totalTokens / max) * 100)}%` }} />
					</span>
				</div>
			))}
		</section>
	)
}

function SettingsPage({
	savedTick,
	saving,
	section,
	setMessage,
	setSection,
	settings,
	updateSettings,
	versions,
}: {
	savedTick: boolean
	saving: boolean
	section: SettingsSectionId
	setMessage: (message: string | null) => void
	setSection: (section: SettingsSectionId) => void
	settings: LauncherSettings
	updateSettings: (patch: LauncherSettingsPatch) => Promise<boolean>
	versions: AppVersions
}) {
	return (
		<div className="page page--settings">
			<header className="page-header safe-actions">
				<div>
					<h1>设置</h1>
					<p>批量启动、退出行为、日志、内核与关于。</p>
				</div>
				<div aria-live="polite" className="settings-save-state">
					{saving ? (
						<>
							<LoaderCircle className="spin" size={15} />
							正在保存
						</>
					) : savedTick ? (
						<>
							<Check size={15} />
							已保存
						</>
					) : (
						'修改后自动保存'
					)}
				</div>
			</header>

			<div className="settings-layout">
				<nav aria-label="设置分类" className="settings-tabs">
					{settingsSections.map((item) => (
						<button
							aria-current={section === item.id ? 'page' : undefined}
							className={section === item.id ? 'settings-tabs__item--active' : ''}
							key={item.id}
							onClick={() => setSection(item.id)}
							type="button"
						>
							{item.label}
						</button>
					))}
				</nav>
				<div aria-busy={saving} className="settings-panels" inert={saving}>
					{section === 'launch' ? (
						<section className="settings-panel">
							<h2>批量启动</h2>
							<p className="settings-panel__intro">控制“打开选中”队列，修改后下一批立即使用。</p>
							<NumberSetting
								hint="批量打开时的并发数量"
								label="同时打开上限"
								max={12}
								min={1}
								onChange={(value) => updateSettings({ launch: { concurrencyLimit: value } })}
								value={settings.launch.concurrencyLimit}
							/>
							<NumberSetting
								hint="降低同时启动时的资源峰值"
								label="错峰间隔"
								max={5000}
								min={0}
								onChange={(value) => updateSettings({ launch: { staggerMs: value } })}
								step={100}
								suffix="ms"
								value={settings.launch.staggerMs}
							/>
							<p className="settings-panel__note">
								<Info size={15} />
								窗口大小、起始页、画像类型、代理、缩放与语言将在运行时接入后开放。
							</p>
						</section>
					) : null}
					{section === 'behavior' ? (
						<section className="settings-panel">
							<h2>启动器行为</h2>
							<p className="settings-panel__intro">浏览器仍在运行时，决定关闭问学后的处理方式。</p>
							<SelectSetting
								label="退出处理"
								onChange={(value) =>
									updateSettings({
										behavior: {
											exitWithBrowsers: value as LauncherSettings['behavior']['exitWithBrowsers'],
										},
									})
								}
								options={[
									{ value: 'ask', label: '每次询问' },
									{ value: 'launcherOnly', label: '仅退出启动器' },
									{ value: 'closeBrowsers', label: '同时关闭浏览器' },
								]}
								value={settings.behavior.exitWithBrowsers}
							/>
							<p className="settings-panel__note">
								<Info size={15} />
								关闭按钮策略、开机自启与下载目录将在对应系统能力接入后开放。
							</p>
						</section>
					) : null}
					{section === 'logs' ? (
						<section className="settings-panel">
							<h2>日志</h2>
							<p className="settings-panel__intro">日志只保存在本机，并按时长和条数自动裁剪。</p>
							<NumberSetting
								hint="超过时长的记录会自动清理"
								label="保留时长"
								max={90}
								min={1}
								onChange={(value) => updateSettings({ logs: { retentionDays: value } })}
								suffix="天"
								value={settings.logs.retentionDays}
							/>
							<NumberSetting
								hint="超过上限时优先清理最旧记录"
								label="最大条数"
								max={100000}
								min={100}
								onChange={(value) => updateSettings({ logs: { maxEntries: value } })}
								step={100}
								value={settings.logs.maxEntries}
							/>
							<SelectSetting
								label="最低捕获级别"
								onChange={(value) => updateSettings({ logs: { minLevel: value as LogLevel } })}
								options={[
									{ value: 'debug', label: 'Debug' },
									{ value: 'info', label: 'Info' },
									{ value: 'warn', label: 'Warn' },
									{ value: 'error', label: 'Error' },
								]}
								value={settings.logs.minLevel}
							/>
							<SelectSetting
								label="默认导出格式"
								onChange={(value) =>
									updateSettings({
										logs: {
											defaultExportFormat: value as LauncherSettings['logs']['defaultExportFormat'],
										},
									})
								}
								options={[
									{ value: 'json', label: 'JSON' },
									{ value: 'ndjson', label: 'NDJSON' },
									{ value: 'text', label: '纯文本' },
								]}
								value={settings.logs.defaultExportFormat}
							/>
							<p className="settings-panel__note">
								<Info size={15} />
								LLM 请求与响应捕获将在采集链路接入后开放。
							</p>
						</section>
					) : null}
					{section === 'kernel' ? (
						<section className="settings-panel">
							<h2>浏览器内核</h2>
							<p className="settings-panel__intro">随问学安装并由启动器统一管理的运行时版本。</p>
							<div className="version-list">
								<span>Browser</span>
								<strong>{versions.browser}</strong>
								<span>Extension</span>
								<strong>{versions.extension}</strong>
							</div>
						</section>
					) : null}
					{section === 'about' ? (
						<section className="settings-panel">
							<h2>关于</h2>
							<p className="settings-panel__intro">问学 WenXue · ask for everything</p>
							<div className="version-list">
								<span>App</span>
								<strong>{versions.app}</strong>
								<span>Browser</span>
								<strong>{versions.browser}</strong>
								<span>Extension</span>
								<strong>{versions.extension}</strong>
							</div>
							<button
								className="soft-button"
								onClick={() => {
									void window.wenxue.app
										.openLogs()
										.then((result) => {
											if (!result.ok) {
												setMessage(result.error ?? strings.openLogsFallback)
											}
										})
										.catch((error: unknown) =>
											setMessage(readCloudBaseErrorMessage(error, strings.openLogsFallback)),
										)
								}}
								type="button"
							>
								<FolderOpen size={15} />
								打开日志目录
							</button>
						</section>
					) : null}
				</div>
			</div>
		</div>
	)
}

function NumberSetting({
	hint,
	label,
	max,
	min,
	onChange,
	step,
	suffix,
	value,
}: {
	hint?: string
	label: string
	max?: number
	min?: number
	onChange: (value: number) => Promise<boolean>
	step?: number
	suffix?: string
	value: number
}) {
	const [draft, setDraft] = useState(String(value))
	const [invalid, setInvalid] = useState(false)
	const [committing, setCommitting] = useState(false)
	const canonicalValueRef = useRef(value)
	const resolvedStep = step ?? 1

	useEffect(() => {
		canonicalValueRef.current = value
		setDraft(String(value))
	}, [value])

	const commit = async () => {
		const next = Number(draft)
		const stepOffset = next - (min ?? 0)
		const matchesStep =
			Math.abs(stepOffset / resolvedStep - Math.round(stepOffset / resolvedStep)) < 1e-9
		if (
			!draft.trim() ||
			!Number.isFinite(next) ||
			(min !== undefined && next < min) ||
			(max !== undefined && next > max) ||
			!matchesStep
		) {
			setInvalid(true)
			return
		}
		setInvalid(false)
		if (next === value) return
		setCommitting(true)
		try {
			if (!(await onChange(next))) setDraft(String(canonicalValueRef.current))
		} finally {
			setCommitting(false)
		}
	}

	return (
		<label className="setting-row">
			<SettingCopy hint={hint} label={label} />
			<div className="setting-control">
				<div className="setting-input-wrap">
					<input
						aria-invalid={invalid}
						disabled={committing}
						max={max}
						min={min}
						onBlur={() => void commit()}
						onChange={(event) => {
							setDraft(event.target.value)
							setInvalid(false)
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter') event.currentTarget.blur()
							if (event.key === 'Escape') {
								event.preventDefault()
								setDraft(String(value))
								setInvalid(false)
							}
						}}
						step={resolvedStep}
						type="number"
						value={draft}
					/>
					{suffix ? <span>{suffix}</span> : null}
				</div>
				{invalid ? (
					<small className="setting-error">
						{min !== undefined && max !== undefined
							? `请输入 ${min}–${max} 范围内、步长为 ${resolvedStep} 的数字`
							: min !== undefined
								? `请输入不小于 ${min}、步长为 ${resolvedStep} 的数字`
								: `请输入不大于 ${max}、步长为 ${resolvedStep} 的数字`}
					</small>
				) : null}
			</div>
		</label>
	)
}

function SelectSetting({
	label,
	onChange,
	options,
	value,
}: {
	label: string
	onChange: (value: string) => Promise<boolean>
	options: Array<{ label: string; value: string }>
	value: string
}) {
	return (
		<label className="setting-row">
			<SettingCopy label={label} />
			<div className="setting-control">
				<select onChange={(event) => void onChange(event.target.value)} value={value}>
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</div>
		</label>
	)
}

function SettingCopy({ hint, label }: { hint?: string; label: string }) {
	return (
		<span className="setting-copy">
			<strong>{label}</strong>
			{hint ? <small>{hint}</small> : null}
		</span>
	)
}

function StatusBadge({ compact = false, status }: { compact?: boolean; status: BrowserStatus }) {
	return (
		<span
			className={`status-badge status-badge--${status} ${compact ? 'status-badge--compact' : ''}`}
		>
			<i />
			{statusLabels[status]}
		</span>
	)
}

function EmptyState({
	action,
	actionIcon: ActionIcon = Plus,
	actionLabel,
	children,
	title,
}: {
	action?: () => void
	actionIcon?: LucideIcon
	actionLabel?: string
	children: string
	title: string
}) {
	return (
		<section className="empty-state">
			<div className="empty-state__mark">
				<img src="logo.png" alt="" />
			</div>
			<h2>{title}</h2>
			<p>{children}</p>
			{action && actionLabel ? (
				<button className="primary-button" onClick={action} type="button">
					<ActionIcon size={16} />
					{actionLabel}
				</button>
			) : null}
		</section>
	)
}

function sortProfiles(
	profiles: BrowserProfile[],
	mode: ProfileSortMode,
	statuses: Record<string, BrowserStatus>,
): BrowserProfile[] {
	return [...profiles].sort((a, b) => {
		if (mode === 'name') {
			return a.displayName.localeCompare(b.displayName, 'zh-CN')
		}
		if (mode === 'status') {
			const statusDiff =
				statusPriority[statuses[a.id] ?? 'idle'] - statusPriority[statuses[b.id] ?? 'idle']
			if (statusDiff !== 0) return statusDiff
		}
		const aTime = a.lastUsedAt ?? a.createdAt
		const bTime = b.lastUsedAt ?? b.createdAt
		return bTime - aTime
	})
}

function formatRelativeTime(ts: number | null): string {
	if (!ts) return '从未'
	const diff = Date.now() - ts
	if (diff < 60_000) return '刚刚'
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
	return `${Math.floor(diff / 86_400_000)} 天前`
}

function formatTime(ts: number): string {
	return new Intl.DateTimeFormat('zh-CN', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).format(ts)
}

function formatDate(ts: number): string {
	return new Intl.DateTimeFormat('zh-CN', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(ts)
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat('zh-CN').format(value)
}

function exportLauncherLogs(
	logs: LauncherLogEntry[],
	format: LauncherSettings['logs']['defaultExportFormat'],
): void {
	if (logs.length === 0) return

	const date = new Date().toISOString().slice(0, 10)
	const fileName = `wenxue-launcher-logs-${date}.${format === 'text' ? 'txt' : format}`
	const content =
		format === 'ndjson'
			? logs.map((entry) => JSON.stringify(entry)).join('\n')
			: format === 'text'
				? logs
						.map(
							(entry) =>
								`${new Date(entry.ts).toISOString()} [${entry.level}] ${entry.source}/${entry.browserId} ${entry.message}`,
						)
						.join('\n')
				: JSON.stringify(logs, null, 2)
	const blob = new Blob([`${content}\n`], {
		type: format === 'text' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8',
	})
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = fileName
	link.click()
	URL.revokeObjectURL(url)
}

function exportTokenUsageSummary(summary: TokenUsageSummary): void {
	if (summary.totalTokens === 0) return

	const date = new Date().toISOString().slice(0, 10)
	const blob = new Blob([`${JSON.stringify(summary, null, 2)}\n`], {
		type: 'application/json;charset=utf-8',
	})
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = `wenxue-token-usage-${date}.json`
	link.click()
	URL.revokeObjectURL(url)
}
