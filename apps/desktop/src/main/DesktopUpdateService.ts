import {
	canonicalJson,
	compareSemver,
	isValidSemver,
	rolloutBucket,
	type UpdateReleaseView,
	type UpdateState,
} from '@wenxue/client-operations'
import type { CancellationToken } from 'electron-updater'
import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppPaths } from './AppPaths'

const STARTUP_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const POLICY_FRESHNESS_MS = 24 * 60 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const DOWNLOAD_PROGRESS_INTERVAL_MS = 150
const MAX_UPDATE_METADATA_BYTES = 64 * 1024
const INSTALLER_DIRECTORY = 'update-installers'
const MANDATORY_POLICY_FILE = 'update-mandatory-policy.json'
const DEVELOPMENT_UPDATE_MESSAGE = '开发模式不支持桌面更新，请安装桌面版本后检查。'
const STALE_MANDATORY_MESSAGE =
	'强制更新策略已超过 24 小时且更新服务暂不可达，已解除工作区限制；联网后请重新检查。'
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUIRED_RELEASE_TEST_EVIDENCE = new Set([
	'quality',
	'manual-installer-integrity',
	'manifest-tamper-rejection',
])

export type UpdateCheckReason = 'startup' | 'timer' | 'manual' | 'signal'
export type InstallIntent = 'open-dmg' | 'restart' | 'quit'

export interface NsisUpdaterPort {
	autoDownload: boolean
	autoInstallOnAppQuit: boolean
	disableDifferentialDownload: boolean
	disableWebInstaller: boolean
	allowDowngrade: boolean
	setFeedURL(options: { provider: 'generic'; url: string; channel: string }): void
	checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: unknown } | null>
	downloadUpdate(cancellationToken?: CancellationToken): Promise<string[]>
	quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
	on(event: 'error', listener: (error: Error) => void): unknown
	on(event: 'download-progress', listener: (progress: NsisDownloadProgress) => void): unknown
	removeListener(event: 'error', listener: (error: Error) => void): unknown
	removeListener(
		event: 'download-progress',
		listener: (progress: NsisDownloadProgress) => void,
	): unknown
}

interface NsisDownloadProgress {
	percent: number
	transferred: number
	total: number
	bytesPerSecond: number
}

export interface DesktopUpdateServiceOptions {
	paths: Pick<AppPaths, 'dataFile'>
	openPath: (targetPath: string) => Promise<string>
	isPackaged: boolean
	currentVersion: string
	platform: NodeJS.Platform
	arch: NodeJS.Architecture
	channel: 'dev' | 'beta' | 'stable'
	policyBaseUrl: string
	manifestPublicKey: string
	fetchImpl?: typeof fetch
	now?: () => number
	randomId?: () => string
	random?: () => number
	setTimeoutImpl?: typeof setTimeout
	clearTimeoutImpl?: typeof clearTimeout
	setIntervalImpl?: typeof setInterval
	clearIntervalImpl?: typeof clearInterval
	onStateChange?: (state: UpdateState) => void
	onError?: (message: string) => void
	createNsisUpdater?: () => Promise<NsisUpdaterPort>
	withInstallGuard?: (
		intent: InstallIntent,
		operation: (canInstall: () => Promise<boolean>) => Promise<void>,
	) => Promise<boolean>
}

interface VerifiedPolicy {
	release: UpdateReleaseView
	releaseId: string
	version: string
	mode: 'optional' | 'mandatory'
	percentage: number
	manifestUrl: string
	manifestSignature: string
	packageArtifact: CandidateArtifact
	manifest: CandidateManifest
	metadataArtifact?: CandidateArtifact
	eventToken: string
	eventInstallIdHash: string
	verifiedAt: number
}

interface CandidateArtifact {
	platform: 'darwin' | 'win32'
	arch: 'arm64' | 'x64'
	kind: string
	fileName: string
	url: string
	sha512: string
	size: number
}

interface CandidateManifest {
	schemaVersion: 1 | 2
	releaseId: string
	runtime: 'electron'
	channel: 'dev' | 'beta' | 'stable'
	version: string
	createdAt: string
	manifestUrl: string
	sourceCoordinates: {
		repository: string
		commit: string
		browserVersion: string
		extensionVersion: string
		releasePublicKeyFingerprint?: string
	}
	tests: Array<{
		name: string
		status: 'passed'
		url: string
	}>
	artifacts: CandidateArtifact[]
	distribution: { mode: 'manual-unsigned' | 'platform-unsigned' }
}

interface NormalizedPolicy {
	schemaVersion: 1 | 2
	id: string
	runtime: 'electron' | 'chromium'
	channel: 'dev' | 'beta' | 'stable'
	releaseId: string
	version: string
	percentage: 1 | 5 | 25 | 50 | 100
	mode: 'optional' | 'mandatory'
	minSupportedVersion?: string
	title: string
	notes: string
	manifestUrl: string
	manifestSignature: string
	artifacts: CandidateArtifact[]
	distribution?: { mode: 'manual-unsigned' | 'platform-unsigned' }
	publishedAt: string
	checkedAt: string
	validUntil: string
	eventToken: string
}

interface DownloadedInstaller {
	releaseId: string
	path: string
	sha512: string
	size: number
}

interface DownloadedNsisInstaller extends DownloadedInstaller {
	updater: NsisUpdaterPort
	detachListeners: () => void
	error: Error | null
	handoffFailureRecorded: boolean
}

type UpdateOperation = 'check' | 'download' | 'openInstaller'

interface PersistedMandatoryPolicy {
	schemaVersion: 1
	verifiedAt: number
	percentage: 100
	manifestSignature: string
	release: UpdateReleaseView & { mode: 'mandatory' }
	manifest: CandidateManifest
	eventToken: string
	eventInstallIdHash: string
}

export class DesktopUpdateService {
	private readonly fetchImpl: typeof fetch
	private readonly now: () => number
	private readonly randomId: () => string
	private readonly random: () => number
	private readonly setTimeoutImpl: typeof setTimeout
	private readonly clearTimeoutImpl: typeof clearTimeout
	private readonly setIntervalImpl: typeof setInterval
	private readonly clearIntervalImpl: typeof clearInterval
	private readonly listeners = new Set<(state: UpdateState) => void>()
	private updateState: UpdateState = { phase: 'idle' }
	private verifiedPolicy: VerifiedPolicy | null = null
	private staleMandatoryPolicy: VerifiedPolicy | null = null
	private startupTimer: ReturnType<typeof setTimeout> | null = null
	private checkTimer: ReturnType<typeof setInterval> | null = null
	private mandatoryFreshnessTimer: ReturnType<typeof setTimeout> | null = null
	private retryTimer: ReturnType<typeof setTimeout> | null = null
	private checkPromise: Promise<UpdateState> | null = null
	private restorePromise: Promise<void> | null = null
	private installIdPromise: Promise<string> | null = null
	private operation: UpdateOperation | null = null
	private pendingCheckReason: Exclude<UpdateCheckReason, 'manual'> | null = null
	private pendingAutomaticDownload = false
	private downloadedInstaller: DownloadedInstaller | null = null
	private downloadedNsisInstaller: DownloadedNsisInstaller | null = null
	private activeDownloadController: AbortController | null = null
	private activeNsisCancellationToken: CancellationToken | null = null
	private stopEpoch = 0
	private started = false

	constructor(private readonly options: DesktopUpdateServiceOptions) {
		this.fetchImpl = options.fetchImpl ?? fetch
		this.now = options.now ?? Date.now
		this.randomId = options.randomId ?? randomUUID
		this.random = options.random ?? Math.random
		this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout
		this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout
		this.setIntervalImpl = options.setIntervalImpl ?? setInterval
		this.clearIntervalImpl = options.clearIntervalImpl ?? clearInterval
	}

	start(): void {
		if (this.started) return
		this.started = true

		if (!this.options.isPackaged) {
			return
		}
		if (!this.options.manifestPublicKey.trim()) {
			this.setState({
				phase: 'error',
				message: '此构建未固定更新签名公钥，更新检查不可用。',
				retryable: false,
			})
			return
		}

		this.restorePromise = this.restoreMandatoryPolicy()
			.then(() => this.cleanupOrphanedInstallers(undefined, true))
			.catch((error) => {
				this.options.onError?.(toMessage(error, '更新恢复状态失败'))
			})

		this.startupTimer = this.setTimeoutImpl(() => {
			void this.check('startup').catch(() => undefined)
		}, STARTUP_CHECK_DELAY_MS)
		this.checkTimer = this.setIntervalImpl(() => {
			void this.check('timer').catch(() => undefined)
		}, CHECK_INTERVAL_MS)
	}

