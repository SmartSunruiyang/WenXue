import type { ClientAnnouncementView, UpdateState } from '@wenxue/client-operations'
import { AnnouncementDialog, UpdateDialog } from '@wenxue/client-operations/react'
import type { LucideIcon } from 'lucide-react'
import {
	Activity,
	ArrowUpRight,
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
	Square,
	Trash2,
	UserRound,
	X,
} from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AccountSettings } from './AccountSettings'
import {
	getLauncherSession,
	readCloudBaseErrorMessage,
	refreshLauncherSession,
	signOutLauncher,
	toPublicUser,
	updateLauncherProfile,
	type LauncherAuthSession,
	type LauncherPublicUser,
} from './cloudbase'
import {
	DesktopAnnouncementService,
	type DesktopAnnouncementSnapshot,
} from './DesktopAnnouncementService'
import { ConfirmationProvider, PopupMenu, SelectField, useConfirmation } from './DesktopOverlays'
import { DesktopReleaseSignalService } from './DesktopReleaseSignalService'
import { EmailAuthScreen } from './EmailAuthScreen'
import {
	finishOnboarding,
	hasOnboardingMedia,
	shouldOfferOnboarding,
	type OnboardingOutcome,
} from './onboardingProgress'
import { OnboardingTour } from './OnboardingTour'
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
import { WindowCloseDialog } from './WindowCloseDialog'

const isMacPlatform = navigator.userAgent.includes('Macintosh')
const onboardingMediaAvailable = hasOnboardingMedia(
	Object.keys(
		import.meta.glob('../public/onboarding/*.mp4', {
			query: '?url',
			import: 'default',
			eager: true,
		}),
	),
)
declare const __WENXUE_UPDATE_CHANNEL__: string

type RouteId = 'browsers' | 'logs' | 'tokens' | 'settings'
type SettingsSectionId = 'account' | 'launch' | 'behavior' | 'logs' | 'kernel' | 'about'
type ProfileSortMode = 'recent' | 'name' | 'status'
type ProfileFilter = 'all' | BrowserStatus
type LogSource = LauncherLogEntry['source']

const routeItems: Array<{ id: RouteId; label: string; icon: LucideIcon }> = [
	{ id: 'logs', label: strings.logs.title, icon: ScrollText },
	{ id: 'tokens', label: strings.tokens.title, icon: CircleDollarSign },
]

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
	{ id: 'account', label: strings.settings.sections.account },
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
	const [closePromptOpen, setClosePromptOpen] = useState(false)
	return (
		<ConfirmationProvider labels={strings.dialog.actions}>
			<DesktopApp closePromptOpen={closePromptOpen} />
			<WindowCloseDialog copy={strings.windowClose} onOpenChange={setClosePromptOpen} />
		</ConfirmationProvider>
	)
}

