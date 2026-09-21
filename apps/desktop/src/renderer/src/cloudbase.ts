import cloudbase from '@cloudbase/js-sdk'
import {
	configureLauncherCaptcha,
	requestLauncherCaptcha,
	withCaptchaAwareTimeout,
} from './captchaChallenge'
import { strings } from './strings'

declare const __WENXUE_GATEWAY_BASE_URL__: string

const DEFAULT_WENXUE_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com'
const NICKNAME_MAX_LENGTH = 32
const VERIFICATION_TTL_MS = 600_000
const EMAIL_RESEND_DELAY_MS = 60_000
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 32
const AUTH_REQUEST_TIMEOUT_MS = 12_000
const PASSWORD_FIRST_CHARACTER_PATTERN = /^[A-Za-z]/
const PASSWORD_DISALLOWED_CHARACTER_PATTERN = /[^A-Za-z0-9()!@#$%^&*|?><_-]/
const NETWORK_FAILURE_PATTERNS = [
	/failed to fetch/i,
	/fetch failed/i,
	/network\s*(?:error|request failed)/i,
	/load failed/i,
	/err_network/i,
	/internet connection appears to be offline/i,
	/\b(?:econnreset|econnrefused|enotfound|etimedout)\b/i,
]
const DEFAULT_CLOUDBASE_ACCESS_KEY = [
	'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9',
	'.eyJpc3MiOiJodHRwczovL3dlbnh1ZS1kOGd6NzZ0YWNjMzY1OWYwNS5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9uIiwiYXVkIjoid2VueHVlLWQ4Z3o3NnRhY2MzNjU5ZjA1IiwiZXhwIjo0MDg2MzIwNTQwLCJpYXQiOjE3ODI2MzczNDAs',
	'Im5vbmNlIjoiZE13cHpKMkhTTWVkSW53T0QxWnV2QSIsImF0X2hhc2giOiJkTXdwekoySFNNZWRJbndPRDFadXZBIiwibmFtZSI6IkFub255bW91cyIsInNjb3BlIjoiYW5vbnltb3VzIiwicHJvamVjdF9pZCI6Indlbnh1ZS1kOGd6NzZ0YWNjMzY1OWYwNSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0',
	'.FXH0g4vTivM1IWwN9bSdS0avTeyZ4Ch0MwNc2Df4EPHAANFgzfZNEbtuU1b9yvqon2dsvvCsznbP7YooM4Qpm12UG0K545fGeDvVRugSUL6ipzi-oPCfn6YVxt5Py8N6gLGMPMqw9Zj3fBRiX_smvXgSXfe8cRtNWjtNp-nqBFaHMagzIYlUbNDt-NXS7LyycTmZO1WsnUV5OzL__Hx1-WYh4ktbdIHQfS5qO6GGdYB-puyBXrsiGJGLOQun8Dsmhr',
	'Dit4tHoKYgqQ3qT97gewI65HHGs0yJs2a_FpP1Dy8QusRvvVcvMCO2N1FZO4mfSneIknxRVGzilFIlXxTxQA',
].join('')
const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID ?? 'wenxue-d8gz76tacc3659f05'
const region = import.meta.env.VITE_CLOUDBASE_REGION ?? 'ap-shanghai'
const accessKey = import.meta.env.VITE_CLOUDBASE_ACCESS_KEY || DEFAULT_CLOUDBASE_ACCESS_KEY
const gatewayBaseUrl =
	typeof __WENXUE_GATEWAY_BASE_URL__ === 'string'
		? __WENXUE_GATEWAY_BASE_URL__
		: (import.meta.env.VITE_WENXUE_GATEWAY_BASE_URL ?? DEFAULT_WENXUE_GATEWAY_BASE_URL)
const activateUrl = `${normalizeGatewayBaseUrl(gatewayBaseUrl)}/v1/auth/activate`

interface CloudBaseAuthError {
	message?: string
	msg?: string
	error?: string
	error_description?: string
	code?: string | number
	errorCode?: string | number
	error_code?: string | number
}

interface CloudBaseAuthResult {
	data?: unknown
	error?: CloudBaseAuthError | null
}

interface CloudBaseAuthClient {
	signInWithPassword(input: { email: string; password: string }): Promise<CloudBaseAuthResult>
	getVerification(
		input: { email: string; target: 'ANY' | 'USER' },
		options: { withCaptcha: true },
	): Promise<{ verification_id: string; expires_in?: number; is_user?: boolean | null }>
	verify(input: {
		verification_id: string
		verification_code: string
	}): Promise<{ verification_token: string; expires_in?: number }>
	signIn(input: { username: string; verification_token: string }): Promise<unknown>
	signUp(input: {
		email: string
		verification_token: string
		password: string
		name: string
	}): Promise<unknown>
	resetPassword(input: {
		email: string
		verification_token: string
		new_password: string
	}): Promise<unknown>
	updateUserBasicInfo(input: { picture: string }): Promise<void>
	createCaptchaData(input: {
		state: string
	}): Promise<{ data: string; token: string; expires_in: number }>
	verifyCaptchaData(input: {
		token: string
		key: string
	}): Promise<{ captcha_token: string; expires_in: number }>
	getSession(): Promise<CloudBaseAuthResult>
	refreshSession(refreshToken?: string): Promise<CloudBaseAuthResult>
	signOut(): Promise<{ error?: CloudBaseAuthError | null }>
}

interface CloudBaseApp {
	auth(options: {
		persistence: 'local'
		captchaOptions: { openURIWithCallback: typeof requestLauncherCaptcha }
	}): CloudBaseAuthClient
	database(): CloudBaseDatabase
	uploadFile(input: { cloudPath: string; filePath: File }): Promise<{ fileID: string }>
	getTempFileURL(input: {
		fileList: { fileID: string; maxAge: number }[]
	}): Promise<{ fileList: { fileID: string; tempFileURL?: string; download_url?: string }[] }>
}

interface CloudBaseDatabase {
	collection(name: string): {
		where(query: Record<string, unknown>): {
			watch(callbacks: {
				onChange: (snapshot: unknown) => void
				onError: (error: unknown) => void
			}): DesktopSignalWatcher
		}
	}
}

export interface DesktopSignalWatcher {
	close(): void | Promise<void>
}

export interface LauncherAuthSession {
	userId: string
	email?: string
	nickname?: string
	avatarUrl?: string
	accessToken: string
	refreshToken: string
	expiresAt: number
	gatewayBaseUrl: string
}

export interface LauncherPublicUser {
	userId: string
	email?: string
	nickname?: string
	avatarUrl?: string
	expiresAt: number
}

export interface LauncherEmailRegistration {
	email: string
	expiresAt: number
	readonly state: LauncherEmailRegistrationState
	complete(input: {
		nickname: string
		password: string
		avatar?: File
	}): Promise<LauncherAuthSession>
	cancel(): void
}

export type LauncherEmailRegistrationState =
	| 'pending'
	| 'confirming-account'
	| 'avatar-pending'
	| 'needs-verification'
	| 'needs-login'
	| 'complete'

export interface LauncherEmailChallenge {
	email: string
	expiresAt: number
	resendAt: number
	verify(
		code: string,
	): Promise<
		| { kind: 'authenticated'; session: LauncherAuthSession }
		| { kind: 'registration'; registration: LauncherEmailRegistration }
	>
	cancel(): void
}

export interface LauncherPasswordReset {
	email: string
	expiresAt: number
	complete(password: string): Promise<void>
	cancel(): void
}

export interface LauncherPasswordResetChallenge {
	email: string
	expiresAt: number
	resendAt: number
	verify(code: string): Promise<LauncherPasswordReset>
	cancel(): void
}

export class CloudSignOutOutcomeUnknownError extends Error {
	readonly cloudSignOutOutcome = 'unknown' as const
}

class AuthRequestTimeoutError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'AbortError'
	}
}

