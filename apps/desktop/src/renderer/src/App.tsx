import type { ClientAnnouncementView, UpdateState } from '@wenxue/client-operations'
import { AnnouncementDialog, UpdateDialog } from '@wenxue/client-operations/react'
import type { LucideIcon } from 'lucide-react'
import {
	Activity,
	ArrowUpDown,
	ArrowUpRight,
	Check,
	ChevronDown,
	CircleDollarSign,
	Copy,
	Download,
	Eye,
	EyeOff,
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
	Plus,
	RefreshCw,
	ScrollText,
	Search,
	Settings,
	Smartphone,
	Square,
	Trash2,
	UserPlus,
	X,
} from 'lucide-react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
	getLauncherPasswordComparison,
	getLauncherPasswordRequirements,
	getLauncherSession,
	getLauncherUsernameRequirements,
	readCloudBaseErrorMessage,
	refreshLauncherSession,
	registerLauncher,
	signInLauncher,
	signOutLauncher,
	toPublicUser,
	validateLauncherCredentials,
	type LauncherAuthSession,
	type LauncherPublicUser,
	type PasswordCharacterMatch,
} from './cloudbase'
import {
	DesktopAnnouncementService,
	type DesktopAnnouncementSnapshot,
} from './DesktopAnnouncementService'
import { DesktopReleaseSignalService } from './DesktopReleaseSignalService'
import { PhoneAuthForm } from './PhoneAuthForm'
import { executeSafeSignOut } from './safeSignOut'
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
declare const __WENXUE_UPDATE_CHANNEL__: string

type RouteId = 'browsers' | 'logs' | 'tokens' | 'settings'
type SettingsSectionId = 'launch' | 'behavior' | 'logs' | 'kernel' | 'about'
type ProfileSortMode = 'recent' | 'name' | 'status'
type ProfileFilter = 'all' | BrowserStatus
type LogSource = LauncherLogEntry['source']