	stop(): void {
		this.started = false
		this.stopEpoch += 1
		this.pendingAutomaticDownload = false
		this.pendingCheckReason = null
		this.activeDownloadController?.abort()
		this.activeDownloadController = null
		this.activeNsisCancellationToken?.cancel()
		if (this.startupTimer) {
			this.clearTimeoutImpl(this.startupTimer)
			this.startupTimer = null
		}
		if (this.checkTimer) {
			this.clearIntervalImpl(this.checkTimer)
			this.checkTimer = null
		}
		this.clearMandatoryFreshnessTimer()
		this.clearRetryTimer()
	}

	state(): UpdateState {
		return this.updateState
	}

	async assertWorkspaceAllowed(): Promise<void> {
		await this.waitForRestore()
		const policy = this.verifiedPolicy ?? this.staleMandatoryPolicy
		if (
			policy?.mode === 'mandatory' &&
			this.now() - policy.verifiedAt <= POLICY_FRESHNESS_MS &&
			isMandatoryReleaseState(this.updateState)
		) {
			throw new Error('当前版本必须完成更新后才能启动问学工作区。')
		}
	}

	subscribe(listener: (state: UpdateState) => void): () => void {
		this.listeners.add(listener)
		listener(this.updateState)
		return () => this.listeners.delete(listener)
	}

	check(reason: UpdateCheckReason = 'manual'): Promise<UpdateState> {
		if (this.checkPromise) {
			this.rememberPendingCheck(reason)
			return this.checkPromise
		}
		if (this.operation) {
			this.rememberPendingCheck(reason)
			return Promise.resolve(this.updateState)
		}
		this.operation = 'check'
		this.checkPromise = this.waitForRestore()
			.then(() => this.performCheck(reason))
			.finally(() => {
				if (this.operation === 'check') this.operation = null
				this.checkPromise = null
				if (this.pendingAutomaticDownload) {
					this.pendingAutomaticDownload = false
					void this.download().catch(() => undefined)
				}
				this.runPendingCheck()
			})
		return this.checkPromise
	}

	async download(): Promise<UpdateState> {
		this.beginExclusiveOperation('download')
		const downloadEpoch = this.stopEpoch
		let downloadReleaseId: string | null = null
		try {
			await this.waitForRestore()
			this.assertDownloadNotStopped(downloadEpoch)
			const current = this.verifiedPolicy
			if (!current || this.updateState.phase !== 'available') {
				throw new Error('当前没有可下载的更新，请先检查更新。')
			}
			const verified = await this.revalidateCurrentPolicy(current, 'download')
			this.assertDownloadNotStopped(downloadEpoch)
			await this.rememberVerifiedPolicy(verified)
			this.setState({
				phase: 'downloading',
				release: verified.release,
				progress: {
					percent: 0,
					transferred: 0,
					total: verified.packageArtifact.size,
					bytesPerSecond: 0,
				},
			})
			downloadReleaseId = verified.releaseId
			this.recordEvent('download', 'start', downloadReleaseId)
			if (verified.manifest.schemaVersion === 2 && this.options.platform === 'win32') {
				this.downloadedNsisInstaller = await this.downloadNsisInstaller(verified, downloadEpoch)
				this.downloadedInstaller = this.downloadedNsisInstaller
			} else {
				this.downloadedInstaller = await this.downloadInstaller(verified)
			}
			this.assertDownloadNotStopped(downloadEpoch)
			const finalPolicy =
				verified.manifest.schemaVersion === 2
					? await this.revalidateCurrentPolicy(verified, 'download')
					: verified
			if (finalPolicy !== verified) await this.rememberVerifiedPolicy(finalPolicy)
			this.assertDownloadNotStopped(downloadEpoch)
			this.setState({ phase: 'ready', release: finalPolicy.release })
			this.recordEvent('download', 'success', downloadReleaseId)
			return this.updateState
		} catch (error) {
			if (downloadEpoch !== this.stopEpoch && this.downloadedInstaller) {
				await this.invalidateDownloadedInstaller()
			}
			this.recordEvent('download', 'failure', downloadReleaseId ?? undefined)
			if (this.updateState.phase !== 'idle' && this.updateState.phase !== 'error') {
				this.fail(error, '更新下载失败，请检查网络后重试。', true)
			}
			throw error
		} finally {
			this.endExclusiveOperation('download')
		}
	}

	private assertDownloadNotStopped(epoch: number): void {
		if (epoch !== this.stopEpoch) throw new Error('更新下载已取消。')
	}

	async openInstaller(): Promise<UpdateState> {
		if (this.options.platform === 'win32' && this.verifiedPolicy?.manifest.schemaVersion === 2) {
			throw new Error('Windows 更新请使用重启更新或退出时安装。')
		}
		this.beginExclusiveOperation('openInstaller')
		let handoffReleaseId: string | undefined
		let handoffAccepted = false
		try {
			await this.waitForRestore()
			const current = this.verifiedPolicy
			if (
				!current ||
				(this.updateState.phase !== 'ready' && this.updateState.phase !== 'handedOff')
			) {
				throw new Error('更新尚未下载完成。')
			}
			const verified = await this.revalidateCurrentPolicy(current, 'openInstaller')
			await this.rememberVerifiedPolicy(verified)
			const downloaded = this.downloadedInstaller
			if (
				!downloaded ||
				downloaded.releaseId !== verified.releaseId ||
				downloaded.sha512 !== verified.packageArtifact.sha512 ||
				downloaded.size !== verified.packageArtifact.size
			) {
				await this.invalidateDownloadedInstaller()
				this.setState({ phase: 'available', release: verified.release })
				throw new Error('已下载的安装包与当前发布策略不一致，请重新下载。')
			}
			try {
				await verifyLocalInstaller(downloaded, verified.packageArtifact)
			} catch (error) {
				await this.invalidateDownloadedInstaller()
				this.setState({ phase: 'available', release: verified.release })
				throw error
			}
			this.setState({ phase: 'opening', release: verified.release })
			handoffReleaseId = verified.releaseId
			this.recordEvent('handoff', 'start', handoffReleaseId)
			if (verified.manifest.schemaVersion === 2) {
				await this.guardedHandoff('open-dmg', current, async () => {
					const openError = await this.options.openPath(downloaded.path)
					if (openError.length > 0) throw new Error(openError)
				})
			} else {
				const openError = await this.options.openPath(downloaded.path)
				if (openError.length > 0) throw new Error(openError)
			}
			handoffAccepted = true
			this.recordEvent('handoff', 'success', handoffReleaseId)
			this.setState({ phase: 'handedOff', release: verified.release })
			return this.updateState
		} catch (error) {
			if (handoffReleaseId && !handoffAccepted) {
				this.recordEvent('handoff', 'failure', handoffReleaseId)
			}
			if (error instanceof UpdateHandoffCancelledError && this.updateState.phase === 'opening') {
				if (this.verifiedPolicy)
					this.setState({ phase: 'ready', release: this.verifiedPolicy.release })
			} else if (this.updateState.phase === 'opening') {
				this.fail(error, '无法打开安装包，请稍后重试。', true)
			}
			throw error
		} finally {
			this.endExclusiveOperation('openInstaller')
		}
	}

	async restartInstall(): Promise<UpdateState> {
		await this.handoffNsis('restart')
		return this.updateState
	}

	async installOnQuit(): Promise<boolean> {
		if (this.options.platform !== 'win32' || this.verifiedPolicy?.manifest.schemaVersion !== 2) {
			return false
		}
		try {
			await this.handoffNsis('quit')
			return true
		} catch (error) {
			this.options.onError?.(toMessage(error, '退出时更新失败'))
			return false
		}
	}