export class LauncherAccountConfirmationError extends Error {
	constructor(
		readonly retryable: boolean,
		readonly status?: number,
	) {
		super(
			retryable
				? strings.auth.emailErrors.activationRetry
				: strings.auth.emailErrors.activationReauthenticate,
		)
		this.name = 'LauncherAccountConfirmationError'
	}
}

export class LauncherEmailRateLimitError extends Error {
	constructor(
		readonly retryAt: number,
		readonly source: 'local' | 'provider',
	) {
		super(strings.auth.emailErrors.rateLimit)
		this.name = 'LauncherEmailRateLimitError'
	}
}

interface EmailResendCooldown {
	retryAt: number
	source: 'local' | 'provider'
}

interface EmailFlow {
	cancelled: boolean
	finished: boolean
	verified: boolean
	token: string
	tokenExpiresAt: number
	sessionUserId?: string
	signUpAttempted: boolean
	signUpSucceeded: boolean
	registrationState: LauncherEmailRegistrationState
	cancel(): void
}

export const cloudbaseConfig = { envId, region, hasAccessKey: Boolean(accessKey) }
let app: CloudBaseApp | null | undefined
let auth: CloudBaseAuthClient | null | undefined
const emailResendCooldowns = new Map<string, EmailResendCooldown>()
let authMutationPending = false
let authMutationTimedOut = false
let authOutcomeUnknown = false
let activeEmailFlow: EmailFlow | null = null

export function normalizeLauncherEmail(value: string): string {
	const email = value.trim().toLowerCase()
	const parts = email.split('@')
	if (
		email.length > 254 ||
		parts.length !== 2 ||
		!parts[0] ||
		parts[0].length > 64 ||
		!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
		parts[0].startsWith('.') ||
		parts[0].endsWith('.') ||
		parts[0].includes('..') ||
		!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(parts[1] ?? '')
	) {
		throw new Error(strings.auth.emailErrors.invalidEmail)
	}
	return email
}

