import cloudbase from '@cloudbase/js-sdk'

import { WENXUE_GATEWAY_BASE_URL } from '@/agent/constants'

export const WENXUE_USER_SESSION_KEY = 'WenXueUserSession'

const DEFAULT_REFRESH_SKEW_MS = 60_000
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

export interface ExtensionUserSession {
	userId: string
	accessToken: string
	refreshToken: string
	expiresAt: number
	gatewayBaseUrl: string
	browserId?: string
}

export interface UserSessionStorageArea {
	get(keys: string | string[]): Promise<Record<string, unknown>>
	set(values: Record<string, unknown>): Promise<void>
	remove(key: string): Promise<void>
}

export type ExtensionUserSessionRefresh = (session: ExtensionUserSession) => Promise<unknown | null>

export interface LoadExtensionUserSessionOptions {
	now?: () => number
	refresh?: ExtensionUserSessionRefresh
	refreshSkewMs?: number
}

interface CloudBaseAuthError {
	message?: string
}

interface CloudBaseAuthClient {
	setSession(input: {
		access_token: string
		refresh_token: string
	}): Promise<{ data?: unknown; error?: CloudBaseAuthError | null }>
}

interface CloudBaseApp {
	auth(options: { persistence: 'local' }): CloudBaseAuthClient
}

let auth: CloudBaseAuthClient | null | undefined

export function normalizeExtensionUserSession(value: unknown): ExtensionUserSession | null {
	if (!isRecord(value)) return null
	const userId = readString(value.userId)
	const accessToken = readString(value.accessToken)
	const refreshToken = readString(value.refreshToken)
	const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt : null
	const gatewayBaseUrl = readString(value.gatewayBaseUrl) ?? WENXUE_GATEWAY_BASE_URL
	const normalizedGatewayBaseUrl = normalizeGatewayBaseUrl(gatewayBaseUrl)
	const browserId = value.browserId

	if (
		!userId ||
		!accessToken ||
		!refreshToken ||
		!expiresAt ||
		!Number.isFinite(expiresAt) ||
		!normalizedGatewayBaseUrl ||
		(browserId !== undefined &&
			(typeof browserId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(browserId)))
	) {
		return null
	}

	return {
		userId,
		accessToken,
		refreshToken,
		expiresAt,
		gatewayBaseUrl: normalizedGatewayBaseUrl,
		...(browserId !== undefined ? { browserId } : {}),
	}
}

export async function saveExtensionUserSession(
	storage: UserSessionStorageArea,
	value: unknown,
): Promise<ExtensionUserSession> {
	const session = normalizeExtensionUserSession(value)
	if (!session) {
		throw new Error('Invalid WenXue user session')
	}
	await storage.set({ [WENXUE_USER_SESSION_KEY]: session })
	return session
}

export async function loadExtensionUserSession(
	storage: UserSessionStorageArea,
	options: LoadExtensionUserSessionOptions = {},
): Promise<ExtensionUserSession | null> {
	const result = await storage.get(WENXUE_USER_SESSION_KEY)
	const session = normalizeExtensionUserSession(result[WENXUE_USER_SESSION_KEY])
	if (!session) return null

	const now = options.now ?? Date.now
	const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS
	if (session.expiresAt > now() + refreshSkewMs) return session

	try {
		const refresh = options.refresh ?? refreshExtensionUserSession
		const refreshedValue = await refresh(session)
		const refreshed = normalizeExtensionUserSession(
			isRecord(refreshedValue)
				? { ...refreshedValue, browserId: session.browserId }
				: refreshedValue,
		)
		if (refreshed) {
			await storage.set({ [WENXUE_USER_SESSION_KEY]: refreshed })
			return refreshed
		}
	} catch {
		// Keep the stored refresh token so a later foreground/background wake can retry.
	}

	return session.expiresAt > now() ? session : null
}

export async function clearExtensionUserSession(storage: UserSessionStorageArea): Promise<void> {
	await storage.remove(WENXUE_USER_SESSION_KEY)
}

async function refreshExtensionUserSession(
	session: ExtensionUserSession,
): Promise<ExtensionUserSession | null> {
	const authClient = getAuth()
	if (!authClient) throw new Error('CloudBase Publishable Key 未配置')
	const { data, error } = await authClient.setSession({
		access_token: session.accessToken,
		refresh_token: session.refreshToken,
	})
	if (error) throw new Error(error.message ?? '刷新登录 session 失败')
	return readRefreshedSession(data, session)
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
			auth: { detectSessionInUrl: false },
		}) as unknown as CloudBaseApp
		auth = app.auth({ persistence: 'local' })
		return auth
	} catch {
		return null
	}
}

function readRefreshedSession(
	value: unknown,
	previous: ExtensionUserSession,
): ExtensionUserSession | null {
	const root = isRecord(value) ? value : null
	const candidate = isRecord(root?.session)
		? root.session
		: isRecord(root?.data) && isRecord(root.data.session)
			? root.data.session
			: root
	if (!candidate) return null

	const accessToken =
		readString(candidate.access_token) ?? readString(candidate.accessToken) ?? previous.accessToken
	const refreshToken =
		readString(candidate.refresh_token) ??
		readString(candidate.refreshToken) ??
		previous.refreshToken
	const expiresAt =
		readExpiresAt(candidate, Date.now) ?? readExpiresAt(root ?? {}, Date.now) ?? previous.expiresAt
	const user = isRecord(candidate.user) ? candidate.user : isRecord(root?.user) ? root.user : null
	const userId =
		readString(user?.id) ?? readString(user?.uid) ?? readString(root?.uid) ?? previous.userId

	return normalizeExtensionUserSession({
		userId,
		accessToken,
		refreshToken,
		expiresAt,
		gatewayBaseUrl: previous.gatewayBaseUrl,
	})
}

function readExpiresAt(session: Record<string, unknown>, now: () => number): number | null {
	const explicit = readNumber(session.expires_at) ?? readNumber(session.expiresAt)
	if (explicit) return explicit < 10_000_000_000 ? explicit * 1000 : explicit
	const expiresIn = readNumber(session.expires_in) ?? readNumber(session.expiresIn)
	if (!expiresIn) return null
	return now() + expiresIn * 1000
}

function normalizeGatewayBaseUrl(value: string): string | null {
	const trimmed = value.trim().replace(/\/+$/, '')
	const baseUrl = trimmed.endsWith('/v1') ? trimmed.slice(0, -3).replace(/\/+$/, '') : trimmed
	return baseUrl === WENXUE_GATEWAY_BASE_URL ? baseUrl : null
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
