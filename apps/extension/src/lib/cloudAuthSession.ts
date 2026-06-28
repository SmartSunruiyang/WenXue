export const WENXUE_CLOUD_AUTH_SESSION_KEY = 'WenXueCloudAuthSession'

export interface ExtensionCloudAuthSession {
	uid: string
	username?: string
	name?: string
	type: 'external'
	accessToken: string
	expiresAt: number
	envId: string
	region: string
	gatewayBaseUrl: string
}

export interface CloudAuthStorageArea {
	get(keys: string | string[]): Promise<Record<string, unknown>>
	set(values: Record<string, unknown>): Promise<void>
	remove(key: string): Promise<void>
}

export function normalizeExtensionCloudAuthSession(
	value: unknown,
): ExtensionCloudAuthSession | null {
	if (!isRecord(value)) return null
	if (
		typeof value.uid !== 'string' ||
		typeof value.accessToken !== 'string' ||
		typeof value.expiresAt !== 'number' ||
		typeof value.envId !== 'string' ||
		typeof value.region !== 'string' ||
		typeof value.gatewayBaseUrl !== 'string' ||
		value.type !== 'external'
	) {
		return null
	}
	if (
		value.uid.length === 0 ||
		value.accessToken.length === 0 ||
		value.envId.length === 0 ||
		value.region.length === 0 ||
		value.gatewayBaseUrl.length === 0
	) {
		return null
	}

	return {
		uid: value.uid,
		username: typeof value.username === 'string' ? value.username : undefined,
		name: typeof value.name === 'string' ? value.name : undefined,
		type: 'external',
		accessToken: value.accessToken,
		expiresAt: value.expiresAt,
		envId: value.envId,
		region: value.region,
		gatewayBaseUrl: value.gatewayBaseUrl,
	}
}

export async function saveExtensionCloudAuthSession(
	storage: CloudAuthStorageArea,
	value: unknown,
): Promise<ExtensionCloudAuthSession> {
	const session = normalizeExtensionCloudAuthSession(value)
	if (!session) {
		throw new Error('Invalid WenXue Cloud auth session')
	}
	await storage.set({ [WENXUE_CLOUD_AUTH_SESSION_KEY]: session })
	return session
}

export async function loadExtensionCloudAuthSession(
	storage: CloudAuthStorageArea,
): Promise<ExtensionCloudAuthSession | null> {
	const result = await storage.get(WENXUE_CLOUD_AUTH_SESSION_KEY)
	return normalizeExtensionCloudAuthSession(result[WENXUE_CLOUD_AUTH_SESSION_KEY])
}

export async function clearExtensionCloudAuthSession(
	storage: CloudAuthStorageArea,
): Promise<void> {
	await storage.remove(WENXUE_CLOUD_AUTH_SESSION_KEY)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}
