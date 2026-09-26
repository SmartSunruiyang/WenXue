export type ClientPlatform = 'darwin' | 'win32'
export type ClientArch = 'arm64' | 'x64'
export type ClientRuntime = 'electron' | 'chromium'
export type ReleaseChannel = 'dev' | 'beta' | 'stable'
export type AnnouncementImportance = 'normal' | 'important'
export type AnnouncementStatus = 'published' | 'withdrawn'
export type UpdateMode = 'optional' | 'mandatory'
export type ReleaseRolloutStatus = 'active' | 'paused' | 'withdrawn' | 'superseded'
export type ReleaseDistributionMode = 'manual-unsigned' | 'platform-unsigned'

export interface AnnouncementAudience {
	platforms?: ClientPlatform[]
	minVersion?: string
	maxVersion?: string
	userIds?: string[]
}

export interface AnnouncementInput {
	importance: AnnouncementImportance
	title: string
	body: string
	detailUrl?: string
	audience: AnnouncementAudience
	expiresAt?: string
}

export interface ValidatedAnnouncementInput extends AnnouncementInput {
	expiresAt: string
}

export interface AnnouncementView extends ValidatedAnnouncementInput {
	id: string
	status: AnnouncementStatus
	publishedAt: string
	publishedBy?: string
	withdrawnAt?: string
}

export interface ClientAnnouncementView {
	id: string
	importance: AnnouncementImportance
	title: string
	body: string
	detailUrl?: string
	publishedAt: string
	expiresAt: string
}

export interface AnnouncementMatchContext {
	userId: string
	platform: ClientPlatform
	version: string
}

export interface ReleaseArtifact {
	platform: ClientPlatform
	arch: ClientArch
	kind: string
	fileName: string
	url: string
	sha512: string
	size: number
}

export type PlatformReleaseArtifact =
	| (ReleaseArtifact & { platform: 'darwin'; arch: 'arm64'; kind: 'dmg' })
	| (ReleaseArtifact & { platform: 'win32'; arch: 'x64'; kind: 'nsis' | 'nsis-yaml' })

export interface ReleaseSourceCoordinates {
	repository: string
	commit: string
	browserVersion: string
	extensionVersion: string
	releasePublicKeyFingerprint?: string
}

export interface ReleaseDistribution {
	mode: 'manual-unsigned'
}

export interface PlatformReleaseDistribution {
	mode: 'platform-unsigned'
}

export interface ReleaseTestEvidence {
	name: string
	status: 'passed'
	url: string
}

export interface ReleaseCandidateManifest {
	schemaVersion: 1
	releaseId: string
	runtime: ClientRuntime
	channel: ReleaseChannel
	version: string
	createdAt: string
	manifestUrl: string
	sourceCoordinates: ReleaseSourceCoordinates
	distribution: ReleaseDistribution
	tests: ReleaseTestEvidence[]
	artifacts: ReleaseArtifact[]
}

export interface ReleaseCandidateManifestV2 extends Omit<
	ReleaseCandidateManifest,
	'schemaVersion' | 'runtime' | 'distribution' | 'artifacts'
> {
	schemaVersion: 2
	runtime: 'electron'
	distribution: PlatformReleaseDistribution
	artifacts: PlatformReleaseArtifact[]
}

export type SignedReleaseCandidateManifest = ReleaseCandidateManifest | ReleaseCandidateManifestV2

export interface ReleaseCandidateV1 extends ReleaseCandidateManifest {
	manifestSignature: string
	status: 'verified'
	registeredAt: string
}

export interface ReleaseCandidateV2 extends ReleaseCandidateManifestV2 {
	manifestSignature: string
	status: 'verified'
	registeredAt: string
}

export type ReleaseCandidate = ReleaseCandidateV1 | ReleaseCandidateV2

export interface ReleaseStageHealth {
	success: number
	failure: number
}