const routeItems: Array<{ id: RouteId; label: string; icon: LucideIcon }> = [
	{ id: 'logs', label: strings.logs.title, icon: ScrollText },
	{ id: 'tokens', label: strings.tokens.title, icon: CircleDollarSign },
]

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
	{ id: 'launch', label: strings.settings.sections.launch },
	{ id: 'behavior', label: strings.settings.sections.behavior },
	{ id: 'logs', label: strings.settings.sections.logs },
	{ id: 'kernel', label: strings.settings.sections.kernel },
	{ id: 'about', label: strings.settings.sections.about },
]

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
	const [profileFilter, setProfileFilter] = useState<ProfileFilter>('all')
	const [logQuery, setLogQuery] = useState('')
	const [logLevels, setLogLevels] = useState<LogLevel[]>(['info', 'warn', 'error'])
	const [activeLogSources, setActiveLogSources] = useState<LogSource[]>(logSources)
	const [followLogs, setFollowLogs] = useState(true)
	const [avatarOpen, setAvatarOpen] = useState(false)
	const [phoneBindingUserId, setPhoneBindingUserId] = useState<string | null>(null)
	const [addingProfile, setAddingProfile] = useState(false)
	const [batchLaunching, setBatchLaunching] = useState(false)
	const [logsMutating, setLogsMutating] = useState(false)
	const [pendingProfileIds, setPendingProfileIds] = useState<string[]>([])
	const [logoutBusy, setLogoutBusy] = useState(false)
	const [savingSettings, setSavingSettings] = useState(false)
	const [tokensLoading, setTokensLoading] = useState(false)
	const [savedTick, setSavedTick] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [announcement, setAnnouncement] = useState<ClientAnnouncementView | null>(null)
	const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' })
	const [updateCheckNotice, setUpdateCheckNotice] = useState<string | null>(null)
	const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
	const avatarButtonRef = useRef<HTMLButtonElement>(null)
	const phoneBindingUserIdRef = useRef<string | null>(null)
	const addingProfileRef = useRef(false)
	const batchLaunchingRef = useRef(false)
	const logoutBusyRef = useRef(false)
	const logRefreshErrorRef = useRef<string | null>(null)
	const announcementErrorRef = useRef<string | null>(null)
	const logsMutationBusyRef = useRef(false)
	const pendingProfileActionsRef = useRef(new Set<string>())
	const settingsErrorRef = useRef<string | null>(null)
	const settingsQueueRef = useRef<Promise<void>>(Promise.resolve())
	const settingsPendingRef = useRef(0)
	const savedTimerRef = useRef<number | null>(null)
	const tokenRequestIdRef = useRef(0)
	const workspaceGenerationRef = useRef(0)
	const announcementServiceRef = useRef<DesktopAnnouncementService | null>(null)
	const releaseSignalServiceRef = useRef<DesktopReleaseSignalService | null>(null)
	announcementServiceRef.current ??= new DesktopAnnouncementService({
		refreshSession: async (current) => {
			const refreshed = await refreshLauncherSession()
			if (refreshed.userId !== current.userId) return null
			const synced = await window.wenxue.auth.setSession(refreshed)
			if (!synced.ok) throw new Error(synced.error ?? '账号 session 刷新失败')
			return refreshed
		},
	})
	releaseSignalServiceRef.current ??= new DesktopReleaseSignalService()

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
		return nextVersions
	}, [])

	useEffect(() => {
		const service = announcementServiceRef.current
		if (!service) return
		return service.subscribe((snapshot: DesktopAnnouncementSnapshot) => {
			setAnnouncement(snapshot.current)
			const previousError = announcementErrorRef.current
			const nextError = snapshot.error ?? null
			announcementErrorRef.current = nextError
			if (nextError) {
				setMessage(nextError)
			} else if (previousError) {
				setMessage((current) => (current === previousError ? null : current))
			}
		})
	}, [])

	useEffect(() => {
		let mounted = true
		const releaseSignalService = releaseSignalServiceRef.current
		const unsubscribe = window.wenxue.updates.onStateChange((state) => {
			setUpdateState(state)
			if (state.phase !== 'idle' && state.phase !== 'error') {
				setUpdateCheckNotice(null)
			}
		})
		void window.wenxue.updates
			.getState()
			.then((state) => {
				if (mounted) setUpdateState(state)
			})
			.catch((error: unknown) => {
				if (mounted) setMessage(readCloudBaseErrorMessage(error, strings.update.checkError))
			})
		releaseSignalService?.start('electron', readUpdateChannel(__WENXUE_UPDATE_CHANNEL__))
		return () => {
			mounted = false
			unsubscribe()
			releaseSignalService?.stop()
			announcementServiceRef.current?.stop()
		}
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
			const nextVersions = await loadWorkspaceData()
			if (mounted) {
				setAuthUser(toPublicUser(session))
				setAuthReady(true)
				void announcementServiceRef.current
					?.start(session, desktopPlatform(nextShellInfo.platform), nextVersions.app)
					.catch((error: unknown) =>
						setMessage(readCloudBaseErrorMessage(error, strings.announcement.syncError)),
					)
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
		const filtered = profiles.filter((profile) => {
			const matchesQuery =
				!text ||
				profile.displayName.toLowerCase().includes(text) ||
				profile.id.toLowerCase().includes(text) ||
				profile.userDataDir.toLowerCase().includes(text)
			const matchesStatus =
				profileFilter === 'all' ||
				(statuses[profile.id] ?? 'idle') === profileFilter ||
				selectedIds.includes(profile.id)
			return matchesQuery && matchesStatus
		})
		return sortProfiles(filtered, profileSort, statuses)
	}, [profileFilter, profileSort, profiles, query, selectedIds, statuses])

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
			setProfileFilter('all')
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
				setProfileFilter('all')
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
				setEditingId((current) => (current === profileId ? null : current))
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
			const nextVersions = await loadWorkspaceData()
			setAuthUser(toPublicUser(session))
			void announcementServiceRef.current
				?.start(session, desktopPlatform(shellInfo.platform), nextVersions.app)
				.catch((error: unknown) =>
					setMessage(readCloudBaseErrorMessage(error, strings.announcement.syncError)),
				)
		},
		[loadWorkspaceData, shellInfo.platform],
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

	const handlePhoneLogin = useCallback(
		async (session: LauncherAuthSession) => {
			await syncSignedInSession(session)
			setMessage(null)
		},
		[syncSignedInSession],
	)

	const closePhoneBinding = useCallback(() => {
		phoneBindingUserIdRef.current = null
		setPhoneBindingUserId(null)
	}, [])

	const handleLogout = useCallback(async () => {
		if (
			logoutBusyRef.current ||
			phoneBindingUserIdRef.current !== null ||
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
		let logoutCompleted = false
		try {
			await executeSafeSignOut({
				prepareSignOut: window.wenxue.auth.prepareSignOut,
				signOutCloud: signOutLauncher,
				hasCloudSession: async () => (await getLauncherSession()) !== null,
				clearSession: window.wenxue.auth.clearSession,
				cancelSignOut: window.wenxue.auth.cancelSignOut,
			})
			logoutCompleted = true
		} catch (error) {
			await refreshProfiles().catch(() => undefined)
			setMessage(readCloudBaseErrorMessage(error, strings.auth.error.logout))
		} finally {
			if (logoutCompleted) {
				announcementServiceRef.current?.stop()
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
				setProfileFilter('all')
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
	}, [refreshProfiles])

	const acknowledgeAnnouncement = useCallback(async () => {
		const current = announcementServiceRef.current?.current()
		if (!current) return
		try {
			await announcementServiceRef.current?.acknowledge(current.id)
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.announcement.ackError))
		}
	}, [])

	const openAnnouncementDetail = useCallback(async (url: string) => {
		try {
			const result = await window.wenxue.app.openExternal(url)
			if (!result.ok) throw new Error(result.error ?? strings.announcement.openDetailError)
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.announcement.openDetailError))
		}
	}, [])

	const checkForUpdates = useCallback(async (surface: 'global' | 'about' = 'global') => {
		setDismissedUpdate(null)
		if (surface === 'about') {
			setUpdateCheckNotice(null)
		} else {
			setMessage(null)
		}
		try {
			const result = await window.wenxue.updates.check('manual')
			if (!result.ok) throw new Error(result.error ?? strings.update.checkError)
			setUpdateCheckNotice(null)
			setUpdateState(result.state)
		} catch (error) {
			const nextMessage = readCloudBaseErrorMessage(error, strings.update.checkError)
			if (surface === 'about') {
				setUpdateCheckNotice(nextMessage)
			} else {
				setMessage(nextMessage)
			}
		}
	}, [])

	const downloadUpdate = useCallback(async () => {
		setMessage(null)
		try {
			const result = await window.wenxue.updates.download()
			if (!result.ok) throw new Error(result.error ?? strings.update.downloadError)
			setUpdateState(result.state)
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.update.downloadError))
		}
	}, [])

	const openUpdateInstaller = useCallback(async () => {
		setMessage(null)
		try {
			const result = await window.wenxue.updates.openInstaller()
			if (!result.ok) throw new Error(result.error ?? strings.update.installError)
			setUpdateState(result.state)
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.update.installError))
		}
	}, [])

	const exitForUpdate = useCallback(async () => {
		const result = await window.wenxue.app.quit()
		if (!result.ok) setMessage(result.error ?? strings.error.closeWindow)
	}, [])

	const interruptionLayer = (
		<DesktopInterruptionLayer
			announcement={authUser ? announcement : null}
			dismissedUpdate={dismissedUpdate}
			onAcknowledge={() => void acknowledgeAnnouncement()}
			onDismissUpdate={(key) => setDismissedUpdate(key)}
			onDownload={() => void downloadUpdate()}
			onExit={() => void exitForUpdate()}
			onOpenInstaller={() => void openUpdateInstaller()}
			onOpenDetail={(url) => void openAnnouncementDetail(url)}
			onRetry={() => void checkForUpdates()}
			updateState={updateState}
		/>
	)

	if (!authReady) {
		return (
			<>
				<main className={`auth-shell ${shellInfo.frameless ? 'app-shell--frameless' : ''}`}>
					<div className="top-drag-zone drag-region" />
					<WindowControls onError={setMessage} shellInfo={shellInfo} setShellInfo={setShellInfo} />
					<div className="auth-loading">
						<LoaderCircle className="spin" size={18} />
						<span>{strings.auth.loading}</span>
					</div>
				</main>
				{interruptionLayer}
			</>
		)
	}

	if (!authUser) {
		return (
			<>
				<AuthScreen
					error={message}
					onLogin={handleLogin}
					onPhoneLogin={handlePhoneLogin}
					onRegister={handleRegister}
					shellInfo={shellInfo}
					setMessage={setMessage}
					setShellInfo={setShellInfo}
				/>
				{interruptionLayer}
			</>
		)
	}

	return (
		<main
			className={`app-shell ${shellInfo.platform === 'darwin' ? 'app-shell--macos' : ''} ${shellInfo.frameless ? 'app-shell--frameless' : ''}`}
		>
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
						onBindPhone={() => {
							if (logoutBusyRef.current) return
							phoneBindingUserIdRef.current = authUser.userId
							setPhoneBindingUserId(authUser.userId)
							setAvatarOpen(false)
						}}
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
							logsMutating ||
							phoneBindingUserId !== null
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
						profileFilter={profileFilter}
						profiles={visibleProfiles}
						pendingProfileIds={pendingProfileIds}
						query={query}
						removeProfile={removeProfile}
						selectedIds={selectedIds}
						setDraftName={setDraftName}
						setEditingId={setEditingId}
						setProfileSort={setProfileSort}
						setProfileFilter={setProfileFilter}
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
					<TokensPage
						loading={tokensLoading}
						onRefresh={refreshTokens}
						profiles={profiles}
						summary={tokens}
					/>
				) : null}
				{route === 'settings' ? (
					<SettingsPage
						checkForUpdates={() => checkForUpdates('about')}
						savedTick={savedTick}
						saving={savingSettings}
						section={settingsSection}
						setMessage={setMessage}
						setSection={setSettingsSection}
						settings={settings}
						updateCheckNotice={updateCheckNotice}
						updateState={updateState}
						updateSettings={updateSettings}
						versions={versions}
					/>
				) : null}
			</section>
			{interruptionLayer}
			{phoneBindingUserId ? (
				<PhoneBindingDialog
					key={phoneBindingUserId}
					onAuthenticated={syncSignedInSession}
					onClose={closePhoneBinding}
					returnFocusRef={avatarButtonRef}
					userId={phoneBindingUserId}
				/>
			) : null}
		</main>
	)
}

