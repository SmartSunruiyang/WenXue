import cloudbase from '@cloudbase/js-sdk'
import { strings } from './strings'

declare const __WENXUE_GATEWAY_BASE_URL__: string

const DEFAULT_WENXUE_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com'
const USERNAME_MIN_LENGTH = 5
const USERNAME_MAX_LENGTH = 24
const PASSWORD_MIN_LENGTH = 9
const PASSWORD_MAX_LENGTH = 32
const AUTH_REQUEST_TIMEOUT_MS = 12_000
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/
const PASSWORD_FIRST_CHARACTER_PATTERN = /^[A-Za-z0-9]/
const PASSWORD_CHARACTER_SET_PATTERN = /^[A-Za-z0-9()!@#$%^&*|?><_-]+$/
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
const registerUrl =
	import.meta.env.VITE_WENXUE_REGISTER_URL ??
	`${normalizeGatewayBaseUrl(gatewayBaseUrl)}/v1/auth/register`
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

interface CloudBaseAuthClient {
	signInWithPassword(input: {
		username: string
		password: string
	}): Promise<{ data?: unknown; error?: CloudBaseAuthError | null }>
	getSession(): Promise<{ data?: unknown; error?: CloudBaseAuthError | null }>
	refreshSession(
		refreshToken?: string,
	): Promise<{ data?: unknown; error?: CloudBaseAuthError | null }>
	signOut(): Promise<{ error?: CloudBaseAuthError | null }>
}

interface CloudBaseApp {
	auth(options: { persistence: 'local' }): CloudBaseAuthClient
	database(): CloudBaseDatabase
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
	username?: string
	accessToken: string
	refreshToken: string
	expiresAt: number
	gatewayBaseUrl: string
}

export interface LauncherPublicUser {
	userId: string
	username?: string
	expiresAt: number
}

export type LauncherCredentialValidationCode =
	| 'usernameRequired'
	| 'usernameLength'
	| 'usernameFormat'
	| 'passwordRequired'
	| 'passwordLength'
	| 'passwordFirstCharacter'
	| 'passwordCharacterSet'
	| 'passwordComplexity'

export const cloudbaseConfig = {
	envId,
	region,
	hasAccessKey: Boolean(accessKey),
}

let app: CloudBaseApp | null | undefined
let auth: CloudBaseAuthClient | null | undefined

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
	return cloudbaseApp
		.database()
		.collection(collectionName)
		.where({ _id: documentId })
		.watch(callbacks)
}

export function validateLauncherCredentials(
	username: string,
	password: string,
): LauncherCredentialValidationCode | null {
	if (username.length === 0) return 'usernameRequired'
	if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
		return 'usernameLength'
	}
	if (!USERNAME_PATTERN.test(username)) return 'usernameFormat'
	if (password.length === 0) return 'passwordRequired'
	if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
		return 'passwordLength'
	}
	if (!PASSWORD_FIRST_CHARACTER_PATTERN.test(password)) return 'passwordFirstCharacter'
	if (!PASSWORD_CHARACTER_SET_PATTERN.test(password)) return 'passwordCharacterSet'
	if (countPasswordCharacterCategories(password) < 3) return 'passwordComplexity'
	return null
}

export async function signInLauncher(
	username: string,
	password: string,
): Promise<LauncherAuthSession> {
	assertLauncherCredentials(username, password)
	const authClient = getAuth()
	if (!authClient) throw new Error(strings.auth.error.publishableKey)
	let data: unknown
	try {
		const result = await withAuthRequestTimeout(
			authClient.signInWithPassword({ username, password }),
		)
		if (result.error) throw result.error
		data = result.data
	} catch (error) {
		throw new Error(readCloudBaseErrorMessage(error, strings.auth.error.login))
	}
	const session = readLauncherAuthSession(data)
	if (!session) throw new Error(strings.auth.error.loginSession)
	return session
}

export async function registerLauncher(
	username: string,
	password: string,
): Promise<LauncherAuthSession> {
	assertLauncherCredentials(username, password)
	const authClient = getAuth()
	if (!authClient) throw new Error(strings.auth.error.publishableKey)
	const accountCreation = await createLauncherAccount(username, password)
	let session: LauncherAuthSession
	try {
		session = await signInLauncher(username, password)
	} catch (error) {
		if (accountCreation === 'existing' && !isConnectivityError(error)) {
			throw new Error(strings.auth.error.usernameExists)
		}
		throw error
	}
	try {
		await activateLauncherAccount(session.accessToken)
	} catch (error) {
		await discardUnactivatedSession(authClient)
		throw error
	}
	return session
}

export async function getLauncherSession(): Promise<LauncherAuthSession | null> {
	const authClient = getAuth()
	if (!authClient) return null
	const { data, error } = await authClient.getSession()
	if (error) return null
	return readLauncherAuthSession(data)
}

