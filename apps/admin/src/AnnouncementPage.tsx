import {
	isValidHttpsUrl,
	validateAnnouncementInput,
	type AnnouncementImportance,
	type AnnouncementInput,
	type AnnouncementView,
	type ClientAnnouncementView,
	type ClientPlatform,
	type ValidationIssue,
} from '@wenxue/client-operations'
import { AnnouncementDialog } from '@wenxue/client-operations/react'
import { CircleAlert, Clock3, Megaphone, RotateCcw, Send, Undo2 } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { fetchAnnouncements, publishAnnouncement, withdrawAnnouncement } from './adminApi'
import type { AdminSession } from './types'

interface AnnouncementDraft {
	importance: AnnouncementImportance
	title: string
	body: string
	detailUrl: string
	platforms: ClientPlatform[]
	minVersion: string
	maxVersion: string
	userIds: string
	expiresAt: string
}

export function AnnouncementPage({
	session,
	canEdit,
	refreshToken,
}: {
	session: AdminSession
	canEdit: boolean
	refreshToken: number
}) {
	const [draft, setDraft] = useState<AnnouncementDraft>(createAnnouncementDraft)
	const [announcements, setAnnouncements] = useState<AnnouncementView[]>([])
	const [issues, setIssues] = useState<ValidationIssue[]>([])
	const [loading, setLoading] = useState(true)
	const [submitting, setSubmitting] = useState(false)
	const [pageError, setPageError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	const loadAnnouncements = useCallback(async () => {
		setLoading(true)
		setPageError(null)
		try {
			setAnnouncements(await fetchAnnouncements(session))
		} catch (error) {
			setPageError(error instanceof Error ? error.message : '消息记录加载失败')
		} finally {
			setLoading(false)
		}
	}, [session])

	useEffect(() => {
		void loadAnnouncements()
	}, [loadAnnouncements, refreshToken])

	const input = useMemo(() => announcementInputFromDraft(draft), [draft])
	const preview = useMemo<ClientAnnouncementView>(
		() => ({
			id: 'announcement-preview',
			importance: draft.importance,
			title: draft.title.trim() || '消息标题',
			body: draft.body.trim() || '在这里预览用户将在问学桌面端看到的消息正文。',
			...(isValidHttpsUrl(draft.detailUrl.trim()) ? { detailUrl: draft.detailUrl.trim() } : {}),
			publishedAt: new Date().toISOString(),
			expiresAt: expiryIso(draft.expiresAt) ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
		}),
		[draft],
	)

	const updateDraft = <Key extends keyof AnnouncementDraft>(
		key: Key,
		value: AnnouncementDraft[Key],
	) => {
		setDraft((current) => ({ ...current, [key]: value }))
		setIssues([])
		setNotice(null)
	}

	const togglePlatform = (platform: ClientPlatform) => {
		const platforms = draft.platforms.includes(platform)
			? draft.platforms.filter((item) => item !== platform)
			: [...draft.platforms, platform]
		updateDraft('platforms', platforms)
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setNotice(null)
		const result = validateAnnouncementInput(input)
		if (!result.ok) {
			setIssues(result.issues)
			return
		}
		setIssues([])
		setSubmitting(true)
		setPageError(null)
		try {
			const announcement = await publishAnnouncement(session, result.value)
			setAnnouncements((current) => [announcement, ...current])
			setDraft(createAnnouncementDraft())
			setNotice('消息已发布，符合目标范围的在线用户将近实时收到。')
		} catch (error) {
			setPageError(error instanceof Error ? error.message : '消息发布失败')
		} finally {
			setSubmitting(false)
		}
	}

	const handleWithdraw = async (announcement: AnnouncementView) => {
		if (!window.confirm(`撤回“${announcement.title}”？正在展示的客户端将关闭这条消息。`)) return
		setPageError(null)
		try {
			const updated = await withdrawAnnouncement(session, announcement.id)
			setAnnouncements((current) =>
				current.map((item) => (item.id === updated.id ? updated : item)),
			)
			setNotice('消息已撤回。')
		} catch (error) {
			setPageError(error instanceof Error ? error.message : '消息撤回失败')
		}
	}

	return (
		<div className="dispatch-page">
			{(pageError || notice) && (
				<div className={pageError ? 'alert' : 'notice'} role={pageError ? 'alert' : 'status'}>
					{pageError ? <CircleAlert size={16} /> : <Megaphone size={16} />}
					{pageError ?? notice}
				</div>
			)}

			<div className="dispatch-editor-grid">
				<section className="panel dispatch-form-panel">
					<div className="panel-header">
						<div>
							<h2>编辑消息</h2>
							<p>只允许纯文本；样式、图标和按钮由客户端固定。</p>
						</div>
						<span className="permission-label">{canEdit ? '可发布' : '只读'}</span>
					</div>

					<form className="dispatch-form" onSubmit={handleSubmit}>
						<fieldset disabled={!canEdit || submitting}>
							<div className="field-block">
								<span>重要性</span>
								<div
									className="segmented wide"
									role="group"
									aria-label="消息重要性"
									aria-describedby={fieldDescriptionId(issues, 'importance')}
								>
									{(['normal', 'important'] as const).map((importance) => (
										<button
											key={importance}
											type="button"
											className={draft.importance === importance ? 'selected' : ''}
											aria-pressed={draft.importance === importance}
											onClick={() => updateDraft('importance', importance)}
										>
											{importance === 'normal' ? '普通消息' : '重要消息'}
										</button>
									))}
								</div>
								<FieldError issues={issues} field="importance" />
							</div>

							<label className="field-block">
								<span>标题 · 最多 80 字</span>
								<input
									value={draft.title}
									aria-invalid={hasFieldIssue(issues, 'title')}
									aria-describedby={fieldDescriptionId(issues, 'title')}
									maxLength={80}
									onChange={(event) => updateDraft('title', event.target.value)}
									placeholder="例如：今晚 22:00 服务维护"
								/>
								<FieldError issues={issues} field="title" />
							</label>

							<label className="field-block">
								<span>正文 · 最多 1000 字</span>
								<textarea
									className="message-body-input"
									value={draft.body}
									aria-invalid={hasFieldIssue(issues, 'body')}
									aria-describedby={fieldDescriptionId(issues, 'body')}
									maxLength={1000}
									onChange={(event) => updateDraft('body', event.target.value)}
									placeholder="直接说明发生了什么，以及用户需要做什么。"
								/>
								<FieldError issues={issues} field="body" />
							</label>

							<label className="field-block">
								<span>详情链接 · 可选，仅 HTTPS</span>
								<input
									type="url"
									value={draft.detailUrl}
									aria-invalid={hasFieldIssue(issues, 'detailUrl')}
									aria-describedby={fieldDescriptionId(issues, 'detailUrl')}
									onChange={(event) => updateDraft('detailUrl', event.target.value)}
									placeholder="https://..."
								/>
								<FieldError issues={issues} field="detailUrl" />
							</label>

							<div className="form-section">
								<div className="form-section__title">
									<strong>目标范围</strong>
									<span>三个维度之间同时满足；留空代表不限制。</span>
								</div>
								<div className="checkbox-list horizontal">
									<label>
										<input
											type="checkbox"
											checked={draft.platforms.includes('darwin')}
											onChange={() => togglePlatform('darwin')}
										/>
										macOS
									</label>
									<label>
										<input
											type="checkbox"
											checked={draft.platforms.includes('win32')}
											onChange={() => togglePlatform('win32')}
										/>
										Windows
									</label>
								</div>
								<FieldError issues={issues} field="audience.platforms" />

								<div className="field-grid two">
									<label className="field-block">
										<span>最低应用版本</span>
										<input
											value={draft.minVersion}
											aria-invalid={hasFieldIssue(issues, 'audience.minVersion')}
											aria-describedby={fieldDescriptionId(issues, 'audience.minVersion')}
											onChange={(event) => updateDraft('minVersion', event.target.value)}
											placeholder="例如 1.2.0"
										/>
										<FieldError issues={issues} field="audience.minVersion" />
									</label>
									<label className="field-block">
										<span>最高应用版本</span>
										<input
											value={draft.maxVersion}
											aria-invalid={hasFieldIssue(issues, 'audience.maxVersion')}
											aria-describedby={fieldDescriptionId(issues, 'audience.maxVersion')}
											onChange={(event) => updateDraft('maxVersion', event.target.value)}
											placeholder="例如 1.9.9"
										/>
										<FieldError issues={issues} field="audience.maxVersion" />
									</label>
								</div>

								<label className="field-block">
									<span>用户 UID · 可选，每行或逗号分隔，最多 500 个</span>
									<textarea
										value={draft.userIds}
										aria-invalid={hasFieldIssue(issues, 'audience.userIds')}
										aria-describedby={fieldDescriptionId(issues, 'audience.userIds')}
										onChange={(event) => updateDraft('userIds', event.target.value)}
										placeholder="uid-001&#10;uid-002"
									/>
									<FieldError issues={issues} field="audience.userIds" />
								</label>
							</div>

							<label className="field-block">
								<span>有效期 · 默认 7 天，最长 30 天</span>
								<input
									type="datetime-local"
									value={draft.expiresAt}
									aria-invalid={hasFieldIssue(issues, 'expiresAt')}
									aria-describedby={fieldDescriptionId(issues, 'expiresAt')}
									onChange={(event) => updateDraft('expiresAt', event.target.value)}
								/>
								<FieldError issues={issues} field="expiresAt" />
							</label>
						</fieldset>

						<button
							className="primary-button form-submit"
							type="submit"
							disabled={!canEdit || submitting}
						>
							<Send size={16} />
							{submitting ? '正在推送' : '立即推送'}
						</button>
						{!canEdit && <p className="muted">viewer 角色只能查看消息和预览，不能发起推送。</p>}
					</form>
				</section>

				<section className="panel preview-panel">
					<div className="panel-header">
						<div>
							<h2>客户端实时预览</h2>
							<p>与桌面端共用同一组件；后台不能改变关闭规则。</p>
						</div>
					</div>
					<AnnouncementDialog
						announcement={preview}
						presentation="preview"
						onAcknowledge={() => undefined}
						onDismiss={() => undefined}
					/>
					<div className="preview-notes">
						<Clock3 size={15} />
						<span>普通消息可关闭；重要消息只能点击“我知道了”。用户始终可以退出整个应用。</span>
					</div>
				</section>
			</div>

			<section className="panel history-panel">
				<div className="panel-header">
					<div>
						<h2>发布历史</h2>
						<p>历史内容不可编辑；需要修正时先撤回，再重新发布。</p>
					</div>
					<button
						className="icon-button"
						type="button"
						onClick={() => void loadAnnouncements()}
						disabled={loading}
					>
						<RotateCcw size={15} className={loading ? 'spin' : ''} />
						重新载入
					</button>
				</div>
				<AnnouncementHistory
					announcements={announcements}
					loading={loading}
					canEdit={canEdit}
					onWithdraw={handleWithdraw}
				/>
			</section>
		</div>
	)
}

function AnnouncementHistory({
	announcements,
	loading,
	canEdit,
	onWithdraw,
}: {
	announcements: AnnouncementView[]
	loading: boolean
	canEdit: boolean
	onWithdraw: (announcement: AnnouncementView) => Promise<void>
}) {
	if (loading) return <div className="empty-state">正在读取消息记录</div>
	if (announcements.length === 0) return <div className="empty-state">尚未发布应用内消息</div>
	return (
		<div className="table-scroll">
			<table>
				<thead>
					<tr>
						<th>消息</th>
						<th>目标</th>
						<th>状态</th>
						<th>发布时间</th>
						<th aria-label="操作" />
					</tr>
				</thead>
				<tbody>
					{announcements.map((announcement) => (
						<tr key={announcement.id}>
							<td>
								<strong className="table-title">{announcement.title}</strong>
								<span className="table-subline">
									{announcement.importance === 'important' ? '重要消息' : '普通消息'}
								</span>
							</td>
							<td>{formatAudience(announcement.audience)}</td>
							<td>
								<span className={`status-badge ${announcement.status}`}>
									{announcement.status === 'published' ? '已发布' : '已撤回'}
								</span>
							</td>
							<td>{formatDateTime(announcement.publishedAt)}</td>
							<td className="table-actions">
								{announcement.status === 'published' && (
									<button
										className="text-button"
										type="button"
										disabled={!canEdit}
										onClick={() => void onWithdraw(announcement)}
									>
										<Undo2 size={14} />
										撤回
									</button>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function FieldError({ issues, field }: { issues: ValidationIssue[]; field: string }) {
	const issue = issues.find((item) => item.field === field)
	return issue ? (
		<small className="field-error" id={fieldErrorId(field)} role="alert">
			{issue.message}
		</small>
	) : null
}

function hasFieldIssue(issues: ValidationIssue[], field: string) {
	return issues.some((issue) => issue.field === field)
}

function fieldDescriptionId(issues: ValidationIssue[], field: string) {
	return hasFieldIssue(issues, field) ? fieldErrorId(field) : undefined
}

function fieldErrorId(field: string) {
	return `announcement-error-${field.replace(/[^a-z0-9]+/gi, '-')}`
}

function createAnnouncementDraft(): AnnouncementDraft {
	const expiresAt = new Date(Date.now() + 7 * 86_400_000)
	expiresAt.setSeconds(0, 0)
	return {
		importance: 'normal',
		title: '',
		body: '',
		detailUrl: '',
		platforms: [],
		minVersion: '',
		maxVersion: '',
		userIds: '',
		expiresAt: toLocalDateTime(expiresAt),
	}
}

function announcementInputFromDraft(draft: AnnouncementDraft): AnnouncementInput {
	const hasUserIds = draft.userIds.trim().length > 0
	const userIds = hasUserIds ? draft.userIds.split(/[\n,，]/).map((item) => item.trim()) : []
	return {
		importance: draft.importance,
		title: draft.title,
		body: draft.body,
		...(draft.detailUrl.trim() ? { detailUrl: draft.detailUrl.trim() } : {}),
		audience: {
			...(draft.platforms.length ? { platforms: draft.platforms } : {}),
			...(draft.minVersion.trim() ? { minVersion: draft.minVersion.trim() } : {}),
			...(draft.maxVersion.trim() ? { maxVersion: draft.maxVersion.trim() } : {}),
			...(hasUserIds ? { userIds } : {}),
		},
		...(expiryIso(draft.expiresAt) ? { expiresAt: expiryIso(draft.expiresAt) } : {}),
	}
}

function expiryIso(value: string) {
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

function toLocalDateTime(value: Date) {
	const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
	return local.toISOString().slice(0, 16)
}

function formatAudience(audience: AnnouncementView['audience']) {
	const parts = []
	if (audience.platforms?.length) {
		parts.push(
			audience.platforms.map((item) => (item === 'darwin' ? 'macOS' : 'Windows')).join(' / '),
		)
	}
	if (audience.minVersion || audience.maxVersion) {
		parts.push(`${audience.minVersion ?? '不限'} – ${audience.maxVersion ?? '不限'}`)
	}
	if (audience.userIds?.length) parts.push(`${audience.userIds.length} 个 UID`)
	return parts.length ? parts.join(' · ') : '全部登录用户'
}

function formatDateTime(value: string) {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return new Intl.DateTimeFormat('zh-CN', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}