export function getLauncherEmailResendAt(value: string): number {
	try {
		return readEmailResendCooldown(normalizeLauncherEmail(value))?.retryAt ?? 0
	} catch {
		return 0
	}
}

function readEmailResendCooldown(email: string): EmailResendCooldown | undefined {
	const cooldown = emailResendCooldowns.get(email)
	if (cooldown && Date.now() >= cooldown.retryAt) {
		emailResendCooldowns.delete(email)
		return undefined
	}
	return cooldown
}

function recordEmailResendCooldown(email: string, cooldown: EmailResendCooldown): void {
	emailResendCooldowns.forEach((previous, key) => {
		if (Date.now() >= previous.retryAt) emailResendCooldowns.delete(key)
	})
	emailResendCooldowns.set(email, cooldown)
}

export function validateLauncherRegistration(nickname: string, password: string): string | null {
	const name = nickname.trim()
	if (!name) return strings.auth.emailErrors.nicknameRequired
	if (
		Array.from(name).length > NICKNAME_MAX_LENGTH ||
		Array.from(name).some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		)
	)
		return strings.auth.emailErrors.nicknameLength
	return validatePassword(password)
}

function validatePassword(password: string): string | null {
	if (!password) return strings.auth.validation.passwordRequired
	const requirements = getLauncherPasswordRequirements(password)
	if (!requirements.length) return strings.auth.validation.passwordLength
	if (!requirements.firstCharacter) return strings.auth.validation.passwordFirstCharacter
	if (!requirements.characterSet) return strings.auth.validation.passwordCharacterSet
	if (!requirements.complexity) return strings.auth.validation.passwordComplexity
	return null
}

export async function sendLauncherEmailCode(value: string): Promise<LauncherEmailChallenge> {
	const { email, flow, challenge, authClient, expiresAt } = await sendEmailVerification(
		value,
		'ANY',
	)
	return {
		email,
		expiresAt,
		resendAt: getLauncherEmailResendAt(email),
		cancel: flow.cancel,
		async verify(code) {
			return runEmailOperation(
				flow,
				strings.auth.emailErrors.verify,
				async () => {
					await verifyEmailCode(flow, authClient, challenge.verification_id, expiresAt, code)
					if (challenge.is_user === true) {
						try {
							await authClient.signIn({ username: email, verification_token: flow.token })
							flow.token = ''
							const session = await readCurrentSession(authClient, email)
							flow.sessionUserId = session.userId
							assertFlowActive(flow)
							flow.finished = true
							return { kind: 'authenticated' as const, session }
						} catch (error) {
							flow.cancelled = true
							flow.token = ''
							throw error
						}
					}
					return {
						kind: 'registration' as const,
						registration: createEmailRegistration(flow, authClient, email),
					}
				},
				authClient,
			)
		},
	}
}

export async function sendLauncherPasswordResetCode(
	value: string,
): Promise<LauncherPasswordResetChallenge> {
	const { email, flow, challenge, authClient, expiresAt } = await sendEmailVerification(
		value,
		'USER',
	)
	return {
		email,
		expiresAt,
		resendAt: getLauncherEmailResendAt(email),
		cancel: flow.cancel,
		async verify(code) {
			return runEmailOperation(flow, strings.auth.emailErrors.verify, async () => {
				await verifyEmailCode(flow, authClient, challenge.verification_id, expiresAt, code)
				return {
					email,
					expiresAt: flow.tokenExpiresAt,
					cancel: flow.cancel,
					async complete(password: string) {
						const error = validatePassword(password)
						if (error) throw new Error(error)
						return runEmailOperation(flow, strings.auth.emailErrors.reset, async () => {
							assertVerificationToken(flow)
							// A reset token is single-use: an indeterminate response requires a new verification.
							const verificationToken = flow.token
							flow.token = ''
							await authClient.resetPassword({
								email,
								verification_token: verificationToken,
								new_password: password,
							})
							assertFlowActive(flow)
							flow.finished = true
						})
					},
				}
			})
		},
	}
}

