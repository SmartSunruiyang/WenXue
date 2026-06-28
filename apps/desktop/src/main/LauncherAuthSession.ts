import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import type { AppPaths } from './AppPaths'

export const WENXUE_CLOUDBASE_ENV_ID = 'wenxue-d8gz76tacc3659f05'
export const WENXUE_CLOUDBASE_REGION = 'ap-shanghai'
export const WENXUE_GATEWAY_BASE_URL =
	'https://wenxue-llm-gateway-4037646-1427406869.ap-shanghai.run.tcloudbase.com'

const AUTH_SESSION_FILE = 'cloud-auth-session.json'
const AUTH_DEVICE_FILE = 'cloud-auth-device.json'
const TOKEN_REFRESH_MARGIN_MS = 60_000

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AuthLoginInput {
	username: string
	password: string
}

export interface CloudAuthSession {
	uid: string
	username?: string
	name?: string
	type: 'external'
	accessToken: string
	refreshToken?: string
	expiresAt: number
	issuedAt: number
	envId: string
	region: string
	gatewayBaseUrl: string
}

export interface PublicCloudAuthSession {
	uid: string
	username?: string
	name?: string
	type: 'external'
	expiresAt: number
	envId: string
	region: string
	gatewayBaseUrl: string
}

export interface ExtensionHandoffAuthSession extends PublicCloudAuthSession {
	accessToken: string
}

export interface LauncherAuthSessionOptions {
	envId?: string
	region?: string
	gatewayBaseUrl?: string
	fetchImpl?: FetchLike
	now?: () => number
}

interface TokenResponse {
	accessToken: string
	refreshToken?: string
	expiresIn: number
	sub: string
}

interface UserProfile {
	sub: string
	username?: string
	name?: string
	type?: string
}

interface PersistedDevice {
	deviceId: string
}

export class LauncherAuthSession {
	private readonly envId: string
	private readonly region: string
	private readonly gatewayBaseUrl: string
	private readonly fetchImpl: FetchLike
	private readonly now: () => number
	private readonly sessionFile: string
	private readonly deviceFile: string
	private cachedSession: CloudAuthSession | null = null
	private cachedDeviceId: string | null = null

	constructor(paths: AppPaths, options: LauncherAuthSessionOptions = {}) {
		this.envId = options.envId ?? WENXUE_CLOUDBASE_ENV_ID
		this.region = options.region ?? WENXUE_CLOUDBASE_REGION
		this.gatewayBaseUrl = options.gatewayBaseUrl ?? WENXUE_GATEWAY_BASE_URL
		this.fetchImpl = options.fetchImpl ?? fetch
		this.now = options.now ?? Date.now
		this.sessionFile = paths.dataFile(AUTH_SESSION_FILE)
		this.deviceFile = paths.dataFile(AUTH_DEVICE_FILE)
	}

	async login(input: AuthLoginInput): Promise<PublicCloudAuthSession> {
		const username = input.username.trim()
		if (!username || !input.password) {
			throw new Error('请输入产品用户账号和密码')
		}

		const token = await this.postToken('/auth/v1/signin', {
			username,
			password: input.password,
		})
		const session = await this.buildSessionFromToken(token)
		await this.saveSession(session)
		return toPublicSession(session)
	}

	async getSession(): Promise<PublicCloudAuthSession | null> {
		const session = await this.getCurrentSession()
		return session ? toPublicSession(session) : null
	}

	async getHandoffSession(): Promise<ExtensionHandoffAuthSession> {
		const session = await this.getCurrentSession()
		if (!session) {
			throw new Error('请先登录产品用户')
		}
		return {
			...toPublicSession(session),
			accessToken: session.accessToken,
		}
	}

	async logout(): Promise<void> {
		this.cachedSession = null
		await writeFile(this.sessionFile, '{}\n', 'utf8')
	}

