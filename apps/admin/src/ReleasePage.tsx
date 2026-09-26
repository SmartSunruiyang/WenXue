import {
	RELEASE_PERCENTAGES,
	validateReleasePublishInput,
	type ReleaseCandidate,
	type ReleaseHealth,
	type ReleasePublishInput,
	type ReleaseRollout,
	type UpdateMode,
	type UpdateState,
	type ValidationIssue,
} from '@wenxue/client-operations'
import { UpdateDialog } from '@wenxue/client-operations/react'
import {
	CircleAlert,
	FileCheck2,
	Pause,
	Play,
	Rocket,
	RotateCcw,
	ShieldCheck,
	TriangleAlert,
	Undo2,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import {
	changeReleaseState,
	fetchReleaseCandidates,
	fetchReleases,
	publishRelease,
} from './adminApi'
import type { AdminSession } from './types'

interface ReleaseDraft {
	candidateId: string
	title: string
	notes: string
	percentage: 1 | 5 | 25 | 50 | 100
	mode: UpdateMode
	minSupportedVersion: string
}

export function ReleasePage({
	session,
	canEdit,
	refreshToken,
}: {
	session: AdminSession
	canEdit: boolean
	refreshToken: number
}) {
	const [candidates, setCandidates] = useState<ReleaseCandidate[]>([])
	const [releases, setReleases] = useState<ReleaseRollout[]>([])
	const [draft, setDraft] = useState<ReleaseDraft>(createReleaseDraft)
	const [issues, setIssues] = useState<ValidationIssue[]>([])
	const [loading, setLoading] = useState(true)
	const [submitting, setSubmitting] = useState(false)
	const [pageError, setPageError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [previewPlatform, setPreviewPlatform] = useState<'darwin' | 'win32'>('darwin')
	const [previewPhase, setPreviewPhase] = useState<'available' | 'ready'>('available')

	const loadReleases = useCallback(async () => {
		setLoading(true)
		setPageError(null)
		try {
			const [nextCandidates, nextReleases] = await Promise.all([
				fetchReleaseCandidates(session),
				fetchReleases(session),
			])
			setCandidates(nextCandidates)
			setReleases(nextReleases)
			setDraft((current) => {
				const candidate =
					nextCandidates.find((item) => item.releaseId === current.candidateId) ?? nextCandidates[0]
				return {
					...current,
					candidateId: candidate?.releaseId ?? '',
					mode: candidate?.schemaVersion === 2 ? 'optional' : current.mode,
				}
			})
		} catch (error) {
			setPageError(error instanceof Error ? error.message : '版本数据加载失败')
		} finally {
			setLoading(false)
		}
	}, [session])

	useEffect(() => {
		void loadReleases()
	}, [loadReleases, refreshToken])

	const selectedCandidate =
		candidates.find((candidate) => candidate.releaseId === draft.candidateId) ?? candidates[0]
	const input = useMemo<ReleasePublishInput>(
		() => ({
			candidateId: draft.candidateId,
			title: draft.title,
			notes: draft.notes,
			percentage: draft.percentage,
			mode: draft.mode,
			...(draft.minSupportedVersion.trim()
				? { minSupportedVersion: draft.minSupportedVersion.trim() }
				: {}),
		}),
		[draft],
	)
	const previewState = useMemo<UpdateState | null>(() => {
		if (!selectedCandidate) return null
		return {
			phase: previewPhase,
			release: {
				releaseId: selectedCandidate.releaseId,
				version: selectedCandidate.version,
				channel: selectedCandidate.channel,
				title: draft.title.trim() || `问学 ${selectedCandidate.version} 可用`,
				notes: draft.notes.trim() || '在这里预览用户将看到的更新说明。',
				mode: selectedCandidate.schemaVersion === 2 ? 'optional' : draft.mode,
				distribution: selectedCandidate.distribution,
				installAction:
					selectedCandidate.schemaVersion === 2
						? previewPlatform === 'darwin'
							? 'open-dmg'
							: 'restart'
						: 'open-installer',
				size: previewArtifactSize(selectedCandidate, previewPlatform),
			},
		}
	}, [draft.mode, draft.notes, draft.title, previewPhase, previewPlatform, selectedCandidate])

	const updateDraft = <Key extends keyof ReleaseDraft>(key: Key, value: ReleaseDraft[Key]) => {
		setDraft((current) => ({ ...current, [key]: value }))
		setIssues([])
		setNotice(null)
	}

	const handleModeChange = (mode: UpdateMode) => {
		if (selectedCandidate?.schemaVersion === 2 && mode === 'mandatory') return
		setDraft((current) => ({
			...current,
			mode,
			percentage: mode === 'mandatory' ? 100 : current.percentage,
		}))
		setIssues((current) =>
			current.filter((issue) => issue.field !== 'mode' && issue.field !== 'percentage'),
		)
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setNotice(null)
		if (selectedCandidate?.schemaVersion === 2 && draft.mode !== 'optional') {
			setIssues([{ field: 'mode', message: '平台更新当前仅支持可选发布。' }])
			return
		}
		const result = validateReleasePublishInput(input)
		if (!result.ok) {
			setIssues(result.issues)
			return
		}
		setIssues([])
		setSubmitting(true)
		setPageError(null)
		try {
			const release = await publishRelease(session, result.value)
			await loadReleases()
			setNotice(`版本 ${selectedCandidate?.version ?? release.releaseId} 已发布。`)
		} catch (error) {
			setPageError(error instanceof Error ? error.message : '版本发布失败')
		} finally {
			setSubmitting(false)
		}
	}

	const handleStateChange = async (
		release: ReleaseRollout,
		action: 'pause' | 'resume' | 'withdraw',
	) => {
		if (
			action === 'withdraw' &&
			!window.confirm(
				`撤回 ${release.channel} 通道的版本发布？客户端将停止新的下载和安装包打开操作。`,
			)
		) {
			return
		}
		setPageError(null)
		try {
			const updated = await changeReleaseState(session, release.id, action)
			setReleases((current) => current.map((item) => (item.id === updated.id ? updated : item)))
			setNotice(
				action === 'pause' ? '发布已暂停。' : action === 'resume' ? '发布已恢复。' : '发布已撤回。',
			)
		} catch (error) {
			setPageError(error instanceof Error ? error.message : '发布状态更新失败')
		}
	}

	return (
		<div className="dispatch-page">
			{(pageError || notice) && (
				<div className={pageError ? 'alert' : 'notice'} role={pageError ? 'alert' : 'status'}>
					{pageError ? <CircleAlert size={16} /> : <Rocket size={16} />}
					{pageError ?? notice}
				</div>
			)}

			<div className="release-layout">
				<section className="panel dispatch-form-panel">
					<div className="panel-header">
						<div>
							<h2>发布版本</h2>
							<p>只选择已通过 Ed25519 清单验签与完整性校验的候选；后台不上传安装包。</p>
						</div>
						<span className="permission-label">{canEdit ? '可发布' : '只读'}</span>
					</div>

					<form className="dispatch-form" onSubmit={handleSubmit}>
						<fieldset disabled={!canEdit || submitting || loading}>
							<label className="field-block">
								<span>版本候选 · 通道和产物由 CI 锁定</span>
								<select
									value={draft.candidateId}
									aria-invalid={hasFieldIssue(issues, 'candidateId')}
									aria-describedby={fieldDescriptionId(issues, 'candidateId')}
									onChange={(event) => {
										const candidate = candidates.find(
											(item) => item.releaseId === event.target.value,
										)
										setDraft((current) => ({
											...current,
											candidateId: event.target.value,
											mode: candidate?.schemaVersion === 2 ? 'optional' : current.mode,
										}))
										setIssues([])
										setNotice(null)
									}}
								>
									{candidates.length === 0 && <option value="">暂无 verified 候选</option>}
									{candidates.map((candidate) => (
										<option key={candidate.releaseId} value={candidate.releaseId}>
											{candidate.version} · {candidate.channel} · {candidate.runtime} ·{' '}
											{candidate.distribution.mode}
										</option>
									))}
								</select>
								<FieldError issues={issues} field="candidateId" />
							</label>

							<div className="field-block">
								<span>更新模式</span>
								<div
									className="segmented wide"
									role="group"
									aria-label="更新模式"
									aria-describedby={fieldDescriptionId(issues, 'mode')}
								>
									{(['optional', 'mandatory'] as const).map((mode) => (
										<button
											key={mode}
											type="button"
											className={draft.mode === mode ? 'selected' : ''}
											aria-pressed={draft.mode === mode}
											disabled={mode === 'mandatory' && selectedCandidate?.schemaVersion === 2}
											onClick={() => handleModeChange(mode)}
										>
											{mode === 'optional' ? '可选更新' : '强制更新'}
										</button>
									))}
								</div>
								<FieldError issues={issues} field="mode" />
								{selectedCandidate?.schemaVersion === 2 && (
									<small className="field-hint">平台更新当前仅支持可选发布。</small>
								)}
							</div>

							<div className="field-block">
								<span>放量比例</span>
								<div
									className="rollout-options"
									role="group"
									aria-label="放量比例"
									aria-describedby={fieldDescriptionId(issues, 'percentage')}
								>
									{RELEASE_PERCENTAGES.map((percentage) => (
										<button
											key={percentage}
											type="button"
											className={draft.percentage === percentage ? 'selected' : ''}
											aria-pressed={draft.percentage === percentage}
											disabled={draft.mode === 'mandatory' && percentage !== 100}
											onClick={() => updateDraft('percentage', percentage)}
										>
											{percentage}%
										</button>
									))}
								</div>
								<FieldError issues={issues} field="percentage" />
								{draft.mode === 'mandatory' && (
									<small className="field-hint">强制更新固定为 100% 放量。</small>
								)}
							</div>

							<label className="field-block">
								<span>更新标题</span>
								<input
									value={draft.title}
									aria-invalid={hasFieldIssue(issues, 'title')}
									aria-describedby={fieldDescriptionId(issues, 'title')}
									maxLength={80}
									onChange={(event) => updateDraft('title', event.target.value)}
									placeholder="例如：问学 1.1.0 已可用"
								/>
								<FieldError issues={issues} field="title" />
							</label>

							<label className="field-block">
								<span>更新说明</span>
								<textarea
									className="message-body-input"
									value={draft.notes}
									aria-invalid={hasFieldIssue(issues, 'notes')}
									aria-describedby={fieldDescriptionId(issues, 'notes')}
									maxLength={2000}
									onChange={(event) => updateDraft('notes', event.target.value)}
									placeholder="说明主要变化、修复内容和用户需要注意的事项。"
								/>
								<FieldError issues={issues} field="notes" />
							</label>

							<label className="field-block">
								<span>最低支持版本 · 可选</span>
								<input
									value={draft.minSupportedVersion}
									aria-invalid={hasFieldIssue(issues, 'minSupportedVersion')}
									aria-describedby={fieldDescriptionId(issues, 'minSupportedVersion')}
									onChange={(event) => updateDraft('minSupportedVersion', event.target.value)}
									placeholder="例如 0.9.0"
								/>
								<FieldError issues={issues} field="minSupportedVersion" />
							</label>
						</fieldset>

						<button
							className="primary-button form-submit"
							type="submit"
							disabled={!canEdit || submitting || !selectedCandidate}
						>
							<Rocket size={16} />
							{submitting ? '正在发布' : '立即发布'}
						</button>
						{!canEdit && <p className="muted">viewer 角色只能查看候选和发布记录。</p>}
					</form>
				</section>

				<div className="release-side">
					<section className="panel preview-panel">
						<div className="panel-header">
							<div>
								<h2>客户端预览</h2>
								<p>
									{selectedCandidate?.schemaVersion === 2
										? 'macOS 打开 DMG 后手动覆盖；Windows 可在退出时安装或立即重启更新。'
										: '用户主动下载并打开未签名安装包，安装过程由操作系统接管。'}
								</p>
							</div>
						</div>
						{selectedCandidate?.schemaVersion === 2 && (
							<div className="segmented wide" role="group" aria-label="预览平台">
								<button
									type="button"
									className={previewPlatform === 'darwin' ? 'selected' : ''}
									aria-pressed={previewPlatform === 'darwin'}
									onClick={() => setPreviewPlatform('darwin')}
								>
									macOS
								</button>
								<button
									type="button"
									className={previewPlatform === 'win32' ? 'selected' : ''}
									aria-pressed={previewPlatform === 'win32'}
									onClick={() => setPreviewPlatform('win32')}
								>
									Windows
								</button>
							</div>
						)}
						{previewState && (
							<div className="segmented wide" role="group" aria-label="预览阶段">
								<button
									type="button"
									className={previewPhase === 'available' ? 'selected' : ''}
									aria-pressed={previewPhase === 'available'}
									onClick={() => setPreviewPhase('available')}
								>
									发现更新
								</button>
								<button
									type="button"
									className={previewPhase === 'ready' ? 'selected' : ''}
									aria-pressed={previewPhase === 'ready'}
									onClick={() => setPreviewPhase('ready')}
								>
									下载完成
								</button>
							</div>
						)}
						{previewState ? (
							<UpdateDialog
								state={previewState}
								presentation="preview"
								onDismiss={() => undefined}
								onDownload={() => undefined}
								onExit={() => undefined}
								onOpenInstaller={() => undefined}
								onRestartInstall={() => undefined}
							/>
						) : (
							<div className="empty-state">等待 CI 注册 verified 候选</div>
						)}
					</section>

					<CandidateEvidence candidate={selectedCandidate} />
				</div>
			</div>

			<section className="panel history-panel">
				<div className="panel-header">
					<div>
						<h2>发布记录</h2>
						<p>
							暂停和撤回会立即阻止客户端开始新的下载或打开安装包；匿名健康事件仅反映交接结果，供人工参考。
						</p>
					</div>
					<button
						className="icon-button"
						type="button"
						onClick={() => void loadReleases()}
						disabled={loading}
					>
						<RotateCcw size={15} className={loading ? 'spin' : ''} />
						重新载入
					</button>
				</div>
				<ReleaseHistory
					releases={releases}
					loading={loading}
					canEdit={canEdit}
					onStateChange={handleStateChange}
				/>
			</section>
		</div>
	)
}

function CandidateEvidence({ candidate }: { candidate?: ReleaseCandidate }) {
	return (
		<section className="panel evidence-panel">
			<div className="panel-header">
				<div>
					<h2>候选完整性</h2>
					<p>Ed25519 清单签名、产物哈希、平台矩阵与内置测试结果均为只读。</p>
				</div>
				{candidate && (
					<span className="verified-label">
						<ShieldCheck size={15} />
						Ed25519 verified
					</span>
				)}
			</div>
			{candidate ? (
				<div className="evidence-content">
					<div className="evidence-strip">
						<div>
							<span>版本</span>
							<strong>{candidate.version}</strong>
						</div>
						<div>
							<span>通道</span>
							<strong>{candidate.channel}</strong>
						</div>
						<div>
							<span>提交</span>
							<strong className="mono">{shortHash(candidate.sourceCoordinates.commit)}</strong>
						</div>
						<div>
							<span>浏览器</span>
							<strong>{candidate.sourceCoordinates.browserVersion}</strong>
						</div>
						<div>
							<span>扩展</span>
							<strong>{candidate.sourceCoordinates.extensionVersion}</strong>
						</div>
						<div>
							<span>分发</span>
							<strong>{candidate.distribution.mode}</strong>
						</div>
					</div>
					<div className="manual-distribution-warning" role="note">
						<TriangleAlert size={17} aria-hidden="true" />
						<div>
							<strong>{candidate.schemaVersion === 2 ? '未签名平台分发' : '未签名手动安装'}</strong>
							<span>
								安装包未经过 Apple Developer ID 或 Windows Authenticode
								签名，Gatekeeper／SmartScreen 可能显示安全警告。Ed25519
								只证明清单来源与文件完整性，不代表平台信任。
							</span>
						</div>
					</div>
					{candidate.schemaVersion === 2 && (
						<p className="muted">2 个平台 · 3 份文件（Windows 安装包附带 NSIS 元数据）</p>
					)}
					<div className="artifact-list">
						{candidate.artifacts.map((artifact) => (
							<div
								className="artifact-row"
								key={`${artifact.platform}:${artifact.arch}:${artifact.fileName}`}
							>
								<div>
									<strong>{artifact.fileName}</strong>
									<span>
										{artifact.platform === 'darwin' ? 'macOS' : 'Windows'} · {artifact.arch} ·{' '}
										{artifact.kind} · {formatBytes(artifact.size)}
									</span>
								</div>
								<code title={artifact.sha512}>{shortHash(artifact.sha512)}</code>
							</div>
						))}
					</div>
					<div className="test-evidence">
						{candidate.tests.map((test) => (
							<span key={test.name}>
								<FileCheck2 size={14} />
								{test.name}
							</span>
						))}
					</div>
				</div>
			) : (
				<div className="empty-state">选择一个版本候选</div>
			)}
		</section>
	)
}

function ReleaseHistory({
	releases,
	loading,
	canEdit,
	onStateChange,
}: {
	releases: ReleaseRollout[]
	loading: boolean
	canEdit: boolean
	onStateChange: (release: ReleaseRollout, action: 'pause' | 'resume' | 'withdraw') => Promise<void>
}) {
	if (loading) return <div className="empty-state">正在读取发布记录</div>
	if (releases.length === 0) return <div className="empty-state">尚未发起版本发布</div>
	return (
		<div className="table-scroll">
			<table>
				<thead>
					<tr>
						<th>候选</th>
						<th>策略</th>
						<th>近 30 天健康</th>
						<th>状态</th>
						<th>发布时间</th>
						<th aria-label="操作" />
					</tr>
				</thead>
				<tbody>
					{releases.map((release) => (
						<tr key={release.id}>
							<td>
								<strong className="table-title mono">{release.releaseId}</strong>
								<span className="table-subline">
									{release.channel} · {release.runtime}
								</span>
							</td>
							<td>
								{release.mode === 'mandatory' ? '强制' : '可选'} · {release.percentage}%
							</td>
							<td>
								<ReleaseHealthCell
									health={release.health}
									unavailableReason={release.healthUnavailableReason}
								/>
							</td>
							<td>
								<span className={`status-badge ${release.status}`}>
									{releaseStatusLabel(release.status)}
								</span>
							</td>
							<td>{formatDateTime(release.publishedAt)}</td>
							<td className="table-actions release-actions">
								{release.status === 'active' && (
									<button
										className="text-button"
										type="button"
										disabled={!canEdit}
										onClick={() => void onStateChange(release, 'pause')}
									>
										<Pause size={14} />
										暂停
									</button>
								)}
								{release.status === 'paused' && (
									<button
										className="text-button"
										type="button"
										disabled={!canEdit}
										onClick={() => void onStateChange(release, 'resume')}
									>
										<Play size={14} />
										恢复
									</button>
								)}
								{(release.status === 'active' || release.status === 'paused') && (
									<button
										className="text-button danger"
										type="button"
										disabled={!canEdit}
										onClick={() => void onStateChange(release, 'withdraw')}
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

function ReleaseHealthCell({
	health,
	unavailableReason,
}: {
	health?: ReleaseHealth
	unavailableReason?: 'historical' | 'limit'
}) {
	if (!health) {
		return (
			<span className="health-empty">
				{unavailableReason === 'historical'
					? '历史版本不再统计'
					: unavailableReason === 'limit'
						? '超出本次统计范围'
						: '暂无事件'}
			</span>
		)
	}
	const failureRate = health.handoffFailureRate
	const handoffSamples = health.stages.handoff.success + health.stages.handoff.failure
	const aboveThreshold =
		!health.truncated && handoffSamples >= 50 && failureRate !== null && failureRate > 0.02
	return (
		<div className={`health-summary${aboveThreshold ? ' health-summary--warning' : ''}`}>
			<div className="health-stages" aria-label="匿名版本健康事件">
				<HealthStage label="检查" health={health.stages.check} />
				<HealthStage label="下载" health={health.stages.download} />
				<HealthStage label="安装包交接" health={health.stages.handoff} />
			</div>
			<span>
				{failureRate === null
					? '尚无安装包交接结果'
					: `安装包打开失败率 ${formatPercent(failureRate)}`}
				{aboveThreshold ? ' · 超过 2%' : ''}
				{health.truncated ? ' · 数据已截断，不用于自动判断' : ''}
				{!health.truncated && handoffSamples > 0 && handoffSamples < 50
					? ` · 样本不足（${handoffSamples}/50）`
					: ''}
			</span>
		</div>
	)
}

function HealthStage({
	label,
	health,
}: {
	label: string
	health: ReleaseHealth['stages']['check']
}) {
	return (
		<span title={`成功 ${health.success}，失败 ${health.failure}`}>
			<strong>{label}</strong> {health.success}/{health.failure}
		</span>
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
	return `release-error-${field.replace(/[^a-z0-9]+/gi, '-')}`
}

function createReleaseDraft(): ReleaseDraft {
	return {
		candidateId: '',
		title: '',
		notes: '',
		percentage: 5,
		mode: 'optional',
		minSupportedVersion: '',
	}
}

function releaseStatusLabel(status: ReleaseRollout['status']) {
	if (status === 'active') return '发布中'
	if (status === 'paused') return '已暂停'
	if (status === 'withdrawn') return '已撤回'
	return '已取代'
}

function shortHash(value: string) {
	return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

function previewArtifactSize(candidate: ReleaseCandidate, platform: 'darwin' | 'win32') {
	const installableSizes = candidate.artifacts
		.filter(
			(artifact) =>
				artifact.platform === platform && (artifact.kind === 'dmg' || artifact.kind === 'nsis'),
		)
		.map((artifact) => artifact.size)
	return installableSizes.length ? Math.max(...installableSizes) : 0
}

function formatBytes(value: number) {
	if (!Number.isFinite(value) || value <= 0) return '-'
	const units = ['B', 'KB', 'MB', 'GB']
	const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
	const amount = value / 1024 ** exponent
	return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`
}

function formatPercent(value: number) {
	return new Intl.NumberFormat('zh-CN', {
		style: 'percent',
		minimumFractionDigits: value > 0 && value < 0.01 ? 2 : 1,
		maximumFractionDigits: 2,
	}).format(value)
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