	private async performCheck(reason: UpdateCheckReason): Promise<UpdateState> {
		if (!this.options.isPackaged) {
			if (reason === 'manual') throw new Error(DEVELOPMENT_UPDATE_MESSAGE)
			return this.updateState
		}
		if (!this.options.manifestPublicKey.trim()) return this.updateState
		if (this.updateState.phase === 'downloading' || this.updateState.phase === 'opening') {
			return this.updateState
		}
		const previousState = this.updateState
		if (!isMandatoryReleaseState(previousState)) this.setState({ phase: 'checking' })
		try {
			const policy = await this.fetchAndVerifyPolicy()
			this.clearRetryTimer()
			if (!policy) {
				await this.rememberVerifiedPolicy(null)
				await this.cleanupOrphanedInstallers().catch((error) => {
					this.options.onError?.(toMessage(error, '无法清理过期更新安装包'))
				})
				this.setState({ phase: 'idle' })
				return this.updateState
			}

			let keepDownloaded =
				this.verifiedPolicy?.releaseId === policy.releaseId &&
				this.verifiedPolicy.manifestSignature === policy.manifestSignature &&
				this.verifiedPolicy.metadataArtifact?.sha512 === policy.metadataArtifact?.sha512 &&
				this.downloadedInstaller?.releaseId === policy.releaseId &&
				this.downloadedInstaller.sha512 === policy.packageArtifact.sha512 &&
				this.downloadedInstaller.size === policy.packageArtifact.size
			await this.rememberVerifiedPolicy(policy)
			if (policy.manifest.schemaVersion === 2 && this.options.platform === 'win32') {
				keepDownloaded = Boolean(
					this.downloadedNsisInstaller &&
					this.downloadedNsisInstaller.error === null &&
					keepDownloaded,
				)
				if (!keepDownloaded && this.downloadedNsisInstaller) {
					await this.invalidateDownloadedInstaller()
				}
			} else if (!keepDownloaded) {
				this.downloadedInstaller = await this.restoreDownloadedInstaller(policy)
				keepDownloaded = this.downloadedInstaller !== null
			}
			if (keepDownloaded && policy.manifest.schemaVersion === 2 && this.downloadedInstaller) {
				try {
					await verifyLocalInstaller(this.downloadedInstaller, policy.packageArtifact)
				} catch (error) {
					this.options.onError?.(toMessage(error, '已缓存更新安装包无效，需重新下载'))
					await this.invalidateDownloadedInstaller()
					keepDownloaded = false
				}
			}
			await this.cleanupOrphanedInstallers(this.downloadedInstaller?.path).catch((error) => {
				this.options.onError?.(toMessage(error, '无法清理旧版更新安装包'))
			})
			this.setState(
				keepDownloaded
					? {
							phase: previousState.phase === 'handedOff' ? 'handedOff' : 'ready',
							release: policy.release,
						}
					: { phase: 'available', release: policy.release },
			)
			this.recordEvent('check', 'success', policy.releaseId)
			if (policy.manifest.schemaVersion === 2 && !keepDownloaded && this.started) {
				this.pendingAutomaticDownload = true
			}
			return this.updateState
		} catch (error) {
			if (error instanceof UpdateRateLimitError) this.scheduleRateLimitRetry(error.retryAfterMs)
			const cached = this.verifiedPolicy ?? this.staleMandatoryPolicy
			this.recordEvent('check', 'failure', cached?.releaseId)
			if (cached?.mode === 'mandatory' && this.now() - cached.verifiedAt <= POLICY_FRESHNESS_MS) {
				this.options.onError?.(toMessage(error, '强制更新策略复核失败，继续使用最近一次有效策略。'))
				this.setState(
					isMandatoryReleaseState(previousState)
						? previousState
						: { phase: 'available', release: cached.release },
				)
				return this.updateState
			}
			if (cached?.mode === 'mandatory') {
				this.verifiedPolicy = null
				this.staleMandatoryPolicy = cached
				this.clearMandatoryFreshnessTimer()
				this.fail(new Error(STALE_MANDATORY_MESSAGE), STALE_MANDATORY_MESSAGE)
			} else {
				this.fail(error, '更新检查失败，请检查网络后重试。', Boolean(cached))
			}
			return this.updateState
		}
	}

	private async fetchAndVerifyPolicy(): Promise<VerifiedPolicy | null> {
		const platform = normalizePlatform(this.options.platform)
		const arch = normalizeArch(this.options.arch)
		const url = new URL('/v1/client/update-policy', requireHttpsBaseUrl(this.options.policyBaseUrl))
		url.searchParams.set('runtime', 'electron')
		url.searchParams.set('platform', platform)
		url.searchParams.set('arch', arch)
		url.searchParams.set('channel', this.options.channel)
		url.searchParams.set('version', this.options.currentVersion)
		url.searchParams.set('protocolVersion', '2')
		const eventInstallIdHash = await this.eventInstallIdHash(this.options.currentVersion)
		url.searchParams.set('installIdHash', eventInstallIdHash)

		const payload = await this.fetchJson(url)
		if (!isRecord(payload) || !hasOwn(payload, 'policy') || payload.policy === undefined) {
			throw new Error('更新服务返回了无效策略响应。')
		}
		if (payload.policy === null) return null
		const policyRecord = requireRecord(payload.policy, '更新策略')
		const normalized = normalizePolicy(policyRecord)
		const checkedAt = Date.parse(normalized.checkedAt)
		const validUntil = Date.parse(normalized.validUntil)
		if (
			checkedAt > this.now() + MAX_CLOCK_SKEW_MS ||
			validUntil - checkedAt > POLICY_FRESHNESS_MS
		) {
			throw new Error('更新策略有效期超过允许范围。')
		}
		if (validUntil <= this.now()) {
			throw new Error('更新策略已过期，请重新检查。')
		}
		if (normalized.runtime !== 'electron' || normalized.channel !== this.options.channel) {
			throw new Error('更新策略与当前运行通道不匹配。')
		}
		if (compareSemver(normalized.version, this.options.currentVersion) <= 0) return null
		if (normalized.schemaVersion === 2 && normalized.mode !== 'optional') {
			throw new Error('新更新协议只允许可选更新。')
		}
		if (normalized.mode === 'mandatory' && normalized.percentage !== 100) {
			throw new Error('强制更新策略必须全量发布。')
		}

		const installId = await this.installId()
		if (rolloutBucket(normalized.releaseId, installId) >= normalized.percentage) return null
		const manifest = await this.fetchAndVerifyManifest(normalized)
		const targetArtifacts = manifest.artifacts.filter(
			(artifact) => artifact.platform === platform && artifact.arch === arch,
		)
		if (
			manifest.releaseId !== normalized.releaseId ||
			manifest.version !== normalized.version ||
			manifest.channel !== normalized.channel ||
			manifest.manifestUrl !== normalized.manifestUrl ||
			normalized.artifacts.some(
				(artifact) => artifact.platform !== platform || artifact.arch !== arch,
			) ||
			canonicalArtifactSet(targetArtifacts) !== canonicalArtifactSet(normalized.artifacts)
		) {
			throw new Error('签名候选与发布策略不一致。')
		}
		const expectedKind = platform === 'darwin' ? 'dmg' : 'nsis'
		const packageArtifacts = targetArtifacts.filter((artifact) => artifact.kind === expectedKind)
		const expectedCount = normalized.schemaVersion === 2 && platform === 'win32' ? 2 : 1
		if (packageArtifacts.length !== 1 || targetArtifacts.length !== expectedCount) {
			throw new Error('签名候选当前平台产物集合无效。')
		}
		const packageArtifact = packageArtifacts[0]
		const metadataArtifact = targetArtifacts.find((artifact) => artifact.kind === 'nsis-yaml')
		if (normalized.schemaVersion === 2) {
			if (manifest.schemaVersion !== 2 || manifest.distribution.mode !== 'platform-unsigned') {
				throw new Error('新策略与签名候选模式不一致。')
			}
			if (platform === 'win32' && !metadataArtifact) throw new Error('缺少 Windows 更新元数据。')
		} else if (manifest.schemaVersion !== 1) {
			throw new Error('旧策略与签名候选模式不一致。')
		}
		return {
			release: {
				releaseId: normalized.releaseId,
				version: normalized.version,
				channel: normalized.channel,
				mode: normalized.mode,
				distribution: manifest.distribution,
				installAction:
					manifest.schemaVersion === 1
						? 'open-installer'
						: platform === 'darwin'
							? 'open-dmg'
							: 'restart',
				title: normalized.title,
				notes: normalized.notes,
				size: packageArtifact.size,
			},
			releaseId: normalized.releaseId,
			version: normalized.version,
			mode: normalized.mode,
			percentage: normalized.percentage,
			manifestUrl: normalized.manifestUrl,
			manifestSignature: normalized.manifestSignature,
			packageArtifact,
			metadataArtifact,
			manifest,
			eventToken: normalized.eventToken,
			eventInstallIdHash,
			verifiedAt: this.now(),
		}
	}

	private async revalidateCurrentPolicy(
		current: VerifiedPolicy,
		action: 'download' | 'openInstaller',
	): Promise<VerifiedPolicy> {
		try {
			const next = await this.fetchAndVerifyPolicy()
			if (
				!next ||
				next.releaseId !== current.releaseId ||
				next.manifestSignature !== current.manifestSignature ||
				next.packageArtifact.sha512 !== current.packageArtifact.sha512 ||
				next.packageArtifact.size !== current.packageArtifact.size ||
				next.metadataArtifact?.sha512 !== current.metadataArtifact?.sha512
			) {
				await this.rememberVerifiedPolicy(null)
				this.setState({ phase: 'idle' })
				throw new Error(
					`更新已被暂停、撤回或替换，无法继续${action === 'download' ? '下载' : '打开安装包'}。`,
				)
			}
			return next
		} catch (error) {
			if (current.mode === 'mandatory') {
				if (this.now() - current.verifiedAt <= POLICY_FRESHNESS_MS) {
					if (action === 'download' && isConnectivityError(error)) return current
					throw error
				}
				this.verifiedPolicy = null
				this.fail(new Error(STALE_MANDATORY_MESSAGE), STALE_MANDATORY_MESSAGE)
				throw new Error(STALE_MANDATORY_MESSAGE)
			}
			if (!isConnectivityError(error)) {
				await this.rememberVerifiedPolicy(null)
				this.setState({ phase: 'idle' })
			}
			throw error
		}
	}

	private async waitForRestore(): Promise<void> {
		await this.restorePromise
	}