export async function refreshLauncherSession(refreshToken?: string): Promise<LauncherAuthSession> {
	const authClient = getAuth()
	if (!authClient) throw new Error(strings.auth.error.publishableKey)
	try {
		const { data, error } = await withAuthRequestTimeout(authClient.refreshSession(refreshToken))
		if (error) throw error
		const session = readLauncherAuthSession(data)
		if (!session) throw new Error(strings.auth.error.loginSession)
		return session
	} catch (error) {
		throw new Error(readCloudBaseErrorMessage(error, strings.auth.error.loginSession))
	}
}

export async function signOutLauncher(): Promise<void> {
	const authClient = getAuth()
	if (!authClient) return
	const { error } = await authClient.signOut()
	if (error) throw new Error(readCloudBaseErrorMessage(error, strings.auth.error.logout))
}

export function toPublicUser(session: LauncherAuthSession): LauncherPublicUser {
	return {
		userId: session.userId,
		username: session.username,
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
	const userMetadata = isRecord(user?.user_metadata) ? user.user_metadata : null
	const userId = readString(user?.id) ?? readString(user?.uid) ?? readString(root?.uid)
	const expiresAt = readExpiresAt(session, options.now ?? Date.now)
	if (!accessToken || !refreshToken || !userId || !expiresAt) return null

	return {
		userId,
		username:
			readString(user?.username) ??
			readString(userMetadata?.username) ??
			readString(userMetadata?.name) ??
			undefined,
		accessToken,
		refreshToken,
		expiresAt,
		gatewayBaseUrl: normalizeGatewayBaseUrl(options.gatewayBaseUrl ?? gatewayBaseUrl),
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

function assertLauncherCredentials(username: string, password: string): void {
	const validationCode = validateLauncherCredentials(username, password)
	if (validationCode) throw new Error(strings.auth.validation[validationCode])
}

function countPasswordCharacterCategories(password: string): number {
	return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password))
		.length
}

function isConnectivityError(value: unknown): boolean {
	if (!(value instanceof Error)) return false
	return (
		value.message === strings.auth.error.network || value.message === strings.auth.error.timeout
	)
}

function getAuth(): CloudBaseAuthClient | null {
	if (auth !== undefined) return auth
	const cloudbaseApp = getApp()
	auth = cloudbaseApp?.auth({ persistence: 'local' }) ?? null
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

async function createLauncherAccount(
	username: string,
	password: string,
): Promise<'created' | 'existing'> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS)
	let response: Response
	let payload: unknown
	try {
		response = await fetch(registerUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({ username, password }),
			signal: controller.signal,
		})
		payload = await readResponsePayload(response)
	} catch (error) {
		throw new Error(readCloudBaseErrorMessage(error, strings.auth.error.register))
	} finally {
		clearTimeout(timeoutId)
	}
	if (response.status === 201) return 'created'
	if (response.status === 409) return 'existing'
	throw new Error(readCloudBaseErrorMessage(payload, `注册失败 (${response.status})`))
}

async function activateLauncherAccount(accessToken: string): Promise<void> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS)
	let response: Response
	let payload: unknown
	try {
		response = await fetch(activateUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({}),
			signal: controller.signal,
		})
		payload = await readResponsePayload(response)
	} catch (error) {
		throw new Error(readAuthorizedErrorMessage(error, strings.auth.error.register, accessToken))
	} finally {
		clearTimeout(timeoutId)
	}
	if (!response.ok) {
		throw new Error(
			readAuthorizedErrorMessage(payload, `账号激活失败 (${response.status})`, accessToken),
		)
	}
}

async function discardUnactivatedSession(authClient: CloudBaseAuthClient): Promise<void> {
	try {
		await withAuthRequestTimeout(authClient.signOut())
	} catch {
		// Activation failed, so cleanup is best-effort and must not replace that original error.
	}
}

async function withAuthRequestTimeout<T>(request: Promise<T>): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutId = setTimeout(() => {
			const error = new Error(strings.auth.error.timeout)
			error.name = 'AbortError'
			reject(error)
		}, AUTH_REQUEST_TIMEOUT_MS)
	})

	try {
		return await Promise.race([request, timeout])
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId)
	}
}

async function readResponsePayload(response: Response): Promise<unknown> {
	const text = await response.text()
	if (!text) return null
	try {
		return JSON.parse(text) as unknown
	} catch {
		return text
	}
}

function readAuthorizedErrorMessage(value: unknown, fallback: string, accessToken: string): string {
	const message = readCloudBaseErrorMessage(value, fallback)
	return accessToken.length > 0 ? message.split(accessToken).join('[REDACTED]') : message
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