function DesktopApp({ closePromptOpen }: { closePromptOpen: boolean }) {
	const confirm = useConfirmation()
	const [route, setRoute] = useState<RouteId>('browsers')
	const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('account')
	const [authReady, setAuthReady] = useState(false)
	const [authUser, setAuthUser] = useState<LauncherPublicUser | null>(null)
	const [onboardingAccountId, setOnboardingAccountId] = useState<string | null>(null)
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
	const [addingProfile, setAddingProfile] = useState(false)
	const [batchLaunching, setBatchLaunching] = useState(false)
	const [logsMutating, setLogsMutating] = useState(false)
	const [pendingProfileIds, setPendingProfileIds] = useState<string[]>([])
	const [logoutBusy, setLogoutBusy] = useState(false)
	const [savingSettings, setSavingSettings] = useState(false)
	const [savingProfile, setSavingProfile] = useState(false)
	const [tokensLoading, setTokensLoading] = useState(false)
	const [savedTick, setSavedTick] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [announcement, setAnnouncement] = useState<ClientAnnouncementView | null>(null)
	const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' })
	const [updateCheckNotice, setUpdateCheckNotice] = useState<string | null>(null)
	const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
	const avatarButtonRef = useRef<HTMLButtonElement>(null)
	const addingProfileRef = useRef(false)
	const batchLaunchingRef = useRef(false)
	const logoutBusyRef = useRef(false)
	const savingProfileRef = useRef(false)
	const profileRevisionRef = useRef(0)
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
			const profileRevision = profileRevisionRef.current
			const refreshed = await refreshLauncherSession()
			if (refreshed.userId !== current.userId) return null
			const synced = await window.wenxue.auth.setSession(refreshed)
			if (!synced.ok) throw new Error(synced.error ?? '账号 session 刷新失败')
			if (!savingProfileRef.current && profileRevision === profileRevisionRef.current) {
				setAuthUser((user) => (user?.userId === refreshed.userId ? toPublicUser(refreshed) : user))
			}
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

	const loadWorkspaceData = useCallback(async (userId: string) => {
		const [nextProfiles, nextStatuses, nextLogs, nextSettings, nextTokens, nextVersions] =
			await Promise.all([
				window.wenxue.browser.listProfiles(),
				window.wenxue.browser.getStatuses(),
				window.wenxue.logs.query({ limit: 600 }),
				window.wenxue.settings.get(),
				window.wenxue.tokens.getSummary(),
				window.wenxue.app.getVersions(),
			])
		setOnboardingAccountId(
			shouldOfferOnboarding(userId, nextProfiles.length, onboardingMediaAvailable) ? userId : null,
		)
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
		const resume = () => {
			releaseSignalServiceRef.current?.resume()
			void announcementServiceRef.current
				?.resume()
				.catch((error: unknown) =>
					setMessage(readCloudBaseErrorMessage(error, strings.announcement.syncError)),
				)
		}
		const resumeWhenVisible = () => {
			if (document.visibilityState === 'visible') resume()
		}
		window.addEventListener('online', resume)
		window.addEventListener('focus', resume)
		document.addEventListener('visibilitychange', resumeWhenVisible)
		return () => {
			window.removeEventListener('online', resume)
			window.removeEventListener('focus', resume)
			document.removeEventListener('visibilitychange', resumeWhenVisible)
		}
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
			const nextVersions = await loadWorkspaceData(session.userId)
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
			if (
				!(await confirm({
					title: strings.dialog.removeProfile.title,
					description: strings.dialog.removeProfile.description,
					confirmLabel: strings.browser.action.remove,
					danger: true,
				}))
			)
				return
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
		[beginProfileAction, confirm, endProfileAction],
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
			const nextVersions = await loadWorkspaceData(session.userId)
			setAuthUser(toPublicUser(session))
			void announcementServiceRef.current
				?.start(session, desktopPlatform(shellInfo.platform), nextVersions.app)
				.catch((error: unknown) =>
					setMessage(readCloudBaseErrorMessage(error, strings.announcement.syncError)),
				)
		},
		[loadWorkspaceData, shellInfo.platform],
	)

	const handleAuthenticated = useCallback(
		async (session: LauncherAuthSession) => {
			await syncSignedInSession(session)
			setMessage(null)
		},
		[syncSignedInSession],
	)

	const handleLogout = useCallback(async () => {
		if (
			logoutBusyRef.current ||
			savingProfileRef.current ||
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
				setOnboardingAccountId(null)
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
				setSettingsSection('account')
				setSavedTick(false)
				setRoute('browsers')
				setAvatarOpen(false)
			}
			logoutBusyRef.current = false
			setLogoutBusy(false)
		}
	}, [refreshProfiles])

	const saveProfile = useCallback(
		async (input: { nickname: string; avatar?: File }) => {
			if (!authUser || logoutBusyRef.current || savingProfileRef.current) {
				throw new Error(strings.auth.emailErrors.pending)
			}
			const userId = authUser.userId
			savingProfileRef.current = true
			profileRevisionRef.current += 1
			setSavingProfile(true)
			try {
				const user = await updateLauncherProfile({ userId, ...input })
				setAuthUser((current) => (current?.userId === user.userId ? user : current))
			} finally {
				savingProfileRef.current = false
				profileRevisionRef.current += 1
				setSavingProfile(false)
			}
		},
		[authUser],
	)

	const requestLogout = useCallback(async () => {
		setAvatarOpen(false)
		if (
			await confirm({
				title: strings.dialog.logout.title,
				description: strings.dialog.logout.description,
				confirmLabel: strings.dialog.logout.confirm,
			})
		)
			await handleLogout()
	}, [confirm, handleLogout])

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

	const restartUpdateInstaller = useCallback(async () => {
		setMessage(null)
		try {
			const result = await window.wenxue.updates.restartInstall()
			if (!result.ok) throw new Error(result.error ?? strings.update.installError)
			setUpdateState(result.state)
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.update.installError))
		}
	}, [])

	const openManualUpdateDownload = useCallback(async () => {
		setMessage(null)
		try {
			const result = await window.wenxue.updates.openManualDownload()
			if (!result.ok) throw new Error(result.error ?? strings.update.manualDownloadError)
			setUpdateState(result.state)
		} catch (error) {
			setMessage(readCloudBaseErrorMessage(error, strings.update.manualDownloadError))
		}
	}, [])

	const exitForUpdate = useCallback(async () => {
		const result = await window.wenxue.app.quit()
		if (!result.ok) setMessage(result.error ?? strings.error.closeWindow)
	}, [])

	const exitOnboarding = (outcome: OnboardingOutcome) => {
		if (!authUser) return
		const saved = finishOnboarding(authUser.userId, outcome)
		setOnboardingAccountId(null)
		setRoute('browsers')
		setAvatarOpen(false)
		if (!saved) setMessage(strings.onboarding.saveProgressError)
	}

	const interruptionLayer = (
		<DesktopInterruptionLayer
			announcement={authUser ? announcement : null}
			dismissedUpdate={dismissedUpdate}
			onAcknowledge={() => void acknowledgeAnnouncement()}
			onDismissUpdate={(key) => setDismissedUpdate(key)}
			onDownload={() => void downloadUpdate()}
			onExit={() => void exitForUpdate()}
			onOpenInstaller={() => void openUpdateInstaller()}
			onManualDownload={() => void openManualUpdateDownload()}
			onRestartInstall={() => void restartUpdateInstaller()}
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
				<EmailAuthScreen
					error={message}
					onAuthenticated={handleAuthenticated}
					onClearError={() => setMessage(null)}
					frameless={shellInfo.frameless}
					onOpenExternal={(url) => {
						void window.wenxue.app.openExternal(url).then(
							(result) => {
								if (!result.ok) setMessage(result.error ?? strings.auth.email.privacyOpenError)
							},
							() => setMessage(strings.auth.email.privacyOpenError),
						)
					}}
					windowControls={
						<WindowControls
							onError={setMessage}
							shellInfo={shellInfo}
							setShellInfo={setShellInfo}
						/>
					}
				/>
				{interruptionLayer}
			</>
		)
	}

	if (onboardingAccountId === authUser.userId) {
		return (
			<>
				<OnboardingTour
					key={authUser.userId}
					frameless={shellInfo.frameless}
					onExit={exitOnboarding}
					suspended={Boolean(
						closePromptOpen ||
						announcement ||
						visibleDesktopUpdateKey(updateState, dismissedUpdate),
					)}
					windowControls={
						<WindowControls
							onError={setMessage}
							shellInfo={shellInfo}
							setShellInfo={setShellInfo}
						/>
					}
				/>
				{interruptionLayer}
			</>
		)
	}

	return (
		<main
			className={`app-shell ${shellInfo.platform === 'darwin' ? 'app-shell--macos' : shellInfo.platform === 'win32' ? 'app-shell--windows' : ''} ${shellInfo.frameless ? 'app-shell--frameless' : ''}`}
		>
			{shellInfo.platform === 'win32' ? (
				<>
					<div className="top-drag-zone drag-region" />
					<WindowControls onError={setMessage} shellInfo={shellInfo} setShellInfo={setShellInfo} />
				</>
			) : null}
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
					<AccountAvatar key={authUser.userId} user={authUser} />
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
				<AvatarMenu
					open={avatarOpen}
					anchorRef={avatarButtonRef}
					logoutBusy={logoutBusy}
					setAvatarOpen={setAvatarOpen}
					setRoute={setRoute}
					setSettingsSection={setSettingsSection}
					user={authUser}
					versions={versions}
					workspaceBusy={
						addingProfile ||
						batchLaunching ||
						pendingProfileIds.length > 0 ||
						savingSettings ||
						savingProfile ||
						logsMutating
					}
					onLogout={requestLogout}
				/>
			</aside>

			<section
				aria-busy={logoutBusy}
				className={`main-surface ${logoutBusy ? 'main-surface--busy' : ''}`}
			>
				{shellInfo.platform !== 'win32' ? (
					<>
						<div className="top-drag-zone drag-region" />
						<WindowControls
							onError={setMessage}
							shellInfo={shellInfo}
							setShellInfo={setShellInfo}
						/>
					</>
				) : null}
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
						user={authUser}
						onSaveProfile={saveProfile}
						onLogout={requestLogout}
						logoutBusy={logoutBusy}
						accountDisabled={
							logoutBusy ||
							addingProfile ||
							batchLaunching ||
							pendingProfileIds.length > 0 ||
							savingSettings ||
							savingProfile ||
							logsMutating
						}
						checkForUpdates={() => checkForUpdates('about')}
						onReplayOnboarding={() => setOnboardingAccountId(authUser.userId)}
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
		</main>
	)
}

