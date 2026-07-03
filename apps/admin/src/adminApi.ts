import type {
	AdminMe,
	AdminSession,
	AdminUsageSummary,
	UserAccountView,
	UserStatus,
} from './types'

const apiBaseUrl = (import.meta.env.VITE_WENXUE_ADMIN_API_BASE_URL ?? '').replace(/\/+$/, '')

interface UsersResponse {
	users: UserAccountView[]
}

interface UserStatusPatch {
	userId: string
	status?: UserStatus
	note?: string
	reason?: string
}

interface UserStatusResponse {
	user: UserAccountView
}

export async function fetchMe(session: AdminSession): Promise<AdminMe> {
	return adminFetch('/admin/v1/me', session)
}

export async function fetchUsageSummary(session: AdminSession): Promise<AdminUsageSummary> {
	return adminFetch('/admin/v1/usage/summary', session)
}

export async function fetchUsers(
	session: AdminSession,
	status?: UserStatus | 'all',
): Promise<UserAccountView[]> {
	const params = new URLSearchParams()
	if (status && status !== 'all') params.set('status', status)
	const path = `/admin/v1/users${params.size ? `?${params.toString()}` : ''}`
	const response = await adminFetch<UsersResponse>(path, session)
	return response.users
}

export async function patchUserStatus(
	session: AdminSession,
	patch: UserStatusPatch,
): Promise<UserAccountView> {
	const response = await adminFetch<UserStatusResponse>('/admin/v1/users/status', session, {
		method: 'PATCH',
		body: JSON.stringify(patch),
	})
	return response.user
}

async function adminFetch<T>(
	path: string,
	session: AdminSession,
	init: RequestInit = {},
): Promise<T> {
	const response = await fetch(`${apiBaseUrl}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${session.accessToken}`,
			'content-type': 'application/json',
			...init.headers,
		},
	})
	const text = await response.text()
	const payload = text ? JSON.parse(text) : null
	if (!response.ok) {
		const message =
			isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
				? payload.error.message
				: `请求失败 (${response.status})`
		throw new Error(message)
	}
	return payload as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