	private beginExclusiveOperation(operation: Exclude<UpdateOperation, 'check'>): void {
		if (this.operation) throw new Error('另一项更新操作正在进行，请稍候。')
		this.operation = operation
	}

	private endExclusiveOperation(operation: UpdateOperation): void {
		if (this.operation === operation) {
			this.operation = null
			this.runPendingCheck()
		}
	}

	private async rememberVerifiedPolicy(policy: VerifiedPolicy | null): Promise<void> {
		if (this.downloadedInstaller && this.downloadedInstaller.releaseId !== policy?.releaseId) {
			await this.invalidateDownloadedInstaller()
		}
		this.verifiedPolicy = policy
		this.staleMandatoryPolicy = null
		this.scheduleMandatoryFreshnessCheck(policy)
		try {
			if (policy?.mode === 'mandatory') {
				const persisted: PersistedMandatoryPolicy = {
					schemaVersion: 1,
					verifiedAt: policy.verifiedAt,
					percentage: 100,
					manifestSignature: policy.manifestSignature,
					release: { ...policy.release, mode: 'mandatory' },
					manifest: policy.manifest,
					eventToken: policy.eventToken,
					eventInstallIdHash: policy.eventInstallIdHash,
				}
				await writeFileAtomically(
					this.options.paths.dataFile(MANDATORY_POLICY_FILE),
					`${JSON.stringify(persisted)}\n`,
					this.randomId,
				)
			} else {
				await unlinkIfExists(this.options.paths.dataFile(MANDATORY_POLICY_FILE))
			}
		} catch (error) {
			this.options.onError?.(toMessage(error, '无法保存强制更新状态'))
		}
	}

	private async restoreMandatoryPolicy(): Promise<void> {
		const filePath = this.options.paths.dataFile(MANDATORY_POLICY_FILE)
		let payload: unknown
		try {
			payload = JSON.parse(await readFile(filePath, 'utf8')) as unknown
		} catch (error) {
			if (isMissingFile(error)) return
			await unlinkIfExists(filePath)
			this.options.onError?.(toMessage(error, '无法恢复强制更新状态'))
			return
		}

		try {
			const restored = verifyPersistedMandatoryPolicy(payload, {
				publicKey: this.options.manifestPublicKey,
				platform: normalizePlatform(this.options.platform),
				arch: normalizeArch(this.options.arch),
				channel: this.options.channel,
			})
			if (compareSemver(restored.version, this.options.currentVersion) <= 0) {
				this.staleMandatoryPolicy = null
				await unlinkIfExists(filePath)
				return
			}
			if (
				restored.verifiedAt > this.now() + MAX_CLOCK_SKEW_MS ||
				this.now() - restored.verifiedAt > POLICY_FRESHNESS_MS
			) {
				this.verifiedPolicy = null
				this.staleMandatoryPolicy = restored
				this.setState({ phase: 'error', message: STALE_MANDATORY_MESSAGE, retryable: true })
				return
			}
			this.verifiedPolicy = restored
			this.staleMandatoryPolicy = null
			this.scheduleMandatoryFreshnessCheck(restored)
			this.setState({ phase: 'available', release: restored.release })
		} catch (error) {
			this.staleMandatoryPolicy = null
			await unlinkIfExists(filePath)
			this.options.onError?.(toMessage(error, '强制更新缓存无效，已忽略'))
		}
	}

	private async fetchAndVerifyManifest(input: {
		manifestUrl: string
		manifestSignature: string
	}): Promise<CandidateManifest> {
		const payload = await this.fetchJson(new URL(requireHttpsUrl(input.manifestUrl, '候选清单')))
		if (
			!hasValidManifestSignature(payload, input.manifestSignature, this.options.manifestPublicKey)
		) {
			throw new Error('候选清单签名无效，已拒绝更新。')
		}
		return normalizeManifest(payload)
	}

	private async downloadInstaller(policy: VerifiedPolicy): Promise<DownloadedInstaller> {
		const artifact = policy.packageArtifact
		const installerDirectory = this.options.paths.dataFile(INSTALLER_DIRECTORY)
		await mkdir(installerDirectory, { recursive: true, mode: 0o700 })
		const downloaded = this.downloadedInstallerForPolicy(policy)
		const finalPath = downloaded.path

		try {
			await verifyLocalInstaller(downloaded, artifact)
			return downloaded
		} catch (error) {
			if (!isMissingFile(error)) await unlinkIfExists(finalPath)
		}

		const temporaryPath = `${finalPath}.${this.randomId()}.part`
		const controller = new AbortController()
		this.activeDownloadController = controller
		const timeout = this.setTimeoutImpl(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
		let fileHandle: Awaited<ReturnType<typeof open>> | null = null
		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
		try {
			const response = await this.fetchImpl(new URL(requireHttpsUrl(artifact.url, '安装包地址')), {
				redirect: 'error',
				signal: controller.signal,
			})
			if (!response.ok) throw new Error(`安装包下载失败 (${response.status})`)
			if (!response.body) throw new Error('安装包下载响应缺少内容。')
			const contentLength = response.headers.get('content-length')
			if (contentLength !== null && Number(contentLength) !== artifact.size) {
				throw new Error('安装包响应大小与签名候选不一致。')
			}

			fileHandle = await open(temporaryPath, 'wx', 0o600)
			reader = response.body.getReader()
			const hash = createHash('sha512')
			let transferred = 0
			const startedAt = performance.now()
			let lastProgressAt = startedAt
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				if (!value || value.byteLength === 0) continue
				transferred += value.byteLength
				if (transferred > artifact.size) {
					throw new Error('安装包超过签名候选声明的大小。')
				}
				const chunk = Buffer.from(value)
				hash.update(chunk)
				await writeAll(fileHandle, chunk)
				const progressAt = performance.now()
				if (
					this.updateState.phase === 'downloading' &&
					(transferred === artifact.size ||
						progressAt - lastProgressAt >= DOWNLOAD_PROGRESS_INTERVAL_MS)
				) {
					const elapsedSeconds = Math.max((progressAt - startedAt) / 1000, 0.001)
					lastProgressAt = progressAt
					this.setState({
						phase: 'downloading',
						release: policy.release,
						progress: {
							percent: Math.min(100, (transferred / artifact.size) * 100),
							transferred,
							total: artifact.size,
							bytesPerSecond: transferred / elapsedSeconds,
						},
					})
				}
			}

			if (transferred !== artifact.size || hash.digest('base64') !== artifact.sha512) {
				throw new Error('安装包 SHA-512 或大小校验失败，已拒绝打开。')
			}
			await fileHandle.sync()
			await fileHandle.close()
			fileHandle = null
			await unlinkIfExists(finalPath)
			await rename(temporaryPath, finalPath)
			return downloaded
		} finally {
			this.clearTimeoutImpl(timeout)
			if (this.activeDownloadController === controller) this.activeDownloadController = null
			if (fileHandle) await fileHandle.close().catch(() => undefined)
			if (reader) await reader.cancel().catch(() => undefined)
			await unlinkIfExists(temporaryPath).catch(() => undefined)
		}
	}

