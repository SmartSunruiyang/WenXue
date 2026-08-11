import { canonicalJson, type ReleaseArtifact } from '@wenxue/client-operations'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopUpdateService, type DesktopUpdateServiceOptions } from './DesktopUpdateService'

const NOW = Date.parse('2026-07-17T12:00:00.000Z')
const INSTALL_ID = '00000000-0000-4000-8000-000000000001'
const POLICY_URL = 'https://gateway.example/v1/client/update-policy'
const MANIFEST_URL = 'https://updates.example/releases/0.1.1/manifest.json'
const INSTALLER_URL = 'https://updates.example/releases/0.1.1/WenXue-0.1.1-mac-arm64.dmg'
const INSTALLER_BYTES = Buffer.from('manual-unsigned-mac-installer')

let tempDir: string

beforeEach(async () => {
	tempDir = await mkdtemp(path.join(os.tmpdir(), 'wenxue-desktop-update-'))
})

afterEach(async () => {
	vi.useRealTimers()
	await rm(tempDir, { force: true, recursive: true })
})

interface UpdateFixture {
	artifacts: ReleaseArtifact[]
	events: Array<Record<string, unknown>>
	fetchImpl: typeof fetch
	manifest: Record<string, unknown>
	policy: Record<string, unknown>
	privateKey: KeyObject
	publicKey: string
	setDownloadBody(bytes: Buffer): void
	setDownloadResponse(factory: () => Response | Promise<Response>): void
	setPolicyMode(
		mode: 'active' | 'withdrawn' | 'offline' | 'malformed' | 'http-error' | 'rate-limited',
	): void
}

