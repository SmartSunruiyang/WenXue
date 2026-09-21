import {
	Activity,
	BarChart3,
	BellRing,
	CheckCircle2,
	CircleAlert,
	LogOut,
	PackageCheck,
	RefreshCw,
	Save,
	Shield,
	Users,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import type { UserStatusPatch } from './adminApi'
import { fetchMe, fetchUsageSummary, fetchUsers, patchUserStatus } from './adminApi'
import { AnnouncementPage } from './AnnouncementPage'
import { cloudbaseConfig, getAdminSession, signInAdmin, signOutAdmin } from './cloudbase'
import { ReleasePage } from './ReleasePage'
import type {
	AdminMe,
	AdminSession,
	AdminUsageSummary,
	UsageBucket,
	UserAccountView,
	UserStatus,
} from './types'

const EMPTY_SUMMARY: AdminUsageSummary = {
	totalInputTokens: 0,
	totalOutputTokens: 0,
	totalTokens: 0,
	byDay: [],
	byModel: [],
	byUser: [],
	recent: [],
	userStatus: {
		active: 0,
		disabled: 0,
		total: 0,
	},
}

type AdminView = 'dashboard' | 'users' | 'announcements' | 'releases'

const VIEW_COPY: Record<AdminView, { title: string; description: string }> = {
	dashboard: { title: 'Tokens 看板', description: '用量、模型和最近调用概览' },
	users: { title: '用户', description: '账号状态、用量与备注' },
	announcements: { title: '消息推送', description: '编辑固定弹窗并向目标账号立即推送' },
	releases: { title: '版本更新', description: '选择 CI 候选并控制灰度发布' },
}

export default function App() {
	const [session, setSession] = useState<AdminSession | null>(null)
	const [me, setMe] = useState<AdminMe | null>(null)
	const [summary, setSummary] = useState<AdminUsageSummary>(EMPTY_SUMMARY)
	const [users, setUsers] = useState<UserAccountView[]>([])
	const [usersRevision, setUsersRevision] = useState(0)
	const [userSaveNotice, setUserSaveNotice] = useState<string | null>(null)
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
	const [userStatusFilter, setUserStatusFilter] = useState<UserStatus | 'all'>('all')
	const [view, setView] = useState<AdminView>(readAdminView)
	const [dispatchRefreshToken, setDispatchRefreshToken] = useState(0)
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [savingUser, setSavingUser] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const selectedUser = users.find((user) => user.userId === selectedUserId) ?? users[0]

	const refresh = useCallback(
		async (activeSession: AdminSession, status: UserStatus | 'all' = 'all') => {
			setRefreshing(true)
			setError(null)
			setUserSaveNotice(null)
			try {
				const [nextMe, nextSummary, nextUsers] = await Promise.all([
					fetchMe(activeSession),
					fetchUsageSummary(activeSession),
					fetchUsers(activeSession, status),
				])
				setMe(nextMe)
				setSummary(nextSummary)
				setUsers(nextUsers)
				setUsersRevision((current) => current + 1)
				setSelectedUserId((current) => {
					if (current && nextUsers.some((user) => user.userId === current)) return current
					return nextUsers[0]?.userId ?? null
				})
				return true
			} catch (nextError) {
				setError(nextError instanceof Error ? nextError.message : '后台数据加载失败')
				return false
			} finally {
				setRefreshing(false)
				setLoading(false)
			}
		},
		[],
	)

	useEffect(() => {
		let cancelled = false
		getAdminSession().then((storedSession) => {
			if (cancelled) return
			if (!storedSession) {
				setLoading(false)
				return
			}
			setSession(storedSession)
			void refresh(storedSession)
		})
		return () => {
			cancelled = true
		}
	}, [refresh])

	useEffect(() => {
		const handleHashChange = () => setView(readAdminView())
		window.addEventListener('hashchange', handleHashChange)
		if (!window.location.hash) window.history.replaceState(null, '', '#dashboard')
		return () => window.removeEventListener('hashchange', handleHashChange)
	}, [])

	const handleLogin = async (username: string, password: string) => {
		setError(null)
		const nextSession = await signInAdmin(username, password)
		setSession(nextSession)
		await refresh(nextSession)
	}

	const handleLogout = async () => {
		await signOutAdmin()
		setSession(null)
		setMe(null)
		setSummary(EMPTY_SUMMARY)
		setUsers([])
		setSelectedUserId(null)
	}

	const handleStatusFilterChange = async (status: UserStatus | 'all') => {
		setUserStatusFilter(status)
		if (session) await refresh(session, status)
	}

	const handleRefresh = async () => {
		if (!session) return
		if (view === 'announcements' || view === 'releases') {
			setDispatchRefreshToken((current) => current + 1)
			return
		}
		await refresh(session, userStatusFilter)
	}

	const handleUserSave = async (patch: UserStatusPatch) => {
		if (!session) throw new Error('登录已失效，请重新登录后再保存')
		setSavingUser(true)
		setUserSaveNotice(null)
		try {
			await patchUserStatus(session, patch)
			if (!(await refresh(session, userStatusFilter))) {
				throw new Error('用户修改已提交，但列表刷新失败，请点击刷新确认当前状态')
			}
			setUserSaveNotice('已保存用户更改')
		} finally {
			setSavingUser(false)
		}
	}

	if (loading) {
		return (
			<div className="center-screen">
				<div className="loading-mark" />
				<span>正在连接后台</span>
			</div>
		)
	}

	if (!session) {
		return <LoginScreen error={error} onLogin={handleLogin} />
	}

	const canEdit = me?.role === 'admin'
	const viewCopy = VIEW_COPY[view]

	return (
		<div className={`admin-shell${view === 'users' ? ' admin-shell--inspector' : ''}`}>
			<aside className="sidebar">
				<div className="brand">
					<div className="brand-mark">问</div>
					<div>
						<strong>问学</strong>
						<span>Admin</span>
					</div>
				</div>
				<nav className="nav-list" aria-label="后台导航">
					<a
						className={view === 'dashboard' ? 'active' : ''}
						href="#dashboard"
						aria-current={view === 'dashboard' ? 'page' : undefined}
					>
						<BarChart3 size={18} />
						看板
					</a>
					<a
						className={view === 'users' ? 'active' : ''}
						href="#users"
						aria-current={view === 'users' ? 'page' : undefined}
					>
						<Users size={18} />
						用户
					</a>
					<a
						className={view === 'announcements' ? 'active' : ''}
						href="#announcements"
						aria-current={view === 'announcements' ? 'page' : undefined}
					>
						<BellRing size={18} />
						消息推送
					</a>
					<a
						className={view === 'releases' ? 'active' : ''}
						href="#releases"
						aria-current={view === 'releases' ? 'page' : undefined}
					>
						<PackageCheck size={18} />
						版本更新
					</a>
				</nav>
			</aside>

			<main className="workspace">
				<header className="topbar">
					<div>
						<h1>{viewCopy.title}</h1>
						<p>
							{viewCopy.description} · {cloudbaseConfig.envId} · {cloudbaseConfig.region}
						</p>
					</div>
					<div className="topbar-actions">
						<span className="role-chip">
							<Shield size={15} />
							{me?.displayName ?? me?.uid ?? session.userId}
							{me?.role ? ` · ${me.role}` : ''}
						</span>
						<button
							className="icon-button"
							type="button"
							onClick={() => void handleRefresh()}
							disabled={refreshing || savingUser}
						>
							<RefreshCw size={16} className={refreshing ? 'spin' : ''} />
							刷新
						</button>
						<button
							className="icon-button ghost"
							type="button"
							onClick={handleLogout}
							disabled={savingUser}
						>
							<LogOut size={16} />
							退出
						</button>
					</div>
				</header>

				{error && (
					<div className="alert">
						<CircleAlert size={16} />
						{error}
					</div>
				)}
				{view === 'users' && userSaveNotice && (
					<p className="notice" role="status">
						<CheckCircle2 size={16} />
						{userSaveNotice}
					</p>
				)}

				{view === 'dashboard' && <DashboardPage summary={summary} />}
				{view === 'users' && (
					<UsersPage
						users={users}
						selectedUserId={selectedUser?.userId}
						statusFilter={userStatusFilter}
						refreshing={refreshing || savingUser}
						onFilterChange={handleStatusFilterChange}
						onSelect={setSelectedUserId}
					/>
				)}
				{view === 'announcements' && (
					<AnnouncementPage
						session={session}
						canEdit={canEdit}
						refreshToken={dispatchRefreshToken}
					/>
				)}
				{view === 'releases' && (
					<ReleasePage session={session} canEdit={canEdit} refreshToken={dispatchRefreshToken} />
				)}
			</main>

			{view === 'users' && (
				<UserInspector
					key={`${selectedUser?.userId ?? 'no-user'}:${usersRevision}`}
					user={selectedUser}
					canEdit={canEdit}
					currentAdminUid={me?.uid ?? session.userId}
					refreshing={refreshing || savingUser}
					onSave={handleUserSave}
				/>
			)}
		</div>
	)
}

function DashboardPage({ summary }: { summary: AdminUsageSummary }) {
	return (
		<>
			<section className="metric-grid" aria-label="tokens 汇总">
				<MetricCard
					label="输入 Tokens"
					value={summary.totalInputTokens}
					icon={<Activity size={18} />}
				/>
				<MetricCard
					label="输出 Tokens"
					value={summary.totalOutputTokens}
					icon={<Activity size={18} />}
				/>
				<MetricCard label="总 Tokens" value={summary.totalTokens} icon={<BarChart3 size={18} />} />
				<MetricCard
					label="启用用户"
					value={summary.userStatus.active}
					icon={<CheckCircle2 size={18} />}
					subtle={`${summary.userStatus.total} 个总计`}
				/>
			</section>

			<div className="content-grid">
				<section className="panel chart-panel">
					<div className="panel-header">
						<div>
							<h2>每日用量</h2>
							<p>按云端 `token_usage` 实时聚合</p>
						</div>
					</div>
					<UsageChart buckets={summary.byDay} />
				</section>
				<section className="panel">
					<div className="panel-header">
						<div>
							<h2>模型分布</h2>
							<p>内置模型调用占比</p>
						</div>
					</div>
					<BucketTable buckets={summary.byModel} />
				</section>
				<section className="panel recent-panel dashboard-recent">
					<div className="panel-header">
						<div>
							<h2>最近调用</h2>
							<p>不展示正文与敏感头</p>
						</div>
					</div>
					<RecentTable summary={summary} />
				</section>
			</div>
		</>
	)
}

function UsersPage({
	users,
	selectedUserId,
	statusFilter,
	refreshing,
	onFilterChange,
	onSelect,
}: {
	users: UserAccountView[]
	selectedUserId?: string
	statusFilter: UserStatus | 'all'
	refreshing: boolean
	onFilterChange: (status: UserStatus | 'all') => Promise<void>
	onSelect: (userId: string) => void
}) {
	return (
		<section className="panel user-panel">
			<div className="panel-header">
				<div>
					<h2>用户账号</h2>
					<p>查看已注册用户，管理访问权限与备注</p>
				</div>
				<div className="segmented">
					{(['all', 'active', 'disabled'] as const).map((status) => (
						<button
							key={status}
							type="button"
							className={statusFilter === status ? 'selected' : ''}
							onClick={() => void onFilterChange(status)}
							disabled={refreshing}
						>
							{status === 'all' ? '全部' : status === 'active' ? '启用' : '禁用'}
						</button>
					))}
				</div>
			</div>
			<UserTable users={users} selectedUserId={selectedUserId} onSelect={onSelect} />
		</section>
	)
}

function LoginScreen({
	error,
	onLogin,
}: {
	error: string | null
	onLogin: (username: string, password: string) => Promise<void>
}) {
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [localError, setLocalError] = useState<string | null>(null)

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setSubmitting(true)
		setLocalError(null)
		try {
			await onLogin(username.trim(), password)
		} catch (nextError) {
			setLocalError(nextError instanceof Error ? nextError.message : '登录失败')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="login-page">
			<form className="login-box" onSubmit={handleSubmit}>
				<div className="brand compact">
					<div className="brand-mark">问</div>
					<div>
						<strong>问学后台</strong>
						<span>Internal access</span>
					</div>
				</div>
				<label>
					<span>邮箱或管理员账号</span>
					<input
						type="text"
						autoComplete="username"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
					/>
				</label>
				<label>
					<span>密码</span>
					<input
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</label>
				{(localError || error) && <div className="alert compact-alert">{localError ?? error}</div>}
				<button
					className="primary-button"
					type="submit"
					disabled={submitting || !username || !password}
				>
					{submitting ? '登录中' : '登录'}
				</button>
			</form>
		</div>
	)
}

function MetricCard({
	label,
	value,
	icon,
	subtle,
}: {
	label: string
	value: number
	icon: React.ReactNode
	subtle?: string
}) {
	return (
		<div className="metric-card">
			<div className="metric-icon">{icon}</div>
			<span>{label}</span>
			<strong>{formatNumber(value)}</strong>
			{subtle && <small>{subtle}</small>}
		</div>
	)
}

function UsageChart({ buckets }: { buckets: UsageBucket[] }) {
	const sorted = useMemo(
		() => [...buckets].sort((left, right) => left.key.localeCompare(right.key)).slice(-14),
		[buckets],
	)
	const max = Math.max(1, ...sorted.map((bucket) => bucket.totalTokens))
	const points = sorted
		.map((bucket, index) => {
			const x = sorted.length <= 1 ? 420 : (index / (sorted.length - 1)) * 420
			const y = 150 - (bucket.totalTokens / max) * 120
			return `${x},${y}`
		})
		.join(' ')

	if (sorted.length === 0) return <EmptyState label="暂无用量数据" />

	return (
		<div className="chart-wrap">
			<svg viewBox="0 0 420 170" role="img" aria-label="每日 tokens 趋势">
				<line x1="0" y1="150" x2="420" y2="150" />
				<polyline points={points} />
				{sorted.map((bucket, index) => {
					const x = sorted.length <= 1 ? 420 : (index / (sorted.length - 1)) * 420
					const y = 150 - (bucket.totalTokens / max) * 120
					return <circle key={bucket.key} cx={x} cy={y} r="4" />
				})}
			</svg>
			<div className="chart-axis">
				<span>{sorted[0]?.label}</span>
				<span>{sorted.at(-1)?.label}</span>
			</div>
		</div>
	)
}

function BucketTable({ buckets }: { buckets: UsageBucket[] }) {
	if (buckets.length === 0) return <EmptyState label="暂无模型分布" />
	return (
		<table>
			<thead>
				<tr>
					<th>模型</th>
					<th>输入</th>
					<th>输出</th>
					<th>总量</th>
				</tr>
			</thead>
			<tbody>
				{buckets.slice(0, 6).map((bucket) => (
					<tr key={bucket.key}>
						<td>{bucket.label}</td>
						<td>{formatNumber(bucket.inputTokens)}</td>
						<td>{formatNumber(bucket.outputTokens)}</td>
						<td>{formatNumber(bucket.totalTokens)}</td>
					</tr>
				))}
			</tbody>
		</table>
	)
}

function UserTable({
	users,
	selectedUserId,
	onSelect,
}: {
	users: UserAccountView[]
	selectedUserId?: string
	onSelect: (userId: string) => void
}) {
	if (users.length === 0) return <EmptyState label="暂无用户账号" />
	return (
		<div className="table-scroll">
			<table>
				<thead>
					<tr>
						<th>邮箱</th>
						<th>昵称</th>
						<th>UID</th>
						<th>类型</th>
						<th>状态</th>
						<th>累计 tokens</th>
						<th>首次出现</th>
						<th>最近出现</th>
					</tr>
				</thead>
				<tbody>
					{users.map((user) => (
						<tr
							key={user.userId}
							className={user.userId === selectedUserId ? 'selected-row' : ''}
							onClick={() => onSelect(user.userId)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault()
									onSelect(user.userId)
								}
							}}
							tabIndex={0}
							aria-selected={user.userId === selectedUserId}
						>
							<td>
								{user.email || (user.userType === 'internalUser' ? '内部管理员' : '未绑定邮箱')}
							</td>
							<td>{user.nickname || '—'}</td>
							<td className="mono" title={user.userId}>
								{shortUserId(user.userId)}
							</td>
							<td>
								{user.userType === 'internalUser'
									? '内部管理账号'
									: user.userType === 'externalUser'
										? '注册用户'
										: '—'}
							</td>
							<td>
								<StatusBadge status={user.status} />
							</td>
							<td>{formatNumber(user.totalTokens)}</td>
							<td>{formatDate(user.firstSeenAt || user.createdAt)}</td>
							<td>{formatDate(user.lastSeenAt || user.updatedAt || user.createdAt)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function RecentTable({ summary }: { summary: AdminUsageSummary }) {
	if (summary.recent.length === 0) return <EmptyState label="暂无调用记录" />
	return (
		<div className="table-scroll compact-table">
			<table>
				<thead>
					<tr>
						<th>时间</th>
						<th>用户</th>
						<th>模型</th>
						<th>tokens</th>
						<th>延迟</th>
					</tr>
				</thead>
				<tbody>
					{summary.recent.slice(0, 8).map((record) => (
						<tr key={record.id}>
							<td>{formatDate(record.ts)}</td>
							<td className="mono">{shortUserId(record.userId)}</td>
							<td>{record.model}</td>
							<td>{formatNumber(record.totalTokens)}</td>
							<td>{record.latencyMs}ms</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function UserInspector({
	user,
	canEdit,
	currentAdminUid,
	refreshing,
	onSave,
}: {
	user?: UserAccountView
	canEdit: boolean
	currentAdminUid: string
	refreshing: boolean
	onSave: (patch: UserStatusPatch) => Promise<void>
}) {
	const [status, setStatus] = useState<UserStatus>(user?.status ?? 'active')
	const [note, setNote] = useState(user?.note ?? '')
	const [reason, setReason] = useState('')
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const hasChanges = !!user && (status !== user.status || note !== (user.note ?? ''))
	const isCurrentAdmin = user?.userId === currentAdminUid

	const handleSave = async () => {
		if (!user || !canEdit || saving || refreshing || !hasChanges) return
		setSaving(true)
		setSaveError(null)
		try {
			await onSave({
				userId: user.userId,
				...(status !== user.status ? { status } : {}),
				...(note !== (user.note ?? '') ? { note } : {}),
				reason,
			})
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : '保存失败，请重试')
		} finally {
			setSaving(false)
		}
	}

	return (
		<aside className="inspector">
			<div className="panel-header">
				<div>
					<h2>用户管理</h2>
					<p>调整账号状态与备注，保存后生效</p>
				</div>
			</div>
			{user ? (
				<div className="inspector-body">
					<div className="field-block">
						<span>邮箱</span>
						<strong>{user.email || '未绑定邮箱'}</strong>
					</div>
					<div className="field-block">
						<span>昵称</span>
						<strong>{user.nickname || '—'}</strong>
					</div>
					<div className="field-block">
						<span>用户 id</span>
						<strong className="mono">{user.userId}</strong>
					</div>
					<div className="field-grid">
						<div className="field-block">
							<span>输入 tokens</span>
							<strong>{formatNumber(user.inputTokens)}</strong>
						</div>
						<div className="field-block">
							<span>输出 tokens</span>
							<strong>{formatNumber(user.outputTokens)}</strong>
						</div>
						<div className="field-block">
							<span>总 tokens</span>
							<strong>{formatNumber(user.totalTokens)}</strong>
						</div>
					</div>
					<div className="field-grid two">
						<div className="field-block">
							<span>首次出现</span>
							<strong>{formatDate(user.firstSeenAt || user.createdAt)}</strong>
						</div>
						<div className="field-block">
							<span>最近出现</span>
							<strong>{formatDate(user.lastSeenAt || user.updatedAt || user.createdAt)}</strong>
						</div>
					</div>
					<label className="field-block">
						<span>账号状态</span>
						<select
							value={status}
							onChange={(event) => setStatus(event.target.value as UserStatus)}
							disabled={
								!canEdit ||
								isCurrentAdmin ||
								user.userType === 'internalUser' ||
								saving ||
								refreshing
							}
						>
							<option value="active">启用</option>
							<option value="disabled">禁用</option>
						</select>
					</label>
					{canEdit && isCurrentAdmin && <p className="muted">当前登录账号不能禁用自身</p>}
					<label className="field-block">
						<span>备注</span>
						<textarea
							value={note}
							onChange={(event) => setNote(event.target.value)}
							disabled={!canEdit || saving || refreshing}
						/>
					</label>
					<label className="field-block">
						<span>调整原因</span>
						<input
							type="text"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							disabled={!canEdit || saving || refreshing}
						/>
					</label>
					<button
						className="primary-button"
						type="button"
						onClick={handleSave}
						disabled={!canEdit || saving || refreshing || !hasChanges}
					>
						<Save size={16} />
						{saving ? '保存中' : '保存更改'}
					</button>
					{!canEdit && <p className="muted">当前账号为只读角色</p>}
					{saveError && (
						<div className="alert compact-alert" role="alert">
							{saveError}
						</div>
					)}
				</div>
			) : (
				<EmptyState label="选择一个用户" />
			)}
		</aside>
	)
}

function StatusBadge({ status }: { status: UserStatus }) {
	return <span className={`status-badge ${status}`}>{status === 'active' ? '启用' : '禁用'}</span>
}

function EmptyState({ label }: { label: string }) {
	return <div className="empty-state">{label}</div>
}

function formatNumber(value: number) {
	return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDate(value: string | number) {
	if (!value) return '-'
	const date = typeof value === 'number' ? new Date(value) : new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return new Intl.DateTimeFormat('zh-CN', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

function shortUserId(value: string) {
	return value.length > 22 ? `${value.slice(0, 14)}…${value.slice(-6)}` : value
}

function readAdminView(): AdminView {
	const hash = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
	if (hash === 'users' || hash === 'announcements' || hash === 'releases') return hash
	return 'dashboard'
}
