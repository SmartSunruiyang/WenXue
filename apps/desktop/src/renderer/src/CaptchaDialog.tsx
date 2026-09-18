import { useEffect, useRef, useSyncExternalStore } from 'react'

import {
	cancelLauncherCaptcha,
	getLauncherCaptchaSnapshot,
	refreshLauncherCaptcha,
	submitLauncherCaptcha,
	subscribeLauncherCaptcha,
} from './captchaChallenge'
import { strings } from './strings'

export function CaptchaDialog() {
	const challenge = useSyncExternalStore(subscribeLauncherCaptcha, getLauncherCaptchaSnapshot)
	const dialogRef = useRef<HTMLDialogElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const challengeId = challenge?.id

	useEffect(() => {
		const dialog = dialogRef.current
		if (!dialog || challengeId === undefined) return
		const previousFocus = document.activeElement
		dialog.showModal()
		inputRef.current?.focus()
		return () => {
			dialog.close()
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
		}
	}, [challengeId])

	useEffect(() => {
		if (challenge?.status === 'ready') inputRef.current?.focus()
	}, [challenge?.status, challenge?.image])

	if (!challenge) return null
	const copy = strings.auth.captcha
	const busy = challenge.status !== 'ready'

	return (
		<dialog
			ref={dialogRef}
			className="launcher-captcha-dialog"
			aria-labelledby="launcher-captcha-title"
			aria-describedby="launcher-captcha-description"
			onCancel={(event) => {
				event.preventDefault()
				cancelLauncherCaptcha()
			}}
			style={{
				width: 'min(400px, calc(100vw - 40px))',
				margin: 'auto',
				maxHeight: 'calc(100vh - 40px)',
				overflow: 'auto',
				padding: 24,
				border: '1px solid var(--wx-border, #dedede)',
				borderRadius: 14,
				background: 'var(--wx-surface, #fff)',
				color: 'var(--wx-foreground)',
				zIndex: 10000,
			}}
		>
			<style>{'.launcher-captcha-dialog::backdrop { background: rgb(0 0 0 / 35%); }'}</style>
			<form
				style={{ display: 'grid', gap: 16 }}
				onSubmit={(event) => {
					event.preventDefault()
					void submitLauncherCaptcha(inputRef.current?.value ?? '')
				}}
			>
				<h2 id="launcher-captcha-title" style={{ margin: 0, fontSize: 20 }}>
					{copy.title}
				</h2>
				<p id="launcher-captcha-description" style={{ margin: 0, fontSize: 14 }}>
					{copy.description}
				</p>
				<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
					<img
						src={challenge.image}
						alt={copy.imageAlt}
						style={{ minWidth: 0, maxWidth: '65%', height: 64, objectFit: 'contain' }}
					/>
					<button
						type="button"
						disabled={busy}
						onClick={() => void refreshLauncherCaptcha()}
						className="soft-button"
					>
						{challenge.status === 'refreshing' ? copy.loading : copy.refresh}
					</button>
				</div>
				<label htmlFor="launcher-captcha-answer" style={{ display: 'grid', gap: 8, fontSize: 14 }}>
					{copy.code}
					<input
						key={challenge.image}
						ref={inputRef}
						id="launcher-captcha-answer"
						name="captcha"
						type="text"
						autoComplete="off"
						spellCheck={false}
						maxLength={32}
						required
						disabled={busy}
						aria-invalid={challenge.error === 'invalid'}
						aria-describedby={challenge.error ? 'launcher-captcha-error' : undefined}
						style={{
							width: '100%',
							boxSizing: 'border-box',
							minHeight: 40,
							padding: '8px 12px',
							border: '1px solid var(--wx-border, #dedede)',
							borderRadius: 8,
						}}
					/>
				</label>
				{challenge.error && (
					<p
						id="launcher-captcha-error"
						role="alert"
						style={{ margin: 0, fontSize: 13, color: 'var(--wx-error-red, #b91c1c)' }}
					>
						{copy[challenge.error]}
					</p>
				)}
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
					<button type="button" className="soft-button" onClick={cancelLauncherCaptcha}>
						{copy.cancel}
					</button>
					<button type="submit" className="primary-button" disabled={busy}>
						{challenge.status === 'verifying' ? copy.verifying : copy.confirm}
					</button>
				</div>
			</form>
		</dialog>
	)
}
