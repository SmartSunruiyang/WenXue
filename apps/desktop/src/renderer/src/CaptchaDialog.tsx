import { useEffect, useRef, useSyncExternalStore } from 'react'

import {
	cancelLauncherCaptcha,
	getLauncherCaptchaSnapshot,
	refreshLauncherCaptcha,
	submitLauncherCaptcha,
	subscribeLauncherCaptcha,
} from './captchaChallenge'
import { DesktopDialog } from './DesktopOverlays'
import { strings } from './strings'

export function CaptchaDialog() {
	const challenge = useSyncExternalStore(subscribeLauncherCaptcha, getLauncherCaptchaSnapshot)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (challenge?.status === 'ready') inputRef.current?.focus()
	}, [challenge?.status, challenge?.image])

	if (!challenge) return null
	const copy = strings.auth.captcha
	const busy = challenge.status !== 'ready'

	return (
		<DesktopDialog
			key={challenge.id}
			title={copy.title}
			description={copy.description}
			onClose={cancelLauncherCaptcha}
			initialFocusRef={inputRef}
		>
			<form
				style={{ display: 'grid', gap: 16, marginTop: 16 }}
				onSubmit={(event) => {
					event.preventDefault()
					void submitLauncherCaptcha(inputRef.current?.value ?? '')
				}}
			>
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
		</DesktopDialog>
	)
}
