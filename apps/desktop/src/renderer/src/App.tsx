import type { LucideIcon } from 'lucide-react'
import {
	AlertTriangle,
	Check,
	Circle,
	CircleCheck,
	Focus,
	FolderOpen,
	HelpCircle,
	LoaderCircle,
	Play,
	RotateCcw,
	ShieldCheck,
	Sparkles,
	Terminal,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { strings } from './strings'
import type { AppVersions, BrowserStatus } from './wenxue'

function useDarkMode() {
	const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: dark)')
		const handler = (e: MediaQueryListEvent) => setDark(e.matches)
		mq.addEventListener('change', handler)
		return () => mq.removeEventListener('change', handler)
	}, [])
	return dark
}

interface StatusPresentation {
	code: string
	icon: LucideIcon
	panelClassName: string
	timelineIndex: number
}

const statusPresentation: Record<BrowserStatus, StatusPresentation> = {
	idle: {
		code: 'IDLE',
		icon: ShieldCheck,
		panelClassName: 'status-panel--idle',
		timelineIndex: -1,
	},
	launching: {
		code: 'IGNITION',
		icon: LoaderCircle,
		panelClassName: 'status-panel--launching',
		timelineIndex: 1,
	},
	running: {
		code: 'ONLINE',
		icon: Zap,
		panelClassName: 'status-panel--running',
		timelineIndex: 2,
	},
	error: {
		code: 'FAULT',
		icon: AlertTriangle,
		panelClassName: 'status-panel--error',
		timelineIndex: -1,
	},
}

export default function App() {
	const dark = useDarkMode()
	const [status, setStatus] = useState<BrowserStatus>('idle')
	const [versions, setVersions] = useState<AppVersions>({
		app: 'unknown',
		browser: 'unknown',
		extension: 'unknown',
	})
	const [launchError, setLaunchError] = useState<string | undefined>()
	const [openLogsError, setOpenLogsError] = useState<string | undefined>()

	useEffect(() => {
		let mounted = true
		const unsubscribe = window.wenxue.browser.onStatusChange((next) => {
			if (!mounted) return
			setStatus(next)
			if (next !== 'error') {
				setLaunchError(undefined)
				setOpenLogsError(undefined)
			}
		})

		window.wenxue.browser.getStatus().then((next) => {
			if (mounted) setStatus(next)
		})
		window.wenxue.app.getVersions().then((next) => {
			if (mounted) setVersions(next)
		})

		return () => {
			mounted = false
			unsubscribe()
		}
	}, [])

	const action = useMemo(() => {
		if (status === 'running') {
			return {
				icon: Focus,
				label: strings.action.focus,
			}
		}
		if (status === 'error') {
			return {
				icon: RotateCcw,
				label: strings.action.relaunch,
			}
		}
		return {
			icon: Play,
			label: strings.action.launch,
		}
	}, [status])

	const launchBrowser = useCallback(async () => {
		setLaunchError(undefined)
		setOpenLogsError(undefined)
		if (status !== 'running') {
			setStatus('launching')
		}

		const result = await window.wenxue.browser.launch()
		if (!result.ok) {
			setStatus('error')
			setLaunchError(result.error)
		}
	}, [status])

	const openLogs = useCallback(async () => {
		setOpenLogsError(undefined)
		const result = await window.wenxue.app.openLogs()
		if (!result.ok) {
			setOpenLogsError(result.error ?? strings.openLogsFallback)
		}
	}, [])

	return (
		<main className={`launcher-root launcher-root--${status}`}>
			<div className="launcher-grid" aria-hidden="true" />
			<section className="launcher-shell" aria-label={strings.shellLabel}>
				<BrandHeader dark={dark} status={status} />
				<BrowserStatusPanel
					actionIcon={action.icon}
					actionLabel={action.label}
					launchError={launchError}
					onAction={launchBrowser}
					onOpenLogs={openLogs}
					openLogsError={openLogsError}
					status={status}
				/>
				<OnboardingChecklist status={status} />
				<VersionFooter versions={versions} />
			</section>
		</main>
	)
}

interface BrandHeaderProps {
	dark: boolean
	status: BrowserStatus
}

function BrandHeader({ dark, status }: BrandHeaderProps) {
	return (
		<header className="brand-header">
			<div className="brand-lockup">
				<div className="brand-mark-wrap">
					<img aria-hidden="true" className="brand-mark" src="/logo.png" />
				</div>
				<div className="brand-copy">
					<img
						alt={strings.brand}
						className="brand-wordmark"
						src={dark ? '/darkslogen.png' : '/lightslogen.png'}
					/>
					<p>{strings.slogan}</p>
				</div>
			</div>
			<div className="status-capsule" aria-label={strings.statusCapsuleLabel}>
				<span className={`status-capsule__dot status-capsule__dot--${status}`} />
				<span>{strings.status[status]}</span>
			</div>
		</header>
	)
}

