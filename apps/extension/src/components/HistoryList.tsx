import {
	ArrowDownToLine,
	ArrowLeft,
	ArrowRight,
	CheckCircle,
	History,
	RotateCcw,
	Trash2,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type SessionRecord, clearSessions, deleteSession, listSessions } from '@/lib/db'
import { downloadHistoryExport } from '@/lib/history-export'
import { type TranslationKey, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function timeAgo(ts: number, t: (key: TranslationKey) => string): string {
	const seconds = Math.floor((Date.now() - ts) / 1000)
	if (seconds < 60) return t('justNow')
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}${t('timeAgoMinutes')}`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}${t('timeAgoHours')}`
	const days = Math.floor(hours / 24)
	return `${days}${t('timeAgoDays')}`
}

export function HistoryList({
	onSelect,
	onBack,
	onRerun,
	onGoToSession,
	canRerun = true,
	canGoToSession = true,
	enterOrigin,
}: {
	onSelect: (id: string) => void
	onBack: () => void
	onRerun: (task: string) => void
	onGoToSession: (session: SessionRecord) => void
	canRerun?: boolean
	canGoToSession?: boolean
	enterOrigin?: { x: number; y: number } | null
}) {
	const { t } = useI18n()
	const [sessions, setSessions] = useState<SessionRecord[]>([])
	const [loading, setLoading] = useState(true)
	const surfaceStyle = enterOrigin
		? ({
				'--wx-history-origin-x': `${enterOrigin.x}px`,
				'--wx-history-origin-y': `${enterOrigin.y}px`,
			} as React.CSSProperties)
		: undefined

	const load = useCallback(async () => {
		try {
			setSessions(await listSessions())
		} catch (err) {
			console.error('[HistoryList] Failed to load sessions:', err)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		load()
	}, [load])

	const handleDelete = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation()
		await deleteSession(id)
		setSessions((prev) => prev.filter((s) => s.id !== id))
	}

	const handleExport = (e: React.MouseEvent, session: SessionRecord) => {
		e.stopPropagation()
		downloadHistoryExport(session.task, session.createdAt, session.history)
	}

	const handleGoToSession = (e: React.MouseEvent, session: SessionRecord) => {
		e.stopPropagation()
		onGoToSession(session)
	}

	const handleCardKeyDown = (e: React.KeyboardEvent, id: string) => {
		if (e.key !== 'Enter' && e.key !== ' ') return
		e.preventDefault()
		onSelect(id)
	}

	return (
		<div
			className="wx-history-surface flex h-screen flex-col overflow-hidden bg-background"
			style={surfaceStyle}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center gap-2 px-3 py-2">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onBack}
					className="cursor-pointer"
					aria-label={t('back')}
					title={t('back')}
				>
					<ArrowLeft className="size-3.5" />
				</Button>
				<span className="text-sm font-medium flex-1">{t('history')}</span>
				{sessions.length > 0 && (
					<Button
						variant="ghost"
						size="sm"
						onClick={async () => {
							await clearSessions()
							setSessions([])
						}}
						className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer h-6 px-2"
					>
						<Trash2 className="size-3 mr-1" />
						{t('clearAll')}
					</Button>
				)}
			</header>

			{/* List */}
			<div className="relative z-10 flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-2">
				{loading && (
					<div className="space-y-2" aria-label="Loading history" aria-busy="true">
						{[...Array(4)].map((_, i) => (
							<div
								key={i}
								className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/70 p-3 shadow-sm"
							>
								<div className="size-3.5 mt-0.5 rounded-full bg-muted animate-pulse shrink-0" />
								<div className="flex-1 space-y-1.5">
									<div className="h-2.5 bg-muted animate-pulse rounded w-3/4" />
									<div className="h-2 bg-muted animate-pulse rounded w-1/3" />
								</div>
							</div>
						))}
					</div>
				)}

				{!loading && sessions.length === 0 && (
					<div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
						<History className="size-8 opacity-30" />
						<p className="text-xs">{t('noHistory')}</p>
					</div>
				)}

				{sessions.map((session) => (
					<div
						key={session.id}
						role="button"
						tabIndex={0}
						onClick={() => onSelect(session.id)}
						onKeyDown={(e) => handleCardKeyDown(e, session.id)}
						className="group flex w-full cursor-pointer items-start gap-2 rounded-lg border border-border/60 bg-card/85 p-3 text-left shadow-[0_8px_24px_rgb(0_0_0/0.05)] transition-all hover:-translate-y-0.5 hover:border-border hover:bg-card hover:shadow-[0_12px_30px_rgb(0_0_0/0.08)] focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-card/70"
					>
						{/* Status icon */}
						{session.status === 'completed' ? (
							<CheckCircle className="size-3.5 text-green-500 shrink-0 mt-0.5" />
						) : (
							<XCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />
						)}

						{/* Content */}
						<div className="min-w-0 flex-1">
							<p className="text-xs font-medium truncate">{session.task}</p>
							<div className="mt-0.5 flex items-center">
								<p className="text-[10px] text-muted-foreground">
									{timeAgo(session.createdAt, t)} · {session.history.length} {t('steps')}
								</p>
							</div>
							<div className="mt-2 flex items-center gap-1.5">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={(e) => handleGoToSession(e, session)}
									disabled={!canGoToSession}
									className="h-6 rounded-md px-2 text-[10px]"
									title={t('goToSession')}
									aria-label={`${t('goToSession')}: ${session.task}`}
								>
									<ArrowRight className="size-3" />
									{t('goToSession')}
								</Button>
								<div className="ml-auto flex items-center gap-0.5">
									<HistoryRerunControl task={session.task} onRerun={onRerun} canRerun={canRerun} />
									<button
										type="button"
										onClick={(e) => handleExport(e, session)}
										className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
										title={t('exportJson')}
										aria-label={`Export history for ${session.task}`}
									>
										<ArrowDownToLine className="size-3" />
									</button>
									<button
										type="button"
										onClick={(e) => handleDelete(e, session.id)}
										className="p-0.5 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
										title={t('delete')}
										aria-label={`Delete history for ${session.task}`}
									>
										<Trash2 className="size-3" />
									</button>
								</div>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

export function HistoryRerunControl({
	task,
	onRerun,
	canRerun = true,
	showLabel = false,
}: {
	task: string
	onRerun: (task: string) => void
	canRerun?: boolean
	showLabel?: boolean
}) {
	const { t } = useI18n()

	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation()
				if (!canRerun) return
				onRerun(task)
			}}
			disabled={!canRerun}
			className={cn(
				'flex items-center gap-1 p-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
				canRerun && 'cursor-pointer',
			)}
			title={t('runAgain')}
			aria-label={`${t('runAgain')}: ${task}`}
		>
			<RotateCcw className="size-3" />
			{showLabel && t('runAgain')}
		</button>
	)
}
