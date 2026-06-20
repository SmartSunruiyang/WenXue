import { ArrowLeft, ArrowRight, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type SessionRecord, deleteSession, getSession } from '@/lib/db'
import { useI18n } from '@/lib/i18n'

import { Conversation } from './conversation'
import { HistoryRerunControl } from './HistoryList'

export function HistoryDetail({
	sessionId,
	onBack,
	onRerun,
	onGoToSession,
	canRerun = true,
	canGoToSession = true,
}: {
	sessionId: string
	onBack: () => void
	onRerun: (task: string) => void
	onGoToSession: (session: SessionRecord) => void
	canRerun?: boolean
	canGoToSession?: boolean
}) {
	const { t } = useI18n()
	const [session, setSession] = useState<SessionRecord | null>(null)

	useEffect(() => {
		getSession(sessionId).then((s) => setSession(s ?? null))
	}, [sessionId])

	if (!session) {
		return (
			<div className="flex items-center justify-center h-screen text-xs text-muted-foreground">
				{t('loading')}
			</div>
		)
	}

	return (
		<div className="flex h-screen w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-background">
			{/* Header */}
			<header className="flex items-center gap-2 px-3 py-2">
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<ArrowLeft className="size-3.5" />
				</Button>
				<span className="text-sm font-medium truncate">{t('history')}</span>
				<HistoryDetailActions
					session={session}
					onRerun={onRerun}
					onGoToSession={onGoToSession}
					onDelete={async () => {
						await deleteSession(sessionId)
						onBack()
					}}
					canRerun={canRerun}
					canGoToSession={canGoToSession}
				/>
			</header>

			{/* Events (read-only) */}
			<div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-2">
				<Conversation task={session.task} events={session.history} />
			</div>
		</div>
	)
}

export function HistoryDetailActions({
	session,
	onRerun,
	onGoToSession,
	onDelete,
	canRerun = true,
	canGoToSession = true,
}: {
	session: SessionRecord
	onRerun: (task: string) => void
	onGoToSession: (session: SessionRecord) => void
	onDelete: () => void | Promise<void>
	canRerun?: boolean
	canGoToSession?: boolean
}) {
	const { t } = useI18n()

	return (
		<div className="ml-auto flex items-center gap-2">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onClick={() => onGoToSession(session)}
				disabled={!canGoToSession}
				className="h-7 px-2 text-[10px]"
				aria-label={`${t('goToSession')}: ${session.task}`}
				title={t('goToSession')}
			>
				<ArrowRight className="size-3" />
				{t('goToSession')}
			</Button>
			<HistoryRerunControl task={session.task} onRerun={onRerun} canRerun={canRerun} showLabel />
			<button
				type="button"
				onClick={onDelete}
				className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-destructive"
			>
				<Trash2 className="size-3" />
				{t('delete')}
			</button>
		</div>
	)
}