	private async downloadNsisInstaller(
		policy: VerifiedPolicy,
		downloadEpoch: number,
	): Promise<DownloadedNsisInstaller> {
		const metadata = policy.metadataArtifact
		if (!metadata) throw new Error('缺少 Windows 更新元数据。')
		const metadataUrl = requireImmutableHttpsUrl(metadata.url, 'Windows 更新元数据地址')
		const installerUrl = requireImmutableHttpsUrl(policy.packageArtifact.url, 'Windows 安装包地址')
		if (
			metadataUrl.href.slice(0, metadataUrl.href.lastIndexOf('/') + 1) !==
			installerUrl.href.slice(0, installerUrl.href.lastIndexOf('/') + 1)
		) {
			throw new Error('Windows 更新元数据与安装包不在同一候选目录。')
		}
		const response = await this.fetchWithTimeout(metadataUrl, undefined, MAX_UPDATE_METADATA_BYTES)
		if (!response.ok) throw new Error(`Windows 更新元数据请求失败 (${response.status})`)
		const bytes = Buffer.from(await response.arrayBuffer())
		if (
			bytes.byteLength > MAX_UPDATE_METADATA_BYTES ||
			bytes.byteLength !== metadata.size ||
			createHash('sha512').update(bytes).digest('base64') !== metadata.sha512
		) {
			throw new Error('Windows 更新元数据哈希或大小校验失败。')
		}
		const raw = JSON.parse(bytes.toString('utf8')) as unknown
		assertNsisMetadata(raw, policy, metadataUrl, installerUrl)
		this.assertDownloadNotStopped(downloadEpoch)
		const { CancellationToken } = await import('electron-updater')
		this.assertDownloadNotStopped(downloadEpoch)
		const cancellationToken = new CancellationToken()
		this.activeNsisCancellationToken = cancellationToken
		try {
			const updater = await (this.options.createNsisUpdater?.() ?? this.defaultNsisUpdater())
			this.assertDownloadNotStopped(downloadEpoch)
			updater.autoDownload = false
			updater.autoInstallOnAppQuit = false
			updater.disableDifferentialDownload = true
			updater.disableWebInstaller = true
			updater.allowDowngrade = false
			let observedError: Error | null = null
			const onError = (error: Error) => {
				observedError = error
				const active = this.downloadedNsisInstaller
				if (active?.updater === updater) {
					active.error = error
					if (this.updateState.phase === 'handedOff' && !active.handoffFailureRecorded) {
						active.handoffFailureRecorded = true
						this.recordEvent('handoff', 'failure', active.releaseId)
					}
					if (this.updateState.phase === 'ready' || this.updateState.phase === 'handedOff') {
						this.fail(error, 'Windows 更新器发生错误。', true)
					}
				}
			}
			const onProgress = (progress: NsisDownloadProgress) => {
				if (this.updateState.phase === 'downloading') {
					this.setState({
						phase: 'downloading',
						release: policy.release,
						progress: {
							percent: Math.min(100, Math.max(0, progress.percent)),
							transferred: progress.transferred,
							total: progress.total,
							bytesPerSecond: progress.bytesPerSecond,
						},
					})
				}
			}
			updater.on('error', onError)
			updater.on('download-progress', onProgress)
			const detachListeners = () => {
				updater.removeListener('error', onError)
				updater.removeListener('download-progress', onProgress)
			}
			try {
				updater.setFeedURL({
					provider: 'generic',
					url: new URL('.', metadataUrl).href,
					channel: metadata.fileName.slice(0, -'.yml'.length),
				})
				const result = await updater.checkForUpdates()
				this.assertDownloadNotStopped(downloadEpoch)
				if (observedError) throw observedError
				if (!result?.isUpdateAvailable) throw new Error('Windows 更新器未找到签名候选版本。')
				assertNsisMetadata(result.updateInfo, policy, metadataUrl, installerUrl)
				const paths = await updater.downloadUpdate(cancellationToken)
				this.assertDownloadNotStopped(downloadEpoch)
				if (cancellationToken.cancelled) throw new Error('更新下载已取消。')
				if (observedError) throw observedError
				if (paths.length !== 1) throw new Error('Windows 更新器下载路径数量无效。')
				const downloaded: DownloadedNsisInstaller = {
					releaseId: policy.releaseId,
					path: paths[0],
					sha512: policy.packageArtifact.sha512,
					size: policy.packageArtifact.size,
					updater,
					detachListeners,
					error: null,
					handoffFailureRecorded: false,
				}
				await verifyLocalInstaller(downloaded, policy.packageArtifact)
				this.assertDownloadNotStopped(downloadEpoch)
				return downloaded
			} catch (error) {
				detachListeners()
				throw error
			}
		} finally {
			if (this.activeNsisCancellationToken === cancellationToken) {
				this.activeNsisCancellationToken = null
			}
		}
	}

	private async defaultNsisUpdater(): Promise<NsisUpdaterPort> {
		const { NsisUpdater } = await import('electron-updater')
		return new NsisUpdater() as NsisUpdaterPort
	}

	private async guardedHandoff(
		intent: InstallIntent,
		current: VerifiedPolicy,
		handoff: () => Promise<void>,
	): Promise<void> {
		const guard = this.options.withInstallGuard
		if (!guard) throw new Error('安全退出协调不可用，无法交接更新。')
		let handedOff = false
		const accepted = await guard(intent, async (canInstall) => {
			const verified = await this.revalidateCurrentPolicy(current, 'openInstaller')
			await this.rememberVerifiedPolicy(verified)
			const downloaded = this.downloadedInstaller
			if (
				!downloaded ||
				downloaded.releaseId !== verified.releaseId ||
				downloaded.sha512 !== verified.packageArtifact.sha512 ||
				downloaded.size !== verified.packageArtifact.size
			) {
				throw new Error('安装包与当前策略不一致。')
			}
			await verifyLocalInstaller(downloaded, verified.packageArtifact)
			if (!(await canInstall())) throw new UpdateHandoffCancelledError()
			await handoff()
			handedOff = true
		})
		if (!accepted || !handedOff) throw new UpdateHandoffCancelledError()
	}

	private async handoffNsis(intent: 'restart' | 'quit'): Promise<void> {
		this.beginExclusiveOperation('openInstaller')
		let handoffStarted = false
		let handoffDownload: DownloadedNsisInstaller | null = null
		try {
			const current = this.verifiedPolicy
			if (
				!current ||
				current.manifest.schemaVersion !== 2 ||
				this.options.platform !== 'win32' ||
				this.updateState.phase !== 'ready' ||
				!this.downloadedNsisInstaller
			) {
				throw new Error('Windows 更新尚未下载完成。')
			}
			const downloaded = this.downloadedNsisInstaller
			handoffDownload = downloaded
			const updater = downloaded.updater
			await this.guardedHandoff(intent, current, async () => {
				if (downloaded.error) throw downloaded.error
				handoffStarted = true
				this.recordEvent('handoff', 'start', current.releaseId)
				updater.quitAndInstall(true, intent === 'restart')
				if (downloaded.error) throw downloaded.error
			})
			this.recordEvent('handoff', 'success', current.releaseId)
			this.setState({ phase: 'handedOff', release: current.release })
		} catch (error) {
			if (
				handoffStarted &&
				!(error instanceof UpdateHandoffCancelledError) &&
				!handoffDownload?.handoffFailureRecorded
			) {
				handoffDownload!.handoffFailureRecorded = true
				this.recordEvent('handoff', 'failure', handoffDownload!.releaseId)
			}
			if (!(error instanceof UpdateHandoffCancelledError) && this.updateState.phase !== 'idle') {
				this.fail(error, 'Windows 更新交接失败。', true)
			}
			throw error
		} finally {
			this.endExclusiveOperation('openInstaller')
		}
	}

	private async invalidateDownloadedInstaller(): Promise<void> {
		const downloaded = this.downloadedInstaller
		this.downloadedInstaller = null
		this.downloadedNsisInstaller?.detachListeners()
		this.downloadedNsisInstaller = null
		if (!downloaded) return
		try {
			await unlinkIfExists(downloaded.path)
		} catch (error) {
			this.options.onError?.(toMessage(error, '无法清理已失效的更新安装包'))
		}
	}

	private downloadedInstallerForPolicy(policy: VerifiedPolicy): DownloadedInstaller {
		const artifact = policy.packageArtifact
		const fileName = requireInstallerFileName(artifact.fileName, artifact.kind)
		const releaseKey = createHash('sha256').update(policy.releaseId).digest('hex').slice(0, 24)
		return {
			releaseId: policy.releaseId,
			path: path.join(
				this.options.paths.dataFile(INSTALLER_DIRECTORY),
				`${releaseKey}-${fileName}`,
			),
			sha512: artifact.sha512,
			size: artifact.size,
		}
	}

	private async restoreDownloadedInstaller(
		policy: VerifiedPolicy,
	): Promise<DownloadedInstaller | null> {
		const downloaded = this.downloadedInstallerForPolicy(policy)
		try {
			await verifyLocalInstaller(downloaded, policy.packageArtifact)
			return downloaded
		} catch (error) {
			if (!isMissingFile(error)) {
				await unlinkIfExists(downloaded.path).catch(() => undefined)
				this.options.onError?.(toMessage(error, '已缓存更新安装包无效，需重新下载'))
			}
			return null
		}
	}

	private async cleanupOrphanedInstallers(keepPath?: string, partialsOnly = false): Promise<void> {
		const installerDirectory = this.options.paths.dataFile(INSTALLER_DIRECTORY)
		let entries
		try {
			entries = await readdir(installerDirectory, { withFileTypes: true })
		} catch (error) {
			if (isMissingFile(error)) return
			throw error
		}
		const results = await Promise.allSettled(
			entries.flatMap((entry) => {
				if (!entry.isFile() && !entry.isSymbolicLink()) return []
				const entryPath = path.join(installerDirectory, entry.name)
				if (keepPath && path.resolve(entryPath) === path.resolve(keepPath)) return []
				if (partialsOnly && !entry.name.endsWith('.part')) return []
				return [unlink(entryPath)]
			}),
		)
		const failure = results.find((result) => result.status === 'rejected')
		if (failure?.status === 'rejected') throw failure.reason
	}

	private async fetchJson(url: URL): Promise<unknown> {
		const response = await this.fetchWithTimeout(url)
		if (!response.ok) {
			if (response.status === 429) {
				throw new UpdateRateLimitError(
					readRetryAfterMs(response.headers.get('retry-after'), this.now()),
				)
			}
			throw new Error(`更新服务请求失败 (${response.status})`)
		}
		return response.json() as Promise<unknown>
	}