async function sendEmailVerification(value: string, target: 'ANY' | 'USER') {
	const email = normalizeLauncherEmail(value)
	assertAuthMutationIdle()
	const cooldown = readEmailResendCooldown(email)
	if (cooldown) throw new LauncherEmailRateLimitError(cooldown.retryAt, cooldown.source)
	const authClient = getAuth()
	if (!authClient) throw new Error(strings.auth.error.publishableKey)
	activeEmailFlow?.cancel()
	assertAuthMutationIdle()
	const flow = createEmailFlow(authClient)
	activeEmailFlow = flow
	try {
		const challenge = await runEmailOperation(flow, strings.auth.emailErrors.send, async () => {
			let result: Awaited<ReturnType<CloudBaseAuthClient['getVerification']>>
			try {
				result = await authClient.getVerification({ email, target }, { withCaptcha: true })
			} catch (error) {
				if (!isEmailRateLimitError(error)) throw error
				const retryAt = readEmailRateLimitRetryAt(error)
				recordEmailResendCooldown(email, { retryAt, source: 'provider' })
				throw new LauncherEmailRateLimitError(retryAt, 'provider')
			}
			// Delivery can succeed after cancellation or timeout, or with an unusable challenge.
			// Preserve its cooldown before discarding the result in any of those cases.
			recordEmailResendCooldown(email, {
				retryAt: Date.now() + EMAIL_RESEND_DELAY_MS,
				source: 'local',
			})
			assertFlowActive(flow)
			if (
				!readString(result.verification_id) ||
				(target === 'ANY' && result.is_user != null && typeof result.is_user !== 'boolean')
			)
				throw new Error(strings.auth.emailErrors.send)
			return result
		})
		return {
			email,
			flow,
			challenge,
			authClient,
			expiresAt: verificationExpiresAt(challenge.expires_in),
		}
	} catch (error) {
		flow.cancel()
		throw error
	}
}

function createEmailFlow(authClient: CloudBaseAuthClient): EmailFlow {
	const flow: EmailFlow = {
		cancelled: false,
		finished: false,
		verified: false,
		token: '',
		tokenExpiresAt: 0,
		signUpAttempted: false,
		signUpSucceeded: false,
		registrationState: 'pending',
		cancel() {
			if (flow.finished || flow.cancelled) return
			flow.cancelled = true
			flow.token = ''
			if (flow.sessionUserId && !authMutationPending) {
				void runAuthMutation(() => clearLateLogin(authClient)).catch(() => {
					authOutcomeUnknown = true
				})
			}
		},
	}
	return flow
}

async function verifyEmailCode(
	flow: EmailFlow,
	authClient: CloudBaseAuthClient,
	verificationId: string,
	expiresAt: number,
	code: string,
): Promise<void> {
	assertFlowActive(flow)
	if (flow.verified || Date.now() >= expiresAt) throw new Error(strings.auth.emailErrors.expired)
	if (!/^\d{6}$/.test(code)) throw new Error(strings.auth.emailErrors.invalidCode)
	// Keep the default v1 verification endpoint: v2 may write login credentials.
	const result = await authClient.verify({
		verification_id: verificationId,
		verification_code: code,
	})
	assertFlowActive(flow)
	if (!readString(result.verification_token)) throw new Error(strings.auth.emailErrors.verify)
	flow.verified = true
	flow.token = result.verification_token
	flow.tokenExpiresAt = verificationExpiresAt(result.expires_in)
}

function createEmailRegistration(
	flow: EmailFlow,
	authClient: CloudBaseAuthClient,
	email: string,
): LauncherEmailRegistration {
	let uploadedAvatar: File | undefined
	let avatarFileID: string | undefined
	return {
		email,
		get expiresAt() {
			return flow.sessionUserId ? Infinity : flow.tokenExpiresAt
		},
		get state() {
			return flow.registrationState
		},
		cancel: flow.cancel,
		async complete({ nickname, password, avatar }) {
			const validation = validateLauncherRegistration(nickname, password)
			if (validation) throw new Error(validation)
			validateAvatar(avatar)
			return runEmailOperation(
				flow,
				strings.auth.emailErrors.register,
				async () => {
					let session: LauncherAuthSession
					if (!flow.sessionUserId) {
						assertVerificationToken(flow)
						if (flow.signUpAttempted) throw new Error(strings.auth.emailErrors.expired)
						flow.signUpAttempted = true
						const verificationToken = flow.token
						flow.token = ''
						// This is the only account-creation call; verification never calls signUp/signInWithOtp.
						try {
							await authClient.signUp({
								email,
								verification_token: verificationToken,
								password,
								name: nickname.trim(),
							})
							flow.signUpSucceeded = true
							assertFlowActive(flow)
							session = await readCurrentSession(authClient, email)
							flow.sessionUserId = session.userId
							flow.registrationState = 'confirming-account'
						} catch (error) {
							flow.cancelled = true
							flow.registrationState = flow.signUpSucceeded ? 'needs-login' : 'needs-verification'
							throw error
						}
					} else {
						// Completion retries stay attached to the exact account created by this flow.
						try {
							session = await readCurrentSession(authClient, email, flow.sessionUserId)
						} catch (error) {
							flow.cancelled = true
							flow.registrationState = 'needs-login'
							throw error
						}
					}
					assertFlowActive(flow)
					if (flow.registrationState === 'confirming-account') {
						try {
							await activateLauncherAccount(session.accessToken)
							assertFlowActive(flow)
							flow.registrationState = 'avatar-pending'
						} catch (error) {
							if (error instanceof LauncherAccountConfirmationError && !error.retryable) {
								flow.cancelled = true
								flow.registrationState = 'needs-login'
							}
							throw error
						}
					}
					if (avatar) {
						try {
							const cloudbaseApp = getApp()
							if (!cloudbaseApp) throw new Error(strings.auth.emailErrors.avatarUpload)
							if (!avatarFileID || uploadedAvatar !== avatar) {
								const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[
									avatar.type
								]
								const uploaded = await cloudbaseApp.uploadFile({
									cloudPath: `avatars/${session.userId}/${crypto.randomUUID()}.${extension}`,
									filePath: avatar,
								})
								if (!readString(uploaded.fileID)?.startsWith('cloud://'))
									throw new Error(strings.auth.emailErrors.avatarUpload)
								uploadedAvatar = avatar
								avatarFileID = uploaded.fileID
							}
							assertFlowActive(flow)
							await authClient.updateUserBasicInfo({ picture: avatarFileID })
							session = await readCurrentSession(authClient, email, flow.sessionUserId)
						} catch (error) {
							if (flow.cancelled) throw error
							throw new Error(strings.auth.emailErrors.avatarUpload)
						}
					}
					assertFlowActive(flow)
					flow.finished = true
					flow.registrationState = 'complete'
					return session
				},
				authClient,
			)
		},
	}
}

