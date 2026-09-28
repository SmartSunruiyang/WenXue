import { ArrowLeft, Check, Eye, EyeOff, LoaderCircle, Minus, UserRound, X } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
	getLauncherEmailResendAt,
	getLauncherPasswordComparison,
	getLauncherPasswordRequirements,
	LauncherEmailRateLimitError,
	readCloudBaseErrorMessage,
	sendLauncherEmailCode,
	sendLauncherPasswordResetCode,
	signInLauncher,
	validateLauncherAvatar,
	validateLauncherPassword,
	validateLauncherRegistration,
	type LauncherAuthSession,
	type PasswordCharacterMatch,
} from './cloudbase'
import { strings } from './strings'

type EmailChallenge = Awaited<ReturnType<typeof sendLauncherEmailCode>>
type Registration = Extract<
	Awaited<ReturnType<EmailChallenge['verify']>>,
	{ kind: 'registration' }
>['registration']
type ResetChallenge = Awaited<ReturnType<typeof sendLauncherPasswordResetCode>>
type PasswordReset = Awaited<ReturnType<ResetChallenge['verify']>>
type Screen =
	| { kind: 'email' | 'password' | 'reset-email' }
	| { kind: 'email-code'; challenge: EmailChallenge }
	| { kind: 'register-password' | 'register-profile'; registration: Registration }
	| { kind: 'reset-code'; challenge: ResetChallenge }
	| { kind: 'reset-password'; reset: PasswordReset }

