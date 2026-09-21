import type {
	AnnouncementInput,
	AnnouncementView,
	ReleaseCandidate,
	ReleasePublishInput,
	ReleaseRollout,
} from '@wenxue/client-operations'

import type { AdminMe, AdminSession, AdminUsageSummary, UserAccountView, UserStatus } from './types'

const apiBaseUrl = (import.meta.env.VITE_WENXUE_ADMIN_API_BASE_URL ?? '').replace(/\/+$/, '')
const pendingIdempotencyKeys = new Map<string, string>()

interface UsersResponse {
	users: UserAccountView[]
}

export interface UserStatusPatch {
	userId: string
	status?: UserStatus
	note?: string
	reason?: string
}

interface UserStatusResponse {
	user: UserAccountView
}

interface AnnouncementsResponse {
	announcements: AnnouncementView[]
}

interface AnnouncementResponse {
	announcement: AnnouncementView
}

interface ReleaseCandidatesResponse {
	candidates: ReleaseCandidate[]
}

interface ReleasesResponse {
	releases: ReleaseRollout[]
}

interface ReleaseResponse {
	release: ReleaseRollout
}

export async function fetchMe(session: AdminSession): Promise<AdminMe> {
	return adminFetch('/api/admin/v1/me', session)
}

export async function fetchUsageSummary(session: AdminSession): Promise<AdminUsageSummary> {
	return adminFetch('/api/admin/v1/usage/summary', session)
}

export async function fetchUsers(
	session: AdminSession,
	status?: UserStatus | 'all',
): Promise<UserAccountView[]> {
	const params = new URLSearchParams()
	if (status && status !== 'all') params.set('status', status)
	const path = `/api/admin/v1/users${params.size ? `?${params.toString()}` : ''}`
	const response = await adminFetch<UsersResponse>(path, session)
	return response.users
}

export async function patchUserStatus(
	session: AdminSession,
	patch: UserStatusPatch,
): Promise<UserAccountView> {
	const response = await adminFetch<UserStatusResponse>('/api/admin/v1/user-status', session, {
		method: 'PATCH',
		body: JSON.stringify(patch),
	})
	return response.user
}

export async function fetchAnnouncements(session: AdminSession): Promise<AnnouncementView[]> {
	const response = await adminFetch<AnnouncementsResponse>('/api/admin/v1/announcements', session)
	return response.announcements
}

export async function publishAnnouncement(
	session: AdminSession,
	input: AnnouncementInput,
): Promise<AnnouncementView> {
	return withIdempotency(`announcement:${JSON.stringify(input)}`, async (idempotencyKey) => {
		const response = await adminFetch<AnnouncementResponse>(
			'/api/admin/v1/announcements',
			session,
			{
				method: 'POST',
				headers: { 'idempotency-key': idempotencyKey },
				body: JSON.stringify(input),
			},
		)
		return response.announcement
	})
}

export async function withdrawAnnouncement(
	session: AdminSession,
	id: string,
): Promise<AnnouncementView> {
	const response = await adminFetch<AnnouncementResponse>(
		'/api/admin/v1/announcement-withdraw',
		session,
		{
			method: 'POST',
			body: JSON.stringify({ id }),
		},
	)
	return response.announcement
}

export async function fetchReleaseCandidates(session: AdminSession): Promise<ReleaseCandidate[]> {
	const response = await adminFetch<ReleaseCandidatesResponse>(
		'/api/admin/v1/release-candidates?runtime=electron',
		session,
	)
	return response.candidates
}

export async function fetchReleases(session: AdminSession): Promise<ReleaseRollout[]> {
	const response = await adminFetch<ReleasesResponse>('/api/admin/v1/releases', session)
	return response.releases
}

export async function publishRelease(
	session: AdminSession,
	input: ReleasePublishInput,
): Promise<ReleaseRollout> {
	return withIdempotency(`release:${JSON.stringify(input)}`, async (idempotencyKey) => {
		const response = await adminFetch<ReleaseResponse>('/api/admin/v1/release-publish', session, {
			method: 'POST',
			headers: { 'idempotency-key': idempotencyKey },
			body: JSON.stringify(input),
		})
		return response.release
	})
}

export async function changeReleaseState(
	session: AdminSession,
	releaseId: string,
	action: 'pause' | 'resume' | 'withdraw',
): Promise<ReleaseRollout> {
	const response = await adminFetch<ReleaseResponse>('/api/admin/v1/release-state', session, {
		method: 'POST',
		body: JSON.stringify({ releaseId, action }),
	})
	return response.release
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

async function withIdempotency<T>(
	fingerprint: string,
	operation: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
	const idempotencyKey = pendingIdempotencyKeys.get(fingerprint) ?? crypto.randomUUID()
	pendingIdempotencyKeys.set(fingerprint, idempotencyKey)
	const result = await operation(idempotencyKey)
	pendingIdempotencyKeys.delete(fingerprint)
	return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
