import { useEffect, useRef, useState } from 'react'
import { DesktopDialog } from './DesktopOverlays'
import type { WindowCloseChoice, WindowClosePromptState } from './wenxue'

export interface WindowCloseDialogCopy {
	title: string
	description: string
	cancel: string
	launcherOnly: string
	closeBrowsers: string
	errorTitle: string
	errorDescription: string
	dismiss: string
	communicationError: string
}

export function WindowCloseDialog({
	copy,
	onOpenChange,
}: {
	copy: WindowCloseDialogCopy
	onOpenChange?: (open: boolean) => void
}) {
	const [prompt, setPrompt] = useState<WindowClosePromptState>(null)
	const [busy, setBusy] = useState(false)
	const [failed, setFailed] = useState(false)
	const submitting = useRef(false)

	useEffect(() => {
		onOpenChange?.(prompt !== null)
	}, [prompt, onOpenChange])

	useEffect(() => {
		let disposed = false
		let receivedEvent = false
		const unsubscribe = window.wenxue.app.onClosePromptChange((state) => {
			receivedEvent = true
			submitting.current = false
			setBusy(false)
			setFailed(false)
			setPrompt(state)
		})
		void window.wenxue.app.getClosePrompt().then(
			(state) => {
				if (!disposed && !receivedEvent) setPrompt(state)
			},
			() => {
				if (!disposed) setFailed(true)
			},
		)
		return () => {
			disposed = true
			unsubscribe()
		}
	}, [])

	if (!prompt) return null

	const respond = async (choice: WindowCloseChoice) => {
		if (submitting.current) return
		submitting.current = true
		setBusy(true)
		setFailed(false)
		try {
			const result = await window.wenxue.app.respondToClosePrompt(prompt.requestId, choice)
			if (!result.ok) setFailed(true)
		} catch {
			setFailed(true)
		} finally {
			submitting.current = false
			setBusy(false)
		}
	}
	const failure = prompt.kind === 'error'

	return (
		<DesktopDialog
			key={prompt.requestId}
			title={failure ? copy.errorTitle : copy.title}
			description={failure ? copy.errorDescription : copy.description}
			onClose={() => void respond(failure ? 'dismiss' : 'cancel')}
		>
			{failed && <p role="alert">{copy.communicationError}</p>}
			<div className="wx-dialog__actions" aria-busy={busy}>
				{failure ? (
					<button
						type="button"
						className="primary-button"
						disabled={busy}
						onClick={() => void respond('dismiss')}
					>
						{copy.dismiss}
					</button>
				) : (
					<>
						<button
							type="button"
							className="soft-button"
							disabled={busy}
							onClick={() => void respond('cancel')}
						>
							{copy.cancel}
						</button>
						<button
							type="button"
							className="soft-button"
							disabled={busy}
							onClick={() => void respond('launcherOnly')}
						>
							{copy.launcherOnly}
						</button>
						<button
							type="button"
							className="primary-button"
							disabled={busy}
							onClick={() => void respond('closeBrowsers')}
						>
							{copy.closeBrowsers}
						</button>
					</>
				)}
			</div>
		</DesktopDialog>
	)
}