function DesktopInterruptionLayer({
	announcement,
	dismissedUpdate,
	onAcknowledge,
	onDismissUpdate,
	onDownload,
	onExit,
	onOpenInstaller,
	onOpenDetail,
	onRetry,
	updateState,
}: {
	announcement: ClientAnnouncementView | null
	dismissedUpdate: string | null
	onAcknowledge: () => void
	onDismissUpdate: (key: string) => void
	onDownload: () => void
	onExit: () => void
	onOpenInstaller: () => void
	onOpenDetail: (url: string) => void
	onRetry: () => void
	updateState: UpdateState
}) {
	const release = 'release' in updateState ? updateState.release : undefined
	const updateKey = release ? `${release.releaseId}:${release.mode}:${updateState.phase}` : null
	const mandatory = release?.mode === 'mandatory'
	const updateVisible = Boolean(
		updateKey &&
		dismissedUpdate !== updateKey &&
		(updateState.phase === 'available' ||
			updateState.phase === 'downloading' ||
			updateState.phase === 'ready' ||
			updateState.phase === 'opening' ||
			updateState.phase === 'handedOff' ||
			updateState.phase === 'error'),
	)

	if (mandatory && updateVisible) {
		return (
			<UpdateDialog
				onDismiss={updateKey ? () => onDismissUpdate(updateKey) : undefined}
				onDownload={onDownload}
				onExit={onExit}
				onOpenInstaller={onOpenInstaller}
				onRetry={onRetry}
				state={updateState}
			/>
		)
	}
	if (announcement) {
		return (
			<AnnouncementDialog
				announcement={announcement}
				onAcknowledge={onAcknowledge}
				onDismiss={announcement.importance === 'normal' ? onAcknowledge : undefined}
				onOpenDetail={onOpenDetail}
			/>
		)
	}
	if (updateVisible) {
		return (
			<UpdateDialog
				onDismiss={updateKey ? () => onDismissUpdate(updateKey) : undefined}
				onDownload={onDownload}
				onExit={onExit}
				onOpenInstaller={onOpenInstaller}
				onRetry={onRetry}
				state={updateState}
			/>
		)
	}
	if (updateState.phase === 'error' && !updateState.release) {
		return createPortal(
			<div aria-live="polite" className="desktop-update-warning no-drag" role="status">
				<Info aria-hidden size={16} />
				<span>{updateState.message}</span>
				{updateState.retryable ? (
					<button onClick={onRetry} type="button">
						<RefreshCw aria-hidden size={14} />
						重新检查
					</button>
				) : null}
			</div>,
			document.body,
		)
	}
	return null
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
	onPhoneLogin,
	onRegister,
	shellInfo,
	setMessage,
	setShellInfo,
}: {
	error: string | null
	onLogin: (username: string, password: string) => Promise<void>
	onPhoneLogin: (session: LauncherAuthSession) => Promise<void>
	onRegister: (username: string, password: string) => Promise<void>
	shellInfo: AppShellInfo
	setMessage: (message: string | null) => void
	setShellInfo: (info: AppShellInfo) => void
}) {
	const [introVisible, setIntroVisible] = useState(
		() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	)
	const [mode, setMode] = useState<'login' | 'register'>('login')
	const [loginMethod, setLoginMethod] = useState<'password' | 'phone'>('password')
	const [phoneBusy, setPhoneBusy] = useState(false)
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordVisible, setPasswordVisible] = useState(false)
	const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false)
	const [activeConfirmationIndex, setActiveConfirmationIndex] = useState(-1)
	const [busy, setBusy] = useState(false)
	const [localError, setLocalError] = useState<string | null>(null)
	const isRegister = mode === 'register'
	const anyBusy = busy || phoneBusy
	const usernameRequirements = getLauncherUsernameRequirements(username)
	const usernameRules = [
		{ key: 'length', label: strings.auth.hint.username.length, valid: usernameRequirements.length },
		{
			key: 'firstCharacter',
			label: strings.auth.hint.username.firstCharacter,
			valid: usernameRequirements.firstCharacter,
		},
		{
			key: 'characterSet',
			label: strings.auth.hint.username.characterSet,
			valid: usernameRequirements.characterSet,
		},
	]
	const passwordRequirements = getLauncherPasswordRequirements(password)
	const passwordRules = [
		{ key: 'length', label: strings.auth.hint.password.length, valid: passwordRequirements.length },
		{
			key: 'firstCharacter',
			label: strings.auth.hint.password.firstCharacter,
			valid: passwordRequirements.firstCharacter,
		},
		{
			key: 'characterSet',
			label: strings.auth.hint.password.characterSet,
			valid: passwordRequirements.characterSet,
		},
		{
			key: 'complexity',
			label: strings.auth.hint.password.complexity,
			valid: passwordRequirements.complexity,
		},
	]
	const comparison = getLauncherPasswordComparison(password, confirmPassword)
	const confirmationHasError =
		confirmPassword.length > 0 &&
		(!password || comparison.firstMismatchIndex >= 0 || comparison.extraLength > 0)
	const confirmationState = !confirmPassword ? 'idle' : confirmationHasError ? 'invalid' : 'valid'
	const confirmationHint = !confirmPassword
		? strings.auth.hint.confirmation.idle
		: !password
			? strings.auth.hint.confirmation.missingPassword
			: comparison.firstMismatchIndex >= 0
				? strings.auth.hint.confirmation.mismatch(comparison.firstMismatchIndex + 1)
				: comparison.extraLength > 0
					? strings.auth.hint.confirmation.extra(comparison.extraLength)
					: comparison.confirmedLength === comparison.states.length
						? strings.auth.hint.confirmation.matched
						: strings.auth.hint.confirmation.progress(
								comparison.confirmedLength,
								comparison.states.length,
							)
	const showPasswordComparison = isRegister && password.length > 0 && confirmPassword.length > 0

	useEffect(() => {
		if (!introVisible) return
		const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
		const finishIntro = () => setIntroVisible(false)
		const handleMotionPreference = () => {
			if (motionPreference.matches) finishIntro()
		}
		const timeoutId = window.setTimeout(finishIntro, 2100)
		motionPreference.addEventListener('change', handleMotionPreference)
		return () => {
			window.clearTimeout(timeoutId)
			motionPreference.removeEventListener('change', handleMotionPreference)
		}
	}, [introVisible])

	const submit = async (event?: FormEvent<HTMLFormElement>) => {
		event?.preventDefault()
		if (busy) return
		setLocalError(null)
		setMessage(null)
		const validationCode = validateLauncherCredentials(username, password, mode)
		if (validationCode) {
			setLocalError(strings.auth.validation[validationCode])
			return
		}
		if (isRegister && !confirmPassword) {
			setLocalError(strings.auth.validation.confirmPasswordRequired)
			return
		}
		if (isRegister && password !== confirmPassword) {
			setLocalError(strings.auth.validation.passwordMismatch)
			return
		}
		setBusy(true)
		try {
			if (isRegister) {
				await onRegister(username, password)
			} else {
				await onLogin(username, password)
			}
		} catch (nextError) {
			setLocalError(readCloudBaseErrorMessage(nextError, strings.auth.error.operation))
		} finally {
			setBusy(false)
		}
	}

	return (
		<main className={`auth-shell ${shellInfo.frameless ? 'app-shell--frameless' : ''}`}>
			<div className="top-drag-zone drag-region" />
			<WindowControls onError={setMessage} shellInfo={shellInfo} setShellInfo={setShellInfo} />
			{introVisible ? (
				<div className="auth-intro" aria-hidden="true">
					<div className="auth-intro__brand">
						<img className="auth-intro__logo" src="logo.png" alt="" />
						<div className="auth-intro__slogan">
							<img src="slogan.png" alt="" />
						</div>
					</div>
				</div>
			) : (
				<div aria-busy={anyBusy} className="auth-card no-drag">
					<div className="auth-card__head">
						<h1>{isRegister ? strings.auth.title.register : strings.auth.title.login}</h1>
						<p>{isRegister ? strings.auth.description.register : strings.auth.description.login}</p>
					</div>
					<div className="segmented-control auth-card__modes" aria-label={strings.auth.modeLabel}>
						<button
							aria-pressed={!isRegister}
							className={!isRegister ? 'segmented-control__active' : ''}
							disabled={anyBusy}
							onClick={() => {
								setMode('login')
								setPasswordVisible(false)
								setConfirmPasswordVisible(false)
								setLocalError(null)
								setMessage(null)
							}}
							type="button"
						>
							<LogIn size={15} />
							{strings.auth.mode.login}
						</button>
						<button
							aria-pressed={isRegister}
							className={isRegister ? 'segmented-control__active' : ''}
							disabled={anyBusy}
							onClick={() => {
								setMode('register')
								setPasswordVisible(false)
								setConfirmPasswordVisible(false)
								setLocalError(null)
								setMessage(null)
							}}
							type="button"
						>
							<UserPlus size={15} />
							{strings.auth.mode.register}
						</button>
					</div>
					{!isRegister ? (
						<div
							aria-label={strings.auth.phone.methodLabel}
							className="auth-login-methods"
							role="group"
						>
							{(['password', 'phone'] as const).map((method) => (
								<button
									aria-pressed={loginMethod === method}
									disabled={anyBusy}
									key={method}
									onClick={() => {
										setLoginMethod(method)
										setLocalError(null)
										setMessage(null)
										setPasswordVisible(false)
										setConfirmPasswordVisible(false)
									}}
									type="button"
								>
									{method === 'password'
										? strings.auth.phone.passwordLogin
										: strings.auth.phone.smsLogin}
								</button>
							))}
						</div>
					) : null}
					{!isRegister && loginMethod === 'phone' ? (
						<>
							<PhoneAuthForm onAuthenticated={onPhoneLogin} onBusyChange={setPhoneBusy} />
							{error ? (
								<div className="auth-alert" role="alert">
									{error}
								</div>
							) : null}
						</>
					) : (
						<form className="auth-credentials" onSubmit={(event) => void submit(event)}>
							<div className="auth-field">
								<label htmlFor="auth-username">{strings.auth.field.username}</label>
								<input
									aria-describedby={isRegister ? 'auth-username-hint' : undefined}
									aria-invalid={
										isRegister && username.length > 0 && usernameRules.some((rule) => !rule.valid)
									}
									autoComplete="username"
									autoFocus
									disabled={busy}
									id="auth-username"
									onChange={(event) => setUsername(event.target.value)}
									type="text"
									value={username}
								/>
								{isRegister ? (
									<AuthRequirements
										id="auth-username-hint"
										hasInput={username.length > 0}
										rules={usernameRules}
									/>
								) : null}
							</div>
							<div className="auth-field">
								<label htmlFor="auth-password">{strings.auth.field.password}</label>
								<div
									className={`auth-password ${showPasswordComparison ? 'auth-password--comparing' : ''}`}
								>
									<input
										aria-describedby={isRegister ? 'auth-password-hint' : undefined}
										aria-invalid={
											isRegister && password.length > 0 && passwordRules.some((rule) => !rule.valid)
										}
										autoCapitalize="none"
										autoComplete={isRegister ? 'new-password' : 'current-password'}
										disabled={busy}
										id="auth-password"
										onChange={(event) => setPassword(event.target.value)}
										spellCheck={false}
										type={passwordVisible ? 'text' : 'password'}
										value={password}
									/>
									{showPasswordComparison ? (
										<PasswordComparison
											password={password}
											visible={passwordVisible}
											states={comparison.states}
											activeIndex={activeConfirmationIndex}
										/>
									) : null}
									<button
										aria-controls="auth-password"
										aria-label={
											passwordVisible
												? strings.auth.action.hidePassword
												: strings.auth.action.showPassword
										}
										className="auth-password__toggle"
										disabled={busy}
										onClick={() => setPasswordVisible((visible) => !visible)}
										title={
											passwordVisible
												? strings.auth.action.hidePassword
												: strings.auth.action.showPassword
										}
										type="button"
									>
										{passwordVisible ? (
											<EyeOff size={16} aria-hidden="true" />
										) : (
											<Eye size={16} aria-hidden="true" />
										)}
									</button>
								</div>
								{isRegister ? (
									<AuthRequirements
										id="auth-password-hint"
										hasInput={password.length > 0}
										rules={passwordRules}
									/>
								) : null}
							</div>
							{isRegister ? (
								<div className="auth-field">
									<label htmlFor="auth-confirm-password">
										{strings.auth.field.confirmPassword}
									</label>
									<div className="auth-password">
										<input
											aria-describedby="auth-confirm-password-hint"
											aria-invalid={confirmationHasError}
											autoCapitalize="none"
											autoComplete="new-password"
											disabled={busy}
											id="auth-confirm-password"
											onChange={(event) => {
												const value = event.target.value
												setConfirmPassword(value)
												setActiveConfirmationIndex(
													Array.from(value.slice(0, event.target.selectionStart ?? value.length))
														.length - 1,
												)
											}}
											spellCheck={false}
											type={confirmPasswordVisible ? 'text' : 'password'}
											value={confirmPassword}
										/>
										<button
											aria-controls="auth-confirm-password"
											aria-label={
												confirmPasswordVisible
													? strings.auth.action.hideConfirmPassword
													: strings.auth.action.showConfirmPassword
											}
											className="auth-password__toggle"
											disabled={busy}
											onClick={() => setConfirmPasswordVisible((visible) => !visible)}
											title={
												confirmPasswordVisible
													? strings.auth.action.hideConfirmPassword
													: strings.auth.action.showConfirmPassword
											}
											type="button"
										>
											{confirmPasswordVisible ? (
												<EyeOff size={16} aria-hidden="true" />
											) : (
												<Eye size={16} aria-hidden="true" />
											)}
										</button>
									</div>
									<span
										className="auth-field__hint auth-confirmation-hint"
										id="auth-confirm-password-hint"
										data-state={confirmationState}
										role="status"
									>
										{confirmationHint}
									</span>
								</div>
							) : null}
							{localError || error ? (
								<div className="auth-alert" role="alert">
									{localError ?? error}
								</div>
							) : null}
							<button className="primary-button auth-submit" disabled={busy} type="submit">
								{busy ? (
									<LoaderCircle className="spin" size={16} />
								) : isRegister ? (
									<UserPlus size={16} />
								) : (
									<LogIn size={16} />
								)}
								{busy
									? strings.auth.action.busy
									: isRegister
										? strings.auth.action.register
										: strings.auth.action.login}
							</button>
						</form>
					)}
				</div>
			)}
		</main>
	)
}