function createFixture(mode: 'optional' | 'mandatory' = 'optional'): UpdateFixture {
	const macArm64 = artifact({
		kind: 'dmg',
		fileName: 'WenXue-0.1.1-mac-arm64.dmg',
		url: INSTALLER_URL,
		sha512: sha512(INSTALLER_BYTES),
		size: INSTALLER_BYTES.byteLength,
	})
	const macX64Bytes = Buffer.from('manual-unsigned-mac-x64-installer')
	const macX64 = artifact({
		arch: 'x64',
		kind: 'dmg',
		fileName: 'WenXue-0.1.1-mac-x64.dmg',
		url: 'https://updates.example/releases/0.1.1/WenXue-0.1.1-mac-x64.dmg',
		sha512: sha512(macX64Bytes),
		size: macX64Bytes.byteLength,
	})
	const windowsBytes = Buffer.from('manual-unsigned-windows-installer')
	const windows = artifact({
		platform: 'win32',
		arch: 'x64',
		kind: 'nsis',
		fileName: 'WenXue-0.1.1-win-x64.exe',
		url: 'https://updates.example/releases/0.1.1/WenXue-0.1.1-win-x64.exe',
		sha512: sha512(windowsBytes),
		size: windowsBytes.byteLength,
	})
	const artifacts = [macArm64, macX64, windows]
	const manifest: Record<string, unknown> = {
		schemaVersion: 1,
		releaseId: 'electron-stable-0.1.1',
		runtime: 'electron',
		channel: 'stable',
		version: '0.1.1',
		createdAt: new Date(NOW - 60_000).toISOString(),
		manifestUrl: MANIFEST_URL,
		distribution: { mode: 'manual-unsigned' },
		sourceCoordinates: {
			repository: 'wenxue/WenXue',
			commit: '0123456789abcdef0123456789abcdef01234567',
			browserVersion: '149.0.7827.55',
			extensionVersion: '0.1.0',
			releasePublicKeyFingerprint: 'a'.repeat(64),
		},
		tests: [
			{
				name: 'quality',
				status: 'passed',
				url: 'https://updates.example.test/evidence/quality.json',
			},
			{
				name: 'manual-installer-integrity',
				status: 'passed',
				url: 'https://updates.example.test/evidence/manual-installer-integrity.json',
			},
			{
				name: 'manifest-tamper-rejection',
				status: 'passed',
				url: 'https://updates.example.test/evidence/manifest-tamper-rejection.json',
			},
		],
		artifacts,
	}
	const { privateKey, publicKey } = generateKeyPairSync('ed25519')
	const exportedPublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
	const policy: Record<string, unknown> = {
		id: 'rollout-electron-stable',
		runtime: 'electron',
		channel: 'stable',
		releaseId: manifest.releaseId,
		version: manifest.version,
		percentage: 100,
		mode,
		...(mode === 'mandatory' ? { minSupportedVersion: '0.1.0' } : {}),
		title: '问学 0.1.1',
		notes: '修复更新链路并提升稳定性。',
		manifestUrl: MANIFEST_URL,
		manifestSignature: signManifest(manifest, privateKey),
		artifacts: [macArm64],
		publishedAt: new Date(NOW - 120_000).toISOString(),
		checkedAt: new Date(NOW).toISOString(),
		validUntil: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
		eventToken: 'signed-update-event-token',
	}
	let policyMode: 'active' | 'withdrawn' | 'offline' | 'malformed' | 'http-error' | 'rate-limited' =
		'active'
	let downloadBody: Buffer = INSTALLER_BYTES
	let downloadResponse: (() => Response | Promise<Response>) | null = null
	const events: Array<Record<string, unknown>> = []
	const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		const url = new URL(String(input))
		if (url.toString().startsWith(POLICY_URL)) {
			if (policyMode === 'offline') throw new TypeError('fetch failed')
			if (policyMode === 'http-error') return new Response(null, { status: 409 })
			if (policyMode === 'rate-limited') {
				return new Response(null, { status: 429, headers: { 'retry-after': '2' } })
			}
			if (policyMode === 'malformed') return Response.json({})
			return Response.json({ policy: policyMode === 'withdrawn' ? null : policy })
		}
		if (url.toString() === MANIFEST_URL) return Response.json(manifest)
		if (url.toString() === INSTALLER_URL) {
			if (downloadResponse) return downloadResponse()
			return new Response(new Uint8Array(downloadBody), {
				headers: { 'content-length': String(downloadBody.byteLength) },
			})
		}
		if (url.pathname === '/v1/client/update-events') {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>
			events.push(body)
			expect(body).toMatchObject({
				releaseId: manifest.releaseId,
				runtime: 'electron',
				platform: 'darwin',
				arch: 'arm64',
				fromVersion: '0.1.0',
			})
			expect(body).not.toHaveProperty('uid')
			return new Response(null, { status: 202 })
		}
		throw new Error(`Unexpected update URL: ${url.toString()}`)
	})

	return {
		artifacts,
		events,
		fetchImpl,
		manifest,
		policy,
		privateKey,
		publicKey: exportedPublicKey,
		setDownloadBody(bytes) {
			downloadBody = bytes
		},
		setDownloadResponse(factory) {
			downloadResponse = factory
		},
		setPolicyMode(nextMode) {
			policyMode = nextMode
		},
	}
}

function createService(
	fixture: UpdateFixture,
	overrides: Partial<DesktopUpdateServiceOptions> = {},
): {
	service: DesktopUpdateService
	openPath: ReturnType<typeof vi.fn<(targetPath: string) => Promise<string>>>
} {
	const openPath = vi.fn(async () => '')
	const service = new DesktopUpdateService({
		paths: { dataFile: (name) => path.join(tempDir, name) },
		openPath,
		isPackaged: true,
		currentVersion: '0.1.0',
		platform: 'darwin',
		arch: 'arm64',
		channel: 'stable',
		policyBaseUrl: 'https://gateway.example',
		manifestPublicKey: fixture.publicKey,
		fetchImpl: fixture.fetchImpl,
		now: () => NOW,
		randomId: () => INSTALL_ID,
		...overrides,
	})
	return { service, openPath }
}

