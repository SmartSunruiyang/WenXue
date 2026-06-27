import type { LucideIcon } from 'lucide-react'
import {
	Activity,
	Check,
	ChevronDown,
	CircleDollarSign,
	Clock,
	Copy,
	Download,
	Filter,
	Focus,
	FolderOpen,
	Info,
	LoaderCircle,
	LogOut,
	Pause,
	Pencil,
	Play,
	Plus,
	ScrollText,
	Search,
	Settings,
	Square,
	Trash2,
	User,
	X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
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

type RouteId = 'browsers' | 'logs' | 'tokens' | 'settings'
type SettingsSectionId = 'launch' | 'behavior' | 'logs' | 'kernel' | 'about'

const routeItems: Array<{ id: RouteId; label: string; icon: LucideIcon }> = [
	{ id: 'logs', label: '日志', icon: ScrollText },
	{ id: 'tokens', label: 'Tokens', icon: CircleDollarSign },
]

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
	{ id: 'launch', label: '启动默认值' },
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

export default function App() {
	const [route, setRoute] = useState<RouteId>('browsers')
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
	const [selectedIds, setSelectedIds] = useState<string[]>([])
	const [editingId, setEditingId] = useState<string | null>(null)
	const [draftName, setDraftName] = useState('')
	const [query, setQuery] = useState('')
	const [logQuery, setLogQuery] = useState('')
	const [logLevels, setLogLevels] = useState<LogLevel[]>(['info', 'warn', 'error'])
	const [followLogs, setFollowLogs] = useState(true)
	const [avatarOpen, setAvatarOpen] = useState(false)
	const [savedTick, setSavedTick] = useState(false)
	const [message, setMessage] = useState<string | null>(null)

	const refreshProfiles = useCallback(async () => {
		const [nextProfiles, nextStatuses] = await Promise.all([
			window.wenxue.browser.listProfiles(),
			window.wenxue.browser.getStatuses(),
		])
		setProfiles(sortProfiles(nextProfiles))
		setStatuses(nextStatuses)
	}, [])

	const refreshLogs = useCallback(async () => {
		const nextLogs = await window.wenxue.logs.query({ limit: 600 })
		setLogs(nextLogs.sort((a, b) => a.ts - b.ts))
	}, [])

	const refreshTokens = useCallback(async () => {
		setTokens(await window.wenxue.tokens.getSummary())
	}, [])

	useEffect(() => {
		let mounted = true
		const load = async () => {
			const [nextProfiles, nextStatuses, nextLogs, nextSettings, nextTokens, nextVersions] =
				await Promise.all([
					window.wenxue.browser.listProfiles(),
					window.wenxue.browser.getStatuses(),
					window.wenxue.logs.query({ limit: 600 }),
					window.wenxue.settings.get(),
					window.wenxue.tokens.getSummary(),
					window.wenxue.app.getVersions(),
				])
			if (!mounted) return
			setProfiles(sortProfiles(nextProfiles))
			setStatuses(nextStatuses)
			setLogs(nextLogs.sort((a, b) => a.ts - b.ts))
			setSettings(nextSettings)
			setTokens(nextTokens)
			setVersions(nextVersions)
		}

		void load().catch((error: unknown) => {
			setMessage(error instanceof Error ? error.message : '启动器数据加载失败')
		})

		const unsubscribeProfile = window.wenxue.browser.onProfileStatusChange((payload) => {
			setStatuses((current) => ({ ...current, [payload.profileId]: payload.status }))
		})
		const logTimer = window.setInterval(() => {
			if (followLogs) void refreshLogs()
		}, 2200)

		return () => {
			mounted = false
			unsubscribeProfile()
			window.clearInterval(logTimer)
		}
	}, [followLogs, refreshLogs])

	const visibleProfiles = useMemo(() => {
		const text = query.trim().toLowerCase()
		if (!text) return profiles
		return profiles.filter(
			(profile) =>
				profile.displayName.toLowerCase().includes(text) || profile.id.toLowerCase().includes(text),
		)
	}, [profiles, query])

	const visibleLogs = useMemo(() => {
		const text = logQuery.trim().toLowerCase()
		return logs
			.filter((entry) => logLevels.includes(entry.level))
			.filter((entry) => !text || entry.message.toLowerCase().includes(text))
			.slice(-160)
	}, [logLevels, logQuery, logs])

	const launchProfile = useCallback(
		async (profileId: string) => {
			setStatuses((current) => ({ ...current, [profileId]: 'launching' }))
			const result = await window.wenxue.browser.launchProfile(profileId)
			if (!result.ok) {
				setStatuses((current) => ({ ...current, [profileId]: 'error' }))
				setMessage(result.error ?? '浏览器启动失败')
				return
			}
			await refreshProfiles()
		},
		[refreshProfiles],
	)

	const stopProfile = useCallback(async (profileId: string) => {
		const result = await window.wenxue.browser.stopProfile(profileId)
		if (!result.ok) {
			setMessage(result.error ?? '浏览器停止失败')
			return
		}
		setStatuses((current) => ({ ...current, [profileId]: 'idle' }))
	}, [])

	const addProfile = useCallback(async () => {
		const result = await window.wenxue.browser.addProfile()
		if (!result.ok || !result.profile) {
			setMessage(result.error ?? '无法添加浏览器画像')
			return
		}
		setProfiles((current) => sortProfiles([...current, result.profile!]))
		setEditingId(result.profile.id)
		setDraftName(result.profile.displayName)
	}, [])

	const duplicateProfile = useCallback(async (profileId: string) => {
		const result = await window.wenxue.browser.duplicateProfile(profileId)
		if (!result.ok || !result.profile) {
			setMessage(result.error ?? '复制画像失败')
			return
		}
		setProfiles((current) => sortProfiles([...current, result.profile!]))
		setEditingId(result.profile.id)
		setDraftName(result.profile.displayName)
	}, [])

	const removeProfile = useCallback(async (profileId: string) => {
		if (!window.confirm('删除该浏览器画像？登录态、Cookie 与缓存会一并清除。')) return
		const result = await window.wenxue.browser.removeProfile(profileId)
		if (!result.ok) {
			setMessage(result.error ?? '删除画像失败')
			return
		}
		setProfiles((current) => current.filter((profile) => profile.id !== profileId))
		setSelectedIds((current) => current.filter((id) => id !== profileId))
		setStatuses((current) => {
			const next = { ...current }
			delete next[profileId]
			return next
		})
	}, [])

	const openProfileFolder = useCallback(async (profileId: string) => {
		const result = await window.wenxue.browser.openProfileFolder(profileId)
		if (!result.ok) {
			setMessage(result.error ?? '打开画像目录失败')
		}
	}, [])

	const commitRename = useCallback(
		async (profileId: string) => {
			const result = await window.wenxue.browser.renameProfile(profileId, draftName)
			if (!result.ok || !result.profile) {
				setMessage(result.error ?? '重命名失败')
				return
			}
			setProfiles((current) =>
				sortProfiles(
					current.map((profile) => (profile.id === profileId ? result.profile! : profile)),
				),
			)
			setEditingId(null)
			setDraftName('')
		},
		[draftName],
	)

	const launchSelected = useCallback(async () => {
		const ids = [...selectedIds]
		const limit = Math.max(1, settings.launch.concurrencyLimit)
		for (let i = 0; i < ids.length; i += limit) {
			const batch = ids.slice(i, i + limit)
			await Promise.all(
				batch.map(
					(profileId, index) =>
						new Promise<void>((resolve) => {
							window.setTimeout(() => {
								void launchProfile(profileId).then(resolve)
							}, index * settings.launch.staggerMs)
						}),
				),
			)
		}
		setSelectedIds([])
	}, [launchProfile, selectedIds, settings.launch.concurrencyLimit, settings.launch.staggerMs])

	const updateSettings = useCallback(async (patch: LauncherSettingsPatch) => {
		const result = await window.wenxue.settings.update(patch)
		if (!result.ok || !result.settings) {
			setMessage(result.error ?? '设置保存失败')
			return
		}
		setSettings(result.settings)
		setSavedTick(true)
		window.setTimeout(() => setSavedTick(false), 1200)
	}, [])

	const clearLogs = useCallback(async () => {
		const result = await window.wenxue.logs.clear()
		if (!result.ok) {
			setMessage(result.error ?? '清空日志失败')
			return
		}
		setLogs([])
	}, [])

	return (
		<main className="app-shell">
			<aside className="sidebar drag-region" aria-label="启动器导航">
				<button
					aria-label="本地资料"
					className="avatar-button no-drag"
					onClick={() => setAvatarOpen((open) => !open)}
					type="button"
				>
					<span>问</span>
				</button>
				<nav className="sidebar-nav no-drag">
					<RailButton
						active={route === 'browsers'}
						label="浏览器"
						onClick={() => setRoute('browsers')}
					>
						<ChromeMark />
					</RailButton>
					{routeItems.map((item) => (
						<RailButton
							active={route === item.id}
							icon={item.icon}
							key={item.id}
							label={item.label}
							onClick={() => setRoute(item.id)}
						/>
					))}
				</nav>
				<div className="sidebar-bottom no-drag">
					<RailButton
						active={route === 'settings'}
						icon={Settings}
						label="设置"
						onClick={() => setRoute('settings')}
					/>
				</div>
				{avatarOpen ? <AvatarMenu setRoute={setRoute} versions={versions} /> : null}
			</aside>

			<section className="main-surface">
				<div className="top-drag-zone drag-region">
					<span>WENXUE LAUNCHER</span>
				</div>
				{message ? (
					<div className="toast no-drag">
						<Info size={15} />
						<span>{message}</span>
						<button onClick={() => setMessage(null)} type="button">
							<X size={14} />
						</button>
					</div>
				) : null}
				{route === 'browsers' ? (
					<BrowserPage
						addProfile={addProfile}
						commitRename={commitRename}
						draftName={draftName}
						duplicateProfile={duplicateProfile}
						editingId={editingId}
						launchProfile={launchProfile}
						launchSelected={launchSelected}
						openProfileFolder={openProfileFolder}
						profiles={visibleProfiles}
						query={query}
						removeProfile={removeProfile}
						selectedIds={selectedIds}
						setDraftName={setDraftName}
						setEditingId={setEditingId}
						setQuery={setQuery}
						setSelectedIds={setSelectedIds}
						settings={settings}
						statuses={statuses}
						stopProfile={stopProfile}
					/>
				) : null}
				{route === 'logs' ? (
					<LogsPage
						clearLogs={clearLogs}
						followLogs={followLogs}
						logLevels={logLevels}
						logQuery={logQuery}
						logs={visibleLogs}
						profiles={profiles}
						settings={settings}
						setFollowLogs={setFollowLogs}
						setLogLevels={setLogLevels}
						setLogQuery={setLogQuery}
					/>
				) : null}
				{route === 'tokens' ? <TokensPage summary={tokens} /> : null}
				{route === 'settings' ? (
					<SettingsPage
						savedTick={savedTick}
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

function RailButton({ active, children, icon: Icon, label, onClick }: RailButtonProps) {
	return (
		<button
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

function ChromeMark() {
	return <i aria-hidden="true" className="chrome-mark" />
}

function AvatarMenu({
	setRoute,
	versions,
}: {
	setRoute: (route: RouteId) => void
	versions: AppVersions
}) {
	return (
		<div className="avatar-menu no-drag">
			<div className="avatar-menu__head">
				<div className="avatar-menu__mark">问</div>
				<div>
					<strong>本地资料</strong>
					<span>ask for everything</span>
				</div>
			</div>
			<button type="button">
				<User size={15} />
				资料
			</button>
			<button onClick={() => setRoute('settings')} type="button">
				<Settings size={15} />
				设置
			</button>
			<button type="button">
				<Info size={15} />
				关于 {versions.app}
			</button>
			<button type="button">
				<LogOut size={15} />
				退出
			</button>
		</div>
	)
}

interface BrowserPageProps {
	addProfile: () => void
	commitRename: (profileId: string) => void
	draftName: string
	duplicateProfile: (profileId: string) => Promise<void>
	editingId: string | null
	launchProfile: (profileId: string) => Promise<void>
	launchSelected: () => Promise<void>
	openProfileFolder: (profileId: string) => Promise<void>
	profiles: BrowserProfile[]
	query: string
	removeProfile: (profileId: string) => Promise<void>
	selectedIds: string[]
	setDraftName: (name: string) => void
	setEditingId: (profileId: string | null) => void
	setQuery: (query: string) => void
	setSelectedIds: (ids: string[]) => void
	settings: LauncherSettings
	statuses: Record<string, BrowserStatus>
	stopProfile: (profileId: string) => Promise<void>
}

function BrowserPage(props: BrowserPageProps) {
	const runningCount = props.profiles.filter(
		(profile) => props.statuses[profile.id] === 'running',
	).length
	const launchingCount = props.profiles.filter(
		(profile) => props.statuses[profile.id] === 'launching',
	).length
	const errorCount = props.profiles.filter(
		(profile) => props.statuses[profile.id] === 'error',
	).length
	const inspectorProfile =
		props.profiles.find((profile) => props.selectedIds.includes(profile.id)) ??
		props.profiles.find((profile) => props.statuses[profile.id] === 'running') ??
		props.profiles[0]

	return (
		<div className="page page--browsers">
			<header className="page-header safe-actions">
				<div>
					<h1>浏览器</h1>
					<p>持久画像、多账号隔离与批量启动。</p>
				</div>
				<div className="header-actions">
					<label className="search-field">
						<Search size={16} />
						<input
							onChange={(event) => props.setQuery(event.target.value)}
							placeholder="搜索画像、路径或标签"
							value={props.query}
						/>
					</label>
					<button className="soft-button" type="button">
						最近使用
						<ChevronDown size={15} />
					</button>
					<button className="primary-button" onClick={props.addProfile} type="button">
						<Plus size={16} />
						添加浏览器
					</button>
				</div>
			</header>

			<div className="metric-row">
				<MetricCard label="浏览器画像" value={props.profiles.length.toString()} />
				<MetricCard label="运行中" value={runningCount.toString()} tone="green" />
				<MetricCard label="启动队列" value={launchingCount.toString()} tone="coral" />
				<MetricCard label="插件错误" value={errorCount.toString()} tone="red" />
			</div>

			{props.profiles.length === 0 ? (
				<EmptyState
					action={props.addProfile}
					actionLabel="添加第一个浏览器"
					title="还没有浏览器画像"
				>
					创建一个持久画像后，登录态、Cookie 与缓存会保存在独立目录中。
				</EmptyState>
			) : (
				<div className="browser-workspace">
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
					<ProfileInspector
						launchProfile={props.launchProfile}
						profile={inspectorProfile}
						settings={props.settings}
						status={props.statuses[inspectorProfile.id] ?? 'idle'}
						stopProfile={props.stopProfile}
						versionsCount={props.profiles.length}
					/>
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
						onClick={() => void props.launchSelected()}
						type="button"
					>
						<Play size={16} />
						打开选中 ({props.selectedIds.length})
					</button>
					<button className="soft-button" onClick={() => props.setSelectedIds([])} type="button">
						取消选择
					</button>
				</div>
			) : null}
		</div>
	)
}

function MetricCard({
	label,
	value,
	tone = 'neutral',
}: {
	label: string
	value: string
	tone?: string
}) {
	return (
		<div className={`metric-card metric-card--${tone}`}>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	)
}

function ProfileRow(props: BrowserPageProps & { profile: BrowserProfile }) {
	const status = props.statuses[props.profile.id] ?? 'idle'
	const selected = props.selectedIds.includes(props.profile.id)
	const running = status === 'running'
	const launching = status === 'launching'

	const toggleSelected = () => {
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
				<input checked={selected} onChange={toggleSelected} type="checkbox" />
				<span />
			</label>
			<div className="profile-identity">
				<div className={`profile-avatar profile-avatar--${props.profile.colorKey}`}>
					{props.profile.displayName.slice(0, 1)}
				</div>
				<div>
					{props.editingId === props.profile.id ? (
						<div className="rename-field">
							<input
								autoFocus
								onChange={(event) => props.setDraftName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') props.commitRename(props.profile.id)
									if (event.key === 'Escape') props.setEditingId(null)
								}}
								value={props.draftName}
							/>
							<button onClick={() => props.commitRename(props.profile.id)} type="button">
								<Check size={14} />
							</button>
							<button onClick={() => props.setEditingId(null)} type="button">
								<X size={14} />
							</button>
						</div>
					) : (
						<button
							className="profile-name"
							onDoubleClick={() => {
								props.setEditingId(props.profile.id)
								props.setDraftName(props.profile.displayName)
							}}
							type="button"
						>
							{props.profile.displayName}
						</button>
					)}
					<span className="profile-id">{props.profile.id}</span>
				</div>
			</div>
			<StatusBadge status={status} />
			<span className="mono-text">{formatRelativeTime(props.profile.lastUsedAt)}</span>
			<div className="row-actions">
				<button
					disabled={launching}
					onClick={() =>
						running
							? void props.launchProfile(props.profile.id)
							: void props.launchProfile(props.profile.id)
					}
					title={running ? '聚焦' : '打开'}
					type="button"
				>
					{launching ? (
						<LoaderCircle className="spin" size={15} />
					) : running ? (
						<Focus size={15} />
					) : (
						<Play size={15} />
					)}
				</button>
				<button
					disabled={!running}
					onClick={() => void props.stopProfile(props.profile.id)}
					title="停止"
					type="button"
				>
					<Square size={15} />
				</button>
				<button
					onClick={() => {
						props.setEditingId(props.profile.id)
						props.setDraftName(props.profile.displayName)
					}}
					title="重命名"
					type="button"
				>
					<Pencil size={15} />
				</button>
				<button
					disabled={launching || running}
					onClick={() => void props.duplicateProfile(props.profile.id)}
					title="复制为新画像"
					type="button"
				>
					<Copy size={15} />
				</button>
				<button
					onClick={() => void props.openProfileFolder(props.profile.id)}
					title="打开画像文件夹"
					type="button"
				>
					<FolderOpen size={15} />
				</button>
				<button
					className="danger-icon"
					disabled={launching || running}
					onClick={() => void props.removeProfile(props.profile.id)}
					title="删除"
					type="button"
				>
					<Trash2 size={15} />
				</button>
			</div>
		</div>
	)
}

function ProfileInspector({
	launchProfile,
	profile,
	settings,
	status,
	stopProfile,
	versionsCount,
}: {
	launchProfile: (profileId: string) => Promise<void>
	profile: BrowserProfile
	settings: LauncherSettings
	status: BrowserStatus
	stopProfile: (profileId: string) => Promise<void>
	versionsCount: number
}) {
	const launching = status === 'launching'
	const running = status === 'running'

	return (
		<aside className="inspector-panel">
			<div className="inspector-head">
				<div className={`profile-avatar profile-avatar--${profile.colorKey}`}>
					{profile.displayName[0]}
				</div>
				<div>
					<strong>{profile.displayName}</strong>
					<StatusBadge status={status} />
				</div>
			</div>
			<button
				className="primary-button"
				disabled={launching}
				onClick={() => void launchProfile(profile.id)}
				type="button"
			>
				{launching ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
				{running ? '聚焦' : '打开'}
			</button>
			<button
				className="soft-button"
				disabled={!running}
				onClick={() => void stopProfile(profile.id)}
				type="button"
			>
				<Square size={16} />
				停止
			</button>
			<InspectorInfo label="画像目录" value={profile.userDataDir} />
			<InspectorInfo label="并发上限" value={`${settings.launch.concurrencyLimit} 个`} />
			<InspectorInfo label="错峰间隔" value={`${settings.launch.staggerMs} ms`} />
			<InspectorInfo label="画像数量" value={`${versionsCount} 个`} />
			<div className="recent-log-card">
				<span>近期日志</span>
				<p>等待浏览器内问学插件发送遥测日志。</p>
			</div>
		</aside>
	)
}

function InspectorInfo({ label, value }: { label: string; value: string }) {
	return (
		<div className="inspector-info">
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	)
}

function LogsPage({
	clearLogs,
	followLogs,
	logLevels,
	logQuery,
	logs,
	profiles,
	settings,
	setFollowLogs,
	setLogLevels,
	setLogQuery,
}: {
	clearLogs: () => Promise<void>
	followLogs: boolean
	logLevels: LogLevel[]
	logQuery: string
	logs: LauncherLogEntry[]
	profiles: BrowserProfile[]
	settings: LauncherSettings
	setFollowLogs: (follow: boolean) => void
	setLogLevels: (levels: LogLevel[]) => void
	setLogQuery: (query: string) => void
}) {
	return (
		<div className="page">
			<header className="page-header safe-actions">
				<div>
					<h1>日志</h1>
					<p>实时 tail、筛选、详情与保留裁剪。</p>
				</div>
				<div className="header-actions">
					<button
						className={`soft-button ${followLogs ? 'soft-button--active' : ''}`}
						onClick={() => setFollowLogs(!followLogs)}
						type="button"
					>
						{followLogs ? <Activity size={15} /> : <Pause size={15} />}
						{followLogs ? '跟随最新' : '已暂停'}
					</button>
					<button
						className="soft-button"
						onClick={() => {
							if (window.confirm('清空全部日志？此操作不可撤销。')) void clearLogs()
						}}
						type="button"
					>
						<Trash2 size={15} />
						清空
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
				<label className="search-field">
					<Search size={16} />
					<input
						onChange={(event) => setLogQuery(event.target.value)}
						placeholder="全文搜索日志"
						value={logQuery}
					/>
				</label>
				<div className="level-filter">
					{(['debug', 'info', 'warn', 'error'] as LogLevel[]).map((level) => (
						<button
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
				<button className="soft-button" type="button">
					<Filter size={15} />
					筛选
				</button>
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

			{logs.length === 0 ? (
				<EmptyState
					action={() => setFollowLogs(true)}
					actionLabel="跟随最新"
					title="还没有启动器日志"
				>
					插件日志通道连接后，会在这里按时间线实时出现。
				</EmptyState>
			) : (
				<div className="log-stream">
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
	return (
		<div className={`log-row log-row--${entry.level}`}>
			<button onClick={() => setOpen(!open)} type="button">
				<span className="mono-text">{formatTime(entry.ts)}</span>
				<span className={`level-dot level-dot--${entry.level}`} />
				<span className="log-tag">{entry.source}</span>
				<span className="log-tag">{entry.browserId}</span>
				<strong>{entry.message}</strong>
				<ChevronDown size={14} />
			</button>
			{open ? <pre>{JSON.stringify(entry.data ?? { context: entry.context }, null, 2)}</pre> : null}
		</div>
	)
}

function TokensPage({ summary }: { summary: TokenUsageSummary }) {
	const hasData = summary.totalTokens > 0
	return (
		<div className="page page--tokens">
			<header className="page-header safe-actions">
				<div>
					<h1>Tokens</h1>
					<p>按画像、模型与日期查看本机消耗。</p>
				</div>
				<div className="header-actions">
					<button className="soft-button" type="button">
						<Clock size={15} />
						最近 30 天
					</button>
					<button className="primary-button" type="button">
						<Download size={15} />
						导出统计
					</button>
				</div>
			</header>

			<div className="token-summary-grid">
				<MetricCard label="输入 tokens" value={formatNumber(summary.totalInputTokens)} />
				<MetricCard
					label="输出 tokens"
					value={formatNumber(summary.totalOutputTokens)}
					tone="green"
				/>
				<MetricCard label="总 tokens" value={formatNumber(summary.totalTokens)} tone="blue" />
				<MetricCard
					label="估算成本"
					value={`¥${summary.estimatedCostCny.toFixed(4)}`}
					tone="coral"
				/>
			</div>

			{hasData ? (
				<div className="token-grid">
					<TokenPanel title="按浏览器画像" buckets={summary.byBrowser} />
					<TokenPanel title="按模型" buckets={summary.byModel} />
					<TokenPanel title="日期趋势" buckets={summary.daily} />
					<div className="token-panel">
						<h2>最近调用</h2>
						{summary.recent.map((record) => (
							<div className="usage-record" key={record.id}>
								<span className="mono-text">{formatTime(record.ts)}</span>
								<strong>{record.model}</strong>
								<span>{formatNumber(record.totalTokens)} tokens</span>
							</div>
						))}
					</div>
				</div>
			) : (
				<EmptyState action={() => undefined} actionLabel="等待遥测" title="还没有 tokens 记录">
					启动器会从已脱敏日志遥测或后续网关计量中汇总 tokens，不保存提示词正文。
				</EmptyState>
			)}
		</div>
	)
}

function TokenPanel({ buckets, title }: { buckets: TokenUsageBucket[]; title: string }) {
	const max = Math.max(...buckets.map((bucket) => bucket.totalTokens), 1)
	return (
		<div className="token-panel">
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
		</div>
	)
}

function SettingsPage({
	savedTick,
	settings,
	updateSettings,
	versions,
}: {
	savedTick: boolean
	settings: LauncherSettings
	updateSettings: (patch: LauncherSettingsPatch) => Promise<void>
	versions: AppVersions
}) {
	const [section, setSection] = useState<SettingsSectionId>('launch')

	return (
		<div className="page page--settings">
			<header className="page-header safe-actions">
				<div>
					<h1>设置</h1>
					<p>启动默认值、启动器行为、日志、内核与关于。</p>
				</div>
				{savedTick ? (
					<div className="saved-indicator">
						<Check size={15} />
						已保存
					</div>
				) : null}
			</header>

			<div className="settings-layout">
				<nav className="settings-tabs">
					{settingsSections.map((item) => (
						<button
							className={section === item.id ? 'settings-tabs__item--active' : ''}
							key={item.id}
							onClick={() => setSection(item.id)}
							type="button"
						>
							{item.label}
						</button>
					))}
				</nav>
				<div className="settings-panels">
					{section === 'launch' ? (
						<section className="settings-panel">
							<h2>启动默认值</h2>
							<NumberSetting
								label="默认窗口宽度"
								onChange={(value) => updateSettings({ launch: { windowWidth: value } })}
								value={settings.launch.windowWidth}
							/>
							<NumberSetting
								label="默认窗口高度"
								onChange={(value) => updateSettings({ launch: { windowHeight: value } })}
								value={settings.launch.windowHeight}
							/>
							<TextSetting
								label="起始页 URL"
								onChange={(value) => updateSettings({ launch: { startUrl: value } })}
								value={settings.launch.startUrl}
							/>
							<NumberSetting
								label="同时打开上限"
								onChange={(value) => updateSettings({ launch: { concurrencyLimit: value } })}
								value={settings.launch.concurrencyLimit}
							/>
							<NumberSetting
								label="错峰间隔 ms"
								onChange={(value) => updateSettings({ launch: { staggerMs: value } })}
								value={settings.launch.staggerMs}
							/>
							<SelectSetting
								label="新建画像类型"
								onChange={(value) =>
									updateSettings({
										launch: { profileType: value as LauncherSettings['launch']['profileType'] },
									})
								}
								options={['persistent', 'incognito']}
								value={settings.launch.profileType}
							/>
							<SelectSetting
								label="代理模式"
								onChange={(value) =>
									updateSettings({
										launch: { proxyMode: value as LauncherSettings['launch']['proxyMode'] },
									})
								}
								options={['none', 'system', 'custom']}
								value={settings.launch.proxyMode}
							/>
							<NumberSetting
								label="默认缩放"
								onChange={(value) => updateSettings({ launch: { zoom: value } })}
								value={settings.launch.zoom}
							/>
							<SelectSetting
								label="界面语言"
								onChange={(value) => updateSettings({ launch: { language: value } })}
								options={['zh-CN', 'en-US']}
								value={settings.launch.language}
							/>
						</section>
					) : null}
					{section === 'behavior' ? (
						<section className="settings-panel">
							<h2>启动器行为</h2>
							<SelectSetting
								label="关闭按钮行为"
								onChange={(value) =>
									updateSettings({
										behavior: {
											closeAction: value as LauncherSettings['behavior']['closeAction'],
										},
									})
								}
								options={['ask', 'minimizeToTray', 'quit']}
								value={settings.behavior.closeAction}
							/>
							<SelectSetting
								label="退出处理"
								onChange={(value) =>
									updateSettings({
										behavior: {
											exitWithBrowsers: value as LauncherSettings['behavior']['exitWithBrowsers'],
										},
									})
								}
								options={['ask', 'launcherOnly', 'closeBrowsers']}
								value={settings.behavior.exitWithBrowsers}
							/>
							<CheckboxSetting
								checked={settings.behavior.openAtLogin}
								label="开机自启"
								onChange={(value) => updateSettings({ behavior: { openAtLogin: value } })}
							/>
							<TextSetting
								label="默认下载目录"
								onChange={(value) => updateSettings({ behavior: { downloadDir: value } })}
								value={settings.behavior.downloadDir}
							/>
						</section>
					) : null}
					{section === 'logs' ? (
						<section className="settings-panel">
							<h2>日志</h2>
							<NumberSetting
								label="保留时长 天"
								onChange={(value) => updateSettings({ logs: { retentionDays: value } })}
								value={settings.logs.retentionDays}
							/>
							<NumberSetting
								label="最大条数"
								onChange={(value) => updateSettings({ logs: { maxEntries: value } })}
								value={settings.logs.maxEntries}
							/>
							<SelectSetting
								label="最低捕获级别"
								onChange={(value) => updateSettings({ logs: { minLevel: value as LogLevel } })}
								options={['debug', 'info', 'warn', 'error']}
								value={settings.logs.minLevel}
							/>
							<CheckboxSetting
								checked={settings.logs.captureLlmRequests}
								label="捕获 LLM 请求"
								onChange={(value) => updateSettings({ logs: { captureLlmRequests: value } })}
							/>
							<CheckboxSetting
								checked={settings.logs.captureLlmResponses}
								label="捕获 LLM 响应"
								onChange={(value) => updateSettings({ logs: { captureLlmResponses: value } })}
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
								options={['json', 'ndjson', 'text']}
								value={settings.logs.defaultExportFormat}
							/>
						</section>
					) : null}
					{section === 'kernel' ? (
						<section className="settings-panel">
							<h2>浏览器内核</h2>
							<div className="about-card">
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
							<div className="about-card">
								<span>App</span>
								<strong>{versions.app}</strong>
								<span>Browser</span>
								<strong>{versions.browser}</strong>
								<span>Extension</span>
								<strong>{versions.extension}</strong>
							</div>
							<button
								className="soft-button"
								onClick={() => void window.wenxue.app.openLogs()}
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
	label,
	onChange,
	value,
}: {
	label: string
	onChange: (value: number) => void
	value: number
}) {
	return (
		<label className="setting-row">
			<span>{label}</span>
			<input
				onBlur={(event) => onChange(Number(event.target.value))}
				type="number"
				defaultValue={value}
			/>
		</label>
	)
}

function TextSetting({
	label,
	onChange,
	value,
}: {
	label: string
	onChange: (value: string) => void
	value: string
}) {
	return (
		<label className="setting-row">
			<span>{label}</span>
			<input onBlur={(event) => onChange(event.target.value)} type="text" defaultValue={value} />
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
	onChange: (value: string) => void
	options: string[]
	value: string
}) {
	return (
		<label className="setting-row">
			<span>{label}</span>
			<select onChange={(event) => onChange(event.target.value)} value={value}>
				{options.map((option) => (
					<option key={option}>{option}</option>
				))}
			</select>
		</label>
	)
}

function CheckboxSetting({
	checked,
	label,
	onChange,
}: {
	checked: boolean
	label: string
	onChange: (value: boolean) => void
}) {
	return (
		<label className="setting-row">
			<span>{label}</span>
			<input
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				type="checkbox"
			/>
		</label>
	)
}

function StatusBadge({ status }: { status: BrowserStatus }) {
	return (
		<span className={`status-badge status-badge--${status}`}>
			<i />
			{statusLabels[status]}
		</span>
	)
}

function EmptyState({
	action,
	actionLabel,
	children,
	title,
}: {
	action: () => void
	actionLabel: string
	children: string
	title: string
}) {
	return (
		<section className="empty-state">
			<div className="empty-state__mark">问</div>
			<h2>{title}</h2>
			<p>{children}</p>
			<button className="primary-button" onClick={action} type="button">
				<Plus size={16} />
				{actionLabel}
			</button>
		</section>
	)
}

function sortProfiles(profiles: BrowserProfile[]): BrowserProfile[] {
	return [...profiles].sort((a, b) => {
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