function validateAvatar(avatar?: File): void {
	if (!avatar) return
	if (!['image/png', 'image/jpeg', 'image/webp'].includes(avatar.type))
		throw new Error(strings.auth.emailErrors.avatarType)
	if (avatar.size <= 0 || avatar.size > AVATAR_MAX_BYTES)
		throw new Error(strings.auth.emailErrors.avatarSize)
}

function verificationExpiresAt(seconds?: number): number {
	return (
		Date.now() +
		(typeof seconds === 'number' && Number.isFinite(seconds)
			? Math.max(0, seconds) * 1000
			: VERIFICATION_TTL_MS)
	)
}

function assertFlowActive(flow: EmailFlow): void {
	if (authMutationTimedOut) {
		// Confirmation only checks an already-created account. A late response can be
		// discarded without destroying that account's verified, retryable session.
		if (flow.registrationState !== 'confirming-account') {
			flow.cancelled = true
			if (flow.signUpAttempted) {
				flow.registrationState = flow.signUpSucceeded ? 'needs-login' : 'needs-verification'
			}
		}
		flow.token = ''
		throw new AuthRequestTimeoutError(strings.auth.error.timeout)
	}
	if (flow.cancelled || flow.finished) throw new Error(strings.auth.emailErrors.cancelled)
}

function assertVerificationToken(flow: EmailFlow): void {
	assertFlowActive(flow)
	if (!flow.token || Date.now() >= flow.tokenExpiresAt) {
		flow.token = ''
		throw new Error(strings.auth.emailErrors.expired)
	}
}

async function runEmailOperation<T>(
	flow: EmailFlow,
	fallback: string,
	operation: () => Promise<T>,
	sessionClient?: CloudBaseAuthClient,
): Promise<T> {
	assertAuthMutationIdle()
	assertFlowActive(flow)
	let cleanupStarted = false
	const cleanup = async () => {
		if (!sessionClient || cleanupStarted) return
		cleanupStarted = true
		await clearLateLogin(sessionClient)
	}
	try {
		return await runAuthMutation(
			async () => {
				try {
					return await operation()
				} catch (error) {
					if (flow.cancelled) await cleanup()
					throw error
				}
			},
			async () => {
				flow.token = ''
				if (!flow.cancelled && flow.registrationState === 'confirming-account') return
				flow.cancelled = true
				if (flow.signUpAttempted) {
					flow.registrationState = flow.signUpSucceeded ? 'needs-login' : 'needs-verification'
				}
				await cleanup()
			},
		)
	} catch (error) {
		if (
			error instanceof LauncherAccountConfirmationError ||
			error instanceof LauncherEmailRateLimitError
		)
			throw error
		throw new Error(readEmailAuthError(error, fallback))
	}
}

function assertAuthMutationIdle(): void {
	if (authMutationPending) throw new Error(strings.auth.emailErrors.pending)
	if (authOutcomeUnknown) throw new Error(strings.auth.emailErrors.sessionChanged)
}

async function runAuthMutation<T>(
	operation: () => Promise<T>,
	onLateCompletion?: () => Promise<void>,
): Promise<T> {
	if (authMutationPending) throw new Error(strings.auth.emailErrors.pending)
	authMutationPending = true
	authMutationTimedOut = false
	let timedOut = false
	const actualRequest = Promise.resolve()
		.then(operation)
		.then(
			async (result) => {
				if (timedOut && onLateCompletion) await onLateCompletion()
				return result
			},
			async (error: unknown) => {
				if (timedOut && onLateCompletion) await onLateCompletion()
				throw error
			},
		)
		.finally(() => {
			authMutationPending = false
			authMutationTimedOut = false
		})
	try {
		return await withAuthRequestTimeout(() => actualRequest)
	} catch (error) {
		if (error instanceof AuthRequestTimeoutError) {
			timedOut = true
			authMutationTimedOut = true
		}
		throw error
	}
}

