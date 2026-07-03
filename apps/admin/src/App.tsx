import {
	Activity,
	BarChart3,
	CheckCircle2,
	CircleAlert,
	Database,
	LogOut,
	RefreshCw,
	Save,
	Shield,
	SlidersHorizontal,
	Users,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { fetchMe, fetchUsageSummary, fetchUsers, patchUserStatus } from './adminApi'
import { cloudbaseConfig, getAdminSession, signInAdmin, signOutAdmin } from './cloudbase'
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

export default function App() {
	const [session, setSession] = useState<AdminSession | null>(null)
	const [me, setMe] = useState<AdminMe | null>(null)
	const [summary, setSummary] = useState<AdminUsageSummary>(EMPTY_SUMMARY)
	const [users, setUsers] = useState<UserAccountView[]>([])
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
	const [userStatusFilter, setUserStatusFilter] = useState<UserStatus | 'all'>('all')
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const selectedUser = users.find((user) => user.userId === selectedUserId) ?? users[0]

	const refresh = useCallback(
		async (activeSession: AdminSession, status: UserStatus | 'all' = userStatusFilter) => {
			setRefreshing(true)
			setError(null)
			try {
				const [nextMe, nextSummary, nextUsers] = await Promise.all([
					fetchMe(activeSession),
					fetchUsageSummary(activeSession),
					fetchUsers(activeSession, status),
				])
				setMe(nextMe)
				setSummary(nextSummary)
				setUsers(nextUsers)
				setSelectedUserId((current) => {
					if (current && nextUsers.some((user) => user.userId === current)) return current
					return nextUsers[0]?.userId ?? null
				})
			} catch (nextError) {
				setError(nextError instanceof Error ? nextError.message : '后台数据加载失败')
			} finally {
				setRefreshing(false)
				setLoading(false)
			}
		},
		[userStatusFilter],
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

	const handleUserStatusSave = async (patch: {
		userId: string
		status: UserStatus
		note: string
		reason: string
	}) => {
		if (!session) return
		const updated = await patchUserStatus(session, patch)
		setUsers((current) => current.map((user) => (user.userId === updated.userId ? updated : user)))
		setSelectedUserId(updated.userId)
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

	return (
		<div className="admin-shell">
			<aside className="sidebar">
				<div className="brand">
					<div className="brand-mark">问</div>
					<div>
						<strong>问学</strong>
						<span>Admin</span>
					</div>
				</div>
				<nav className="nav-list" aria-label="后台导航">
					<a className="active" href="#dashboard">
						<BarChart3 size={18} />
						看板
					</a>
					<a href="#users">
						<Users size={18} />
						用户
					</a>
					<a href="#audit">
						<Database size={18} />
						审计
					</a>
					<a href="#settings">
						<SlidersHorizontal size={18} />
						设置
					</a>
				</nav>
			</aside>

			<main className="workspace">
				<header className="topbar">
					<div>
						<h1>Tokens 看板</h1>
						<p>
							{cloudbaseConfig.envId} · {cloudbaseConfig.region}
						</p>
					</div>
					<div className="topbar-actions">
						<span className="role-chip">
							<Shield size={15} />
							{me?.displayName ?? me?.uid ?? session.userId}
							{me?.role ? ` · ${me.role}` : ''}
						</span>
						<button className="icon-button" onClick={() => refresh(session)} disabled={refreshing}>
							<RefreshCw size={16} className={refreshing ? 'spin' : ''} />
							刷新
						</button>
						<button className="icon-button ghost" onClick={handleLogout}>
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
					<MetricCard
						label="总 Tokens"
						value={summary.totalTokens}
						icon={<BarChart3 size={18} />}
					/>
					<MetricCard
						label="活跃用户"
						value={summary.userStatus.active}
						icon={<CheckCircle2 size={18} />}
						subtle={`${summary.userStatus.total} 个总计`}
					/>
				</section>

				<div className="content-grid">
					<section className="panel chart-panel" id="dashboard">
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

					<section className="panel user-panel" id="users">
						<div className="panel-header">
							<div>
								<h2>用户状态</h2>
								<p>按用户启用或禁用内置模型访问</p>
							</div>
							<div className="segmented">
								{(['all', 'active', 'disabled'] as const).map((status) => (
									<button
										key={status}
										className={userStatusFilter === status ? 'selected' : ''}
										onClick={() => handleStatusFilterChange(status)}
									>
										{status === 'all' ? '全部' : status === 'active' ? '启用' : '禁用'}
									</button>
								))}
							</div>
						</div>
						<UserTable
							users={users}
							selectedUserId={selectedUser?.userId}
							onSelect={setSelectedUserId}
						/>
					</section>

					<section className="panel recent-panel">
						<div className="panel-header">
							<div>
								<h2>最近调用</h2>
								<p>不展示正文与敏感头</p>
							</div>
						</div>
						<RecentTable summary={summary} />
					</section>
				</div>
			</main>

			<UserInspector
				user={selectedUser}
				canEdit={me?.role === 'admin'}
				onSave={handleUserStatusSave}
			/>
		</div>
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
					<span>内部账号</span>
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
						<th>用户</th>
						<th>状态</th>
						<th>累计 tokens</th>
						<th>更新时间</th>
					</tr>
				</thead>
				<tbody>
					{users.map((user) => (
						<tr
							key={user.userId}
							className={user.userId === selectedUserId ? 'selected-row' : ''}
							onClick={() => onSelect(user.userId)}
						>
							<td className="mono">{shortUserId(user.userId)}</td>
							<td>
								<StatusBadge status={user.status} />
							</td>
							<td>{formatNumber(user.totalTokens)}</td>
							<td>{formatDate(user.updatedAt || user.createdAt)}</td>
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
	onSave,
}: {
	user?: UserAccountView
	canEdit: boolean
	onSave: (patch: {
		userId: string
		status: UserStatus
		note: string
		reason: string
	}) => Promise<void>
}) {
	const [status, setStatus] = useState<UserStatus>('active')
	const [note, setNote] = useState('')
	const [reason, setReason] = useState('')
	const [saving, setSaving] = useState(false)
	const [message, setMessage] = useState<string | null>(null)

	useEffect(() => {
		if (!user) return
		setStatus(user.status)
		setNote(user.note ?? '')
		setReason('')
		setMessage(null)
	}, [user])

	const handleSave = async () => {
		if (!user) return
		setSaving(true)
		setMessage(null)
		try {
			await onSave({
				userId: user.userId,
				status,
				note,
				reason,
			})
			setMessage('已保存')
		} catch (error) {
			setMessage(error instanceof Error ? error.message : '保存失败')
		} finally {
			setSaving(false)
		}
	}

	return (
		<aside className="inspector">
			<div className="panel-header">
				<div>
					<h2>状态编辑</h2>
					<p>用户级内置模型访问权限</p>
				</div>
			</div>
			{user ? (
				<div className="inspector-body">
					<div className="field-block">
						<span>用户 id</span>
						<strong className="mono">{user.userId}</strong>
					</div>
					<div className="field-block">
						<span>状态</span>
						<div className="segmented wide">
							{(['active', 'disabled'] as const).map((item) => (
								<button
									key={item}
									className={status === item ? 'selected' : ''}
									onClick={() => setStatus(item)}
									disabled={!canEdit}
								>
									{item === 'active' ? '启用' : '禁用'}
								</button>
							))}
						</div>
					</div>
					<label className="field-block">
						<span>备注</span>
						<textarea
							value={note}
							onChange={(event) => setNote(event.target.value)}
							disabled={!canEdit}
						/>
					</label>
					<label className="field-block">
						<span>调整原因</span>
						<input
							type="text"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							disabled={!canEdit}
						/>
					</label>
					<button className="primary-button" onClick={handleSave} disabled={!canEdit || saving}>
						<Save size={16} />
						{saving ? '保存中' : '保存状态'}
					</button>
					{!canEdit && <p className="muted">当前账号为只读角色</p>}
					{message && <p className="muted">{message}</p>}
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