export function EmailAuthScreen({
	error,
	frameless,
	onAuthenticated,
	onClearError,
	onOpenExternal,
	windowControls,
}: {
	error: string | null
	frameless: boolean
	onAuthenticated: (session: LauncherAuthSession) => Promise<void>
	onClearError: () => void
	onOpenExternal?: (url: string) => void
	windowControls?: ReactNode
}) {
	const id = useId()
	const [introVisible, setIntroVisible] = useState(
		() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	)
	const [screen, setScreen] = useState<Screen>({ kind: 'email' })
	const [email, setEmail] = useState('')
	const [code, setCode] = useState('')
	const [nickname, setNickname] = useState('')
	const [password, setPassword] = useState('')
	const [confirmation, setConfirmation] = useState('')
	const [avatar, setAvatar] = useState<File | undefined>()
	const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
	const [failedAvatarPreview, setFailedAvatarPreview] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [localError, setLocalError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [now, setNow] = useState(Date.now)
	const operationRef = useRef(0)
	const busyRef = useRef(false)
	const mountedRef = useRef(true)
	const resourcesRef = useRef(new Set<{ cancel(): void }>())
	const headingRef = useRef<HTMLHeadingElement>(null)
	const avatarInputRef = useRef<HTMLInputElement>(null)
	const copy = strings.auth.email
	const isCode = screen.kind === 'email-code' || screen.kind === 'reset-code'
	const isEmailEntry = screen.kind === 'email' || screen.kind === 'reset-email'
	const isRegistration = screen.kind === 'register-password' || screen.kind === 'register-profile'
	const newPassword = screen.kind === 'register-password' || screen.kind === 'reset-password'
	const registrationState = isRegistration ? screen.registration.state : null
	const profileSubmitted =
		registrationState !== null &&
		registrationState !== 'pending' &&
		registrationState !== 'needs-verification'
	const expiresAt = isRegistration
		? registrationState === 'pending'
			? screen.registration.expiresAt
			: null
		: screen.kind === 'reset-password'
			? screen.reset.expiresAt
			: isCode
				? screen.challenge.expiresAt
				: null
	const expired = expiresAt !== null && now >= expiresAt
	const resendAt = Math.max(getLauncherEmailResendAt(email), isCode ? screen.challenge.resendAt : 0)
	const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

	const clearResources = () => {
		operationRef.current += 1
		resourcesRef.current.forEach((resource) => resource.cancel())
		resourcesRef.current.clear()
	}

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			clearResources()
		}
	}, [])

	useEffect(() => {
		if (expiresAt === null && resendAt <= Date.now()) return
		const timer = window.setInterval(() => setNow(Date.now()), 1000)
		return () => window.clearInterval(timer)
	}, [expiresAt, resendAt])

	useEffect(
		() => () => {
			if (avatarPreview) URL.revokeObjectURL(avatarPreview)
		},
		[avatarPreview],
	)

	const selectAvatar = (file?: File) => {
		const validationError = validateLauncherAvatar(file)
		if (validationError) {
			setLocalError(validationError)
			return
		}
		setAvatar(file)
		setAvatarPreview(file ? URL.createObjectURL(file) : null)
		setLocalError(null)
	}

	useEffect(() => {
		if (!introVisible) return
		const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
		const finishIntro = () => setIntroVisible(false)
		const handleMotionPreference = () => {
			if (motionPreference.matches) finishIntro()
		}
		const timeoutId = window.setTimeout(finishIntro, 2100)
		motionPreference.addEventListener('change', handleMotionPreference)
		return () => {
			window.clearTimeout(timeoutId)
			motionPreference.removeEventListener('change', handleMotionPreference)
		}
	}, [introVisible])

	useEffect(() => {
		headingRef.current?.focus()
	}, [screen.kind, introVisible])

	const navigate = (kind: 'email' | 'password' | 'reset-email', nextNotice?: string) => {
		clearResources()
		busyRef.current = false
		setBusy(false)
		setNow(Date.now())
		setScreen({ kind })
		setCode('')
		setNickname('')
		setPassword('')
		setConfirmation('')
		selectAvatar()
		setLocalError(null)
		setNotice(nextNotice ?? null)
		onClearError()
	}

	const run = async (
		action: (isCurrent: () => boolean) => Promise<void>,
		failureDestination?: 'email' | 'reset-email',
	) => {
		if (busyRef.current) return
		busyRef.current = true
		setBusy(true)
		setLocalError(null)
		setNotice(null)
		onClearError()
		const operation = ++operationRef.current
		const isCurrent = () => mountedRef.current && operationRef.current === operation
		try {
			await action(isCurrent)
		} catch (nextError) {
			if (isCurrent()) {
				const errorMessage =
					nextError instanceof LauncherEmailRateLimitError && nextError.source === 'provider'
						? strings.auth.emailErrors.providerRateLimit
						: readCloudBaseErrorMessage(nextError, strings.auth.error.operation)
				if (failureDestination) {
					navigate(failureDestination)
					setLocalError(errorMessage)
				} else if (isRegistration && screen.registration.state === 'needs-verification') {
					navigate('email')
					setLocalError(readCloudBaseErrorMessage(nextError, strings.auth.emailErrors.register))
				} else if (isRegistration && screen.registration.state === 'needs-login') {
					navigate('password', strings.auth.emailErrors.activationReauthenticate)
				} else {
					setLocalError(errorMessage)
				}
			}
		} finally {
			if (isCurrent()) {
				setNow(Date.now())
				busyRef.current = false
				setBusy(false)
			}
		}
	}

	const sendCode = async (reset: boolean) => {
		if (resendSeconds > 0) return
		await run(
			async (isCurrent) => {
				const challenge = reset
					? await sendLauncherPasswordResetCode(email)
					: await sendLauncherEmailCode(email)
				if (!isCurrent()) {
					challenge.cancel()
					return
				}
				resourcesRef.current.forEach((resource) => resource.cancel())
				resourcesRef.current.clear()
				resourcesRef.current.add(challenge)
				setEmail(challenge.email)
				setCode('')
				setNow(Date.now())
				setScreen(
					reset
						? { kind: 'reset-code', challenge: challenge as ResetChallenge }
						: { kind: 'email-code', challenge: challenge as EmailChallenge },
				)
			},
			isCode ? (reset ? 'reset-email' : 'email') : undefined,
		)
	}

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (busyRef.current || expired) return
		if (isRegistration && screen.registration.state === 'needs-verification') {
			navigate('email')
			setLocalError(strings.auth.emailErrors.register)
			return
		}
		if (isRegistration && screen.registration.state === 'needs-login') {
			navigate('password', strings.auth.emailErrors.activationReauthenticate)
			return
		}
		if (screen.kind === 'email' || screen.kind === 'reset-email') {
			await sendCode(screen.kind === 'reset-email')
			return
		}
		if ((newPassword || isRegistration) && !profileSubmitted) {
			const validation =
				screen.kind === 'register-profile'
					? validateLauncherRegistration(nickname, password)
					: validateLauncherPassword(password)
			if (validation) {
				setLocalError(validation)
				return
			}
			if (!confirmation || password !== confirmation) {
				setLocalError(
					!confirmation
						? strings.auth.validation.confirmPasswordRequired
						: strings.auth.validation.passwordMismatch,
				)
				return
			}
		}
		if (screen.kind === 'register-password') {
			setLocalError(null)
			setNotice(null)
			onClearError()
			setScreen({ kind: 'register-profile', registration: screen.registration })
			return
		}
		await run(async (isCurrent) => {
			if (screen.kind === 'password') {
				const session = await signInLauncher(email, password)
				if (isCurrent()) await onAuthenticated(session)
			} else if (screen.kind === 'email-code') {
				const result = await screen.challenge.verify(code)
				if (!isCurrent()) {
					if (result.kind === 'registration') result.registration.cancel()
					return
				}
				if (result.kind === 'authenticated') {
					await onAuthenticated(result.session)
				} else {
					resourcesRef.current.add(result.registration)
					setScreen({ kind: 'register-password', registration: result.registration })
					setCode('')
					setNow(Date.now())
				}
			} else if (screen.kind === 'register-profile') {
				const session = await screen.registration.complete({ nickname, password, avatar })
				if (isCurrent()) await onAuthenticated(session)
			} else if (screen.kind === 'reset-code') {
				const reset = await screen.challenge.verify(code)
				if (!isCurrent()) {
					reset.cancel()
					return
				}
				resourcesRef.current.add(reset)
				setScreen({ kind: 'reset-password', reset })
				setCode('')
				setNow(Date.now())
			} else if (screen.kind === 'reset-password') {
				await screen.reset.complete(password)
				if (isCurrent()) navigate('password', copy.resetSuccess)
			}
		})
	}

	const title =
		screen.kind === 'email'
			? copy.title
			: screen.kind === 'password'
				? copy.passwordTitle
				: screen.kind === 'register-password'
					? copy.registerPasswordTitle
					: screen.kind === 'register-profile'
						? copy.registerTitle
						: screen.kind === 'reset-email'
							? copy.resetTitle
							: screen.kind === 'reset-password'
								? copy.newPasswordTitle
								: copy.codeTitle
	const submitLabel =
		screen.kind === 'email'
			? copy.continueEmail
			: screen.kind === 'password'
				? copy.login
				: screen.kind === 'register-password'
					? copy.next
					: screen.kind === 'register-profile'
						? registrationState === 'confirming-account'
							? copy.retryAccountConfirmation
							: copy.completeRegistration
						: screen.kind === 'reset-email'
							? copy.sendResetCode
							: screen.kind === 'reset-password'
								? copy.resetPassword
								: copy.verify
	const shownError = expired ? strings.auth.emailErrors.expired : (localError ?? error)
	const canSubmit =
		!busy &&
		!expired &&
		(!isEmailEntry || resendSeconds === 0) &&
		(newPassword
			? Boolean(password && confirmation)
			: isCode
				? Boolean(code.trim())
				: screen.kind === 'password'
					? Boolean(email.trim() && password)
					: true)

	return (
		<main className={`auth-shell email-auth-shell ${frameless ? 'app-shell--frameless' : ''}`}>
			<div className="top-drag-zone drag-region" />
			{windowControls}
			{introVisible ? (
				<div className="auth-intro" aria-hidden="true">
					<div className="auth-intro__brand">
						<img className="auth-intro__logo" src="logo.png" alt="" />
						<div className="auth-intro__slogan">
							<img src="slogan.png" alt="" />
						</div>
					</div>
				</div>
			) : (
				<section
					key={screen.kind}
					className={`email-auth no-drag ${screen.kind === 'email' ? 'email-auth--welcome' : 'email-auth--step'}`}
					aria-labelledby={`${id}-title`}
				>
					<header className="email-auth__heading">
						<h1 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
							{title}
						</h1>
						{isRegistration ? (
							<ol className="email-auth__steps" aria-label={copy.registrationSteps}>
								<li
									aria-current={screen.kind === 'register-password' ? 'step' : undefined}
									data-complete={screen.kind === 'register-profile'}
								>
									<span aria-hidden>
										{screen.kind === 'register-profile' ? <Check size={12} /> : '1'}
									</span>
									{copy.passwordStep}
								</li>
								<li aria-current={screen.kind === 'register-profile' ? 'step' : undefined}>
									<span aria-hidden>2</span>
									{copy.profileStep}
								</li>
							</ol>
						) : null}
					</header>
					<div className="email-auth__card">
						{screen.kind !== 'email' ? (
							<button
								className="email-auth__back"
								disabled={busy}
								onClick={() => navigate(screen.kind.startsWith('reset') ? 'password' : 'email')}
								type="button"
							>
								<ArrowLeft size={15} aria-hidden />
								{screen.kind.startsWith('reset') ? copy.backPassword : copy.backEmail}
							</button>
						) : null}
						{screen.kind === 'email' ? (
							<>
								<button
									className="email-auth__secondary"
									disabled={busy}
									onClick={() => navigate('password')}
									type="button"
								>
									<UserRound size={18} aria-hidden />
									{copy.passwordEntry}
								</button>
								<div className="email-auth__divider">{copy.or}</div>
							</>
						) : null}
						{isCode ? (
							<p className="email-auth__description">
								{copy.codeSent}
								<strong>{email}</strong>
							</p>
						) : null}
						{isRegistration ? (
							<p className="email-auth__description">
								{registrationState === 'avatar-pending'
									? copy.avatarPendingDescription
									: profileSubmitted
										? copy.accountCreatedDescription
										: screen.kind === 'register-profile'
											? copy.registerDescription
											: null}
								<strong>{email}</strong>
							</p>
						) : null}
						{screen.kind === 'reset-email' ? (
							<p className="email-auth__description">{copy.resetDescription}</p>
						) : null}
						{screen.kind === 'reset-password' ? (
							<p className="email-auth__description">{email}</p>
						) : null}
						<form
							className="email-auth__form"
							onSubmit={(event) => void submit(event)}
							aria-busy={busy}
						>
							{isEmailEntry || screen.kind === 'password' ? (
								<label className="auth-field" htmlFor={`${id}-email`}>
									<span className={screen.kind === 'email' ? 'sr-only' : undefined}>
										{copy.emailLabel}
									</span>
									<input
										id={`${id}-email`}
										autoComplete="email"
										autoCapitalize="none"
										spellCheck={false}
										type="email"
										required
										disabled={busy}
										placeholder={copy.emailPlaceholder}
										value={email}
										onChange={(event) => {
											setEmail(event.target.value)
											setNow(Date.now())
											setLocalError(null)
											setNotice(null)
											onClearError()
										}}
									/>
								</label>
							) : null}
							{isCode ? (
								<label className="auth-field" htmlFor={`${id}-code`}>
									<span>{copy.codeLabel}</span>
									<input
										id={`${id}-code`}
										autoComplete="one-time-code"
										inputMode="numeric"
										pattern="[0-9]{6}"
										maxLength={6}
										required
										disabled={busy || expired}
										placeholder={copy.codePlaceholder}
										value={code}
										onChange={(event) => setCode(event.target.value)}
									/>
								</label>
							) : null}
							{screen.kind === 'register-profile' ? (
								<>
									<div className="email-auth__avatar-field">
										<button
											aria-label={copy.avatarUpload}
											className="email-auth__avatar"
											disabled={busy}
											onClick={() => avatarInputRef.current?.click()}
											type="button"
										>
											{avatarPreview && avatarPreview !== failedAvatarPreview ? (
												<img
													key={avatarPreview}
													alt={copy.avatarPreview}
													src={avatarPreview}
													onError={() => setFailedAvatarPreview(avatarPreview)}
												/>
											) : (
												<UserRound aria-hidden size={28} />
											)}
										</button>
										<div>
											<label className="email-auth__avatar-label" htmlFor={`${id}-avatar`}>
												{copy.avatarLabel}
											</label>
											<p>{copy.avatarHint}</p>
											{avatar ? (
												<button
													className="email-auth__link"
													disabled={busy}
													onClick={() => {
														selectAvatar()
														if (avatarInputRef.current) avatarInputRef.current.value = ''
													}}
													type="button"
												>
													{copy.avatarRemove}
												</button>
											) : null}
										</div>
										<input
											className="sr-only"
											id={`${id}-avatar`}
											ref={avatarInputRef}
											type="file"
											accept="image/png,image/jpeg,image/webp"
											disabled={busy}
											onChange={(event) => {
												const file = event.target.files?.[0]
												if (file) selectAvatar(file)
												event.target.value = ''
											}}
										/>
									</div>
									<label className="auth-field" htmlFor={`${id}-nickname`}>
										<span>{copy.nicknameLabel}</span>
										<input
											id={`${id}-nickname`}
											autoComplete="nickname"
											disabled={busy || expired || profileSubmitted}
											maxLength={32}
											value={nickname}
											onChange={(event) => setNickname(event.target.value)}
											placeholder={copy.nicknamePlaceholder}
											aria-describedby={`${id}-nickname-hint`}
										/>
										<span id={`${id}-nickname-hint`} className="auth-field__hint">
											{copy.nicknameHint}
										</span>
									</label>
								</>
							) : null}
							{screen.kind === 'password' || newPassword ? (
								<PasswordFields
									key={screen.kind}
									id={id}
									password={password}
									confirmation={confirmation}
									setPassword={setPassword}
									setConfirmation={setConfirmation}
									creating={newPassword}
									disabled={busy || expired || profileSubmitted}
								/>
							) : null}
							{screen.kind === 'password' ? (
								<button
									className="email-auth__link email-auth__forgot"
									disabled={busy}
									onClick={() => navigate('reset-email')}
									type="button"
								>
									{copy.forgotPassword}
								</button>
							) : null}
							{notice ? (
								<p className="email-auth__notice" role="status">
									{notice}
								</p>
							) : null}
							{shownError ? (
								<p className="auth-alert" role="alert">
									{shownError}
								</p>
							) : null}
							<button className="email-auth__primary" disabled={!canSubmit} type="submit">
								{busy ? (
									<>
										<LoaderCircle size={17} className="spin" aria-hidden />
										{copy.processing}
									</>
								) : isEmailEntry && resendSeconds > 0 ? (
									copy.resendCountdown(resendSeconds)
								) : (
									submitLabel
								)}
							</button>
							{screen.kind === 'email' ? (
								<p className="email-auth__privacy">
									{copy.privacyBefore}
									<a
										href="https://wenxue-d8gz76tacc3659f05-1427406869.tcloudbaseapp.com/"
										target="_blank"
										rel="noreferrer"
										onClick={(event) => {
											if (!onOpenExternal) return
											event.preventDefault()
											onOpenExternal(event.currentTarget.href)
										}}
									>
										{copy.privacyLink}
									</a>
									{copy.privacyAfter}
								</p>
							) : null}
							{screen.kind === 'register-profile' && !profileSubmitted ? (
								<button
									className="email-auth__link"
									disabled={busy || expired}
									type="button"
									onClick={() => {
										setLocalError(null)
										onClearError()
										setScreen({ kind: 'register-password', registration: screen.registration })
									}}
								>
									<ArrowLeft size={15} aria-hidden />
									{copy.previousStep}
								</button>
							) : null}
							{isCode ? (
								<button
									className="email-auth__link"
									disabled={busy || resendSeconds > 0}
									onClick={() => void sendCode(screen.kind === 'reset-code')}
									type="button"
								>
									{resendSeconds > 0 ? copy.resendCountdown(resendSeconds) : copy.resend}
								</button>
							) : null}
							{expired && (newPassword || isRegistration) ? (
								<button
									className="email-auth__link"
									disabled={busy}
									onClick={() =>
										navigate(screen.kind === 'reset-password' ? 'reset-email' : 'email')
									}
									type="button"
								>
									{copy.verifyAgain}
								</button>
							) : null}
						</form>
					</div>
				</section>
			)}
		</main>
	)
}