function AuthRequirements({
	id,
	hasInput,
	rules,
}: {
	id: string
	hasInput: boolean
	rules: Array<{ key: string; label: string; valid: boolean }>
}) {
	return (
		<ul className="auth-field__hint auth-requirements" id={id} aria-live="polite">
			{rules.map((rule) => {
				const state = !hasInput ? 'idle' : rule.valid ? 'valid' : 'invalid'
				const Icon = state === 'idle' ? Minus : rule.valid ? Check : X
				return (
					<li className="auth-requirement" data-state={state} key={rule.key}>
						<Icon size={12} aria-hidden="true" />
						<span>
							{rule.label}
							<span className="sr-only">，{strings.auth.hint.requirementState[state]}</span>
						</span>
					</li>
				)
			})}
		</ul>
	)
}

function PasswordComparison({
	password,
	visible,
	states,
	activeIndex,
}: {
	password: string
	visible: boolean
	states: PasswordCharacterMatch[]
	activeIndex: number
}) {
	const viewportRef = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const viewport = viewportRef.current
		if (!viewport) return
		const alignActiveCharacter = () => {
			const index = Math.max(0, Math.min(activeIndex, viewport.children.length - 1))
			const character = viewport.children[index] as HTMLElement | undefined
			if (!character) return
			const bounds = viewport.getBoundingClientRect()
			const { left, right } = character.getBoundingClientRect()
			if (left < bounds.left) viewport.scrollLeft -= Math.ceil(bounds.left - left)
			else if (right > bounds.right) {
				viewport.scrollLeft += Math.ceil(right - bounds.right)
			}
		}
		alignActiveCharacter()
		const observer = new ResizeObserver(alignActiveCharacter)
		observer.observe(viewport)
		return () => observer.disconnect()
	}, [password, visible, activeIndex])
	return (
		<div className="auth-password__comparison" aria-hidden="true" ref={viewportRef}>
			{Array.from(password).map((character, index) => (
				<span
					className="auth-password__character"
					data-state={states[index]}
					// eslint-disable-next-line @eslint-react/no-array-index-key -- Fixed positions retain cells; state changes replay only that cell's animation.
					key={`${index}:${states[index]}`}
				>
					{visible ? character : '•'}
				</span>
			))}
		</div>
	)
}