async function clearLateLogin(authClient: CloudBaseAuthClient): Promise<void> {
	try {
		const result = await authClient.signOut()
		if (result.error) throw result.error
	} catch {
		authOutcomeUnknown = true
	}
}

function readEmailAuthError(value: unknown, fallback: string): string {
	if (isAbortError(value)) return strings.auth.error.timeout
	if (value instanceof Error) {
		const safeMessages: string[] = [
			...Object.values(strings.auth.emailErrors),
			...Object.values(strings.auth.captcha),
			...Object.values(strings.auth.error),
			...Object.values(strings.auth.validation),
		]
		if (safeMessages.includes(value.message)) return value.message
	}
	if (isEmailRateLimitError(value)) return strings.auth.emailErrors.rateLimit
	if (isRecord(value)) {
		const code = String(value.code ?? value.error ?? value.error_code ?? '').toLowerCase()
		if (code === 'already_exists') return strings.auth.emailErrors.accountExists
	}
	const message = readCloudBaseErrorMessage(value, fallback)
	return message === strings.auth.error.network ? message : fallback
}

function isEmailRateLimitError(value: unknown): boolean {
	if (!isRecord(value)) return false
	if (value.category === 'RATE_LIMITED') return true
	return [value.code, value.error, value.error_code, value.errorCode].some((code) =>
		['resource_exhausted', 'rate_limit_exceeded', '8', '4029'].includes(
			String(code ?? '').toLowerCase(),
		),
	)
}

function readEmailRateLimitRetryAt(value: unknown): number {
	const now = Date.now()
	// SDK AuthError.retryAfter and HTTP retry_after are seconds, not milliseconds.
	const seconds = isRecord(value)
		? [value.retryAfter, value.retry_after].find(
				(delay): delay is number =>
					typeof delay === 'number' &&
					Number.isFinite(delay) &&
					delay > 0 &&
					Number.isFinite(now + delay * 1000),
			)
		: undefined
	// Without a server hint this is client backoff, not a promise of provider recovery.
	return now + (seconds === undefined ? EMAIL_RESEND_DELAY_MS : seconds * 1000)
}

export function watchDesktopSignal(
	collectionName: 'desktop_announcement_signal' | 'desktop_release_signal',
	documentId: string,
	callbacks: {
		onChange: (snapshot: unknown) => void
		onError: (error: unknown) => void
	},
): DesktopSignalWatcher {
	const cloudbaseApp = getApp()
	if (!cloudbaseApp) throw new Error(strings.auth.error.publishableKey)
	const query =
		collectionName === 'desktop_announcement_signal' && documentId !== 'global'
			? { _id: documentId, uid: '{openid}' }
			: { _id: documentId }
	return cloudbaseApp.database().collection(collectionName).where(query).watch(callbacks)
}

export function getLauncherPasswordRequirements(password: string): {
	length: boolean
	firstCharacter: boolean
	characterSet: boolean
	complexity: boolean
} {
	return {
		length: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
		firstCharacter: PASSWORD_FIRST_CHARACTER_PATTERN.test(password),
		characterSet: password.length > 0 && !PASSWORD_DISALLOWED_CHARACTER_PATTERN.test(password),
		complexity: countPasswordCharacterCategories(password) >= 3,
	}
}

export type PasswordCharacterMatch = 'pending' | 'match' | 'mismatch'

export function getLauncherPasswordComparison(password: string, confirmation: string) {
	const characters = Array.from(password)
	const confirmedCharacters = Array.from(confirmation)
	const states: PasswordCharacterMatch[] = characters.map((character, index) =>
		index >= confirmedCharacters.length
			? 'pending'
			: character === confirmedCharacters[index]
				? 'match'
				: 'mismatch',
	)
	return {
		states,
		confirmedLength: confirmedCharacters.length,
		extraLength: Math.max(0, confirmedCharacters.length - characters.length),
		firstMismatchIndex: states.indexOf('mismatch'),
	}
}

export async function signInLauncher(
	value: string,
	password: string,
): Promise<LauncherAuthSession> {
	const email = normalizeLauncherEmail(value)
	if (!password) throw new Error(strings.auth.validation.passwordRequired)
	assertAuthMutationIdle()
	const authClient = getAuth()
	if (!authClient) throw new Error(strings.auth.error.publishableKey)
	activeEmailFlow?.cancel()
	assertAuthMutationIdle()
	let cleanupStarted = false
	const cleanup = async () => {
		if (cleanupStarted) return
		cleanupStarted = true
		await clearLateLogin(authClient)
	}
	try {
		return await runAuthMutation(async () => {
			const result = await authClient.signInWithPassword({ email, password })
			if (result.error) throw result.error
			try {
				const session = await readSessionWithAvatar(result.data)
				if (!session || session.email?.toLowerCase() !== email)
					throw new Error(strings.auth.error.loginSession)
				return session
			} catch (error) {
				await cleanup()
				throw error
			}
		}, cleanup)
	} catch (error) {
		throw new Error(readEmailAuthError(error, strings.auth.error.login))
	}
}

