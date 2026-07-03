export type AdminRole = 'admin' | 'viewer'
export type UserStatus = 'active' | 'disabled'

export interface AdminSession {
	accessToken: string
	userId: string
	username?: string
}

export interface AdminMe {
	uid: string
	role: AdminRole
	displayName?: string
}

export interface UsageBucket {
	key: string
	label: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
}

export interface UsageRecordView {
	id: string
	ts: number
	userId: string
	model: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
	latencyMs: number
}

export interface AdminUsageSummary {
	totalInputTokens: number
	totalOutputTokens: number
	totalTokens: number
	byDay: UsageBucket[]
	byModel: UsageBucket[]
	byUser: UsageBucket[]
	recent: UsageRecordView[]
	userStatus: {
		active: number
		disabled: number
		total: number
	}
}

export interface UserAccountView {
	userId: string
	status: UserStatus
	createdAt: string
	updatedAt: string
	note?: string
	inputTokens: number
	outputTokens: number
	totalTokens: number
}
