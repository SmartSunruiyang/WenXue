import type { AgentStatus } from '@page-agent/core'
import { BookOpen, Globe, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { siGithub } from 'simple-icons'

import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Status dot indicator
export function StatusDot({ status }: { status: AgentStatus }) {
	const { t } = useI18n()

	const colorClass = {
		idle: 'bg-muted-foreground',
		running: 'bg-blue-500',
		completed: 'bg-green-500',
		error: 'bg-destructive',
	}[status]

	const label = {
		idle: t('statusReady'),
		running: t('statusRunning'),
		completed: t('statusDone'),
		error: t('statusError'),
	}[status]

	return (
		<div className="flex items-center gap-1.5 mr-2">
			<span
				className={cn('size-2 rounded-full', colorClass, status === 'running' && 'animate-pulse')}
			/>
			<span className="text-xs text-muted-foreground">{label}</span>
		</div>
	)
}

export function Logo({ className }: { className?: string }) {
	return (
		<img
			src="/assets/wenxue-logo-1254.png"
			alt="问学 WenXue"
			className={cn('', className)}
		/>
	)
}

// Full-screen liquid-glass frame, shown only while running (UIUX §5)
export function MotionOverlay({ active }: { active: boolean }) {
	return (
		<div
			aria-hidden
			className={cn('wx-liquid-frame z-10 overflow-hidden', active && 'wx-active')}
		>
			<div className="wx-liquid-glass" />
			<div className="wx-liquid-flow" />
			<div className="wx-liquid-flow wx-liquid-flow--alt" />
			<div className="wx-liquid-ring" />
			<div className="wx-liquid-edge" />
		</div>
	)
}

// Empty state with logo and breathing glow
export function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
			<div className="relative select-none pointer-events-none">
				<div className="absolute inset-0 -m-6 rounded-full bg-[conic-gradient(from_180deg,oklch(0.55_0.2_280),oklch(0.5_0.15_230),oklch(0.6_0.18_310),oklch(0.55_0.2_280))] blur-2xl animate-[glow-a_5s_ease-in-out_infinite]" />
				<div className="absolute inset-0 -m-6 rounded-full bg-[conic-gradient(from_0deg,oklch(0.55_0.18_160),oklch(0.5_0.2_200),oklch(0.6_0.15_120),oklch(0.55_0.18_160))] blur-2xl animate-[glow-b_5s_ease-in-out_infinite]" />
				<Logo className="relative size-20 opacity-80" />
			</div>
			<img
				src="/assets/wenxue-slogan.png"
				alt="问学 — ask for everything"
				className="w-56 max-w-full select-none pointer-events-none"
			/>
			<div className="flex items-center gap-3 mt-1 text-muted-foreground">
				<a
					href="https://github.com/alibaba/page-agent"
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-foreground transition-colors"
					title="GitHub"
				>
					<svg role="img" viewBox="0 0 24 24" className="size-4 fill-current">
						<path d={siGithub.path} />
					</svg>
				</a>
				<a
					href="https://alibaba.github.io/page-agent/docs/features/chrome-extension"
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-foreground transition-colors"
					title="Documentation"
				>
					<BookOpen className="size-4" />
				</a>
				<a
					href="https://alibaba.github.io/page-agent"
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-foreground transition-colors"
					title="Website"
				>
					<Globe className="size-4" />
				</a>
			</div>
		</div>
	)
}

const PIN_TIP_DISMISSED_KEY = 'pinTipDismissed'

export function PinTip() {
	const { t } = useI18n()
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		chrome.storage.local.get(PIN_TIP_DISMISSED_KEY).then((result) => {
			if (!result[PIN_TIP_DISMISSED_KEY]) setVisible(true)
		})
	}, [])

	const dismiss = () => {
		setVisible(false)
		chrome.storage.local.set({ [PIN_TIP_DISMISSED_KEY]: true })
	}

	if (!visible) return null

	return (
		<div className="absolute top-1 right-3 z-50 flex flex-col items-end">
			{/* 📌 pin icon */}
			<div
				className="text-xl select-none"
				style={{ animation: 'pin-swing 1.2s ease-in-out 0.3s 2' }}
			>
				📌
			</div>
			{/* connecting line */}
			<div
				className="wx-pin-line w-px origin-top"
				style={{
					height: 16,
					animation: 'pin-line-grow 0.4s ease-out 0.6s both',
				}}
			/>
			{/* tip card */}
			<div
				className="w-44 rounded-lg border bg-popover p-2.5 shadow-lg"
				style={{ animation: 'pin-card-in 0.35s ease-out 0.9s both' }}
			>
				<div className="flex items-start justify-between gap-1">
					<div className="space-y-0.5 text-[11px] leading-relaxed">
						<p className="font-medium text-foreground">{t('pinTip')}</p>
						<p className="text-muted-foreground">{t('pinTipHow')}</p>
					</div>
					<button
						type="button"
						onClick={dismiss}
						className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
						aria-label={t('pinTipDismiss')}
					>
						<X className="size-3" />
					</button>
				</div>
				<button
					type="button"
					onClick={dismiss}
					className="mt-1.5 w-full rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
				>
					{t('pinTipDismiss')}
				</button>
			</div>
		</div>
	)
}
