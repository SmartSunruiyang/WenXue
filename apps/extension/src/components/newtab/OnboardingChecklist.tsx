import { ChevronDown, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/lib/i18n'

interface Props {
	done: boolean
	onDone: (done: boolean) => void
}

export function OnboardingChecklist({ done, onDone }: Props) {
	const { t } = useI18n()
	const [collapsed, setCollapsed] = useState(done)
	const [closing, setClosing] = useState(false)
	const closeTimer = useRef<number | null>(null)
	const steps = [t('ntStep1'), t('ntStep2'), t('ntStep3'), t('ntStep4')]

	useEffect(() => {
		return () => {
			if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
		}
	}, [])

	const open = () => {
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current)
			closeTimer.current = null
		}
		setClosing(false)
		setCollapsed(false)
	}

	const collapse = () => {
		if (closing) return
		setClosing(true)
		closeTimer.current = window.setTimeout(() => {
			setCollapsed(true)
			setClosing(false)
			onDone(true)
			closeTimer.current = null
		}, 280)
	}

	if (collapsed) {
		return (
			<button
				type="button"
				onClick={open}
				className="wx-onboarding-trigger flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
			>
				<Sparkles className="size-3.5" />
				{t('ntOnboardingTitle')}
			</button>
		)
	}

	return (
		<div
			className={`wx-onboarding-panel w-full rounded-xl border bg-card p-4 ${closing ? 'wx-onboarding-panel--closing' : ''}`}
		>
			<div className="mb-3 flex items-center justify-between">
				<p className="flex items-center gap-2 text-sm font-semibold">
					<Sparkles className="size-4" />
					{t('ntOnboardingTitle')}
				</p>
				<button
					type="button"
					aria-label={t('ntOnboardingDone')}
					onClick={collapse}
					className="rounded p-1 text-muted-foreground hover:text-foreground cursor-pointer"
				>
					<ChevronDown className="size-4" />
				</button>
			</div>
			<ol className="space-y-2">
				{steps.map((step, i) => (
					<li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground">
						<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] text-muted-foreground">
							{i + 1}
						</span>
						<span>{step}</span>
					</li>
				))}
			</ol>
			<button
				type="button"
				onClick={collapse}
				className="mt-3 w-full rounded-lg bg-muted px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors cursor-pointer"
			>
				{t('ntOnboardingDone')}
			</button>
		</div>
	)
}
