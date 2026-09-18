import { ChevronDown, ExternalLink, Plug, PlugZap, Square, Unplug } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useAgent } from '@/agent/useAgent'
import { Conversation } from '@/components/conversation'
import { Logo, StatusDot } from '@/components/misc'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/lib/i18n'

import { useHubWs } from './hub-ws'

export const HUB_AGENT_OPTIONS = {
	enableUserTakeover: false,
	enableUserQuestions: false,
} as const

export default function App() {
	const { t } = useI18n()
	const { status, history, activity, currentTask, config, execute, stop, configure } =
		useAgent(HUB_AGENT_OPTIONS)
	const { wsState } = useHubWs(execute, stop, configure, config)
	const historyRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight
	}, [history, activity])

	const isRunning = status === 'running'
	const hasConnection = Boolean(new URLSearchParams(location.search).get('ws'))
	const WsIcon = wsState === 'connected' ? PlugZap : wsState === 'connecting' ? Plug : Unplug
	const wsLabel = {
		connected: t('hubConnected'),
		connecting: t('hubConnecting'),
		disconnected: t(hasConnection ? 'hubDisconnected' : 'hubNoConnection'),
	}[wsState]
	const showEmptySession = !currentTask && history.length === 0 && !isRunning

	return (
		<div className="hub-page">
			<header className="hub-page-header">
				<div>
					<div className="hub-title">
						<Logo className="size-7" />
						<h1>{t('hubTitle')}</h1>
						<span>Beta</span>
					</div>
					<p>{t('hubDescription')}</p>
				</div>
				<div className="hub-connection" role="status">
					<span className={`hub-connection-label hub-connection-label--${wsState}`}>
						<WsIcon className="size-4" />
						{wsLabel}
					</span>
					{wsState === 'disconnected' && hasConnection && (
						<Button variant="outline" onClick={() => window.location.reload()}>
							{t('ntRetry')}
						</Button>
					)}
				</div>
			</header>
			<div className="hub-workspace">
				<aside className="hub-sidebar">
					<HubConfig />
					<ProtocolDocsCollapsible />
					<footer>
						<span>v{__VERSION__}</span>
						<a
							href="https://github.com/alibaba/page-agent/tree/main/packages/mcp"
							target="_blank"
							rel="noopener noreferrer"
						>
							{t('hubMcpPackage')}
							<ExternalLink className="size-3.5" />
						</a>
					</footer>
				</aside>
				<main className="hub-session">
					<header className="hub-session-header">
						<h2>{t('hubLiveSession')}</h2>
						<div>
							<StatusDot status={status} />
							{isRunning && (
								<Button variant="outline" onClick={stop}>
									<Square className="size-3.5" />
									{t('stopTask')}
								</Button>
							)}
						</div>
					</header>
					<div ref={historyRef} className="hub-history">
						{showEmptySession ? (
							<div className="hub-empty">
								<WsIcon className="size-7" />
								<h3>{t(wsState === 'connected' ? 'hubWaiting' : 'hubNoSession')}</h3>
								<p>{t(wsState === 'connected' ? 'hubWaitingHint' : 'hubNoSessionHint')}</p>
							</div>
						) : (
							<div className="hub-conversation">
								<Conversation
									task={currentTask}
									events={history}
									activity={activity}
									running={isRunning}
								/>
							</div>
						)}
					</div>
				</main>
			</div>
		</div>
	)
}

function HubConfig() {
	const { t } = useI18n()
	const [allowAll, setAllowAll] = useState(false)
	const [ready, setReady] = useState(false)
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)
	const [error, setError] = useState(false)

	useEffect(() => {
		chrome.storage.local
			.get('allowAllHubConnection')
			.then((result) => {
				setAllowAll(result.allowAllHubConnection === true)
				setReady(true)
			})
			.catch(() => setError(true))
	}, [])

	const toggle = async (checked: boolean) => {
		setSaving(true)
		setSaved(false)
		setError(false)
		try {
			await chrome.storage.local.set({ allowAllHubConnection: checked })
			setAllowAll(checked)
			setSaved(true)
		} catch {
			setError(true)
		} finally {
			setSaving(false)
		}
	}

	return (
		<section className="hub-config" aria-labelledby="hub-config-title">
			<h2 id="hub-config-title">{t('hubConnectionSettings')}</h2>
			<label className="hub-switch-row">
				<span>{t('hubAutoApprove')}</span>
				<Switch
					checked={allowAll}
					onCheckedChange={toggle}
					disabled={!ready || saving}
					aria-describedby="hub-approval-hint"
				/>
			</label>
			<p id="hub-approval-hint">{t('hubApprovalHint')}</p>
			{(saving || saved) && (
				<p className="hub-save-status" role="status">
					{t(saving ? 'settingsSaving' : 'settingsSaved')}
				</p>
			)}
			{error && (
				<div className="hub-config-error" role="alert">
					<span>{t(ready ? 'settingsSaveError' : 'settingsLoadError')}</span>
					{!ready && (
						<Button variant="outline" onClick={() => window.location.reload()}>
							{t('ntRetry')}
						</Button>
					)}
				</div>
			)}
		</section>
	)
}

function ProtocolDocsCollapsible() {
	const { t } = useI18n()
	const [open, setOpen] = useState(false)

	return (
		<section className="hub-guide">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				aria-controls="hub-guide-content"
			>
				<span>{t('hubDocs')}</span>
				<ChevronDown className={`size-4 ${open ? 'rotate-180' : ''}`} />
			</button>
			{open && (
				<div id="hub-guide-content" className="hub-guide-content">
					<p>{t('hubDocsIntro')}</p>
					<section>
						<h3>{t('hubConnectWith')}</h3>
						<code>hub.html?ws=PORT</code>
					</section>
					<section>
						<h3>{t('hubFlow')}</h3>
						<ol>
							{[t('hubFlow1'), t('hubFlow2'), t('hubFlow3'), t('hubFlow4'), t('hubFlow5')].map(
								(step) => (
									<li key={step}>{step}</li>
								),
							)}
						</ol>
					</section>
					<section>
						<h3>{t('hubInbound')}</h3>
						<pre>{`{ type: "execute", task: string, config?: object }
{ type: "stop" }`}</pre>
					</section>
					<section>
						<h3>{t('hubOutbound')}</h3>
						<pre>{`{ type: "ready" }
{ type: "result", success: boolean, data: string, state?: "completed" | "error" | "paused" }
{ type: "error", message: string }`}</pre>
					</section>
				</div>
			)}
		</section>
	)
}
