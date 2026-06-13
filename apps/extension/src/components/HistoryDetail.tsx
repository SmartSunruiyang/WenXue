import { ArrowLeft, ArrowRight, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type SessionRecord, deleteSession, getSession } from '@/lib/db'
import { useI18n } from '@/lib/i18n'

import { Conversation } from './conversation'

export function HistoryDetail({
	sessionId,
	onBack,
	onRerun,
	onGoToSession,
	canGoToSession = true,
}: {
	sessionId: string
	onBack: () => void
	onRerun: (task: string) => void
	onGoToSession: (session: SessionRecord) => void
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
					<button
						type="button"
						onClick={() => onRerun(session.task)}
						className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<RotateCcw className="size-3" />
						{t('runAgain')}
					</button>
					<button
						type="button"
						onClick={async () => {
							await deleteSession(sessionId)
							onBack()
						}}
						className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
					>
						<Trash2 className="size-3" />
						{t('delete')}
					</button>
				</div>
			</header>

			{/* Events (read-only) */}
			<div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-2">
				<Conversation task={session.task} events={session.history} />
			</div>
		</div>
	)
}
