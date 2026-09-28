import { canonicalJson, type ReleaseArtifact } from '@wenxue/client-operations'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	DesktopUpdateService,
	type DesktopUpdateServiceOptions,
	type NsisUpdaterPort,
} from './DesktopUpdateService'

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
			release: {
				releaseId: 'electron-stable-0.1.1',
				version: '0.1.1',
				mode: 'optional',
				installAction: 'open-installer',
			},
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
		await expect(first.service.assertWorkspaceAllowed()).rejects.toThrow('必须完成更新')
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
		await expect(restored.service.assertWorkspaceAllowed()).rejects.toThrow('必须完成更新')
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

function createV2Fixture(platform: 'darwin' | 'win32') {
	const fixture = createFixture()
	const exeBytes = Buffer.from('manual-unsigned-windows-installer')
	const exe = fixture.artifacts.find((item) => item.platform === 'win32')!
	const metadataUrl = 'https://updates.example/releases/0.1.1/latest.yml'
	const metadata = {
		version: '0.1.1',
		files: [{ url: encodeURIComponent(exe.fileName), sha512: exe.sha512, size: exe.size }],
		path: encodeURIComponent(exe.fileName),
		sha512: exe.sha512,
	}
	let metadataBytes: Buffer = Buffer.from(`${JSON.stringify(metadata)}\n`)
	const yaml = artifact({
		platform: 'win32',
		arch: 'x64',
		kind: 'nsis-yaml',
		fileName: 'latest.yml',
		url: metadataUrl,
		sha512: sha512(metadataBytes),
		size: metadataBytes.length,
	})
	const mac = fixture.artifacts.find((item) => item.platform === 'darwin' && item.arch === 'arm64')!
	fixture.manifest.schemaVersion = 2
	fixture.manifest.distribution = { mode: 'platform-unsigned' }
	fixture.manifest.artifacts = [mac, exe, yaml]
	fixture.policy.schemaVersion = 2
	fixture.policy.eventToken = `${Buffer.from(
		JSON.stringify({
			schemaVersion: 1,
			releaseId: fixture.manifest.releaseId,
			installIdHash: createHash('sha256')
				.update(['wenxue-update-event-v1', 'electron', 'stable', '0.1.0', INSTALL_ID].join('\0'))
				.digest('hex'),
			runtime: 'electron',
			platform,
			arch: platform === 'darwin' ? 'arm64' : 'x64',
			fromVersion: '0.1.0',
			expiresAt: NOW + 6 * 24 * 60 * 60 * 1000,
		}),
	).toString('base64url')}.fixture-signature`
	fixture.policy.distribution = { mode: 'platform-unsigned' }
	fixture.policy.artifacts = platform === 'darwin' ? [mac] : [exe, yaml]
	fixture.policy.manifestSignature = signManifest(fixture.manifest, fixture.privateKey)
	const originalFetch = fixture.fetchImpl
	fixture.fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		if (String(input) === metadataUrl) return new Response(new Uint8Array(metadataBytes))
		if (String(input) === exe.url) return new Response(new Uint8Array(exeBytes))
		if (platform === 'win32' && new URL(String(input)).pathname === '/v1/client/update-events') {
			fixture.events.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
			return new Response(null, { status: 202 })
		}
		return originalFetch(input, init)
	})
	return {
		fixture,
		exe,
		metadata,
		setMetadataBytes: (bytes: Buffer) => {
			metadataBytes = bytes
		},
	}
}

function createNsisPort(info: unknown, installerPath: string): NsisUpdaterPort {
	return {
		autoDownload: true,
		autoInstallOnAppQuit: true,
		disableDifferentialDownload: false,
		disableWebInstaller: false,
		allowDowngrade: false,
		setFeedURL: vi.fn(),
		checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: info })),
		downloadUpdate: vi.fn(async () => [installerPath]),
		quitAndInstall: vi.fn(),
		on: vi.fn(),
		removeListener: vi.fn(),
	}
}