interface BrowserStatusPanelProps {
	actionIcon: LucideIcon
	actionLabel: string
	launchError?: string
	onAction: () => void
	onOpenLogs: () => void
	openLogsError?: string
	status: BrowserStatus
}

function BrowserStatusPanel({
	actionIcon: ActionIcon,
	actionLabel,
	launchError,
	onAction,
	onOpenLogs,
	openLogsError,
	status,
}: BrowserStatusPanelProps) {
	const presentation = statusPresentation[status]
	const StatusIcon = presentation.icon
	const isLaunching = status === 'launching'

	return (
		<article className={`energy-frame status-panel ${presentation.panelClassName}`}>
			<div className="status-panel__head">
				<div className="status-panel__icon" aria-hidden="true">
					<StatusIcon className={isLaunching ? 'motion-spin' : undefined} size={20} />
				</div>
				<div className="status-panel__copy">
					<div className="status-panel__eyebrow">
						<span>{presentation.code}</span>
						<span>{strings.runtimeLabel}</span>
					</div>
					<h1>{strings.status[status]}</h1>
					<p>{strings.description[status]}</p>
				</div>
			</div>

			<LaunchTimeline activeIndex={presentation.timelineIndex} status={status} />

			{status === 'error' ? (
				<div className="status-panel__alerts">
					<p className="status-panel__error" title={launchError ?? strings.errorFallback}>
						{launchError ?? strings.errorFallback}
					</p>
					{openLogsError ? (
						<p className="status-panel__error" title={openLogsError}>
							{openLogsError}
						</p>
					) : null}
				</div>
			) : null}

			<div className="status-panel__actions">
				<button className="primary-action" disabled={isLaunching} onClick={onAction} type="button">
					{isLaunching ? (
						<LoaderCircle aria-hidden="true" className="motion-spin" size={17} />
					) : (
						<ActionIcon aria-hidden="true" size={17} />
					)}
					<span>{actionLabel}</span>
				</button>
				{status === 'error' ? (
					<button className="secondary-action" onClick={onOpenLogs} type="button">
						<FolderOpen aria-hidden="true" size={16} />
						<span>{strings.action.openLogs}</span>
					</button>
				) : null}
			</div>
		</article>
	)
}

interface LaunchTimelineProps {
	activeIndex: number
	status: BrowserStatus
}

function LaunchTimeline({ activeIndex, status }: LaunchTimelineProps) {
	return (
		<ol className="launch-timeline" aria-label={strings.launchTimeline.title}>
			{strings.launchTimeline.items.map((item, index) => {
				const complete = status === 'running' || (status === 'launching' && index < activeIndex)
				const active = status === 'launching' && index === activeIndex
				const failed = status === 'error' && index === 1
				return (
					<li
						className={`launch-timeline__item ${
							complete ? 'launch-timeline__item--complete' : ''
						} ${active ? 'launch-timeline__item--active' : ''} ${
							failed ? 'launch-timeline__item--failed' : ''
						}`}
						key={item}
					>
						<span className="launch-timeline__marker" aria-hidden="true">
							{complete ? <Check size={11} /> : null}
						</span>
						<span>{item}</span>
					</li>
				)
			})}
		</ol>
	)
}

interface OnboardingChecklistProps {
	status: BrowserStatus
}

function OnboardingChecklist({ status }: OnboardingChecklistProps) {
	const browserStarted = status === 'launching' || status === 'running'

	return (
		<section className="onboarding-panel" aria-labelledby="onboarding-title">
			<div className="section-heading">
				<Sparkles aria-hidden="true" size={15} />
				<h2 id="onboarding-title">{strings.onboarding.title}</h2>
			</div>
			<ol className="onboarding-list">
				{strings.onboarding.items.map((item, index) => {
					const complete = index === 0 && browserStarted
					return (
						<li className={complete ? 'onboarding-list__item--complete' : ''} key={item}>
							{complete ? (
								<CircleCheck aria-hidden="true" size={15} />
							) : (
								<Circle aria-hidden="true" size={15} />
							)}
							<span>{item}</span>
						</li>
					)
				})}
			</ol>
		</section>
	)
}

interface VersionFooterProps {
	versions: AppVersions
}

function VersionFooter({ versions }: VersionFooterProps) {
	return (
		<footer className="version-footer">
			<VersionItem icon={Terminal} label={strings.versionLabel.app} value={versions.app} />
			<VersionItem
				icon={ShieldCheck}
				label={strings.versionLabel.browser}
				value={versions.browser}
			/>
			<VersionItem
				icon={HelpCircle}
				label={strings.versionLabel.extension}
				value={versions.extension}
			/>
		</footer>
	)
}

interface VersionItemProps {
	icon: LucideIcon
	label: string
	value: string
}

function VersionItem({ icon: Icon, label, value }: VersionItemProps) {
	return (
		<div className="version-item" title={`${label}: ${value}`}>
			<Icon aria-hidden="true" size={13} />
			<div>
				<p>{label}</p>
				<strong>{value}</strong>
			</div>
		</div>
	)
}