	private async getCurrentSession(): Promise<CloudAuthSession | null> {
		const session = this.cachedSession ?? (await this.readPersistedSession())
		if (!session) return null
		if (session.expiresAt - TOKEN_REFRESH_MARGIN_MS <= this.now()) {
			if (!session.refreshToken) {
				this.cachedSession = null
				return null
			}
			return this.refreshSession(session.refreshToken)
		}
		this.cachedSession = session
		return session
	}

	private async refreshSession(refreshToken: string): Promise<CloudAuthSession | null> {
		try {
			const token = await this.postToken('/auth/v1/token', {
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			})
			const session = await this.buildSessionFromToken(token)
			await this.saveSession(session)
			return session
		} catch {
			this.cachedSession = null
			await writeFile(this.sessionFile, '{}\n', 'utf8')
			return null
		}
	}

	private async buildSessionFromToken(token: TokenResponse): Promise<CloudAuthSession> {
		const profile = await this.fetchUserProfile(token.accessToken)
		if (profile.type !== 'external') {
			throw new Error('当前账号不是产品注册用户，请使用 CloudBase 外部注册用户登录')
		}
		if (profile.sub !== token.sub) {
			throw new Error('登录会话用户与用户信息不一致，请重新登录')
		}

		const issuedAt = this.now()
		return {
			uid: token.sub,
			username: profile.username,
			name: profile.name,
			type: 'external',
			accessToken: token.accessToken,
			refreshToken: token.refreshToken,
			expiresAt: issuedAt + token.expiresIn * 1000,
			issuedAt,
			envId: this.envId,
			region: this.region,
			gatewayBaseUrl: this.gatewayBaseUrl,
		}
	}

	private async postToken(pathname: string, body: Record<string, string>): Promise<TokenResponse> {
		const deviceId = await this.getDeviceId()
		const response = await this.fetchImpl(this.authUrl(pathname), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-device-id': deviceId,
			},
			body: JSON.stringify(body),
		})
		const payload = await parseJsonResponse(response)
		if (!response.ok) {
			throw new Error(errorMessageFromPayload(payload, 'CloudBase 登录失败'))
		}
		return parseTokenResponse(payload)
	}

	private async fetchUserProfile(accessToken: string): Promise<UserProfile> {
		const deviceId = await this.getDeviceId()
		const response = await this.fetchImpl(this.authUrl('/auth/v1/user/me'), {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'x-device-id': deviceId,
			},
		})
		const payload = await parseJsonResponse(response)
		if (!response.ok) {
			throw new Error(errorMessageFromPayload(payload, 'CloudBase 用户信息获取失败'))
		}
		return parseUserProfile(payload)
	}

	private authUrl(pathname: string): string {
		const url = new URL(pathname, `https://${this.envId}.api.tcloudbasegateway.com`)
		url.searchParams.set('client_id', this.envId)
		return url.toString()
	}

	private async getDeviceId(): Promise<string> {
		if (this.cachedDeviceId) return this.cachedDeviceId

		try {
			const parsed = JSON.parse(await readFile(this.deviceFile, 'utf8')) as unknown
			const persisted = parsePersistedDevice(parsed)
			if (persisted) {
				this.cachedDeviceId = persisted.deviceId
				return persisted.deviceId
			}
		} catch (error) {
			if (!isMissingFile(error)) {
				throw error
			}
		}

		const deviceId = `wenxue-${randomUUID()}`
		this.cachedDeviceId = deviceId
		await writeFile(this.deviceFile, `${JSON.stringify({ deviceId }, null, 2)}\n`, 'utf8')
		return deviceId
	}

	private async readPersistedSession(): Promise<CloudAuthSession | null> {
		try {
			const parsed = JSON.parse(await readFile(this.sessionFile, 'utf8')) as unknown
			return parsePersistedSession(parsed, {
				envId: this.envId,
				region: this.region,
				gatewayBaseUrl: this.gatewayBaseUrl,
			})
		} catch (error) {
			if (!isMissingFile(error)) {
				throw error
			}
			return null
		}
	}

	private async saveSession(session: CloudAuthSession): Promise<void> {
		this.cachedSession = session
		await writeFile(this.sessionFile, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
	}
}