export interface ReleaseHealth {
	windowStartedAt: string
	updatedAt?: string
	sampleCount: number
	truncated: boolean
	stages: {
		check: ReleaseStageHealth
		download: ReleaseStageHealth
		handoff: ReleaseStageHealth
	}
	handoffFailureRate: number | null
}

export interface ReleaseRollout {
	id: string
	runtime: ClientRuntime
	channel: ReleaseChannel
	releaseId: string
	status: ReleaseRolloutStatus
	percentage: 1 | 5 | 25 | 50 | 100
	mode: UpdateMode
	minSupportedVersion?: string
	title: string
	notes: string
	publishedAt: string
	publishedBy?: string
	updatedAt?: string
	health?: ReleaseHealth
	healthUnavailableReason?: 'historical' | 'limit'
}

export interface ReleasePublishInput {
	candidateId: string
	title: string
	notes: string
	percentage: 1 | 5 | 25 | 50 | 100
	mode: UpdateMode
	minSupportedVersion?: string
}

export interface UpdatePolicy {
	id: string
	runtime: ClientRuntime
	channel: ReleaseChannel
	releaseId: string
	version: string
	percentage: 1 | 5 | 25 | 50 | 100
	mode: UpdateMode
	minSupportedVersion?: string
	title: string
	notes: string
	manifestUrl: string
	manifestSignature: string
	distribution: ReleaseDistribution
	artifacts: ReleaseArtifact[]
	publishedAt: string
	checkedAt: string
	validUntil: string
	eventToken: string
}

export interface UpdatePolicyV2 extends Omit<
	UpdatePolicy,
	'runtime' | 'mode' | 'distribution' | 'artifacts'
> {
	schemaVersion: 2
	runtime: 'electron'
	mode: 'optional'
	distribution: PlatformReleaseDistribution
	artifacts: PlatformReleaseArtifact[]
}

export type UpdatePolicyResponse = { policy: UpdatePolicy | UpdatePolicyV2 } | { policy: null }

export interface UpdateReleaseView {
	releaseId: string
	version: string
	channel: ReleaseChannel
	title: string
	notes: string
	mode: UpdateMode
	distribution: ReleaseDistribution | PlatformReleaseDistribution
	size: number
}

export interface DownloadProgress {
	percent: number
	transferred: number
	total: number
	bytesPerSecond: number
}

export type UpdateState =
	| { phase: 'idle' | 'checking' }
	| { phase: 'available'; release: UpdateReleaseView }
	| { phase: 'downloading'; release: UpdateReleaseView; progress: DownloadProgress }
	| { phase: 'ready'; release: UpdateReleaseView }
	| { phase: 'opening'; release: UpdateReleaseView }
	| { phase: 'handedOff'; release: UpdateReleaseView }
	| { phase: 'error'; message: string; retryable: boolean; release?: UpdateReleaseView }

export interface ValidationIssue {
	field: string
	message: string
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] }

export interface ParsedSemver {
	major: number
	minor: number
	patch: number
	prerelease: Array<number | string>
}

export const ANNOUNCEMENT_LIMITS: Readonly<{
	title: 80
	body: 1000
	detailUrl: 2048
	userIds: 500
	defaultExpiryDays: 7
	maxExpiryDays: 30
}>

export const RELEASE_PERCENTAGES: readonly [1, 5, 25, 50, 100]

export function parseSemver(value: string): ParsedSemver | null
export function isValidSemver(value: string): boolean
export function compareSemver(left: string, right: string): number
export function versionInRange(version: string, minVersion?: string, maxVersion?: string): boolean
export function isValidHttpsUrl(value: string): boolean
export function validateAnnouncementInput(
	input: unknown,
	options?: { now?: number | Date },
): ValidationResult<ValidatedAnnouncementInput>
export function validateReleasePublishInput(input: unknown): ValidationResult<ReleasePublishInput>
export function matchesAudience(
	context: AnnouncementMatchContext,
	audience: AnnouncementAudience,
): boolean
export function canonicalJson(value: unknown): string
export function rolloutBucket(releaseId: string, installId: string): number