	private async fetchWithTimeout(
		url: URL,
		init?: RequestInit,
		maxBytes?: number,
	): Promise<Response> {
		const controller = new AbortController()
		const timeout = this.setTimeoutImpl(() => controller.abort(), REQUEST_TIMEOUT_MS)
		try {
			const response = await this.fetchImpl(url, {
				...init,
				redirect: 'error',
				signal: controller.signal,
			})
			if (maxBytes && Number(response.headers.get('content-length')) > maxBytes) {
				throw new Error('更新元数据超过大小上限。')
			}
			let body: ArrayBuffer
			if (maxBytes && response.body) {
				const reader = response.body.getReader()
				const chunks: Buffer[] = []
				let total = 0
				try {
					while (true) {
						const { done, value } = await reader.read()
						if (done) break
						total += value.byteLength
						if (total > maxBytes) throw new Error('更新元数据超过大小上限。')
						chunks.push(Buffer.from(value))
					}
				} finally {
					await reader.cancel().catch(() => undefined)
				}
				body = Uint8Array.from(Buffer.concat(chunks)).buffer
			} else {
				body = await response.arrayBuffer()
			}
			return new Response(body.byteLength > 0 ? body : null, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			})
		} finally {
			this.clearTimeoutImpl(timeout)
		}
	}

	private installId(): Promise<string> {
		this.installIdPromise ??= readOrCreateInstallId(
			this.options.paths.dataFile('update-install-id'),
			this.randomId,
		)
		return this.installIdPromise
	}

	private recordEvent(stage: string, result: string, releaseId?: string): void {
		if (!releaseId) return
		const policy = [this.verifiedPolicy, this.staleMandatoryPolicy].find(
			(value) => value?.releaseId === releaseId,
		)
		if (!policy) return
		void this.sendEvent(
			stage,
			result,
			releaseId,
			this.options.currentVersion,
			policy.eventToken,
			policy.eventInstallIdHash,
		).catch((error) => {
			this.options.onError?.(toMessage(error, '更新事件上报失败'))
		})
	}

	private async sendEvent(
		stage: string,
		result: string,
		releaseId: string,
		fromVersion: string,
		eventToken: string,
		installIdHash: string,
	): Promise<void> {
		const url = new URL('/v1/client/update-events', requireHttpsBaseUrl(this.options.policyBaseUrl))
		const response = await this.fetchWithTimeout(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				releaseId,
				installIdHash,
				runtime: 'electron',
				platform: normalizePlatform(this.options.platform),
				arch: normalizeArch(this.options.arch),
				fromVersion,
				stage,
				result,
				eventToken,
			}),
		})
		if (!response.ok) throw new Error(`更新事件上报失败 (${response.status})`)
	}

	private async eventInstallIdHash(fromVersion: string): Promise<string> {
		const installId = await this.installId()
		return createHash('sha256')
			.update(
				['wenxue-update-event-v1', 'electron', this.options.channel, fromVersion, installId].join(
					'\0',
				),
			)
			.digest('hex')
	}

	private fail(error: unknown, fallback: string, preserveRelease = false): void {
		const message = toMessage(error, fallback)
		this.options.onError?.(message)
		this.setState({
			phase: 'error',
			message,
			retryable: true,
			...(preserveRelease && this.verifiedPolicy ? { release: this.verifiedPolicy.release } : {}),
		})
	}

	private setState(state: UpdateState): void {
		this.updateState = state
		this.options.onStateChange?.(state)
		this.listeners.forEach((listener) => listener(state))
	}

	private rememberPendingCheck(reason: UpdateCheckReason): void {
		if (reason === 'manual') return
		if (reason === 'signal' || this.pendingCheckReason === null) this.pendingCheckReason = reason
	}

	private runPendingCheck(): void {
		if (this.operation || this.checkPromise || !this.pendingCheckReason) return
		const reason = this.pendingCheckReason
		this.pendingCheckReason = null
		void this.check(reason).catch(() => undefined)
	}

	private scheduleMandatoryFreshnessCheck(policy: VerifiedPolicy | null): void {
		this.clearMandatoryFreshnessTimer()
		if (policy?.mode !== 'mandatory' || !this.started) return
		const delay = Math.max(0, policy.verifiedAt + POLICY_FRESHNESS_MS - this.now() + 1)
		this.mandatoryFreshnessTimer = this.setTimeoutImpl(() => {
			this.mandatoryFreshnessTimer = null
			void this.check('timer').catch(() => undefined)
		}, delay)
	}

	private clearMandatoryFreshnessTimer(): void {
		if (!this.mandatoryFreshnessTimer) return
		this.clearTimeoutImpl(this.mandatoryFreshnessTimer)
		this.mandatoryFreshnessTimer = null
	}

	private scheduleRateLimitRetry(retryAfterMs: number): void {
		if (!this.started || this.retryTimer) return
		const jitter = Math.floor(Math.max(0, Math.min(0.999_999, this.random())) * 60_000)
		this.retryTimer = this.setTimeoutImpl(() => {
			this.retryTimer = null
			void this.check('timer').catch(() => undefined)
		}, retryAfterMs + jitter)
	}

	private clearRetryTimer(): void {
		if (!this.retryTimer) return
		this.clearTimeoutImpl(this.retryTimer)
		this.retryTimer = null
	}
}

class UpdateRateLimitError extends Error {
	constructor(readonly retryAfterMs: number) {
		super('更新检查请求过于频繁，已安排自动重试。')
		this.name = 'UpdateRateLimitError'
	}
}

class UpdateHandoffCancelledError extends Error {
	constructor() {
		super('更新交接已取消。')
		this.name = 'UpdateHandoffCancelledError'
	}
}

function verifyPersistedMandatoryPolicy(
	value: unknown,
	input: {
		publicKey: string
		platform: 'darwin' | 'win32'
		arch: 'arm64' | 'x64'
		channel: 'dev' | 'beta' | 'stable'
	},
): VerifiedPolicy {
	const persisted = requireRecord(value, '强制更新缓存')
	if (persisted.schemaVersion !== 1 || persisted.percentage !== 100) {
		throw new Error('强制更新缓存版本无效。')
	}
	const verifiedAt = requirePositiveNumber(persisted.verifiedAt, '强制策略验证时间')
	const manifestSignature = requireString(persisted.manifestSignature, '候选清单签名')
	if (!hasValidManifestSignature(persisted.manifest, manifestSignature, input.publicKey)) {
		throw new Error('强制更新缓存中的候选签名无效。')
	}
	const manifest = normalizeManifest(persisted.manifest)
	if (manifest.channel !== input.channel) throw new Error('强制更新缓存通道不匹配。')
	const releaseRecord = requireRecord(persisted.release, '强制更新信息')
	if (releaseRecord.mode !== 'mandatory') throw new Error('强制更新缓存模式无效。')
	const release: UpdateReleaseView & { mode: 'mandatory' } = {
		releaseId: requireString(releaseRecord.releaseId, '发布 ID'),
		version: requireSemverString(releaseRecord.version, '版本'),
		channel: requireChannel(releaseRecord.channel),
		mode: 'mandatory',
		distribution: normalizeDistribution(releaseRecord.distribution),
		installAction: 'open-installer',
		title: requireString(releaseRecord.title, '更新标题'),
		notes: requireString(releaseRecord.notes, '更新说明'),
		size: requirePositiveNumber(releaseRecord.size, '更新大小'),
	}
	if (
		release.releaseId !== manifest.releaseId ||
		release.version !== manifest.version ||
		release.channel !== manifest.channel
	) {
		throw new Error('强制更新缓存与签名候选不一致。')
	}
	const targetArtifacts = manifest.artifacts.filter(
		(artifact) => artifact.platform === input.platform && artifact.arch === input.arch,
	)
	const expectedKind = input.platform === 'darwin' ? 'dmg' : 'nsis'
	const packageArtifact = targetArtifacts.find((artifact) => artifact.kind === expectedKind)
	if (!packageArtifact || targetArtifacts.length !== 1 || packageArtifact.size !== release.size) {
		throw new Error('强制更新缓存缺少当前平台的签名产物。')
	}

	return {
		release,
		releaseId: release.releaseId,
		version: release.version,
		mode: 'mandatory',
		percentage: 100,
		manifestUrl: manifest.manifestUrl,
		manifestSignature,
		packageArtifact,
		manifest,
		eventToken: requireString(persisted.eventToken, '更新事件凭证'),
		eventInstallIdHash: requireSha256(persisted.eventInstallIdHash, '安装标识摘要'),
		verifiedAt,
	}
}

function hasValidManifestSignature(
	manifest: unknown,
	signature: string,
	publicKey: string,
): boolean {
	try {
		return verifySignature(
			null,
			Buffer.from(canonicalJson(manifest)),
			readPublicKey(publicKey),
			Buffer.from(signature, 'base64'),
		)
	} catch {
		return false
	}
}

async function unlinkIfExists(filePath: string): Promise<void> {
	try {
		await unlink(filePath)
	} catch (error) {
		if (!isMissingFile(error)) throw error
	}
}