function visibleDesktopUpdateKey(state: UpdateState, dismissed: string | null): string | null {
	const release = 'release' in state ? state.release : undefined
	if (!release) return null
	const key = `${release.releaseId}:${release.mode}:${state.phase}`
	if (key === dismissed) return null
	return state.phase === 'available' ||
		state.phase === 'downloading' ||
		state.phase === 'ready' ||
		state.phase === 'opening' ||
		state.phase === 'handedOff' ||
		state.phase === 'error'
		? key
		: null
}

function DesktopInterruptionLayer({
	announcement,
	dismissedUpdate,
	onAcknowledge,
	onDismissUpdate,
	onDownload,
	onExit,
	onOpenInstaller,
	onManualDownload,
	onRestartInstall,
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
	onManualDownload: () => void
	onRestartInstall: () => void
	onOpenDetail: (url: string) => void
	onRetry: () => void
	updateState: UpdateState
}) {
	const release = 'release' in updateState ? updateState.release : undefined
	const updateKey = visibleDesktopUpdateKey(updateState, dismissedUpdate)
	const mandatory = release?.mode === 'mandatory'
	const updateVisible = updateKey !== null

	if (mandatory && updateVisible) {
		return (
			<UpdateDialog
				onDismiss={updateKey ? () => onDismissUpdate(updateKey) : undefined}
				onDownload={onDownload}
				onExit={onExit}
				onOpenInstaller={onOpenInstaller}
				onManualDownload={onManualDownload}
				onRestartInstall={onRestartInstall}
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
				onManualDownload={onManualDownload}
				onRestartInstall={onRestartInstall}
				onRetry={onRetry}
				state={updateState}
			/>
		)
	}
	if (updateState.phase === 'error' && !updateState.release) {
		const warningKey = `warning:${updateState.message}`
		if (dismissedUpdate === warningKey) return null
		return createPortal(
			<div aria-live="polite" className="desktop-update-warning no-drag" role="status">
				<Info aria-hidden size={16} />
				<span>{updateState.message}</span>
				<div className="desktop-update-warning__actions">
					{updateState.retryable ? (
						<button onClick={onRetry} type="button">
							<RefreshCw aria-hidden size={14} />
							重新检查
						</button>
					) : null}
					<button
						aria-label={strings.update.dismissWarning}
						className="desktop-update-warning__close"
						onClick={() => onDismissUpdate(warningKey)}
						title={strings.update.dismissWarning}
						type="button"
					>
						<X aria-hidden size={16} />
					</button>
				</div>
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

function AccountAvatar({ user }: { user: LauncherPublicUser }) {
	const [failedAvatarUrl, setFailedAvatarUrl] = useState<string>()
	const avatarUrl = user.avatarUrl !== failedAvatarUrl ? user.avatarUrl : undefined
	return (
		<img
			key={avatarUrl}
			className={avatarUrl ? 'user-avatar' : undefined}
			src={avatarUrl || 'logo.png'}
			alt=""
			onError={() => {
				if (avatarUrl) setFailedAvatarUrl(avatarUrl)
			}}
		/>
	)
}

function AvatarMenu({
	open,
	anchorRef,
	logoutBusy,
	onLogout,
	setAvatarOpen,
	setRoute,
	setSettingsSection,
	user,
	versions,
	workspaceBusy,
}: {
	open: boolean
	anchorRef: RefObject<HTMLButtonElement | null>
	logoutBusy: boolean
	onLogout: () => Promise<void>
	setAvatarOpen: (open: boolean) => void
	setRoute: (route: RouteId) => void
	setSettingsSection: (section: SettingsSectionId) => void
	user: LauncherPublicUser
	versions: AppVersions
	workspaceBusy: boolean
}) {
	return (
		<PopupMenu
			open={open}
			anchorRef={anchorRef}
			onClose={() => setAvatarOpen(false)}
			label={strings.account.menuLabel}
			className="avatar-menu no-drag"
			placement="right-start"
		>
			<div className="avatar-menu__head">
				<div className="avatar-menu__mark">
					<AccountAvatar key={user.userId} user={user} />
				</div>
				<div>
					<strong title={user.nickname}>{user.nickname || user.email || user.userId}</strong>
					<span title={user.email}>{user.email}</span>
				</div>
			</div>
			<button
				onClick={() => {
					setSettingsSection('account')
					setRoute('settings')
					setAvatarOpen(false)
				}}
				role="menuitem"
				type="button"
			>
				<UserRound size={16} />
				{strings.settings.sections.account}
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
				{strings.settings.sections.about}{' '}
				<span className="menu-meta">{formatPublicVersion(versions.app)}</span>
			</button>
			<button
				data-danger
				disabled={logoutBusy || workspaceBusy}
				onClick={() => void onLogout()}
				role="menuitem"
				title={workspaceBusy ? strings.dialog.logout.busy : undefined}
				type="button"
			>
				{logoutBusy ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
				{logoutBusy ? strings.dialog.logout.pending : strings.dialog.logout.confirm}
			</button>
		</PopupMenu>
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
					<SelectField
						className="browser-sort"
						label={strings.browser.sortLabel}
						disabled={props.batchLaunching}
						onChange={(value) => props.setProfileSort(value as ProfileSortMode)}
						value={props.profileSort}
						options={[
							{ value: 'recent', label: strings.browser.sort.recent },
							{ value: 'name', label: strings.browser.sort.name },
							{ value: 'status', label: strings.browser.sort.status },
						]}
					/>
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
	const [menuOpen, setMenuOpen] = useState(false)
	const closeMenu = () => setMenuOpen(false)
	const toggleMenu = () => setMenuOpen((open) => !open)

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
			<PopupMenu
				open={menuOpen}
				anchorRef={menuButtonRef}
				onClose={closeMenu}
				label={`${props.profile.displayName} · ${strings.browser.action.more}`}
				className="browser-profile-menu"
				id={`profile-menu-${props.profile.id}`}
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
					data-danger
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
			</PopupMenu>
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
	const confirm = useConfirmation()
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
							onClick={async () => {
								if (
									await confirm({
										title: strings.dialog.clearLogs.title,
										description: strings.logs.confirmClear,
										confirmLabel: strings.logs.clear,
										danger: true,
									})
								)
									await clearLogs()
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
				<details className="token-cost-note">
					<summary>{strings.tokens.costRules}</summary>
					<p>{strings.tokens.costHint}</p>
					<ul>
						{strings.tokens.costRates.map((rate) => (
							<li key={rate}>{rate}</li>
						))}
					</ul>
					<p>{strings.tokens.costFormula}</p>
					<p>{strings.tokens.costHistory}</p>
					<p>{strings.tokens.costCoverage}</p>
				</details>

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
	user,
	onSaveProfile,
	onLogout,
	logoutBusy,
	accountDisabled,
	checkForUpdates,
	onReplayOnboarding,
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
	user: LauncherPublicUser
	onSaveProfile: (input: { nickname: string; avatar?: File }) => Promise<void>
	onLogout: () => Promise<void>
	logoutBusy: boolean
	accountDisabled: boolean
	checkForUpdates: () => Promise<void>
	onReplayOnboarding: () => void
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
					<div aria-live="polite" className="settings-save-state" hidden={section === 'account'}>
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
						{section === 'account' ? (
							<AccountSettings
								user={user}
								onSave={onSaveProfile}
								onLogout={onLogout}
								logoutBusy={logoutBusy}
								disabled={accountDisabled}
							/>
						) : null}
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
									<strong>{formatPublicVersion(versions.extension)}</strong>
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
									<strong>{formatPublicVersion(versions.app)}</strong>
									<span>{strings.settings.kernel.browser}</span>
									<strong>{versions.browser}</strong>
									<span>{strings.settings.kernel.extension}</span>
									<strong>{formatPublicVersion(versions.extension)}</strong>
								</div>
								<p aria-live="polite" className="settings-panel__note">
									<Info size={15} />
									{updateCheckNotice ?? describeUpdateState(updateState)}
								</p>
								{updateState.lastInstallAttempt && (
									<p aria-live="polite" className="settings-panel__note">
										<Info size={15} />
										{`上次目标版本 v${formatPublicVersion(updateState.lastInstallAttempt.targetVersion)}：${strings.update.lastInstallAttempt[updateState.lastInstallAttempt.status]}`}
									</p>
								)}
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

									{onboardingMediaAvailable ? (
										<button className="soft-button" onClick={onReplayOnboarding} type="button">
											<RefreshCw size={15} />
											{strings.onboarding.reopen}
										</button>
									) : null}
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
		<div className="setting-row">
			<SettingCopy label={label} />
			<div className="setting-control">
				<SelectField
					label={label}
					onChange={(nextValue) => void onChange(nextValue)}
					value={value}
					options={options}
				/>
			</div>
		</div>
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

function formatPublicVersion(version: string): string {
	return version.replace(/-beta(?=\.|$)/i, 'beta').replace(/-preview(?=\.|$)/i, ' preview')
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
			return `${strings.update.status.available} v${formatPublicVersion(state.release.version)}`
		case 'downloading':
			return `${strings.update.status.downloading} ${Math.round(state.progress.percent)}%`
		case 'ready':
			return `${strings.update.status.ready} v${formatPublicVersion(state.release.version)}`
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