describe('DesktopUpdateService manual-unsigned flow', () => {
	it('keeps development startup quiet and explains unavailability only after a manual check', async () => {
		const fixture = createFixture()
		const setTimeoutImpl = vi.fn(() => 1) as unknown as typeof setTimeout
		const setIntervalImpl = vi.fn(() => 2) as unknown as typeof setInterval
		const { service } = createService(fixture, {
			isPackaged: false,
			setTimeoutImpl,
			setIntervalImpl,
		})

		service.start()

		expect(service.state()).toEqual({ phase: 'idle' })
		expect(setTimeoutImpl).not.toHaveBeenCalled()
		expect(setIntervalImpl).not.toHaveBeenCalled()
		await expect(service.check('signal')).resolves.toEqual({ phase: 'idle' })
		await expect(service.check('manual')).rejects.toThrow(
			'开发模式不支持桌面更新，请安装桌面版本后检查。',
		)
		expect(service.state()).toEqual({ phase: 'idle' })
		expect(fixture.fetchImpl).not.toHaveBeenCalled()
	})

	it('checks 30 seconds after startup and every four hours', async () => {
		const fixture = createFixture()
		let startupCheck: (() => void) | undefined
		let recurringCheck: (() => void) | undefined
		const setTimeoutImpl = vi.fn((callback: () => void, delay?: number) => {
			if (delay === 30_000) startupCheck = callback
			return 1
		}) as unknown as typeof setTimeout
		const setIntervalImpl = vi.fn((callback: () => void, delay?: number) => {
			if (delay === 4 * 60 * 60 * 1000) recurringCheck = callback
			return 2
		}) as unknown as typeof setInterval
		const { service } = createService(fixture, {
			setTimeoutImpl,
			clearTimeoutImpl: vi.fn() as unknown as typeof clearTimeout,
			setIntervalImpl,
			clearIntervalImpl: vi.fn() as unknown as typeof clearInterval,
		})
		const policyRequestCount = () =>
			vi
				.mocked(fixture.fetchImpl)
				.mock.calls.filter(([input]) => String(input).startsWith(POLICY_URL)).length

		service.start()
		expect(policyRequestCount()).toBe(0)
		startupCheck?.()
		await service.check('manual')
		expect(policyRequestCount()).toBe(1)
		recurringCheck?.()
		await service.check('manual')
		expect(policyRequestCount()).toBe(2)
		service.stop()
	})

	it('honors Retry-After with jitter and retries a rate-limited signal check', async () => {
		const fixture = createFixture()
		fixture.setPolicyMode('rate-limited')
		let retryCheck: (() => void) | undefined
		const setTimeoutImpl = vi.fn((callback: () => void, delay?: number) => {
			if (delay === 32_000) retryCheck = callback
			return 1
		}) as unknown as typeof setTimeout
		const { service } = createService(fixture, {
			random: () => 0.5,
			setTimeoutImpl,
			clearTimeoutImpl: vi.fn() as unknown as typeof clearTimeout,
			setIntervalImpl: vi.fn(() => 2) as unknown as typeof setInterval,
			clearIntervalImpl: vi.fn() as unknown as typeof clearInterval,
		})

		service.start()
		await expect(service.check('signal')).resolves.toMatchObject({
			phase: 'error',
			message: '更新检查请求过于频繁，已安排自动重试。',
		})
		expect(retryCheck).toBeTypeOf('function')

		fixture.setPolicyMode('active')
		retryCheck?.()
		await vi.waitFor(() => expect(service.state()).toMatchObject({ phase: 'available' }))
		service.stop()
	})

	it('removes orphaned installers left by a previous process on startup', async () => {
		const fixture = createFixture()
		const installerDirectory = path.join(tempDir, 'update-installers')
		await mkdir(installerDirectory, { recursive: true })
		await writeFile(path.join(installerDirectory, 'old-release.dmg'), 'old')
		await writeFile(path.join(installerDirectory, 'interrupted.part'), 'partial')
		const { service } = createService(fixture)

		service.start()
		await service.check('manual')
		await vi.waitFor(async () => expect(await readdir(installerDirectory)).toEqual([]))
		service.stop()
	})

	it('discovers a signed manual-unsigned candidate without downloading it', async () => {
		const fixture = createFixture()
		const { service } = createService(fixture)

		await expect(service.check('manual')).resolves.toMatchObject({
			phase: 'available',
			release: { releaseId: 'electron-stable-0.1.1', version: '0.1.1', mode: 'optional' },
		})
		expect(
			vi.mocked(fixture.fetchImpl).mock.calls.some(([input]) => String(input) === INSTALLER_URL),
		).toBe(false)
	})

	it('strictly rejects a manifest that is not manual-unsigned', async () => {
		const fixture = createFixture()
		fixture.manifest.distribution = { mode: 'platform-signed' }
		fixture.policy.manifestSignature = signManifest(fixture.manifest, fixture.privateKey)

		await expect(createService(fixture).service.check('manual')).resolves.toMatchObject({
			phase: 'error',
			message: '候选清单不是受支持的 manual-unsigned 分发模式。',
		})
	})

	it('requires the exact signed release test evidence contract', async () => {
		const missing = createFixture()
		missing.manifest.tests = (missing.manifest.tests as unknown[]).slice(0, 2)
		missing.policy.manifestSignature = signManifest(missing.manifest, missing.privateKey)
		await expect(createService(missing).service.check('manual')).resolves.toMatchObject({
			phase: 'error',
			message: '候选测试证据必须完整且数量固定。',
		})

		const duplicate = createFixture()
		const duplicateTests = duplicate.manifest.tests as Array<Record<string, unknown>>
		duplicateTests[2] = { ...duplicateTests[1] }
		duplicate.policy.manifestSignature = signManifest(duplicate.manifest, duplicate.privateKey)
		await expect(createService(duplicate).service.check('manual')).resolves.toMatchObject({
			phase: 'error',
			message: '候选测试证据名称缺失、重复或不受支持。',
		})

		const extraField = createFixture()
		const extraTests = extraField.manifest.tests as Array<Record<string, unknown>>
		extraTests[0] = { ...extraTests[0], issuer: 'unexpected' }
		extraField.policy.manifestSignature = signManifest(extraField.manifest, extraField.privateKey)
		await expect(createService(extraField).service.check('manual')).resolves.toMatchObject({
			phase: 'error',
			message: '候选测试证据字段无效。',
		})
	})

	it('rejects expired policy, unsigned mutations, and target artifact mutations', async () => {
		const expired = createFixture()
		expired.policy.checkedAt = new Date(NOW - 60_000).toISOString()
		expired.policy.validUntil = new Date(NOW - 1).toISOString()
		await expect(createService(expired).service.check('manual')).resolves.toMatchObject({
			phase: 'error',
			message: '更新策略已过期，请重新检查。',
		})

		const unsigned = createFixture()
		unsigned.manifest.version = '0.1.2'
		await expect(createService(unsigned).service.check('manual')).resolves.toMatchObject({
			phase: 'error',
			message: '候选清单签名无效，已拒绝更新。',
		})

		const mutated = createFixture()
		const policyArtifacts = mutated.policy.artifacts as ReleaseArtifact[]
		mutated.policy.artifacts = [{ ...policyArtifacts[0], size: policyArtifacts[0].size + 1 }]
		await expect(createService(mutated).service.check('manual')).resolves.toMatchObject({
			phase: 'error',
			message: '签名候选与发布策略不一致。',
		})
	})

	it('streams the installer into the controlled directory and verifies exact bytes', async () => {
		const fixture = createFixture()
		fixture.setDownloadResponse(
			() =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(INSTALLER_BYTES.subarray(0, 7))
							controller.enqueue(INSTALLER_BYTES.subarray(7))
							controller.close()
						},
					}),
					{ headers: { 'content-length': String(INSTALLER_BYTES.byteLength) } },
				),
		)
		const { service } = createService(fixture)
		const phases: string[] = []
		service.subscribe((state) => phases.push(state.phase))
		await service.check('manual')

		await expect(service.download()).resolves.toMatchObject({ phase: 'ready' })
		expect(phases).toContain('downloading')
		const files = await readdir(path.join(tempDir, 'update-installers'))
		expect(files).toHaveLength(1)
		expect(files[0]).toMatch(/\.dmg$/)
		expect(await readFile(path.join(tempDir, 'update-installers', files[0]))).toEqual(
			INSTALLER_BYTES,
		)
	})

	it('deletes temporary files when SHA-512 verification fails', async () => {
		const fixture = createFixture('mandatory')
		fixture.setDownloadBody(
			Buffer.from('tampered-installer-with-same-size'.slice(0, INSTALLER_BYTES.length)),
		)
		const { service } = createService(fixture)
		await service.check('manual')

		await expect(service.download()).rejects.toThrow(/SHA-512|大小/)
		expect(service.state()).toMatchObject({ phase: 'error', release: { mode: 'mandatory' } })
		expect(await readdir(path.join(tempDir, 'update-installers'))).toEqual([])
	})

	it('revalidates before opening and refuses a withdrawn release', async () => {
		const fixture = createFixture()
		const { service, openPath } = createService(fixture)
		await service.check('manual')
		await service.download()
		fixture.setPolicyMode('withdrawn')

		await expect(service.openInstaller()).rejects.toThrow('更新已被暂停、撤回或替换')
		expect(service.state()).toEqual({ phase: 'idle' })
		expect(openPath).not.toHaveBeenCalled()
		expect(await readdir(path.join(tempDir, 'update-installers'))).toEqual([])
	})

	it('keeps a completed optional installer across a temporary policy outage', async () => {
		const fixture = createFixture()
		const { service } = createService(fixture)
		await service.check('manual')
		await service.download()
		const installerDirectory = path.join(tempDir, 'update-installers')
		const downloadedFiles = await readdir(installerDirectory)
		fixture.setPolicyMode('offline')

		await expect(service.check('timer')).resolves.toMatchObject({
			phase: 'error',
			release: { releaseId: 'electron-stable-0.1.1' },
		})
		expect(await readdir(installerDirectory)).toEqual(downloadedFiles)

		fixture.setPolicyMode('active')
		await expect(service.check('manual')).resolves.toMatchObject({ phase: 'ready' })
		expect(
			vi.mocked(fixture.fetchImpl).mock.calls.filter(([input]) => String(input) === INSTALLER_URL),
		).toHaveLength(1)
	})

	it('rehydrates a verified installer after an app restart without downloading it again', async () => {
		const fixture = createFixture()
		const first = createService(fixture)
		await first.service.check('manual')
		await first.service.download()

		const restarted = createService(fixture)
		restarted.service.start()
		await expect(restarted.service.check('manual')).resolves.toMatchObject({ phase: 'ready' })
		expect(
			vi.mocked(fixture.fetchImpl).mock.calls.filter(([input]) => String(input) === INSTALLER_URL),
		).toHaveLength(1)
		restarted.service.stop()
	})

	it('opens the verified installer without quitting the app or controlling CfT', async () => {
		const fixture = createFixture()
		const { service, openPath } = createService(fixture)
		await service.check('manual')
		await service.download()

		await expect(service.openInstaller()).resolves.toMatchObject({
			phase: 'handedOff',
			release: { releaseId: 'electron-stable-0.1.1' },
		})
		expect(openPath).toHaveBeenCalledOnce()
		expect(openPath.mock.calls[0][0]).toMatch(/update-installers\/.*\.dmg$/)
		await vi.waitFor(() =>
			expect(
				fixture.events.filter((event) => event.stage === 'handoff').map((event) => event.result),
			).toEqual(['start', 'success']),
		)
	})

	it('rehashes the local installer immediately before opening it', async () => {
		const fixture = createFixture()
		const { service, openPath } = createService(fixture)
		await service.check('manual')
		await service.download()
		const [fileName] = await readdir(path.join(tempDir, 'update-installers'))
		await writeFile(
			path.join(tempDir, 'update-installers', fileName),
			Buffer.alloc(INSTALLER_BYTES.length),
		)

		await expect(service.openInstaller()).rejects.toThrow('SHA-512')
		expect(openPath).not.toHaveBeenCalled()
		expect(service.state()).toMatchObject({ phase: 'available' })
		expect(await readdir(path.join(tempDir, 'update-installers'))).toEqual([])
	})

	it('serializes duplicate downloads and runs a queued signal check afterward', async () => {
		const fixture = createFixture()
		let releaseDownload: (() => void) | undefined
		fixture.setDownloadResponse(
			() =>
				new Response(
					new ReadableStream({
						async start(controller) {
							await new Promise<void>((resolve) => (releaseDownload = resolve))
							controller.enqueue(INSTALLER_BYTES)
							controller.close()
						},
					}),
				),
		)
		const { service } = createService(fixture)
		await service.check('manual')
		const download = service.download()
		await vi.waitFor(() => expect(service.state().phase).toBe('downloading'))
		await expect(service.download()).rejects.toThrow('另一项更新操作正在进行')
		await expect(service.check('signal')).resolves.toMatchObject({ phase: 'downloading' })
		releaseDownload?.()
		await expect(download).resolves.toMatchObject({ phase: 'ready' })
		await vi.waitFor(() => {
			const policyRequests = vi
				.mocked(fixture.fetchImpl)
				.mock.calls.filter(([input]) => String(input).startsWith(POLICY_URL))
			expect(policyRequests).toHaveLength(3)
		})
	})

	it('persists a recent mandatory policy and unlocks it after 24 hours offline', async () => {
		const fixture = createFixture('mandatory')
		let currentTime = NOW
		const first = createService(fixture, { now: () => currentTime })
		await first.service.check('manual')
		const persistedFiles = await readdir(tempDir)
		expect(persistedFiles.some((fileName) => fileName.endsWith('.tmp'))).toBe(false)
		expect(
			JSON.parse(await readFile(path.join(tempDir, 'update-mandatory-policy.json'), 'utf8')),
		).toMatchObject({
			schemaVersion: 1,
			release: { distribution: { mode: 'manual-unsigned' } },
		})

		const restored = createService(fixture, { now: () => currentTime })
		restored.service.start()
		await vi.waitFor(() =>
			expect(restored.service.state()).toMatchObject({
				phase: 'available',
				release: { mode: 'mandatory' },
			}),
		)
		restored.service.stop()

		currentTime = NOW + 24 * 60 * 60 * 1000 + 1
		const stale = createService(fixture, { now: () => currentTime })
		stale.service.start()
		await vi.waitFor(() =>
			expect(stale.service.state()).toMatchObject({
				phase: 'error',
				message: expect.stringContaining('已解除工作区限制'),
			}),
		)
		await expect(stale.service.assertWorkspaceAllowed()).resolves.toBeUndefined()
		stale.service.stop()
	})

	it('requires a live policy before opening a mandatory installer', async () => {
		const fixture = createFixture('mandatory')
		const { service, openPath } = createService(fixture)
		await service.check('manual')
		await service.download()
		fixture.setPolicyMode('offline')

		await expect(service.openInstaller()).rejects.toThrow('fetch failed')
		expect(service.state()).toMatchObject({ phase: 'ready', release: { mode: 'mandatory' } })
		expect(openPath).not.toHaveBeenCalled()
	})

	it('reports handoff failure when the OS refuses to open the installer', async () => {
		const fixture = createFixture()
		const { service, openPath } = createService(fixture)
		openPath.mockResolvedValueOnce('OS refused installer')
		await service.check('manual')
		await service.download()

		await expect(service.openInstaller()).rejects.toThrow('OS refused installer')
		expect(service.state()).toMatchObject({ phase: 'error', release: { version: '0.1.1' } })
		await vi.waitFor(() =>
			expect(
				fixture.events.filter((event) => event.stage === 'handoff').map((event) => event.result),
			).toEqual(['start', 'failure']),
		)
	})

	it('reports handoff failure when opening the installer throws', async () => {
		const fixture = createFixture()
		const { service, openPath } = createService(fixture)
		openPath.mockRejectedValueOnce(new Error('shell handoff failed'))
		await service.check('manual')
		await service.download()

		await expect(service.openInstaller()).rejects.toThrow('shell handoff failed')
		expect(service.state()).toMatchObject({ phase: 'error', release: { version: '0.1.1' } })
		await vi.waitFor(() =>
			expect(
				fixture.events.filter((event) => event.stage === 'handoff').map((event) => event.result),
			).toEqual(['start', 'failure']),
		)
	})
})

function artifact(overrides: Partial<ReleaseArtifact>): ReleaseArtifact {
	return {
		platform: 'darwin',
		arch: 'arm64',
		kind: 'dmg',
		fileName: 'WenXue.dmg',
		url: INSTALLER_URL,
		sha512: sha512(INSTALLER_BYTES),
		size: INSTALLER_BYTES.byteLength,
		...overrides,
	}
}

function signManifest(manifest: Record<string, unknown>, privateKey: KeyObject): string {
	return sign(null, Buffer.from(canonicalJson(manifest)), privateKey).toString('base64')
}

function sha512(value: string | Buffer): string {
	return createHash('sha512').update(value).digest('base64')
}
