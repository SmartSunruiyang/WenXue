import cloudbase from '@cloudbase/js-sdk'

const WENXUE_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-4037646-1427406869.ap-shanghai.run.tcloudbase.com'
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
const gatewayBaseUrl = import.meta.env.VITE_WENXUE_GATEWAY_BASE_URL ?? WENXUE_GATEWAY_BASE_URL
const registerUrl =
	import.meta.env.VITE_WENXUE_REGISTER_URL ??
	`${normalizeGatewayBaseUrl(gatewayBaseUrl)}/v1/auth/register`

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
	signOut(): Promise<{ error?: CloudBaseAuthError | null }>
}

interface CloudBaseApp {
	auth(options: { persistence: 'local' }): CloudBaseAuthClient
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

export const cloudbaseConfig = {
	envId,
	region,
	hasAccessKey: Boolean(accessKey),
}

let auth: CloudBaseAuthClient | null | undefined

export async function signInLauncher(
	username: string,
	password: string,
): Promise<LauncherAuthSession> {
	const authClient = getAuth()
	if (!authClient) throw new Error('CloudBase Publishable Key 未配置')
	const { data, error } = await authClient.signInWithPassword({ username, password })
	if (error) throw new Error(readCloudBaseErrorMessage(error, '登录失败'))
	const session = readLauncherAuthSession(data)
	if (!session) throw new Error('登录成功但未返回有效 session')
	return session
}

export async function registerLauncher(
	username: string,
	password: string,
): Promise<LauncherAuthSession> {
	if (!getAuth()) throw new Error('CloudBase Publishable Key 未配置')
	await createLauncherAccount(username, password)
	return signInLauncher(username, password)
}

export async function getLauncherSession(): Promise<LauncherAuthSession | null> {
	const authClient = getAuth()
	if (!authClient) return null
	const { data, error } = await authClient.getSession()
	if (error) return null
	return readLauncherAuthSession(data)
}

export async function signOutLauncher(): Promise<void> {
	const authClient = getAuth()
	if (!authClient) return
	const { error } = await authClient.signOut()
	if (error) throw new Error(readCloudBaseErrorMessage(error, '退出失败'))
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
	return readErrorMessage(value, new Set()) ?? fallback
}

function getAuth(): CloudBaseAuthClient | null {
	if (auth !== undefined) return auth
	if (!accessKey) {
		auth = null
		return auth
	}

	try {
		const app = cloudbase.init({
			env: envId,
			region,
			accessKey,
			auth: { detectSessionInUrl: true },
		}) as unknown as CloudBaseApp
		auth = app.auth({ persistence: 'local' })
		return auth
	} catch {
		return null
	}
}

async function createLauncherAccount(username: string, password: string): Promise<void> {
	let response: Response
	try {
		response = await fetch(registerUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({ username, password }),
		})
	} catch (error) {
		throw new Error(readCloudBaseErrorMessage(error, '注册服务暂时不可用'))
	}
	const payload = await readResponsePayload(response)
	if (!response.ok) {
		throw new Error(readCloudBaseErrorMessage(payload, `注册失败 (${response.status})`))
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