async function writeFileAtomically(
	filePath: string,
	contents: string,
	randomId: () => string,
): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
	const temporaryPath = `${filePath}.${randomId()}.tmp`
	let fileHandle: Awaited<ReturnType<typeof open>> | null = null
	try {
		fileHandle = await open(temporaryPath, 'wx', 0o600)
		await fileHandle.writeFile(contents, 'utf8')
		await fileHandle.sync()
		await fileHandle.close()
		fileHandle = null
		await rename(temporaryPath, filePath)
	} finally {
		if (fileHandle) await fileHandle.close().catch(() => undefined)
		await unlinkIfExists(temporaryPath).catch(() => undefined)
	}
}

async function writeAll(
	fileHandle: Awaited<ReturnType<typeof open>>,
	chunk: Buffer,
): Promise<void> {
	let offset = 0
	while (offset < chunk.byteLength) {
		const { bytesWritten } = await fileHandle.write(chunk, offset, chunk.byteLength - offset)
		if (bytesWritten <= 0) throw new Error('安装包写入失败。')
		offset += bytesWritten
	}
}

async function verifyLocalInstaller(
	downloaded: DownloadedInstaller,
	artifact: CandidateArtifact,
): Promise<void> {
	const fileStat = await stat(downloaded.path)
	if (!fileStat.isFile() || fileStat.size !== artifact.size || downloaded.size !== artifact.size) {
		throw new Error('已下载安装包大小校验失败。')
	}
	const hash = createHash('sha512')
	for await (const chunk of createReadStream(downloaded.path)) hash.update(chunk)
	if (hash.digest('base64') !== artifact.sha512 || downloaded.sha512 !== artifact.sha512) {
		throw new Error('已下载安装包 SHA-512 校验失败。')
	}
}

function requireInstallerFileName(value: string, kind: string): string {
	if (
		value.includes('\0') ||
		value === '.' ||
		value === '..' ||
		path.basename(value) !== value ||
		value.includes('/') ||
		value.includes('\\')
	) {
		throw new Error('安装包文件名无效。')
	}
	const extension = path.extname(value).toLowerCase()
	if (
		(kind === 'dmg' && extension === '.dmg') ||
		(kind === 'nsis' && extension === '.exe') ||
		(kind === 'nsis-yaml' && extension === '.yml')
	) {
		return value
	}
	throw new Error('安装包类型或扩展名无效。')
}