describe('DesktopUpdateService platform-unsigned flow', () => {
	it('opens only a fresh signed Windows installer URL for manual fallback', async () => {
		const { fixture, exe, setMetadataBytes } = createV2Fixture('win32')
		const openExternal = vi.fn(async () => undefined)
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			openExternal,
		})
		await service.check('manual')
		setMetadataBytes(Buffer.from('tampered metadata'))
		await expect(service.download()).rejects.toThrow()
		expect(service.state()).toMatchObject({ phase: 'error', manualDownloadAvailable: true })
		await service.openManualDownload()
		expect(openExternal).toHaveBeenCalledWith(exe.url)
		expect(openExternal).toHaveBeenCalledTimes(1)
		expect(service.state().phase).toBe('error')
		fixture.setPolicyMode('withdrawn')
		await expect(service.openManualDownload()).rejects.toThrow('暂停、撤回或替换')
		expect(openExternal).toHaveBeenCalledTimes(1)
	})

	it('does not open a manual Windows download after stop during policy revalidation', async () => {
		const { fixture, setMetadataBytes } = createV2Fixture('win32')
		const openExternal = vi.fn(async () => undefined)
		let holdPolicy = false
		let releasePolicy: (() => void) | undefined
		const originalFetch = fixture.fetchImpl
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			if (holdPolicy && new URL(String(input)).pathname === '/v1/client/update-policy') {
				await new Promise<void>((resolve) => {
					releasePolicy = resolve
				})
			}
			return originalFetch(input, init)
		})
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			openExternal,
			fetchImpl,
		})
		await service.check('manual')
		setMetadataBytes(Buffer.from('tampered metadata'))
		await expect(service.download()).rejects.toThrow()
		holdPolicy = true
		const pending = service.openManualDownload()
		await vi.waitFor(() => expect(releasePolicy).toBeDefined())
		service.stop()
		releasePolicy?.()
		await expect(pending).rejects.toThrow('已取消')
		expect(openExternal).not.toHaveBeenCalled()
	})
	it('records a guarded Mac handoff before opening and confirms only when the signed target starts', async () => {
		const { fixture } = createV2Fixture('darwin')
		const attemptPath = path.join(tempDir, 'update-install-attempt.json')
		const { service } = createService(fixture, {
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => true)
				return true
			},
			openPath: async () => {
				const stored = JSON.parse(await readFile(attemptPath, 'utf8')) as Record<string, unknown>
				expect(stored.handoff).toBe('prepared')
				return ''
			},
		})
		await service.check('manual')
		await service.download()
		await service.openInstaller()
		const stored = JSON.parse(await readFile(attemptPath, 'utf8')) as Record<string, unknown>
		expect(stored).toMatchObject({
			fromVersion: '0.1.0',
			targetVersion: '0.1.1',
			handoff: 'accepted',
		})
		expect(stored).not.toHaveProperty('path')
		const old = createService(fixture).service
		old.start()
		await vi.waitFor(() => expect(old.state().lastInstallAttempt?.status).toBe('unconfirmed'))
		expect(fixture.events.filter((event) => event.stage === 'target-started')).toHaveLength(0)
		old.stop()
		fixture.setPolicyMode('offline')
		const target = createService(fixture, { currentVersion: '0.1.1' }).service
		target.start()
		await vi.waitFor(() => expect(target.state().lastInstallAttempt?.status).toBe('confirmed'))
		expect(fixture.events.filter((event) => event.stage === 'target-started')).toMatchObject([
			{
				result: 'success',
				fromVersion: '0.1.0',
				targetVersion: '0.1.1',
				artifactSha512: expect.any(String),
			},
		])
		await expect(readFile(attemptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
		target.stop()
	})

	it('discards a prepared attempt when the final guard declines after persistence', async () => {
		const { fixture } = createV2Fixture('darwin')
		let checks = 0
		const { service, openPath } = createService(fixture, {
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => ++checks === 1)
				return true
			},
		})
		await service.check('manual')
		await service.download()
		await expect(service.openInstaller()).rejects.toThrow('已取消')
		expect(openPath).not.toHaveBeenCalled()
		expect(service.state().lastInstallAttempt).toBeUndefined()
		await expect(
			readFile(path.join(tempDir, 'update-install-attempt.json'), 'utf8'),
		).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('rejects altered or expired attempts and never confirms a third version', async () => {
		const { fixture } = createV2Fixture('darwin')
		const attemptPath = path.join(tempDir, 'update-install-attempt.json')
		const { service } = createService(fixture, {
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => true)
				return true
			},
		})
		await service.check('manual')
		await service.download()
		await service.openInstaller()
		const original = await readFile(attemptPath, 'utf8')
		for (const mutated of [
			{ ...(JSON.parse(original) as Record<string, unknown>), artifactSha512: sha512('wrong') },
			{ ...(JSON.parse(original) as Record<string, unknown>), expiresAt: NOW - 1 },
			{ ...(JSON.parse(original) as Record<string, unknown>), eventToken: 'x'.repeat(4_097) },
		]) {
			await writeFile(attemptPath, JSON.stringify(mutated))
			const target = createService(fixture, { currentVersion: '0.1.1' }).service
			target.start()
			await vi.waitFor(async () =>
				expect(await readdir(tempDir)).not.toContain('update-install-attempt.json'),
			)
			expect(target.state().lastInstallAttempt).toBeUndefined()
			target.stop()
		}
		await writeFile(attemptPath, original)
		const third = createService(fixture, { currentVersion: '0.1.2' }).service
		third.start()
		await vi.waitFor(async () =>
			expect(await readdir(tempDir)).not.toContain('update-install-attempt.json'),
		)
		expect(fixture.events.filter((event) => event.stage === 'target-started')).toHaveLength(0)
		third.stop()
	})

	it('retries a target-started event after network failure, then clears the local secret', async () => {
		const { fixture } = createV2Fixture('darwin')
		const { service } = createService(fixture, {
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => true)
				return true
			},
		})
		await service.check('manual')
		await service.download()
		await service.openInstaller()
		let offline = true
		const originalFetch = fixture.fetchImpl
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			if (
				new URL(String(input)).pathname === '/v1/client/update-events' &&
				JSON.parse(String(init?.body)).stage === 'target-started' &&
				offline
			) {
				throw new TypeError('offline')
			}
			return originalFetch(input, init)
		})
		const target = createService(fixture, { currentVersion: '0.1.1', fetchImpl }).service
		target.start()
		await vi.waitFor(() => expect(target.state().lastInstallAttempt?.status).toBe('unconfirmed'))
		offline = false
		await target.check('manual')
		await vi.waitFor(() => expect(target.state().lastInstallAttempt?.status).toBe('confirmed'))
		expect(fixture.events.filter((event) => event.stage === 'target-started')).toHaveLength(1)
		target.stop()
	})

	it('ends confirmation on HTTP 401 without claiming an installed target', async () => {
		const { fixture } = createV2Fixture('darwin')
		const { service } = createService(fixture, {
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => true)
				return true
			},
		})
		await service.check('manual')
		await service.download()
		await service.openInstaller()
		const originalFetch = fixture.fetchImpl
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) =>
			new URL(String(input)).pathname === '/v1/client/update-events' &&
			JSON.parse(String(init?.body)).stage === 'target-started'
				? new Response(null, { status: 401 })
				: originalFetch(input, init),
		)
		const target = createService(fixture, { currentVersion: '0.1.1', fetchImpl }).service
		target.start()
		await vi.waitFor(async () =>
			expect(await readdir(tempDir)).not.toContain('update-install-attempt.json'),
		)
		expect(target.state().lastInstallAttempt?.status).not.toBe('confirmed')
		target.stop()
	})

	it('does not publish confirmation after stop while the event request is pending', async () => {
		const { fixture } = createV2Fixture('darwin')
		const { service } = createService(fixture, {
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => true)
				return true
			},
		})
		await service.check('manual')
		await service.download()
		await service.openInstaller()
		let finishEvent: (() => void) | undefined
		const originalFetch = fixture.fetchImpl
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			if (
				new URL(String(input)).pathname === '/v1/client/update-events' &&
				JSON.parse(String(init?.body)).stage === 'target-started'
			) {
				return new Promise<Response>((resolve) => {
					finishEvent = () => resolve(new Response(null, { status: 202 }))
				})
			}
			return originalFetch(input, init)
		})
		const onStateChange = vi.fn()
		const target = createService(fixture, {
			currentVersion: '0.1.1',
			fetchImpl,
			onStateChange,
		}).service
		target.start()
		await vi.waitFor(() => expect(finishEvent).toBeDefined())
		const stateCount = onStateChange.mock.calls.length
		target.stop()
		finishEvent?.()
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(onStateChange).toHaveBeenCalledTimes(stateCount)
		expect(target.state().lastInstallAttempt?.status).toBe('unconfirmed')
		expect(await readdir(tempDir)).toContain('update-install-attempt.json')
	})
	it('keeps workspace access available for schema 2 optional policy and rejects mandatory', async () => {
		const { fixture } = createV2Fixture('darwin')
		const { service } = createService(fixture)
		await service.check('manual')
		await expect(service.assertWorkspaceAllowed()).resolves.toBeUndefined()
		fixture.policy.mode = 'mandatory'
		await expect(service.check('manual')).resolves.toMatchObject({ phase: 'error' })
		await expect(service.assertWorkspaceAllowed()).resolves.toBeUndefined()
	})

	it('starts a schema 2 Mac background download only for a rollout-eligible policy', async () => {
		const { fixture } = createV2Fixture('darwin')
		const { service } = createService(fixture)
		service.start()
		await service.check('manual')
		await vi.waitFor(() => expect(service.state().phase).toBe('ready'))
		expect(service.state()).toMatchObject({ release: { installAction: 'open-dmg' } })
		service.stop()
		const ineligible = createV2Fixture('darwin').fixture
		ineligible.policy.percentage = 1
		const second = createService(ineligible).service
		second.start()
		await second.check('manual')
		expect(second.state().phase).toBe('idle')
		second.stop()
	})

	it('requires a guard and a fresh policy for Mac DMG handoff', async () => {
		const { fixture } = createV2Fixture('darwin')
		const { service, openPath } = createService(fixture)
		await service.check('manual')
		await service.download()
		await expect(service.openInstaller()).rejects.toThrow('安全退出协调不可用')
		expect(openPath).not.toHaveBeenCalled()
		const guarded = createService(fixture, {
			withInstallGuard: async (_intent, operation) => {
				fixture.setPolicyMode('withdrawn')
				await operation(async () => true)
				return true
			},
		})
		await guarded.service.check('manual')
		await expect(guarded.service.openInstaller()).rejects.toThrow('暂停、撤回或替换')
		expect(guarded.openPath).not.toHaveBeenCalled()
	})

	it('keeps a verified Mac DMG ready when the user cancels the guard', async () => {
		const { fixture } = createV2Fixture('darwin')
		const { service, openPath } = createService(fixture, {
			withInstallGuard: async () => false,
		})
		await service.check('manual')
		await service.download()
		await expect(service.openInstaller()).rejects.toThrow('已取消')
		expect(service.state().phase).toBe('ready')
		expect(openPath).not.toHaveBeenCalled()
	})

	it('rejects tampered metadata and never calls the Windows updater', async () => {
		const { fixture, setMetadataBytes } = createV2Fixture('win32')
		setMetadataBytes(Buffer.from('tampered'))
		const createNsisUpdater = vi.fn(async () => createNsisPort({}, 'unused'))
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater,
		})
		await service.check('manual')
		await expect(service.download()).rejects.toThrow('元数据哈希或大小校验失败')
		expect(createNsisUpdater).not.toHaveBeenCalled()
	})

	it('rejects updater-selected extras and tampered installer bytes', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, 'tampered')
		const selected: Record<string, unknown> = { ...metadata, packages: { x64: {} } }
		const updater = createNsisPort(selected, installerPath)
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
		})
		await service.check('manual')
		await expect(service.download()).rejects.toThrow('元数据字段无效')
		expect(updater.downloadUpdate).not.toHaveBeenCalled()
		selected.packages = undefined
		const second = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => createNsisPort(metadata, installerPath),
		}).service
		await second.check('manual')
		await expect(second.download()).rejects.toThrow('大小校验失败')
	})

	it('never installs on quit without an explicit guard', async () => {
		const { fixture, metadata, exe } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
		})
		await service.check('manual')
		expect(service.state()).toMatchObject({ release: { installAction: 'restart' } })
		await service.download()
		expect(updater.autoDownload).toBe(false)
		expect(updater.autoInstallOnAppQuit).toBe(false)
		expect(updater.disableDifferentialDownload).toBe(true)
		expect(updater.disableWebInstaller).toBe(true)
		expect(updater.allowDowngrade).toBe(false)
		expect(await service.installOnQuit()).toBe(false)
		expect(updater.quitAndInstall).not.toHaveBeenCalled()
		expect(exe.sha512).toBe(sha512(await readFile(installerPath)))
	})

	it('revalidates policy and installer inside the Windows guard before restart', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		let allow = false
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => allow)
				return true
			},
		})
		await service.check('manual')
		await service.download()
		await expect(service.restartInstall()).rejects.toThrow('已取消')
		expect(updater.quitAndInstall).not.toHaveBeenCalled()
		expect(fixture.events.filter((event) => event.stage === 'handoff')).toEqual([])
		allow = true
		await writeFile(installerPath, 'tampered')
		await expect(service.restartInstall()).rejects.toThrow('大小校验失败')
		expect(updater.quitAndInstall).not.toHaveBeenCalled()
	})

	it('hands off a verified NSIS only after the final guard check', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		updater.quitAndInstall = vi.fn(() => {
			const stored = JSON.parse(
				readFileSync(path.join(tempDir, 'update-install-attempt.json'), 'utf8'),
			) as Record<string, unknown>
			expect(stored.handoff).toBe('prepared')
		})
		const withInstallGuard = vi.fn(
			async (
				_intent: 'open-dmg' | 'restart' | 'quit',
				operation: (canInstall: () => Promise<boolean>) => Promise<void>,
			) => {
				await operation(async () => true)
				return true
			},
		)
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
			withInstallGuard,
		})
		await service.check('manual')
		await service.download()
		await expect(service.restartInstall()).resolves.toMatchObject({ phase: 'handedOff' })
		expect(withInstallGuard).toHaveBeenCalledWith('restart', expect.any(Function))
		expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
		await vi.waitFor(() =>
			expect(
				fixture.events.filter((event) => event.stage === 'handoff').map((event) => event.result),
			).toEqual(['start', 'success']),
		)
		const secondUpdater = createNsisPort(metadata, installerPath)
		const second = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => secondUpdater,
			withInstallGuard,
		}).service
		await second.check('manual')
		await second.download()
		await expect(second.installOnQuit()).resolves.toBe(true)
		expect(secondUpdater.quitAndInstall).toHaveBeenCalledWith(true, false)
		await vi.waitFor(() =>
			expect(
				fixture.events.filter((event) => event.stage === 'handoff').map((event) => event.result),
			).toEqual(['start', 'success', 'start', 'success']),
		)
	})

	it('invalidates a tampered updater cache on the next policy check', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
		})
		await service.check('manual')
		await service.download()
		await writeFile(installerPath, 'tampered')
		await expect(service.check('manual')).resolves.toMatchObject({ phase: 'available' })
		expect(updater.quitAndInstall).not.toHaveBeenCalled()
		expect(updater.removeListener).toHaveBeenCalledWith('error', expect.any(Function))
		expect(updater.removeListener).toHaveBeenCalledWith('download-progress', expect.any(Function))
	})

	it('reports Windows progress and refuses a synchronous updater handoff error', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		let releaseDownload: (() => void) | undefined
		updater.downloadUpdate = vi.fn(
			() =>
				new Promise<string[]>((resolve) => {
					releaseDownload = () => resolve([installerPath])
				}),
		)
		const listeners = new Map<string, (value: never) => void>()
		updater.on = vi.fn((event, listener) => {
			listeners.set(event, listener)
		}) as NsisUpdaterPort['on']
		updater.quitAndInstall = vi.fn(() =>
			listeners.get('error')?.(new Error('spawn failed') as never),
		)
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => true)
				return true
			},
		})
		await service.check('manual')
		const pending = service.download()
		await vi.waitFor(() => expect(listeners.has('download-progress')).toBe(true))
		await vi.waitFor(() => expect(releaseDownload).toBeDefined())
		listeners.get('download-progress')?.({
			percent: 55,
			transferred: 11,
			total: 20,
			bytesPerSecond: 5,
		} as never)
		expect(service.state()).toMatchObject({ phase: 'downloading', progress: { percent: 55 } })
		releaseDownload?.()
		await pending
		await expect(service.restartInstall()).rejects.toThrow('spawn failed')
		expect(service.state().phase).toBe('error')
		await vi.waitFor(async () =>
			expect(
				JSON.parse(await readFile(path.join(tempDir, 'update-install-attempt.json'), 'utf8')),
			).toMatchObject({ handoff: 'failed' }),
		)
		await vi.waitFor(() =>
			expect(
				fixture.events.filter((event) => event.stage === 'handoff').map((event) => event.result),
			).toEqual(['start', 'failure']),
		)
		await expect(service.check('manual')).resolves.toMatchObject({ phase: 'available' })
		expect(updater.removeListener).toHaveBeenCalledWith('error', expect.any(Function))
		const target = createService(fixture, {
			currentVersion: '0.1.1',
			platform: 'win32',
			arch: 'x64',
		}).service
		target.start()
		await vi.waitFor(() => expect(target.state().lastInstallAttempt?.status).toBe('failed'))
		expect(fixture.events.filter((event) => event.stage === 'target-started')).toHaveLength(0)
		target.stop()
	})

	it('reports an asynchronous NSIS handoff error after updater accepts the request', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		const nextUpdater = createNsisPort(metadata, installerPath)
		let updaterCreates = 0
		let onError: ((error: Error) => void) | undefined
		updater.on = vi.fn((event, listener) => {
			if (event === 'error') onError = listener
		}) as NsisUpdaterPort['on']
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => (++updaterCreates === 1 ? updater : nextUpdater),
			withInstallGuard: async (_intent, operation) => {
				await operation(async () => true)
				return true
			},
		})
		await service.check('manual')
		await service.download()
		await service.restartInstall()
		onError?.(new Error('installer spawn failed'))
		expect(service.state()).toMatchObject({ phase: 'error', message: 'installer spawn failed' })
		await vi.waitFor(async () =>
			expect(
				JSON.parse(await readFile(path.join(tempDir, 'update-install-attempt.json'), 'utf8')),
			).toMatchObject({ handoff: 'failed' }),
		)
		await vi.waitFor(() =>
			expect(
				fixture.events.filter((event) => event.stage === 'handoff').map((event) => event.result),
			).toEqual(['start', 'success', 'failure']),
		)
		await service.check('manual')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		await service.download()
		await service.restartInstall()
		const nextAttempt = JSON.parse(
			await readFile(path.join(tempDir, 'update-install-attempt.json'), 'utf8'),
		) as Record<string, unknown>
		expect(nextAttempt.handoff).toBe('accepted')
		onError?.(new Error('late error from the previous updater'))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(
			JSON.parse(await readFile(path.join(tempDir, 'update-install-attempt.json'), 'utf8')),
		).toMatchObject({
			attemptId: nextAttempt.attemptId,
			handoff: 'accepted',
		})
	})

	it('does not mark a download ready when policy is withdrawn during transfer', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		updater.downloadUpdate = vi.fn(async () => {
			fixture.setPolicyMode('withdrawn')
			return [installerPath]
		})
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
		})
		await service.check('manual')
		await expect(service.download()).rejects.toThrow('暂停、撤回或替换')
		expect(service.state().phase).toBe('idle')
		expect(updater.quitAndInstall).not.toHaveBeenCalled()
	})

	it('cancels a Windows transfer on stop and discards its queued signal check', async () => {
		const { fixture, metadata } = createV2Fixture('win32')
		const installerPath = path.join(tempDir, 'download.exe')
		await writeFile(installerPath, Buffer.from('manual-unsigned-windows-installer'))
		const updater = createNsisPort(metadata, installerPath)
		let releaseDownload: (() => void) | undefined
		let cancellationToken: Parameters<NsisUpdaterPort['downloadUpdate']>[0]
		updater.downloadUpdate = vi.fn((token) => {
			cancellationToken = token
			return new Promise<string[]>((resolve) => {
				releaseDownload = () => resolve([installerPath])
			})
		})
		const { service } = createService(fixture, {
			platform: 'win32',
			arch: 'x64',
			createNsisUpdater: async () => updater,
		})
		await service.check('manual')
		const pending = service.download()
		await vi.waitFor(() => expect(releaseDownload).toBeDefined())
		await expect(service.check('signal')).resolves.toMatchObject({ phase: 'downloading' })
		const policyRequests = () =>
			vi
				.mocked(fixture.fetchImpl)
				.mock.calls.filter(([input]) => String(input).startsWith(POLICY_URL)).length
		const beforeStop = policyRequests()
		service.stop()
		expect(cancellationToken?.cancelled).toBe(true)
		releaseDownload?.()
		await expect(pending).rejects.toThrow('已取消')
		await new Promise((resolve) => setImmediate(resolve))
		expect(service.state().phase).not.toBe('ready')
		expect(policyRequests()).toBe(beforeStop)
		expect(updater.removeListener).toHaveBeenCalledWith('error', expect.any(Function))
	})
})