async function readCurrentSession(
	authClient: CloudBaseAuthClient,
	email: string,
	userId?: string,
): Promise<LauncherAuthSession> {
	const result = await authClient.getSession()
	if (result.error) throw result.error
	const session = await readSessionWithAvatar(result.data)
	if (!session || session.email?.toLowerCase() !== email || (userId && session.userId !== userId))
		throw new Error(strings.auth.emailErrors.sessionChanged)
	return session
}

export async function getLauncherSession(): Promise<LauncherAuthSession | null> {
	const authClient = getAuth()
	if (!authClient) return null
	try {
		const { data, error } = await withAuthRequestTimeout(() => authClient.getSession())
		if (error) throw error
		const session = await readSessionWithAvatar(data)
		if (session) return session
		if (data == null || (isRecord(data) && data.session == null)) return null
		throw new Error(strings.auth.error.loginSession)
	} catch (error) {
		throw new Error(readEmailAuthError(error, strings.auth.error.loginSession))
	}
}

export async function refreshLauncherSession(refreshToken?: string): Promise<LauncherAuthSession> {
	assertAuthMutationIdle()
	const authClient = getAuth()
	if (!authClient) throw new Error(strings.auth.error.publishableKey)
	try {
		return await runAuthMutation(async () => {
			const { data, error } = await authClient.refreshSession(refreshToken)
			if (error) throw error
			const session = await readSessionWithAvatar(data)
			if (!session) throw new Error(strings.auth.error.loginSession)
			return session
		})
	} catch (error) {
		throw new Error(readEmailAuthError(error, strings.auth.error.loginSession))
	}
}

export async function signOutLauncher(): Promise<void> {
	if (authMutationPending) throw new Error(strings.auth.emailErrors.pending)
	// Explicit sign-out owns cleanup; avoid scheduling a second sign-out from cancel().
	if (activeEmailFlow && !activeEmailFlow.finished) {
		activeEmailFlow.cancelled = true
		activeEmailFlow.token = ''
	}
	const authClient = getAuth()
	if (!authClient) return
	try {
		await runAuthMutation(async () => {
			const { error } = await authClient.signOut()
			if (error) throw error
			authOutcomeUnknown = false
		})
	} catch (error) {
		const message = readEmailAuthError(error, strings.auth.error.logout)
		if (error instanceof AuthRequestTimeoutError) throw new CloudSignOutOutcomeUnknownError(message)
		throw new Error(message)
	}
}

export function toPublicUser(session: LauncherAuthSession): LauncherPublicUser {
	return {
		userId: session.userId,
		email: session.email,
		nickname: session.nickname,
		avatarUrl: session.avatarUrl,
		expiresAt: session.expiresAt,
	}
}

export function readLauncherAuthSession(
	value: unknown,
	options: { now?: () => number; gatewayBaseUrl?: string } = {},
): LauncherAuthSession | null {
	const root = isRecord(value) ? value : null
	const session = isRecord(root?.session) ? root.session : null
	if (!session) return null
	const accessToken = readString(session.access_token) ?? readString(session.accessToken)
	const refreshToken = readString(session.refresh_token) ?? readString(session.refreshToken)
	const user = isRecord(session.user) ? session.user : isRecord(root?.user) ? root.user : null
	const metadata = isRecord(user?.user_metadata) ? user.user_metadata : null
	const userId = readString(user?.id) ?? readString(user?.uid) ?? readString(root?.uid)
	const expiresAt = readExpiresAt(session, options.now ?? Date.now)
	if (!accessToken || !refreshToken || !userId || !expiresAt || user?.is_anonymous === true)
		return null
	const avatar = readAvatarReference(value)
	return {
		userId,
		email: readString(user?.email) ?? undefined,
		nickname:
			readString(metadata?.name) ??
			readString(metadata?.nickName) ??
			readString(user?.name) ??
			undefined,
		avatarUrl: readHttpsUrl(avatar),
		accessToken,
		refreshToken,
		expiresAt,
		gatewayBaseUrl: normalizeGatewayBaseUrl(options.gatewayBaseUrl ?? gatewayBaseUrl),
	}
}

async function readSessionWithAvatar(value: unknown): Promise<LauncherAuthSession | null> {
	const session = readLauncherAuthSession(value)
	const fileID = readAvatarReference(value)
	if (!session || !fileID?.startsWith('cloud://')) return session
	try {
		const cloudbaseApp = getApp()
		if (!cloudbaseApp) return session
		const result = await withAuthRequestTimeout(() =>
			cloudbaseApp.getTempFileURL({ fileList: [{ fileID, maxAge: 3600 }] }),
		)
		const file = result.fileList.find((entry) => entry.fileID === fileID)
		session.avatarUrl = readHttpsUrl(file?.tempFileURL ?? file?.download_url)
	} catch {
		/* A missing avatar must not prevent an otherwise valid login. */
	}
	return session
}