function PasswordFields({
	id,
	password,
	confirmation,
	setPassword,
	setConfirmation,
	creating,
	disabled,
}: {
	id: string
	password: string
	confirmation: string
	setPassword: (value: string) => void
	setConfirmation: (value: string) => void
	creating: boolean
	disabled: boolean
}) {
	const [visible, setVisible] = useState(false)
	const [confirmationVisible, setConfirmationVisible] = useState(false)
	const [activeConfirmationIndex, setActiveConfirmationIndex] = useState(-1)
	const requirements = getLauncherPasswordRequirements(password)
	const comparison = getLauncherPasswordComparison(password, confirmation)
	const showPasswordComparison = creating && password.length > 0 && confirmation.length > 0
	const confirmationHasError = Boolean(
		confirmation && (!password || comparison.firstMismatchIndex >= 0 || comparison.extraLength),
	)
	const confirmationHint = !confirmation
		? strings.auth.hint.confirmation.idle
		: !password
			? strings.auth.hint.confirmation.missingPassword
			: comparison.firstMismatchIndex >= 0
				? strings.auth.hint.confirmation.mismatch(comparison.firstMismatchIndex + 1)
				: comparison.extraLength
					? strings.auth.hint.confirmation.extra(comparison.extraLength)
					: password === confirmation
						? strings.auth.hint.confirmation.matched
						: strings.auth.hint.confirmation.progress(comparison.confirmedLength, password.length)
	return (
		<>
			<div className="auth-field">
				<label htmlFor={`${id}-password`}>{strings.auth.field.password}</label>
				<div
					className={`auth-password ${showPasswordComparison ? 'auth-password--comparing' : ''}`}
				>
					<input
						id={`${id}-password`}
						aria-describedby={creating ? `${id}-requirements` : undefined}
						autoComplete={creating ? 'new-password' : 'current-password'}
						autoCapitalize="none"
						spellCheck={false}
						type={visible ? 'text' : 'password'}
						required
						disabled={disabled}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
					{showPasswordComparison ? (
						<PasswordComparison
							password={password}
							visible={visible}
							states={comparison.states}
							activeIndex={activeConfirmationIndex}
						/>
					) : null}
					<button
						aria-label={
							visible ? strings.auth.action.hidePassword : strings.auth.action.showPassword
						}
						aria-pressed={visible}
						aria-controls={`${id}-password`}
						className="auth-password__toggle"
						disabled={disabled}
						onClick={() => setVisible((value) => !value)}
						type="button"
					>
						{visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
					</button>
				</div>
				{creating ? (
					<ul className="auth-requirements" id={`${id}-requirements`}>
						{(
							Object.keys(strings.auth.hint.password) as Array<
								keyof typeof strings.auth.hint.password
							>
						).map((key) => {
							const state = !password ? 'idle' : requirements[key] ? 'valid' : 'invalid'
							const Icon = !password ? Minus : requirements[key] ? Check : X
							return (
								<li className="auth-requirement" data-state={state} key={key}>
									<Icon size={12} aria-hidden />
									<span>
										{strings.auth.hint.password[key]}
										<span className="sr-only">，{strings.auth.hint.requirementState[state]}</span>
									</span>
								</li>
							)
						})}
					</ul>
				) : null}
			</div>
			{creating ? (
				<div className="auth-field">
					<label htmlFor={`${id}-confirmation`}>{strings.auth.field.confirmPassword}</label>
					<div className="auth-password">
						<input
							id={`${id}-confirmation`}
							aria-describedby={`${id}-comparison`}
							aria-invalid={confirmationHasError}
							autoComplete="new-password"
							autoCapitalize="none"
							spellCheck={false}
							type={confirmationVisible ? 'text' : 'password'}
							required
							disabled={disabled}
							value={confirmation}
							onChange={(event) => {
								const value = event.target.value
								setConfirmation(value)
								setActiveConfirmationIndex(
									Array.from(value.slice(0, event.target.selectionStart ?? value.length)).length -
										1,
								)
							}}
						/>
						<button
							aria-label={
								confirmationVisible
									? strings.auth.action.hideConfirmPassword
									: strings.auth.action.showConfirmPassword
							}
							aria-pressed={confirmationVisible}
							aria-controls={`${id}-confirmation`}
							className="auth-password__toggle"
							disabled={disabled}
							onClick={() => setConfirmationVisible((value) => !value)}
							type="button"
						>
							{confirmationVisible ? (
								<EyeOff size={16} aria-hidden />
							) : (
								<Eye size={16} aria-hidden />
							)}
						</button>
					</div>
					<p
						className="auth-field__hint auth-confirmation-hint"
						id={`${id}-comparison`}
						aria-live="polite"
						data-state={!confirmation ? 'idle' : confirmationHasError ? 'invalid' : 'valid'}
					>
						{confirmationHint}
					</p>
				</div>
			) : null}
		</>
	)
}

function PasswordComparison({
	password,
	visible,
	states,
	activeIndex,
}: {
	password: string
	visible: boolean
	states: PasswordCharacterMatch[]
	activeIndex: number
}) {
	const viewportRef = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const viewport = viewportRef.current
		if (!viewport) return
		const alignActiveCharacter = () => {
			const index = Math.max(0, Math.min(activeIndex, viewport.children.length - 1))
			const character = viewport.children[index] as HTMLElement | undefined
			if (!character) return
			const bounds = viewport.getBoundingClientRect()
			const { left, right } = character.getBoundingClientRect()
			if (left < bounds.left) viewport.scrollLeft -= Math.ceil(bounds.left - left)
			else if (right > bounds.right) {
				viewport.scrollLeft += Math.ceil(right - bounds.right)
			}
		}
		alignActiveCharacter()
		const observer = new ResizeObserver(alignActiveCharacter)
		observer.observe(viewport)
		return () => observer.disconnect()
	}, [password, visible, activeIndex])
	return (
		<div className="auth-password__comparison" aria-hidden="true" ref={viewportRef}>
			{Array.from(password).map((character, index) => (
				<span
					className="auth-password__character"
					data-state={states[index]}
					// eslint-disable-next-line @eslint-react/no-array-index-key -- Fixed positions retain cells; state changes replay only that cell's animation.
					key={`${index}:${states[index]}`}
				>
					{visible ? character : '•'}
				</span>
			))}
		</div>
	)
}
