declare const __WENXUE_GATEWAY_BASE_URL__: string

const DEFAULT_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-wenxue-d8gz76tacc3659f05-1427406869.ap-shanghai.run.wxcloudrun.com'
const DEFAULT_VERIFICATION_TIMEOUT_MS = 12_000
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
	fetchImpl?: typeof fetch
	verificationTimeoutMs?: number
}

export class UserSessionStore {
	private readonly now: () => number
	private readonly gatewayBaseUrl: string
	private readonly fetchImpl: typeof fetch
	private readonly verificationTimeoutMs: number
	private session: UserSession | null = null

	constructor(options: UserSessionStoreOptions = {}) {
		this.now = options.now ?? Date.now
		this.gatewayBaseUrl = normalizeGatewayBaseUrl(options.gatewayBaseUrl ?? WENXUE_GATEWAY_BASE_URL)
		this.fetchImpl = options.fetchImpl ?? fetch
		this.verificationTimeoutMs =
			typeof options.verificationTimeoutMs === 'number' &&
			Number.isFinite(options.verificationTimeoutMs) &&
			options.verificationTimeoutMs > 0
				? options.verificationTimeoutMs
				: DEFAULT_VERIFICATION_TIMEOUT_MS
	}

	async setSession(value: unknown): Promise<PublicUserSession> {
		const candidate = normalizeUserSession(value, this.now(), this.gatewayBaseUrl)
		const verifiedUserId = await verifyGatewayUser(
			candidate,
			this.fetchImpl,
			this.verificationTimeoutMs,
		)
		if (candidate.userId !== verifiedUserId) {
			throw new Error('问学账号身份校验失败，请重新登录')
		}
		if (this.session && this.session.userId !== verifiedUserId) {
			throw new Error('请先退出当前问学账号，再登录其他账号')
		}
		const session = { ...candidate, userId: verifiedUserId }
		this.session = session
		return toPublicSession(session)
	}

	current(): PublicUserSession | null {
		if (!this.session) return null
		if (this.session.expiresAt <= this.now()) {
			return null
		}
		return toPublicSession(this.session)
	}

	requireSession(): UserSession {
		if (!this.session) {
			throw new Error('请先登录问学账号')
		}
		if (this.session.expiresAt <= this.now()) {
			throw new Error('用户登录已过期，请重新登录')
		}
		return this.session
	}

	clear(): void {
		this.session = null
	}
}

async function verifyGatewayUser(
	session: UserSession,
	fetchImpl: typeof fetch,
	timeoutMs: number,
): Promise<string> {
	const controller = new AbortController()
	let timeoutId: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			(async () => {
				const response = await fetchImpl(
					new URL('/v1/auth/activate', `${session.gatewayBaseUrl}/`).toString(),
					{
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							authorization: `Bearer ${session.accessToken}`,
						},
						body: JSON.stringify({}),
						signal: controller.signal,
					},
				)
				const payload: unknown = await response.json().catch(() => null)
				const verifiedUserId = isRecord(payload) ? readString(payload.userId) : null
				if (!response.ok || !isRecord(payload) || payload.ok !== true || !verifiedUserId) {
					throw new Error('问学账号身份校验失败，请重新登录')
				}
				return verifiedUserId
			})(),
			new Promise<never>((_resolve, reject) => {
				timeoutId = setTimeout(() => {
					controller.abort()
					reject(new Error('verification timed out'))
				}, timeoutMs)
			}),
		])
	} catch (error) {
		if (error instanceof Error && error.message === '问学账号身份校验失败，请重新登录') {
			throw error
		}
		throw new Error('无法验证问学账号，请检查网络后重试')
	} finally {
		if (timeoutId) clearTimeout(timeoutId)
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