function readAvatarReference(value: unknown): string | null {
	if (!isRecord(value)) return null
	const session = isRecord(value.session) ? value.session : null
	const user = isRecord(session?.user) ? session.user : isRecord(value.user) ? value.user : null
	const metadata = isRecord(user?.user_metadata) ? user.user_metadata : null
	return (
		readString(metadata?.picture) ?? readString(metadata?.avatarUrl) ?? readString(user?.picture)
	)
}

function readHttpsUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	try {
		const url = new URL(value)
		return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
	} catch {
		return undefined
	}
}

export function readCloudBaseErrorMessage(value: unknown, fallback: string): string {
	if (isAbortError(value)) return strings.auth.error.timeout
	const message = readErrorMessage(value, new Set())
	if (!message) return fallback
	return NETWORK_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
		? strings.auth.error.network
		: message
}

function countPasswordCharacterCategories(password: string): number {
	return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password))
		.length
}

function getAuth(): CloudBaseAuthClient | null {
	if (auth !== undefined) return auth
	const cloudbaseApp = getApp()
	auth =
		cloudbaseApp?.auth({
			persistence: 'local',
			captchaOptions: {
				openURIWithCallback: (url) =>
					authMutationTimedOut
						? Promise.reject(new AuthRequestTimeoutError(strings.auth.error.timeout))
						: requestLauncherCaptcha(url),
			},
		}) ?? null
	if (auth) {
		const authClient = auth
		configureLauncherCaptcha({
			createCaptchaData: (input) => authClient.createCaptchaData(input),
			verifyCaptchaData: (input) => authClient.verifyCaptchaData(input),
		})
	}
	return auth
}

function getApp(): CloudBaseApp | null {
	if (app !== undefined) return app
	if (!accessKey) {
		app = null
		return app
	}

	try {
		app = cloudbase.init({
			env: envId,
			region,
			accessKey,
			auth: { detectSessionInUrl: true },
		}) as unknown as CloudBaseApp
		return app
	} catch {
		app = null
		return null
	}
}

async function activateLauncherAccount(accessToken: string): Promise<void> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS)
	try {
		const response = await fetch(activateUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
			body: JSON.stringify({}),
			signal: controller.signal,
		})
		if (!response.ok) {
			throw new LauncherAccountConfirmationError(
				response.status >= 500 || response.status === 408 || response.status === 429,
				response.status,
			)
		}
	} catch (error) {
		if (error instanceof LauncherAccountConfirmationError) throw error
		throw new LauncherAccountConfirmationError(true)
	} finally {
		clearTimeout(timeoutId)
	}
}

async function withAuthRequestTimeout<T>(request: () => Promise<T>): Promise<T> {
	return withCaptchaAwareTimeout(
		request,
		AUTH_REQUEST_TIMEOUT_MS,
		() => new AuthRequestTimeoutError(strings.auth.error.timeout),
	)
}

function readExpiresAt(session: Record<string, unknown>, now: () => number): number | null {
	const explicit = readNumber(session.expires_at) ?? readNumber(session.expiresAt)
	if (explicit) return explicit < 10_000_000_000 ? explicit * 1000 : explicit
	const expiresIn = readNumber(session.expires_in) ?? readNumber(session.expiresIn)
	if (!expiresIn) return null
	return now() + expiresIn * 1000
}

function normalizeGatewayBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, '')
	return trimmed.endsWith('/v1') ? trimmed.slice(0, -3).replace(/\/+$/, '') : trimmed
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isAbortError(value: unknown): boolean {
	return isRecord(value) && value.name === 'AbortError'
}

function readErrorMessage(value: unknown, seen: Set<object>): string | null {
	if (value instanceof Error && value.message.trim().length > 0) {
		return readJsonErrorMessage(value.message) ?? value.message.trim()
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		return readJsonErrorMessage(value) ?? value.trim()
	}
	if (!isRecord(value)) return null
	if (seen.has(value)) return null
	seen.add(value)

	for (const key of ['message', 'msg', 'error_description', 'error'] as const) {
		const message = readString(value[key])
		if (message) return readJsonErrorMessage(message) ?? message
	}

	for (const key of ['cause', 'data', 'response', 'error'] as const) {
		const message = readErrorMessage(value[key], seen)
		if (message) return message
	}

	const code = readString(value.code) ?? readString(value.errorCode) ?? readString(value.error_code)
	if (code) return code
	return null
}

function readJsonErrorMessage(value: string): string | null {
	const text = value.trim()
	if (!text.startsWith('{') || !text.endsWith('}')) return null
	try {
		const parsed = JSON.parse(text) as unknown
		if (!isRecord(parsed)) return null
		return (
			readString(parsed.message) ??
			readString(parsed.msg) ??
			readString(parsed.error_description) ??
			readString(parsed.error)
		)
	} catch {
		return null
	}
}
