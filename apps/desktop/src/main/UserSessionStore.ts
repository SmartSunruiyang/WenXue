declare const __WENXUE_GATEWAY_BASE_URL__: string

const DEFAULT_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com'
export const WENXUE_GATEWAY_BASE_URL = normalizeGatewayBaseUrl(
	typeof __WENXUE_GATEWAY_BASE_URL__ === 'string'
		? __WENXUE_GATEWAY_BASE_URL__
		: DEFAULT_GATEWAY_BASE_URL,
)

export interface UserSession {
	userId: string
	accessToken: string
	refreshToken: string
	expiresAt: number
	gatewayBaseUrl: string
}

export type PublicUserSession = Pick<UserSession, 'userId' | 'expiresAt' | 'gatewayBaseUrl'>

export interface UserSessionStoreOptions {
	now?: () => number
	gatewayBaseUrl?: string
}

export class UserSessionStore {
	private readonly now: () => number
	private readonly gatewayBaseUrl: string
	private session: UserSession | null = null

	constructor(options: UserSessionStoreOptions = {}) {
		this.now = options.now ?? Date.now
		this.gatewayBaseUrl = normalizeGatewayBaseUrl(options.gatewayBaseUrl ?? WENXUE_GATEWAY_BASE_URL)
	}

	setSession(value: unknown): PublicUserSession {
		const session = normalizeUserSession(value, this.now(), this.gatewayBaseUrl)
		this.session = session
		return toPublicSession(session)
	}

	current(): PublicUserSession | null {
		if (!this.session) return null
		if (this.session.expiresAt <= this.now()) {
			this.session = null
			return null
		}
		return toPublicSession(this.session)
	}

	requireSession(): UserSession {
		if (!this.session) {
			throw new Error('请先登录问学账号')
		}
		if (this.session.expiresAt <= this.now()) {
			this.session = null
			throw new Error('用户登录已过期，请重新登录')
		}
		return this.session
	}

	clear(): void {
		this.session = null
	}
}

function normalizeUserSession(value: unknown, now: number, gatewayBaseUrl: string): UserSession {
	if (!isRecord(value)) {
		throw new Error('用户 session 无效')
	}
	const userId = readString(value.userId)
	const accessToken = readString(value.accessToken)
	const refreshToken = readString(value.refreshToken)
	const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt : null
	if (!userId || !accessToken || !refreshToken || !expiresAt || !Number.isFinite(expiresAt)) {
		throw new Error('用户 session 无效')
	}
	if (expiresAt <= now) {
		throw new Error('用户登录已过期')
	}
	return {
		userId,
		accessToken,
		refreshToken,
		expiresAt,
		// This endpoint is embedded by the signed build. Never trust a renderer-supplied
		// address with account credentials.
		gatewayBaseUrl,
	}
}

function toPublicSession(session: UserSession): PublicUserSession {
	return {
		userId: session.userId,
		expiresAt: session.expiresAt,
		gatewayBaseUrl: session.gatewayBaseUrl,
	}
}

function normalizeGatewayBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, '')
	if (!trimmed) throw new Error('问学服务地址无效')
	const parsed = new URL(trimmed)
	if (parsed.protocol !== 'https:') throw new Error('问学服务地址必须使用 HTTPS')
	return trimmed.endsWith('/v1') ? trimmed.slice(0, -3).replace(/\/+$/, '') : trimmed
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}
