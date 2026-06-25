import type { HistoricalEvent } from '@page-agent/core'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'

const CONTEXT_BANNER_RATIO = 0.85

export function shouldShowContextBanner(history: HistoricalEvent[], hardTokens: number): boolean {
	if (hardTokens <= 0) return false
	for (let index = history.length - 1; index >= 0; index--) {
		const event = history[index]
		if (event.type === 'step') {
			return event.usage.promptTokens >= hardTokens * CONTEXT_BANNER_RATIO
		}
	}
	return false
}

export function ContextBanner({
	onNewConversation,
	onDismiss,
}: {
	onNewConversation: () => void
	onDismiss: () => void
}) {
	return (
		<div
			role="status"
			className="flex w-full min-w-0 items-start gap-3 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2.5 text-amber-950 shadow-sm dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100"
		>
			<div className="min-w-0 flex-1 text-[13px] leading-relaxed">
				上下文已较长，建议开启新会话以获得更好效果
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<Button type="button" size="sm" className="h-7 px-2.5 text-xs" onClick={onNewConversation}>
					新会话
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-xs text-amber-950 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-100 dark:hover:bg-amber-400/10 dark:hover:text-amber-50"
					onClick={onDismiss}
				>
					继续当前会话
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="size-7 text-amber-950 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-100 dark:hover:bg-amber-400/10 dark:hover:text-amber-50"
					aria-label="继续当前会话"
					onClick={onDismiss}
				>
					<X className="size-3.5" />
				</Button>
			</div>
		</div>
	)
}