function PhoneBindingDialog({
	onAuthenticated,
	onClose,
	returnFocusRef,
	userId,
}: {
	onAuthenticated: (session: LauncherAuthSession) => Promise<void>
	onClose: () => void
	returnFocusRef: RefObject<HTMLButtonElement | null>
	userId: string
}) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const busyRef = useRef(false)
	const [busy, setBusy] = useState(false)
	const [complete, setComplete] = useState(false)

	useEffect(() => {
		const dialog = dialogRef.current
		dialog?.showModal()
		return () => {
			dialog?.close()
			returnFocusRef.current?.focus()
		}
	}, [returnFocusRef])

	const handleBusyChange = useCallback((nextBusy: boolean) => {
		busyRef.current = nextBusy
		setBusy(nextBusy)
	}, [])

	return (
		<dialog
			aria-describedby="phone-binding-description"
			aria-labelledby="phone-binding-title"
			className="phone-binding-dialog no-drag"
			onCancel={(event) => {
				event.preventDefault()
				if (!busyRef.current) onClose()
			}}
			ref={dialogRef}
		>
			<div className="phone-binding-dialog__head">
				<h2 id="phone-binding-title">{strings.auth.phone.bindTitle}</h2>
				<button
					aria-label={strings.auth.phone.close}
					className="phone-binding-dialog__close"
					disabled={busy}
					onClick={() => {
						if (!busyRef.current) onClose()
					}}
					title={strings.auth.phone.close}
					type="button"
				>
					<X size={18} />
				</button>
			</div>
			<p className="phone-binding-dialog__description" id="phone-binding-description">
				{strings.auth.phone.bindDescription}
			</p>
			{complete ? (
				<div className="phone-binding-dialog__complete">
					<p className="phone-auth-form__sent" role="status">
						<Check size={18} aria-hidden="true" />
						{strings.auth.phone.bindSuccess}
					</p>
					<button autoFocus className="primary-button" onClick={onClose} type="button">
						{strings.auth.phone.close}
					</button>
				</div>
			) : (
				<PhoneAuthForm
					onAuthenticated={async (session) => {
						await onAuthenticated(session)
						handleBusyChange(false)
						setComplete(true)
					}}
					onBusyChange={handleBusyChange}
					userId={userId}
				/>
			)}
		</dialog>
	)
}

