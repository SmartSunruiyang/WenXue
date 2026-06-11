import { useCallback, useEffect, useMemo, useState } from 'react'
import { strings } from './strings'
import type { AppVersions, BrowserStatus } from './wenxue'

const statusTone: Record<BrowserStatus, string> = {
	idle: 'border-slate-200 bg-white text-slate-700',
	launching: 'border-amber-200 bg-amber-50 text-amber-800',
	running: 'border-emerald-200 bg-emerald-50 text-emerald-800',
	error: 'border-red-200 bg-red-50 text-red-800',
}

const statusDot: Record<BrowserStatus, string> = {
	idle: 'bg-slate-400',
	launching: 'bg-amber-500',
	running: 'bg-emerald-500',
	error: 'bg-red-500',
}

export default function App() {
	const [status, setStatus] = useState<BrowserStatus>('idle')
	const [versions, setVersions] = useState<AppVersions>({
		app: 'unknown',
		browser: 'unknown',
		extension: 'unknown',
	})
	const [launchError, setLaunchError] = useState<string | undefined>()

	useEffect(() => {
		let mounted = true
		const unsubscribe = window.wenxue.browser.onStatusChange((next) => {
			if (!mounted) return
			setStatus(next)
			if (next !== 'error') {
				setLaunchError(undefined)
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

	const actionLabel = useMemo(() => {
		if (status === 'running') return strings.action.focus
		if (status === 'error') return strings.action.relaunch
		return strings.action.launch
	}, [status])

	const launchBrowser = useCallback(async () => {
		setLaunchError(undefined)
		if (status !== 'running') {
			setStatus('launching')
		}

		const result = await window.wenxue.browser.launch()
		if (!result.ok) {
			setStatus('error')
			setLaunchError(result.error)
		}
	}, [status])

	return (
		<main className="flex min-h-screen bg-slate-50 px-6 py-5 text-slate-950">
			<section className="mx-auto flex w-full max-w-[432px] flex-col justify-between gap-5">
				<header>
					<p className="text-2xl font-semibold leading-tight">{strings.brand}</p>
					<p className="mt-1 text-sm text-slate-500">{strings.slogan}</p>
				</header>

				<div className={`rounded-lg border p-5 shadow-sm ${statusTone[status]}`}>
					<div className="flex items-center gap-3">
						<span className={`h-3 w-3 rounded-full ${statusDot[status]}`} />
						<div>
							<p className="text-lg font-semibold">{strings.status[status]}</p>
							<p className="mt-1 text-sm opacity-80">{strings.description[status]}</p>
						</div>
					</div>

					{launchError ? (
						<p className="mt-4 rounded-md bg-white/70 px-3 py-2 text-sm text-red-700">
							{launchError}
						</p>
					) : null}

					<button
						className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
						disabled={status === 'launching'}
						onClick={launchBrowser}
						type="button"
					>
						{status === 'launching' ? (
							<span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
						) : null}
						{actionLabel}
					</button>
				</div>

				<footer className="grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 font-mono text-[11px] text-slate-500">
					<VersionItem label={strings.versionLabel.app} value={versions.app} />
					<VersionItem label={strings.versionLabel.browser} value={versions.browser} />
					<VersionItem label={strings.versionLabel.extension} value={versions.extension} />
				</footer>
			</section>
		</main>
	)
}

interface VersionItemProps {
	label: string
	value: string
}

function VersionItem({ label, value }: VersionItemProps) {
	return (
		<div className="min-w-0">
			<p className="truncate text-slate-400">{label}</p>
			<p className="truncate text-slate-700">{value}</p>
		</div>
	)
}
