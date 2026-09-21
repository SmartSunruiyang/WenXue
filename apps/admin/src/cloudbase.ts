import cloudbase from '@cloudbase/js-sdk'

import type { AdminSession } from './types'

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

interface CloudBaseAuthClient {
	signInWithPassword(input: {
		username?: string
		email?: string
		password: string
	}): Promise<{ data?: unknown; error?: { message?: string } | null }>
	getSession(): Promise<{ data?: unknown; error?: { message?: string } | null }>
	signOut(): Promise<{ error?: { message?: string } | null }>
}

interface CloudBaseApp {
	auth(options: { persistence: 'local' }): CloudBaseAuthClient
}

let auth: CloudBaseAuthClient | null | undefined

export const cloudbaseConfig = {
	envId,
	region,
	hasAccessKey: Boolean(accessKey),
}

export async function signInAdmin(username: string, password: string): Promise<AdminSession> {
	const authClient = getAuth()
	if (!authClient) throw new Error('CloudBase Publishable Key 未配置')
	const { data, error } = await authClient.signInWithPassword(
		username.includes('@') ? { email: username, password } : { username, password },
	)
	if (error) throw new Error(error.message ?? '登录失败')
	const session = readSession(data)
	if (!session) throw new Error('登录成功但未返回有效 session')
	return session
}

export async function getAdminSession(): Promise<AdminSession | null> {
	const authClient = getAuth()
	if (!authClient) return null
	const { data, error } = await authClient.getSession()
	if (error) return null
	return readSession(data)
}

export async function signOutAdmin(): Promise<void> {
	const authClient = getAuth()
	if (!authClient) return
	const { error } = await authClient.signOut()
	if (error) throw new Error(error.message ?? '退出失败')
}

function readSession(value: unknown): AdminSession | null {
	const root = isRecord(value) ? value : null
	const session = isRecord(root?.session) ? root.session : null
	const accessToken = readString(session?.access_token) ?? readString(session?.accessToken)
	const user = isRecord(session?.user) ? session.user : null
	const userMetadata = isRecord(user?.user_metadata) ? user.user_metadata : null
	const userId = readString(user?.id) ?? readString(user?.uid) ?? readString(root?.uid)
	if (!accessToken || !userId) return null
	return {
		accessToken,
		userId,
		username: readString(user?.username) ?? readString(userMetadata?.username) ?? undefined,
	}
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null
}