function AvatarMenu({
	logoutBusy,
	onBindPhone,
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
	onBindPhone: () => void
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
			<button disabled={logoutBusy} onClick={onBindPhone} role="menuitem" type="button">
				<Smartphone size={15} />
				{strings.auth.phone.bindTitle}
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
	profileFilter: ProfileFilter
	profiles: BrowserProfile[]
	pendingProfileIds: string[]
	query: string
	removeProfile: (profileId: string) => Promise<void>
	selectedIds: string[]
	setDraftName: (name: string) => void
	setEditingId: (profileId: string | null) => void
	setProfileSort: (mode: ProfileSortMode) => void
	setProfileFilter: (filter: ProfileFilter) => void
	setQuery: (query: string) => void
	setSelectedIds: (ids: string[]) => void
	statuses: Record<string, BrowserStatus>
	stopProfile: (profileId: string) => Promise<void>
	viewLogs: () => void
}

function BrowserPage(props: BrowserPageProps) {
	const [selectionMode, setSelectionMode] = useState(props.selectedIds.length > 0)
	const selectAllRef = useRef<HTMLInputElement>(null)
	const searchRef = useRef<HTMLInputElement>(null)
	const counts: Record<ProfileFilter, number> = {
		all: props.allProfiles.length,
		running: 0,
		idle: 0,
		launching: 0,
		error: 0,
	}
	for (const profile of props.allProfiles) counts[props.statuses[profile.id] ?? 'idle']++
	const filters: ProfileFilter[] = ['all', 'running', 'idle']
	if (counts.launching > 0 || props.profileFilter === 'launching') filters.push('launching')
	if (counts.error > 0 || props.profileFilter === 'error') filters.push('error')
	const selectableIds = props.profiles
		.filter(
			(profile) =>
				props.selectedIds.includes(profile.id) ||
				(!props.pendingProfileIds.includes(profile.id) &&
					props.statuses[profile.id] !== 'launching'),
		)
		.map((profile) => profile.id)
	const allSelected =
		selectableIds.length > 0 && selectableIds.every((id) => props.selectedIds.includes(id))
	const someSelected = selectableIds.some((id) => props.selectedIds.includes(id))
	const selectionBusy = props.selectedIds.some(
		(id) => props.pendingProfileIds.includes(id) || props.statuses[id] === 'launching',
	)

	useEffect(() => {
		if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected
	}, [allSelected, selectionMode, someSelected])

	const resetFilters = () => {
		props.setQuery('')
		props.setProfileFilter('all')
		props.setSelectedIds([])
	}

	return (
		<div className="page page--browsers">
			<div className="browser-page-content">
				<header className="browser-page-header">
					<div>
						<h1>
							{strings.browser.title}
							<span className="browser-total" aria-label={strings.browser.total(counts.all)}>
								{counts.all}
							</span>
						</h1>
						<p>{strings.browser.description}</p>
					</div>
					<button
						className="browser-button browser-button--primary"
						disabled={props.addingProfile || props.batchLaunching}
						onClick={() => void props.addProfile()}
						type="button"
					>
						{props.addingProfile ? (
							<LoaderCircle aria-hidden className="spin" size={16} />
						) : (
							<Plus aria-hidden size={17} />
						)}
						{props.addingProfile ? strings.browser.action.creating : strings.browser.action.create}
					</button>
				</header>

				<div className="browser-tools">
					<div className="browser-search">
						<Search aria-hidden size={17} />
						<input
							aria-label={strings.browser.searchLabel}
							disabled={props.batchLaunching}
							onChange={(event) => {
								props.setQuery(event.target.value)
								props.setSelectedIds([])
							}}
							placeholder={strings.browser.searchPlaceholder}
							ref={searchRef}
							value={props.query}
						/>
						{props.query ? (
							<button
								aria-label={strings.browser.clearSearch}
								disabled={props.batchLaunching}
								onClick={() => {
									props.setQuery('')
									props.setSelectedIds([])
									searchRef.current?.focus()
								}}
								type="button"
							>
								<X aria-hidden size={15} />
							</button>
						) : null}
					</div>
					<label className="browser-sort">
						<ArrowUpDown aria-hidden size={16} />
						<select
							aria-label={strings.browser.sortLabel}
							disabled={props.batchLaunching}
							onChange={(event) => props.setProfileSort(event.target.value as ProfileSortMode)}
							value={props.profileSort}
						>
							<option value="recent">{strings.browser.sort.recent}</option>
							<option value="name">{strings.browser.sort.name}</option>
							<option value="status">{strings.browser.sort.status}</option>
						</select>
						<ChevronDown aria-hidden size={14} />
					</label>
					<button
						aria-pressed={selectionMode}
						className="browser-button browser-button--secondary"
						disabled={props.batchLaunching || props.allProfiles.length === 0}
						onClick={() => {
							setSelectionMode(!selectionMode)
							props.setSelectedIds([])
						}}
						type="button"
					>
						<Check aria-hidden size={16} />
						{selectionMode ? strings.browser.selection.finish : strings.browser.selection.start}
					</button>
				</div>

				<div className="browser-filterbar">
					<div className="browser-filters" role="group" aria-label={strings.browser.filterLabel}>
						{filters.map((filter) => (
							<button
								aria-pressed={props.profileFilter === filter}
								disabled={props.batchLaunching}
								key={filter}
								onClick={() => {
									props.setProfileFilter(filter)
									props.setSelectedIds([])
								}}
								type="button"
							>
								<span>{strings.browser.filters[filter]}</span>
								<span className="browser-filter-count">{counts[filter]}</span>
							</button>
						))}
					</div>
					{selectionMode ? (
						<label className="browser-select-all">
							<input
								checked={allSelected}
								disabled={props.batchLaunching || selectableIds.length === 0}
								onChange={() => props.setSelectedIds(allSelected ? [] : selectableIds)}
								ref={selectAllRef}
								type="checkbox"
							/>
							{strings.browser.selection.all}
						</label>
					) : null}
				</div>

				<div className="browser-results" aria-label={strings.browser.listLabel}>
					{props.profiles.length === 0 ? (
						<section className="browser-empty">
							<div className="browser-empty-icon">
								{counts.all === 0 ? (
									<Globe2 aria-hidden size={28} />
								) : (
									<Search aria-hidden size={28} />
								)}
							</div>
							<h2>
								{counts.all === 0
									? strings.browser.empty.title
									: strings.browser.empty.filteredTitle}
							</h2>
							<p>
								{counts.all === 0
									? strings.browser.empty.description
									: strings.browser.empty.filteredDescription}
							</p>
							<button
								className={`browser-button ${counts.all === 0 ? 'browser-button--primary' : 'browser-button--secondary'}`}
								disabled={props.addingProfile || props.batchLaunching}
								onClick={counts.all === 0 ? () => void props.addProfile() : resetFilters}
								type="button"
							>
								{counts.all === 0 ? <Plus aria-hidden size={16} /> : null}
								{counts.all === 0
									? props.addingProfile
										? strings.browser.action.creating
										: strings.browser.action.create
									: strings.browser.action.reset}
							</button>
						</section>
					) : (
						<ul className="profile-list" aria-label={strings.browser.listLabel}>
							{props.profiles.map((profile) => (
								<ProfileRow
									key={profile.id}
									profile={profile}
									selectionMode={selectionMode}
									{...props}
								/>
							))}
						</ul>
					)}
				</div>

				{selectionMode ? (
					<div className="browser-selection-bar">
						<div>
							<span aria-live="polite">
								{strings.browser.selection.count(props.selectedIds.length)}
							</span>
							<small>
								{props.batchLaunching
									? strings.browser.selection.busy
									: strings.browser.selection.hint}
							</small>
						</div>
						<button
							className="browser-button browser-button--primary"
							disabled={props.batchLaunching || selectionBusy || props.selectedIds.length === 0}
							onClick={() => void props.launchSelected()}
							type="button"
						>
							{props.batchLaunching ? (
								<LoaderCircle aria-hidden className="spin" size={16} />
							) : (
								<ArrowUpRight aria-hidden size={17} />
							)}
							{props.batchLaunching
								? strings.browser.action.launching
								: strings.browser.selection.launch(props.selectedIds.length)}
						</button>
					</div>
				) : null}
			</div>
		</div>
	)
}

function ProfileRow(props: BrowserPageProps & { profile: BrowserProfile; selectionMode: boolean }) {
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
		const menuWidth = 184
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
		if (props.batchLaunching || actionPending || launching) return
		props.setSelectedIds(
			selected
				? props.selectedIds.filter((id) => id !== props.profile.id)
				: [...props.selectedIds, props.profile.id],
		)
	}

	return (
		<li className={`profile-row profile-row--${status} ${selected ? 'profile-row--selected' : ''}`}>
			{props.selectionMode ? (
				<label className="checkbox-control">
					<input
						aria-label={strings.browser.selection.label(props.profile.displayName)}
						checked={selected}
						disabled={props.batchLaunching || actionPending || launching}
						onChange={toggleSelected}
						type="checkbox"
					/>
					<span />
				</label>
			) : null}
			<div className="profile-identity">
				<div className={`profile-avatar profile-avatar--${props.profile.colorKey}`}>
					{props.profile.displayName.slice(0, 1)}
				</div>
				<div className="profile-copy">
					{props.editingId === props.profile.id ? (
						<div
							className="rename-field"
							onBlur={(event) => {
								if (!event.currentTarget.contains(event.relatedTarget)) {
									void props.commitRename(props.profile.id)
								}
							}}
						>
							<input
								aria-label={`${strings.browser.action.rename} ${props.profile.displayName}`}
								autoFocus
								disabled={actionPending || props.batchLaunching}
								onChange={(event) => props.setDraftName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter' && !event.nativeEvent.isComposing)
										void props.commitRename(props.profile.id)
									if (event.key === 'Escape') props.setEditingId(null)
								}}
								value={props.draftName}
							/>
							<button
								aria-label={strings.browser.action.confirmRename}
								disabled={actionPending || props.batchLaunching}
								onClick={() => void props.commitRename(props.profile.id)}
								type="button"
							>
								<Check size={14} />
							</button>
							<button
								aria-label={strings.browser.action.cancelRename}
								disabled={actionPending || props.batchLaunching}
								onClick={() => props.setEditingId(null)}
								type="button"
							>
								<X size={14} />
							</button>
						</div>
					) : (
						<strong className="profile-name" title={props.profile.displayName}>
							{props.profile.displayName}
						</strong>
					)}
					<span className="profile-meta">{formatRelativeTime(props.profile.lastUsedAt)}</span>
				</div>
			</div>
			<StatusBadge status={status} />
			<div className="row-actions">
				<button
					className="row-primary-action"
					disabled={launching || actionPending || props.batchLaunching}
					onClick={() => void props.launchProfile(props.profile.id)}
					aria-label={`${running ? strings.browser.action.focus : failed ? strings.browser.action.retry : strings.browser.action.launch} ${props.profile.displayName}`}
					type="button"
				>
					{launching || actionPending ? (
						<LoaderCircle className="spin" size={15} />
					) : running ? (
						<Focus size={15} />
					) : failed ? (
						<RefreshCw size={15} />
					) : (
						<ArrowUpRight size={16} />
					)}
					<span>
						{launching
							? strings.browser.action.launching
							: actionPending
								? strings.browser.action.busy
								: running
									? strings.browser.action.focus
									: failed
										? strings.browser.action.retry
										: strings.browser.action.launch}
					</span>
				</button>
				<span className="profile-stop-slot">
					{running ? (
						<button
							aria-label={`${strings.browser.action.stop} ${props.profile.displayName}`}
							disabled={actionPending || props.batchLaunching}
							onClick={() => void props.stopProfile(props.profile.id)}
							title={strings.browser.action.stop}
							type="button"
						>
							<Square size={15} />
						</button>
					) : null}
				</span>
				<div className="row-more">
					<button
						aria-controls={`profile-menu-${props.profile.id}`}
						aria-expanded={menuOpen}
						aria-haspopup="menu"
						aria-label={`${props.profile.displayName} · ${strings.browser.action.more}`}
						className="row-more__trigger"
						disabled={actionPending || props.batchLaunching}
						onClick={toggleMenu}
						onKeyDown={(event) => {
							if (event.key !== 'ArrowDown' || menuOpen) return
							event.preventDefault()
							toggleMenu()
						}}
						ref={menuButtonRef}
						title={strings.browser.action.more}
						type="button"
					>
						<MoreHorizontal size={16} />
					</button>
				</div>
			</div>
			{menuOpen && menuPosition
				? createPortal(
						<div
							aria-label={`${props.profile.displayName} · ${strings.browser.action.more}`}
							className="row-more__menu browser-profile-menu"
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
									{strings.browser.action.logs}
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
								{strings.browser.action.rename}
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
								{strings.browser.action.duplicate}
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
								{strings.browser.action.folder}
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
								{strings.browser.action.remove}
							</button>
						</div>,
						document.body,
					)
				: null}
		</li>
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
	const logSearchRef = useRef<HTMLInputElement>(null)
	const profileNames = new Map(profiles.map((profile) => [profile.id, profile.displayName]))

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
		<div className="page page--logs">
			<div className="page-content">
				<header className="page-header safe-actions">
					<div>
						<h1>{strings.logs.title}</h1>
						<p>{strings.logs.description}</p>
					</div>
					<div className="header-actions">
						<button
							className="soft-button"
							disabled={clearingLogs || totalLogCount === 0}
							onClick={() => {
								if (window.confirm(strings.logs.confirmClear)) void clearLogs()
							}}
							type="button"
						>
							{clearingLogs ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
							{clearingLogs ? strings.logs.clearing : strings.logs.clear}
						</button>
						<button
							className="primary-button"
							disabled={logs.length === 0}
							onClick={() => exportLauncherLogs(logs, settings.logs.defaultExportFormat)}
							type="button"
						>
							<Download size={16} />
							{strings.logs.export}
						</button>
					</div>
				</header>
				<div className="log-toolbar">
					<div className="log-search-row">
						<div className="search-field">
							<Search aria-hidden size={16} />
							<input
								aria-label={strings.logs.searchLabel}
								onChange={(event) => setLogQuery(event.target.value)}
								placeholder={strings.logs.searchPlaceholder}
								ref={logSearchRef}
								type="search"
								value={logQuery}
							/>
							{logQuery ? (
								<button
									aria-label={strings.logs.clearSearch}
									className="search-clear"
									onClick={() => {
										setLogQuery('')
										logSearchRef.current?.focus()
									}}
									type="button"
								>
									<X aria-hidden size={15} />
								</button>
							) : null}
						</div>
						<button
							aria-pressed={followLogs}
							className={`soft-button ${followLogs ? 'soft-button--active' : ''}`}
							onClick={() => setFollowLogs(!followLogs)}
							type="button"
						>
							{followLogs ? <Activity size={16} /> : <Pause size={16} />}
							{followLogs ? strings.logs.follow : strings.logs.paused}
						</button>
					</div>
					<div className="log-filter-row">
						<span>{strings.logs.levelLabel}</span>
						<div aria-label={strings.logs.levelLabel} className="level-filter" role="group">
							{(['debug', 'info', 'warn', 'error'] as LogLevel[]).map((level) => (
								<button
									aria-pressed={logLevels.includes(level)}
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
									<span aria-hidden className={`level-dot level-dot--${level}`} />
									{strings.logs.level[level]}
								</button>
							))}
						</div>
					</div>
					<div className="log-filter-row">
						<span>{strings.logs.sourceLabel}</span>
						<div aria-label={strings.logs.sourceLabel} className="source-filter" role="group">
							{logSources.map((source) => (
								<button
									aria-pressed={activeLogSources.includes(source)}
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
									{strings.logs.source[source]}
								</button>
							))}
						</div>
					</div>
				</div>
				<div className="legend-row">
					<span>{strings.logs.count(logs.length, totalLogCount)}</span>
					<span>{strings.logs.retention(settings.logs.retentionDays)}</span>
				</div>
				{totalLogCount === 0 ? (
					<EmptyState icon={ScrollText} title={strings.logs.emptyTitle}>
						{strings.logs.emptyDescription}
					</EmptyState>
				) : logs.length === 0 ? (
					<EmptyState
						action={resetFilters}
						actionIcon={X}
						actionLabel={strings.logs.reset}
						icon={Search}
						title={strings.logs.filteredTitle}
					>
						{strings.logs.filteredDescription}
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
							<LogRow
								browserName={profileNames.get(entry.browserId) ?? entry.browserId}
								entry={entry}
								key={entry.id}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

function LogRow({ browserName, entry }: { browserName: string; entry: LauncherLogEntry }) {
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
				<span className="log-row__content">
					<strong title={entry.message}>{entry.message}</strong>
					<span className="log-row__meta">
						<span className="log-level">
							<i aria-hidden className={`level-dot level-dot--${entry.level}`} />
							{strings.logs.level[entry.level]}
						</span>
						<span>{strings.logs.source[entry.source]}</span>
						<span className="log-tag" title={browserName}>
							{browserName}
						</span>
					</span>
				</span>
				<ChevronDown aria-hidden className={open ? 'log-row__chevron--open' : ''} size={16} />
			</button>
			{open ? (
				<div className="log-details" id={detailsId}>
					<p>{entry.message}</p>
					<pre>{JSON.stringify(entry.data ?? { context: entry.context }, null, 2)}</pre>
				</div>
			) : null}
		</div>
	)
}

function TokensPage({
	loading,
	onRefresh,
	profiles,
	summary,
}: {
	loading: boolean
	onRefresh: () => Promise<void>
	profiles: BrowserProfile[]
	summary: TokenUsageSummary
}) {
	const profileNames = new Map(profiles.map((profile) => [profile.id, profile.displayName]))
	const displaySummary = {
		...summary,
		byBrowser: summary.byBrowser.map((bucket) => ({
			...bucket,
			label:
				bucket.key === 'cloud'
					? strings.tokens.unassignedBrowser
					: (profileNames.get(bucket.key) ?? bucket.label),
		})),
	}
	const hasData = summary.totalTokens > 0
	return (
		<div className="page page--tokens">
			<div className="page-content">
				<header className="page-header safe-actions">
					<div>
						<h1>{strings.tokens.title}</h1>
						<p>{strings.tokens.description}</p>
					</div>
					<div className="header-actions">
						<button
							className="soft-button"
							disabled={loading}
							onClick={() => void onRefresh()}
							type="button"
						>
							<RefreshCw className={loading ? 'spin' : ''} size={15} />
							{loading ? strings.tokens.refreshing : strings.tokens.refresh}
						</button>
						<button
							className="primary-button"
							disabled={!hasData}
							onClick={() => exportTokenUsageSummary(displaySummary)}
							type="button"
						>
							<Download size={15} />
							{strings.tokens.export}
						</button>
					</div>
				</header>

				<section
					aria-busy={loading}
					aria-label={strings.tokens.overview}
					className="token-overview"
				>
					<div className="token-overview__total">
						<span>{strings.tokens.total}</span>
						<strong>{loading && !hasData ? '—' : formatNumber(summary.totalTokens)}</strong>
					</div>
					<div className="token-overview__details">
						<div>
							<span>{strings.tokens.input}</span>
							<strong>{formatNumber(summary.totalInputTokens)}</strong>
						</div>
						<div>
							<span>{strings.tokens.output}</span>
							<strong>{formatNumber(summary.totalOutputTokens)}</strong>
						</div>
						<div>
							<span>{strings.tokens.cost}</span>
							<strong>¥{summary.estimatedCostCny.toFixed(4)}</strong>
						</div>
					</div>
				</section>
				<p className="token-cost-note">{strings.tokens.costHint}</p>

				{hasData ? (
					<div className="token-sections">
						<div className="token-distributions">
							<TokenPanel title={strings.tokens.byBrowser} buckets={displaySummary.byBrowser} />
							<TokenPanel title={strings.tokens.byModel} buckets={summary.byModel} />
						</div>
						<TokenPanel flow title={strings.tokens.daily} buckets={summary.daily} />
						<section className="usage-history">
							<h2>{strings.tokens.recent}</h2>
							<table>
								<thead>
									<tr>
										<th>{strings.tokens.time}</th>
										<th>{strings.tokens.model}</th>
										<th>{strings.tokens.usage}</th>
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
												{strings.tokens.noRecent}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</section>
					</div>
				) : (
					<EmptyState
						icon={CircleDollarSign}
						title={loading ? strings.tokens.loadingTitle : strings.tokens.emptyTitle}
					>
						{loading ? strings.tokens.loadingDescription : strings.tokens.emptyDescription}
					</EmptyState>
				)}
			</div>
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
			{buckets.length === 0 ? (
				<p className="section-empty">{strings.tokens.noDistribution}</p>
			) : null}
			{buckets.map((bucket) => (
				<div className="usage-bar" key={bucket.key}>
					<div>
						<strong>{bucket.label}</strong>
						<span>{formatNumber(bucket.totalTokens)} tokens</span>
					</div>
					<span>
						<i style={{ width: `${(bucket.totalTokens / max) * 100}%` }} />
					</span>
				</div>
			))}
		</section>
	)
}

function SettingsPage({
	checkForUpdates,
	savedTick,
	saving,
	section,
	setMessage,
	setSection,
	settings,
	updateCheckNotice,
	updateState,
	updateSettings,
	versions,
}: {
	checkForUpdates: () => Promise<void>
	savedTick: boolean
	saving: boolean
	section: SettingsSectionId
	setMessage: (message: string | null) => void
	setSection: (section: SettingsSectionId) => void
	settings: LauncherSettings
	updateCheckNotice: string | null
	updateState: UpdateState
	updateSettings: (patch: LauncherSettingsPatch) => Promise<boolean>
	versions: AppVersions
}) {
	return (
		<div className="page page--settings">
			<div className="page-content">
				<header className="page-header safe-actions">
					<div>
						<h1>{strings.settings.title}</h1>
						<p>{strings.settings.description}</p>
					</div>
					<div aria-live="polite" className="settings-save-state">
						{saving ? (
							<>
								<LoaderCircle className="spin" size={15} />
								{strings.settings.saving}
							</>
						) : savedTick ? (
							<>
								<Check size={15} />
								{strings.settings.saved}
							</>
						) : (
							strings.settings.autoSave
						)}
					</div>
				</header>

				<div className="settings-layout">
					<nav aria-label={strings.settings.navigation} className="settings-tabs">
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
								<h2>{strings.settings.sections.launch}</h2>
								<p className="settings-panel__intro">{strings.settings.launch.description}</p>
								<NumberSetting
									hint={strings.settings.launch.limitHint}
									label={strings.settings.launch.limit}
									max={12}
									min={1}
									onChange={(value) => updateSettings({ launch: { concurrencyLimit: value } })}
									value={settings.launch.concurrencyLimit}
								/>
								<NumberSetting
									hint={strings.settings.launch.staggerHint}
									label={strings.settings.launch.stagger}
									max={5000}
									min={0}
									onChange={(value) => updateSettings({ launch: { staggerMs: value } })}
									step={100}
									suffix={strings.settings.launch.unit}
									value={settings.launch.staggerMs}
								/>
							</section>
						) : null}
						{section === 'behavior' ? (
							<section className="settings-panel">
								<h2>{strings.settings.sections.behavior}</h2>
								<p className="settings-panel__intro">{strings.settings.behavior.description}</p>
								<SelectSetting
									label={strings.settings.behavior.exit}
									onChange={(value) =>
										updateSettings({
											behavior: {
												exitWithBrowsers: value as LauncherSettings['behavior']['exitWithBrowsers'],
											},
										})
									}
									options={[
										{ value: 'ask', label: strings.settings.behavior.ask },
										{ value: 'launcherOnly', label: strings.settings.behavior.launcherOnly },
										{ value: 'closeBrowsers', label: strings.settings.behavior.closeBrowsers },
									]}
									value={settings.behavior.exitWithBrowsers}
								/>
							</section>
						) : null}
						{section === 'logs' ? (
							<section className="settings-panel">
								<h2>{strings.settings.sections.logs}</h2>
								<p className="settings-panel__intro">{strings.settings.logs.description}</p>
								<NumberSetting
									hint={strings.settings.logs.retentionHint}
									label={strings.settings.logs.retention}
									max={90}
									min={1}
									onChange={(value) => updateSettings({ logs: { retentionDays: value } })}
									suffix={strings.settings.logs.unit}
									value={settings.logs.retentionDays}
								/>
								<NumberSetting
									hint={strings.settings.logs.limitHint}
									label={strings.settings.logs.limit}
									max={100000}
									min={100}
									onChange={(value) => updateSettings({ logs: { maxEntries: value } })}
									step={100}
									value={settings.logs.maxEntries}
								/>
								<SelectSetting
									label={strings.settings.logs.level}
									onChange={(value) => updateSettings({ logs: { minLevel: value as LogLevel } })}
									options={[
										{ value: 'debug', label: strings.logs.level.debug },
										{ value: 'info', label: strings.logs.level.info },
										{ value: 'warn', label: strings.logs.level.warn },
										{ value: 'error', label: strings.logs.level.error },
									]}
									value={settings.logs.minLevel}
								/>
								<SelectSetting
									label={strings.settings.logs.format}
									onChange={(value) =>
										updateSettings({
											logs: {
												defaultExportFormat:
													value as LauncherSettings['logs']['defaultExportFormat'],
											},
										})
									}
									options={[
										{ value: 'json', label: 'JSON' },
										{ value: 'ndjson', label: 'NDJSON' },
										{ value: 'text', label: strings.settings.logs.plainText },
									]}
									value={settings.logs.defaultExportFormat}
								/>
							</section>
						) : null}
						{section === 'kernel' ? (
							<section className="settings-panel">
								<h2>{strings.settings.sections.kernel}</h2>
								<p className="settings-panel__intro">{strings.settings.kernel.description}</p>
								<div className="version-list">
									<span>{strings.settings.kernel.browser}</span>
									<strong>{versions.browser}</strong>
									<span>{strings.settings.kernel.extension}</span>
									<strong>{versions.extension}</strong>
								</div>
							</section>
						) : null}
						{section === 'about' ? (
							<section className="settings-panel">
								<h2>{strings.settings.sections.about}</h2>
								<p className="settings-panel__intro">
									{strings.brand} · {strings.slogan}
								</p>
								<div className="version-list">
									<span>{strings.settings.about.version}</span>
									<strong>{versions.app}</strong>
									<span>{strings.settings.kernel.browser}</span>
									<strong>{versions.browser}</strong>
									<span>{strings.settings.kernel.extension}</span>
									<strong>{versions.extension}</strong>
								</div>
								<p aria-live="polite" className="settings-panel__note">
									<Info size={15} />
									{updateCheckNotice ?? describeUpdateState(updateState)}
								</p>
								<div className="settings-panel__actions">
									<button
										className="primary-button"
										disabled={
											updateState.phase === 'checking' ||
											updateState.phase === 'downloading' ||
											updateState.phase === 'opening'
										}
										onClick={() => void checkForUpdates()}
										type="button"
									>
										{updateState.phase === 'checking' ? (
											<LoaderCircle className="spin" size={15} />
										) : (
											<RefreshCw size={15} />
										)}
										{updateState.phase === 'checking'
											? strings.update.checkingAction
											: strings.update.checkAction}
									</button>
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
										{strings.settings.about.openLogs}
									</button>
								</div>
							</section>
						) : null}
					</div>
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
		// Persisted settings can change outside this input, so its local editing buffer must follow.
		// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
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
							? strings.settings.invalid.range(min, max, resolvedStep)
							: min !== undefined
								? strings.settings.invalid.min(min, resolvedStep)
								: strings.settings.invalid.max(max, resolvedStep)}
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

function StatusBadge({ status }: { status: BrowserStatus }) {
	return (
		<span className={`status-badge status-badge--${status}`}>
			<i aria-hidden />
			{strings.browser.status[status]}
		</span>
	)
}

function EmptyState({
	action,
	actionIcon: ActionIcon = Plus,
	actionLabel,
	children,
	icon: Icon = Info,
	title,
}: {
	action?: () => void
	actionIcon?: LucideIcon
	actionLabel?: string
	children: string
	icon?: LucideIcon
	title: string
}) {
	return (
		<section className="empty-state">
			<div className="empty-state__mark">
				<Icon aria-hidden size={24} strokeWidth={1.5} />
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
	if (!ts) return strings.browser.time.never
	const diff = Date.now() - ts
	if (diff < 60_000) return strings.browser.time.justNow
	if (diff < 3_600_000) return strings.browser.time.minutes(Math.floor(diff / 60_000))
	if (diff < 86_400_000) return strings.browser.time.hours(Math.floor(diff / 3_600_000))
	return strings.browser.time.days(Math.floor(diff / 86_400_000))
}

function formatTime(ts: number): string {
	return new Intl.DateTimeFormat('zh-CN', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).format(ts)
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat('zh-CN').format(value)
}

function readUpdateChannel(value: string): 'dev' | 'beta' | 'stable' {
	if (value === 'dev' || value === 'beta' || value === 'stable') return value
	return 'stable'
}

function desktopPlatform(value: string): 'darwin' | 'win32' {
	if (value === 'darwin' || value === 'win32') return value
	return isMacPlatform ? 'darwin' : 'win32'
}

function describeUpdateState(state: UpdateState): string {
	switch (state.phase) {
		case 'idle':
			return strings.update.status.idle
		case 'checking':
			return strings.update.status.checking
		case 'available':
			return `${strings.update.status.available} v${state.release.version}`
		case 'downloading':
			return `${strings.update.status.downloading} ${Math.round(state.progress.percent)}%`
		case 'ready':
			return `${strings.update.status.ready} v${state.release.version}`
		case 'opening':
			return strings.update.status.opening
		case 'handedOff':
			return strings.update.status.handedOff
		case 'error':
			return state.message
	}
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
