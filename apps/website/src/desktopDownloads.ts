export type DownloadTarget = 'mac' | 'windows'
export interface DesktopArtifact {
	platform: 'darwin' | 'win32'
	arch: 'arm64' | 'x64'
	kind: 'dmg' | 'nsis'
	url: string
	sha512: string
	size: number
}
export interface DesktopRelease {
	version: string
	publishedAt: string
	artifacts: DesktopArtifact[]
}
export interface DownloadState {
	phase: 'loading' | 'ready' | 'empty' | 'error' | 'checking'
	release: DesktopRelease | null
	target: DownloadTarget
	message: string
}
const invalidResponse = () => new Error('下载信息无效，请稍后重试。')
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseDesktopDownloads(value: unknown): DesktopRelease | null {
	if (!record(value)) throw invalidResponse()
	if (value.release === null) return null
	const release = value.release
	if (
		!record(release) ||
		typeof release.version !== 'string' ||
		!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
			release.version,
		) ||
		typeof release.publishedAt !== 'string' ||
		!Number.isFinite(Date.parse(release.publishedAt)) ||
		!Array.isArray(release.artifacts) ||
		release.artifacts.length !== 2
	)
		throw invalidResponse()
	const artifacts = release.artifacts.map((artifact): DesktopArtifact => {
		if (
			!record(artifact) ||
			!(
				(artifact.platform === 'darwin' && artifact.arch === 'arm64' && artifact.kind === 'dmg') ||
				(artifact.platform === 'win32' && artifact.arch === 'x64' && artifact.kind === 'nsis')
			) ||
			typeof artifact.url !== 'string' ||
			typeof artifact.sha512 !== 'string' ||
			!/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512) ||
			typeof artifact.size !== 'number' ||
			!Number.isSafeInteger(artifact.size) ||
			artifact.size <= 0
		)
			throw invalidResponse()
		let url: URL
		try {
			url = new URL(artifact.url)
		} catch {
			throw invalidResponse()
		}
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
			throw invalidResponse()
		return {
			platform: artifact.platform,
			arch: artifact.arch,
			kind: artifact.kind,
			url: artifact.url,
			sha512: artifact.sha512,
			size: artifact.size,
		}
	})
	if (new Set(artifacts.map((artifact) => artifact.platform)).size !== 2) throw invalidResponse()
	return { version: release.version, publishedAt: release.publishedAt, artifacts }
}

export async function fetchDesktopDownloads(signal: AbortSignal): Promise<DesktopRelease | null> {
	const response = await fetch('/v1/public/desktop-downloads', {
		cache: 'no-store',
		credentials: 'omit',
		signal,
	})
	if (!response.ok) throw new Error('无法获取下载信息，请检查网络后重试。')
	return parseDesktopDownloads(await response.json())
}

export function recommendDownloadTarget(userAgent: string): DownloadTarget {
	return /Windows/i.test(userAgent) ? 'windows' : 'mac'
}
export function selectedArtifact(release: DesktopRelease, target: DownloadTarget): DesktopArtifact {
	return release.artifacts.find(
		(artifact) => artifact.platform === (target === 'mac' ? 'darwin' : 'win32'),
	)!
}
export function formatPackageSize(size: number): string {
	return `${(size / 1024 / 1024).toFixed(1)} MB`
}
export function desktopReleaseLabel(version: string): string {
	return version.split('+')[0].includes('-') ? '预览版' : '正式版'
}

export class DesktopDownloads {
	private state: DownloadState
	private listeners = new Set<() => void>()
	private requestId = 0
	private abort: AbortController | null = null
	private load: (signal: AbortSignal) => Promise<DesktopRelease | null>
	constructor(load: (signal: AbortSignal) => Promise<DesktopRelease | null>, userAgent: string) {
		this.load = load
		this.state = {
			phase: 'loading',
			release: null,
			target: recommendDownloadTarget(userAgent),
			message: '',
		}
	}
	getSnapshot = () => this.state
	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	private setState(state: DownloadState) {
		this.state = state
		this.listeners.forEach((listener) => listener())
	}
	select = (target: DownloadTarget) => {
		if (this.state.phase === 'checking') return
		this.setState({ ...this.state, target })
	}
	refresh = async () => {
		await this.request()
	}
	download = async (navigate: (url: string) => void) => {
		if (this.state.phase !== 'ready' || !this.state.release) return
		const current = this.state.release
		const target = this.state.target
		const next = await this.request(current)
		if (!next) return
		const newArtifact = selectedArtifact(next, target)
		if (
			current.version !== next.version ||
			current.publishedAt !== next.publishedAt ||
			(['mac', 'windows'] as const).some(
				(platform) =>
					JSON.stringify(selectedArtifact(current, platform)) !==
					JSON.stringify(selectedArtifact(next, platform)),
			)
		) {
			this.setState({
				...this.state,
				message: '下载版本已更新，请确认版本和安装包后再次点击下载。',
			})
			return
		}
		navigate(newArtifact.url)
	}
	private async request(current?: DesktopRelease): Promise<DesktopRelease | null> {
		const id = ++this.requestId
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.setState({
			...this.state,
			phase: current ? 'checking' : 'loading',
			release: null,
			message: '',
		})
		const timer = setTimeout(() => abort.abort(), 15000)
		try {
			const release = await this.load(abort.signal)
			if (id !== this.requestId) return null
			this.setState({ ...this.state, phase: release ? 'ready' : 'empty', release, message: '' })
			return release
		} catch {
			if (id === this.requestId)
				this.setState({
					...this.state,
					phase: 'error',
					release: null,
					message: '无法获取当前下载信息，请检查网络后重试。',
				})
			return null
		} finally {
			clearTimeout(timer)
		}
	}
	dispose = () => {
		++this.requestId
		this.abort?.abort()
	}
}