function toPublicSession(session: CloudAuthSession): PublicCloudAuthSession {
	return {
		uid: session.uid,
		username: session.username,
		name: session.name,
		type: session.type,
		expiresAt: session.expiresAt,
		envId: session.envId,
		region: session.region,
		gatewayBaseUrl: session.gatewayBaseUrl,
	}
}

async function parseJsonResponse(response: Response): Promise<unknown> {
	const text = await response.text()
	if (!text) return {}
	try {
		return JSON.parse(text) as unknown
	} catch {
		return {}
	}
}

function parseTokenResponse(value: unknown): TokenResponse {
	if (!isRecord(value)) {
		throw new Error('CloudBase 登录响应格式异常')
	}
	const accessToken = value.access_token
	const expiresIn = value.expires_in
	const sub = value.sub
	if (typeof accessToken !== 'string' || accessToken.length === 0) {
		throw new Error('CloudBase 登录响应缺少 access_token')
	}
	if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
		throw new Error('CloudBase 登录响应缺少 expires_in')
	}
	if (typeof sub !== 'string' || sub.length === 0) {
		throw new Error('CloudBase 登录响应缺少 uid')
	}

	return {
		accessToken,
		refreshToken: typeof value.refresh_token === 'string' ? value.refresh_token : undefined,
		expiresIn,
		sub,
	}
}

function parseUserProfile(value: unknown): UserProfile {
	if (!isRecord(value)) {
		throw new Error('CloudBase 用户信息响应格式异常')
	}
	const sub = value.sub
	if (typeof sub !== 'string' || sub.length === 0) {
		throw new Error('CloudBase 用户信息缺少 uid')
	}

	return {
		sub,
		username: typeof value.username === 'string' ? value.username : undefined,
		name: typeof value.name === 'string' ? value.name : undefined,
		type: typeof value.type === 'string' ? value.type : undefined,
	}
}

function parsePersistedDevice(value: unknown): PersistedDevice | null {
	if (!isRecord(value) || typeof value.deviceId !== 'string' || value.deviceId.length === 0) {
		return null
	}
	return { deviceId: value.deviceId }
}

function parsePersistedSession(
	value: unknown,
	defaults: Pick<CloudAuthSession, 'envId' | 'region' | 'gatewayBaseUrl'>,
): CloudAuthSession | null {
	if (!isRecord(value)) return null
	if (
		typeof value.uid !== 'string' ||
		typeof value.accessToken !== 'string' ||
		typeof value.expiresAt !== 'number' ||
		typeof value.issuedAt !== 'number' ||
		value.type !== 'external'
	) {
		return null
	}

	return {
		uid: value.uid,
		username: typeof value.username === 'string' ? value.username : undefined,
		name: typeof value.name === 'string' ? value.name : undefined,
		type: 'external',
		accessToken: value.accessToken,
		refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : undefined,
		expiresAt: value.expiresAt,
		issuedAt: value.issuedAt,
		envId: typeof value.envId === 'string' ? value.envId : defaults.envId,
		region: typeof value.region === 'string' ? value.region : defaults.region,
		gatewayBaseUrl:
			typeof value.gatewayBaseUrl === 'string' ? value.gatewayBaseUrl : defaults.gatewayBaseUrl,
	}
}

function errorMessageFromPayload(value: unknown, fallback: string): string {
	if (!isRecord(value)) return fallback
	if (typeof value.error_description === 'string' && value.error_description.length > 0) {
		return value.error_description
	}
	if (typeof value.error === 'string' && value.error.length > 0) {
		return value.error
	}
	return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === 'ENOENT'
}
