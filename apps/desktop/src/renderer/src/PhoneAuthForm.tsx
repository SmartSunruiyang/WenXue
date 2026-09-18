import { LoaderCircle, LogIn, Smartphone } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import {
	getLauncherPhoneResendAt,
	LauncherPhoneAlreadyRegisteredError,
	LauncherRegistrationRequiredError,
	readCloudBaseErrorMessage,
	sendLauncherPhoneCode,
	type LauncherAuthSession,
	type LauncherPhoneChallenge,
} from './cloudbase'
import { strings } from './strings'

export function PhoneAuthForm({
	userId,
	registration,
	initialPhone = '',
	onAuthenticated,
	onBusyChange,
	onRegistrationRequired,
	onRegistrationConflict,
}: {
	userId?: string
	registration?: { username: string; password: string; userId?: string }
	initialPhone?: string
	onAuthenticated: (session: LauncherAuthSession) => Promise<void>
	onBusyChange?: (busy: boolean) => void
	onRegistrationRequired?: (error: LauncherRegistrationRequiredError) => void
	onRegistrationConflict?: (phone: string) => void
}) {
	const id = useId()
	const [phone, setPhone] = useState(initialPhone)
	const [code, setCode] = useState('')
	const [challenge, setChallenge] = useState<LauncherPhoneChallenge | null>(null)
	const [phase, setPhase] = useState<'sending' | 'verifying' | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [resendAt, setResendAt] = useState(getLauncherPhoneResendAt)
	const [now, setNow] = useState(Date.now)
	const challengeRef = useRef<LauncherPhoneChallenge | null>(null)
	const busyRef = useRef(false)
	const mountedRef = useRef(true)
	const codeInputRef = useRef<HTMLInputElement>(null)
	const busy = phase !== null
	const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			challengeRef.current?.cancel()
			challengeRef.current = null
		}
	}, [])

	useEffect(() => {
		if (resendAt <= Date.now()) return
		const interval = window.setInterval(() => {
			const nextNow = Date.now()
			setNow(nextNow)
			if (nextNow >= resendAt) window.clearInterval(interval)
		}, 250)
		return () => window.clearInterval(interval)
	}, [resendAt])

	const setBusy = (nextPhase: typeof phase) => {
		busyRef.current = nextPhase !== null
		setPhase(nextPhase)
		onBusyChange?.(nextPhase !== null)
	}

	const clearChallenge = () => {
		challengeRef.current?.cancel()
		challengeRef.current = null
		setChallenge(null)
		setCode('')
	}

	const sendCode = async () => {
		if (busyRef.current || Date.now() < resendAt) return
		clearChallenge()
		setError(null)
		setBusy('sending')
		try {
			const purpose = registration
				? registration.userId
					? {
							kind: 'complete' as const,
							userId: registration.userId,
							username: registration.username,
							password: registration.password,
						}
					: {
							kind: 'register' as const,
							username: registration.username,
							password: registration.password,
						}
				: userId
					? { kind: 'bind' as const, userId }
					: { kind: 'login' as const }
			const nextChallenge = await sendLauncherPhoneCode(phone, purpose)
			if (!mountedRef.current) {
				nextChallenge.cancel()
				return
			}
			challengeRef.current = nextChallenge
			setChallenge(nextChallenge)
			setResendAt(nextChallenge.resendAt)
			setNow(Date.now())
		} catch (nextError) {
			if (mountedRef.current && nextError instanceof LauncherRegistrationRequiredError) {
				clearChallenge()
				onRegistrationRequired?.(nextError)
			} else if (mountedRef.current && nextError instanceof LauncherPhoneAlreadyRegisteredError) {
				clearChallenge()
				onRegistrationConflict?.(nextError.phone)
			} else if (mountedRef.current) {
				setError(readCloudBaseErrorMessage(nextError, strings.auth.phone.sendError))
				setResendAt(getLauncherPhoneResendAt())
				setNow(Date.now())
			}
		} finally {
			if (mountedRef.current) {
				setBusy(null)
				if (challengeRef.current) {
					window.requestAnimationFrame(() => codeInputRef.current?.focus())
				}
			}
		}
	}

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (busyRef.current) return
		const currentChallenge = challengeRef.current
		if (!currentChallenge) {
			setError(strings.auth.phone.needCode)
			return
		}
		setError(null)
		setBusy('verifying')
		try {
			const session = await currentChallenge.verify(code)
			if (mountedRef.current) {
				clearChallenge()
				await onAuthenticated(session)
			}
		} catch (nextError) {
			if (mountedRef.current && nextError instanceof LauncherRegistrationRequiredError) {
				clearChallenge()
				onRegistrationRequired?.(nextError)
			} else if (mountedRef.current && nextError instanceof LauncherPhoneAlreadyRegisteredError) {
				clearChallenge()
				onRegistrationConflict?.(nextError.phone)
			} else if (mountedRef.current) {
				setError(readCloudBaseErrorMessage(nextError, strings.auth.phone.verifyError))
			}
		} finally {
			if (mountedRef.current) setBusy(null)
		}
	}

	return (
		<form
			aria-busy={busy}
			className="phone-auth-form"
			noValidate
			onSubmit={(event) => void submit(event)}
		>
			<div className="auth-field">
				<label htmlFor={`${id}-phone`}>{strings.auth.phone.phoneLabel}</label>
				<div className="phone-auth-form__number">
					<span>{strings.auth.phone.countryCode}</span>
					<input
						aria-describedby={`${id}-phone-hint`}
						autoComplete="tel-national"
						autoFocus
						disabled={busy}
						id={`${id}-phone`}
						inputMode="tel"
						maxLength={11}
						onChange={(event) => {
							clearChallenge()
							setPhone(event.target.value)
							setError(null)
						}}
						placeholder={strings.auth.phone.phonePlaceholder}
						type="tel"
						value={phone}
					/>
				</div>
				<span className="auth-field__hint" id={`${id}-phone-hint`}>
					{strings.auth.phone.phoneHint}
				</span>
			</div>
			<div className="auth-field">
				<label htmlFor={`${id}-code`}>{strings.auth.phone.codeLabel}</label>
				<div className="phone-auth-form__code">
					<input
						autoComplete="one-time-code"
						disabled={busy || !challenge}
						id={`${id}-code`}
						inputMode="numeric"
						maxLength={6}
						onChange={(event) => {
							setCode(event.target.value)
							setError(null)
						}}
						placeholder={strings.auth.phone.codePlaceholder}
						ref={codeInputRef}
						type="text"
						value={code}
					/>
					<button
						className="soft-button phone-auth-form__send"
						disabled={busy || resendSeconds > 0 || !phone.trim()}
						onClick={() => void sendCode()}
						type="button"
					>
						{phase === 'sending' ? <LoaderCircle className="spin" size={15} /> : null}
						{phase === 'sending'
							? strings.auth.phone.sending
							: resendSeconds > 0
								? strings.auth.phone.resendCountdown(resendSeconds)
								: registration
									? strings.auth.phone.registerCode
									: strings.auth.phone.sendCode}
					</button>
				</div>
			</div>
			{error ? (
				<div className="auth-alert" role="alert">
					{error}
				</div>
			) : challenge ? (
				<p className="phone-auth-form__sent" role="status">
					{strings.auth.phone.sent}
				</p>
			) : null}
			<button className="primary-button auth-submit" disabled={busy || !challenge} type="submit">
				{phase === 'verifying' ? (
					<LoaderCircle className="spin" size={16} />
				) : userId ? (
					<Smartphone size={16} />
				) : (
					<LogIn size={16} />
				)}
				{phase === 'verifying'
					? registration
						? strings.auth.phone.verifyingRegister
						: userId
							? strings.auth.phone.binding
							: strings.auth.phone.loggingIn
					: registration
						? strings.auth.phone.verifyRegister
						: userId
							? strings.auth.phone.bind
							: strings.auth.phone.login}
			</button>
			{!userId && !registration ? (
				<p className="phone-auth-form__hint">{strings.auth.phone.loginHint}</p>
			) : null}
		</form>
	)
}