async function readOrCreateInstallId(filePath: string, randomId: () => string): Promise<string> {
	let repairInvalidFile = false
	try {
		const existing = (await readFile(filePath, 'utf8')).trim()
		if (INSTALL_ID_PATTERN.test(existing)) return existing
		repairInvalidFile = true
	} catch (error) {
		if (!isMissingFile(error)) throw error
	}

	const created = randomId()
	if (!INSTALL_ID_PATTERN.test(created)) throw new Error('无法生成安全的更新安装标识。')
	if (repairInvalidFile) {
		await writeFile(filePath, `${created}\n`, { encoding: 'utf8', mode: 0o600 })
		return created
	}
	try {
		await writeFile(filePath, `${created}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
		return created
	} catch (error) {
		if (!isAlreadyExists(error)) throw error
		const existing = (await readFile(filePath, 'utf8')).trim()
		if (!INSTALL_ID_PATTERN.test(existing)) throw new Error('更新安装标识无效。')
		return existing
	}
}

function normalizePolicy(value: Record<string, unknown>): NormalizedPolicy {
	const schemaVersion = value.schemaVersion === 2 ? 2 : 1
	if (value.schemaVersion !== undefined && value.schemaVersion !== 2) {
		throw new Error('更新策略 schema 无效。')
	}
	const distribution =
		value.distribution === undefined ? undefined : normalizeDistribution(value.distribution)
	if (schemaVersion === 2 && distribution?.mode !== 'platform-unsigned') {
		throw new Error('新策略分发模式无效。')
	}
	if (schemaVersion === 1 && distribution && distribution.mode !== 'manual-unsigned') {
		throw new Error('旧策略分发模式无效。')
	}
	if (schemaVersion === 2) {
		requireImmutableHttpsUrl(requireString(value.manifestUrl, '候选清单地址'), '候选清单地址')
	}
	const checkedAt = requireIsoDate(value.checkedAt, '策略检查时间')
	const validUntil = requireIsoDate(value.validUntil, '策略有效期')
	if (Date.parse(validUntil) < Date.parse(checkedAt)) throw new Error('更新策略有效期无效。')
	if (!Array.isArray(value.artifacts)) throw new Error('更新策略缺少产物。')
	return {
		schemaVersion,
		id: requireString(value.id, '策略 ID'),
		runtime: requireRuntime(value.runtime),
		channel: requireChannel(value.channel),
		releaseId: requireString(value.releaseId, '发布 ID'),
		version: requireSemverString(value.version, '版本'),
		percentage: requirePercentage(value.percentage),
		mode: requireMode(value.mode),
		...(value.minSupportedVersion === undefined
			? {}
			: { minSupportedVersion: requireSemverString(value.minSupportedVersion, '最低支持版本') }),
		title: requireString(value.title, '更新标题'),
		notes: requireString(value.notes, '更新说明'),
		manifestUrl: requireHttpsUrl(requireString(value.manifestUrl, '候选清单地址'), '候选清单地址'),
		manifestSignature: requireString(value.manifestSignature, '候选清单签名'),
		artifacts: value.artifacts.map(normalizeArtifact),
		distribution,
		publishedAt: requireIsoDate(value.publishedAt, '发布时间'),
		checkedAt,
		validUntil,
		eventToken: requireString(value.eventToken, '更新事件凭证'),
	}
}

function normalizeManifest(value: unknown): CandidateManifest {
	const manifest = requireRecord(value, '候选清单')
	if (
		(manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) ||
		manifest.runtime !== 'electron'
	) {
		throw new Error('候选清单 schema 或运行时无效。')
	}
	const distribution = normalizeDistribution(manifest.distribution)
	if (
		(manifest.schemaVersion === 1 && distribution.mode !== 'manual-unsigned') ||
		(manifest.schemaVersion === 2 && distribution.mode !== 'platform-unsigned')
	) {
		throw new Error('候选清单 schema 与分发模式不一致。')
	}
	if (!Array.isArray(manifest.artifacts)) throw new Error('候选清单缺少产物。')
	const artifacts = manifest.artifacts.map(normalizeArtifact)
	if (
		manifest.schemaVersion === 2 &&
		(artifacts.length !== 3 ||
			artifacts.filter(
				(item) => item.platform === 'darwin' && item.arch === 'arm64' && item.kind === 'dmg',
			).length !== 1 ||
			artifacts.filter(
				(item) => item.platform === 'win32' && item.arch === 'x64' && item.kind === 'nsis',
			).length !== 1 ||
			artifacts.filter(
				(item) => item.platform === 'win32' && item.arch === 'x64' && item.kind === 'nsis-yaml',
			).length !== 1)
	)
		throw new Error('新候选产物集合必须恰好包含三个目标。')
	if (manifest.schemaVersion === 2) {
		requireImmutableHttpsUrl(requireString(manifest.manifestUrl, '候选清单地址'), '候选清单地址')
		artifacts.forEach((item) => requireImmutableHttpsUrl(item.url, '新候选产物地址'))
		const metadata = artifacts.find((item) => item.kind === 'nsis-yaml')!
		if (metadata.fileName !== updateMetadataFileName(requireChannel(manifest.channel))) {
			throw new Error('Windows 更新元数据文件名与通道不一致。')
		}
	}
	const sourceCoordinates = normalizeSourceCoordinates(manifest.sourceCoordinates)
	if (manifest.schemaVersion === 2 && !sourceCoordinates.releasePublicKeyFingerprint) {
		throw new Error('新候选缺少发布公钥指纹。')
	}
	return {
		schemaVersion: manifest.schemaVersion,
		releaseId: requireString(manifest.releaseId, '候选 ID'),
		runtime: 'electron',
		channel: requireChannel(manifest.channel),
		version: requireSemverString(manifest.version, '候选版本'),
		createdAt: requireIsoDate(manifest.createdAt, '候选创建时间'),
		manifestUrl: requireHttpsUrl(
			requireString(manifest.manifestUrl, '候选清单地址'),
			'候选清单地址',
		),
		sourceCoordinates,
		tests: normalizeTestEvidence(manifest.tests),
		artifacts,
		distribution,
	}
}

function normalizeArtifact(value: unknown): CandidateArtifact {
	const artifact = requireRecord(value, '更新产物')
	const platform = normalizePlatform(requireString(artifact.platform, '产物平台'))
	const arch = normalizeArch(requireString(artifact.arch, '产物架构'))
	const fileName = requireInstallerFileName(
		requireString(artifact.fileName, '产物文件名'),
		requireString(artifact.kind, '产物类型'),
	)
	return {
		platform,
		arch,
		kind: requireString(artifact.kind, '产物类型'),
		fileName,
		url: requireHttpsUrl(requireString(artifact.url, '产物地址'), '产物地址'),
		sha512: requireSha512(artifact.sha512, '产物哈希'),
		size: requirePositiveNumber(artifact.size, '产物大小'),
	}
}

function canonicalArtifactSet(artifacts: CandidateArtifact[]): string {
	return canonicalJson(
		[...artifacts].sort((left, right) => {
			const leftKey = `${left.platform}\u0000${left.arch}\u0000${left.kind}\u0000${left.fileName}`
			const rightKey = `${right.platform}\u0000${right.arch}\u0000${right.kind}\u0000${right.fileName}`
			return leftKey.localeCompare(rightKey)
		}),
	)
}

function isMandatoryReleaseState(state: UpdateState): boolean {
	return 'release' in state && state.release?.mode === 'mandatory'
}

function readPublicKey(value: string) {
	const trimmed = value.trim().split('\\n').join('\n')
	return trimmed.includes('BEGIN PUBLIC KEY')
		? createPublicKey(trimmed)
		: createPublicKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'spki' })
}

function requireHttpsBaseUrl(value: string): URL {
	const parsed = new URL(value)
	if (parsed.protocol !== 'https:') throw new Error('更新服务必须使用 HTTPS。')
	return parsed
}

function requireHttpsUrl(value: string, label: string): string {
	const parsed = new URL(value)
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
		throw new Error(`${label}必须使用无凭据的 HTTPS 地址。`)
	}
	return parsed.toString()
}

function requireImmutableHttpsUrl(value: string, label: string): URL {
	const parsed = new URL(requireHttpsUrl(value, label))
	if (parsed.href.includes('?') || parsed.href.includes('#')) {
		throw new Error(`${label}不得包含查询或片段。`)
	}
	return parsed
}

function updateMetadataFileName(channel: 'dev' | 'beta' | 'stable'): string {
	return channel === 'stable' ? 'latest.yml' : `${channel}.yml`
}

function assertNsisMetadata(
	value: unknown,
	policy: VerifiedPolicy,
	metadataUrl: URL,
	installerUrl: URL,
): void {
	const metadata = requireRecord(value, 'Windows 更新元数据')
	const keys = Object.keys(metadata)
	if (
		keys.length !== 4 ||
		!['version', 'files', 'path', 'sha512'].every((key) => hasOwn(metadata, key)) ||
		metadata.version !== policy.version ||
		!Array.isArray(metadata.files) ||
		metadata.files.length !== 1
	) {
		throw new Error('Windows 更新元数据字段无效。')
	}
	const file = requireRecord(metadata.files[0], 'Windows 安装包元数据')
	const fileKeys = Object.keys(file)
	const relativeName = encodeURIComponent(policy.packageArtifact.fileName)
	if (
		fileKeys.length !== 3 ||
		!['url', 'sha512', 'size'].every((key) => hasOwn(file, key)) ||
		file.url !== relativeName ||
		metadata.path !== relativeName ||
		new URL(relativeName, metadataUrl).href !== installerUrl.href ||
		file.sha512 !== policy.packageArtifact.sha512 ||
		metadata.sha512 !== policy.packageArtifact.sha512 ||
		file.size !== policy.packageArtifact.size
	) {
		throw new Error('Windows 更新元数据与签名安装包不一致。')
	}
}

function readRetryAfterMs(value: string | null, now: number): number {
	if (value) {
		const seconds = Number(value)
		if (Number.isFinite(seconds) && seconds >= 0) {
			return Math.min(CHECK_INTERVAL_MS, Math.max(1_000, Math.ceil(seconds * 1_000)))
		}
		const timestamp = Date.parse(value)
		if (Number.isFinite(timestamp)) {
			return Math.min(CHECK_INTERVAL_MS, Math.max(1_000, timestamp - now))
		}
	}
	return 60_000
}

function normalizePlatform(value: unknown): 'darwin' | 'win32' {
	if (value === 'darwin' || value === 'win32') return value
	throw new Error(`不支持的更新平台：${String(value)}`)
}

function normalizeArch(value: unknown): 'arm64' | 'x64' {
	if (value === 'arm64' || value === 'x64') return value
	throw new Error(`不支持的更新架构：${String(value)}`)
}

function requireChannel(value: unknown): 'dev' | 'beta' | 'stable' {
	if (value === 'dev' || value === 'beta' || value === 'stable') return value
	throw new Error('更新通道无效。')
}

function requireMode(value: unknown): 'optional' | 'mandatory' {
	if (value === 'optional' || value === 'mandatory') return value
	throw new Error('更新模式无效。')
}

function requirePercentage(value: unknown): 1 | 5 | 25 | 50 | 100 {
	if (value === 1 || value === 5 || value === 25 || value === 50 || value === 100) return value
	throw new Error('更新放量比例无效。')
}

function requireRuntime(value: unknown): 'electron' | 'chromium' {
	if (value === 'electron' || value === 'chromium') return value
	throw new Error('更新运行时无效。')
}

function requireIsoDate(value: unknown, label: string): string {
	const result = requireString(value, label)
	if (!Number.isFinite(Date.parse(result))) throw new Error(`${label}无效。`)
	return result
}

function requireSha512(value: unknown, label: string): string {
	const digest = requireString(value, label)
	if (/^[a-f0-9]{128}$/i.test(digest)) return Buffer.from(digest, 'hex').toString('base64')
	const bytes = Buffer.from(digest, 'base64')
	if (bytes.byteLength === 64 && bytes.toString('base64') === digest) return digest
	throw new Error(`${label}无效。`)
}

function normalizeSourceCoordinates(value: unknown) {
	const source = requireRecord(value, '源码坐标')
	return {
		repository: requireString(source.repository, '源码仓库'),
		commit: requireString(source.commit, '源码提交'),
		browserVersion: requireString(source.browserVersion, '浏览器版本'),
		extensionVersion: requireString(source.extensionVersion, '插件版本'),
		...(source.releasePublicKeyFingerprint === undefined
			? {}
			: {
					releasePublicKeyFingerprint: requireSha256(
						source.releasePublicKeyFingerprint,
						'更新签名公钥指纹',
					),
				}),
	}
}

function normalizeTestEvidence(value: unknown) {
	if (!Array.isArray(value) || value.length !== REQUIRED_RELEASE_TEST_EVIDENCE.size) {
		throw new Error('候选测试证据必须完整且数量固定。')
	}
	const names = new Set<string>()
	const tests = value.map((item) => {
		const evidence = requireRecord(item, '测试证据')
		if (
			Object.keys(evidence).length !== 3 ||
			!hasOwn(evidence, 'name') ||
			!hasOwn(evidence, 'status') ||
			!hasOwn(evidence, 'url')
		) {
			throw new Error('候选测试证据字段无效。')
		}
		if (evidence.status !== 'passed') throw new Error('候选测试证据未通过。')
		const name = requireString(evidence.name, '测试名称')
		if (!REQUIRED_RELEASE_TEST_EVIDENCE.has(name) || names.has(name)) {
			throw new Error('候选测试证据名称缺失、重复或不受支持。')
		}
		names.add(name)
		return {
			name,
			status: 'passed' as const,
			url: requireHttpsUrl(requireString(evidence.url, '测试证据地址'), '测试证据地址'),
		}
	})
	if (names.size !== REQUIRED_RELEASE_TEST_EVIDENCE.size) {
		throw new Error('候选测试证据不完整。')
	}
	return tests
}

function normalizeDistribution(value: unknown): { mode: 'manual-unsigned' | 'platform-unsigned' } {
	const distribution = requireRecord(value, '候选分发模式')
	if (
		(distribution.mode !== 'manual-unsigned' && distribution.mode !== 'platform-unsigned') ||
		Object.keys(distribution).length !== 1
	) {
		throw new Error('候选清单不是受支持的 manual-unsigned 分发模式。')
	}
	return { mode: distribution.mode }
}

function requirePositiveNumber(value: unknown, label: string): number {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
	throw new Error(`${label}无效。`)
}

function requireString(value: unknown, label: string): string {
	if (typeof value === 'string' && value.trim()) return value.trim()
	throw new Error(`${label}无效。`)
}

function requireSha256(value: unknown, label: string): string {
	const digest = requireString(value, label).toLowerCase()
	if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label}无效。`)
	return digest
}

function requireSemverString(value: unknown, label: string): string {
	const result = requireString(value, label)
	if (!isValidSemver(result)) throw new Error(`${label}无效。`)
	return result
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (isRecord(value)) return value
	throw new Error(`${label}无效。`)
}

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(value, key)
}

function isConnectivityError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return (
		error.name === 'AbortError' ||
		/failed to fetch|fetch failed|network|offline|econn|enotfound|timeout|请求失败 \((?:408|429|5\d\d)\)/i.test(
			error.message,
		)
	)
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
	return isRecord(error) && error.code === 'EEXIST'
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback
}
