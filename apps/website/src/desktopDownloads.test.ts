import assert from 'node:assert/strict'
import test from 'node:test'
import {
	DesktopDownloads,
	desktopReleaseLabel,
	fetchDesktopDownloads,
	parseDesktopDownloads,
	recommendDownloadTarget,
	type DesktopRelease,
} from './desktopDownloads'

const release: DesktopRelease = {
	version: '1.2.3',
	publishedAt: '2026-09-29T00:00:00Z',
	artifacts: [
		{
			platform: 'darwin',
			arch: 'arm64',
			kind: 'dmg',
			url: 'https://downloads.example/mac.dmg',
			sha512: 'A'.repeat(86) + '==',
			size: 1024,
		},
		{
			platform: 'win32',
			arch: 'x64',
			kind: 'nsis',
			url: 'https://downloads.example/windows.exe',
			sha512: 'B'.repeat(86) + '==',
			size: 2048,
		},
	],
}
const response = (value: unknown) => ({ release: value })

test('only a complete stable or preview release with HTTPS installers is accepted', () => {
	assert.equal(parseDesktopDownloads(response(null)), null)
	assert.deepEqual(parseDesktopDownloads(response(release)), release)
	for (const version of [
		'1.2.3-beta.4',
		'1.2.3-rc.1',
		'01.2.3',
		'1.2.3-previewish',
		'1.2.3-preview.01',
	]) {
		assert.throws(() => parseDesktopDownloads(response({ ...release, version })))
	}
	for (const url of [
		'http://example.com/a',
		'javascript:alert(1)',
		'/local',
		'https://user:pass@example.com/a',
		'https://example.com/a#hash',
		'https://example.com/a?signature=temporary',
	]) {
		assert.throws(() =>
			parseDesktopDownloads(
				response({
					...release,
					artifacts: [{ ...release.artifacts[0], url }, release.artifacts[1]],
				}),
			),
		)
	}
	assert.throws(() =>
		parseDesktopDownloads(response({ ...release, artifacts: [release.artifacts[0]] })),
	)
	assert.throws(() =>
		parseDesktopDownloads(
			response({ ...release, artifacts: [release.artifacts[0], release.artifacts[0]] }),
		),
	)
	assert.throws(() =>
		parseDesktopDownloads(
			response({
				...release,
				artifacts: [{ ...release.artifacts[0], size: -1 }, release.artifacts[1]],
			}),
		),
	)
	assert.throws(() =>
		parseDesktopDownloads(
			response({
				...release,
				artifacts: [{ ...release.artifacts[0], sha512: 'invalid' }, release.artifacts[1]],
			}),
		),
	)
})

test('preview versions are accepted and labeled distinctly from stable versions', () => {
	for (const version of ['0.1.2-preview', '0.1.2-preview.1+build.2']) {
		const preview = { ...release, version }
		assert.deepEqual(parseDesktopDownloads(response(preview)), preview)
		assert.equal(desktopReleaseLabel(version), '预览版')
	}
	assert.equal(desktopReleaseLabel('0.1.2'), '正式版')
	assert.equal(desktopReleaseLabel('0.1.2+build-with-dashes'), '正式版')
})

test('preview download requires revalidation and changing to stable requires another click', async () => {
	const preview = { ...release, version: '0.1.2-preview' }
	let current: DesktopRelease | null = preview
	const downloads = new DesktopDownloads(async () => current, 'Windows')
	await downloads.refresh()
	const navigations: string[] = []
	await downloads.download((url) => navigations.push(url))
	assert.deepEqual(navigations, [preview.artifacts[1].url])
	current = release
	await downloads.download((url) => navigations.push(url))
	assert.equal(navigations.length, 1)
	assert.match(downloads.getSnapshot().message, /再次点击/)
	assert.equal(desktopReleaseLabel(downloads.getSnapshot().release!.version), '正式版')
	await downloads.download((url) => navigations.push(url))
	assert.equal(navigations.length, 2)
	current = null
	await downloads.download((url) => navigations.push(url))
	assert.equal(navigations.length, 2)
	assert.equal(downloads.getSnapshot().phase, 'empty')
})

test('public request bypasses caches and does not send credentials', async () => {
	const original = globalThis.fetch
	globalThis.fetch = async (input, init) => {
		assert.equal(input, '/v1/public/desktop-downloads')
		assert.equal(init?.cache, 'no-store')
		assert.equal(init?.credentials, 'omit')
		return new Response(JSON.stringify(response(release)))
	}
	try {
		assert.deepEqual(await fetchDesktopDownloads(new AbortController().signal), release)
	} finally {
		globalThis.fetch = original
	}
})

test('platform recommendation does not infer Mac architecture', () => {
	assert.equal(recommendDownloadTarget('Macintosh Intel Mac OS X'), 'mac')
	assert.equal(recommendDownloadTarget('Windows NT 10.0'), 'windows')
})

test('refresh immediately clears stale release and ignores older responses', async () => {
	const resolvers: ((value: DesktopRelease | null) => void)[] = []
	const downloads = new DesktopDownloads(
		() => new Promise((resolve) => resolvers.push(resolve)),
		'Mac',
	)
	const first = downloads.refresh()
	resolvers[0](release)
	await first
	const second = downloads.refresh()
	assert.equal(downloads.getSnapshot().release, null)
	const third = downloads.refresh()
	resolvers[2](null)
	await third
	resolvers[1](release)
	await second
	assert.equal(downloads.getSnapshot().phase, 'empty')
	assert.equal(downloads.getSnapshot().release, null)
})

test('click revalidation refuses withdrawn, unreachable and changed installers', async () => {
	for (const next of [
		null,
		new Error('offline'),
		{ ...release, version: '1.2.4' },
		{
			...release,
			artifacts: [{ ...release.artifacts[0], sha512: 'C'.repeat(86) + '==' }, release.artifacts[1]],
		},
	]) {
		let calls = 0
		const downloads = new DesktopDownloads(async () => {
			if (calls++ === 0) return release
			if (next instanceof Error) throw next
			return next
		}, 'Mac')
		await downloads.refresh()
		const navigations: string[] = []
		await downloads.download((url) => navigations.push(url))
		assert.deepEqual(navigations, [])
		if (next === null || next instanceof Error) assert.equal(downloads.getSnapshot().release, null)
		else assert.match(downloads.getSnapshot().message, /再次点击/)
	}
})

test('unchanged installer downloads only after revalidation and honors manual platform choice', async () => {
	let calls = 0
	const downloads = new DesktopDownloads(async () => {
		calls++
		return release
	}, 'Mac')
	await downloads.refresh()
	downloads.select('windows')
	const navigations: string[] = []
	await downloads.download((url) => navigations.push(url))
	assert.equal(calls, 2)
	assert.deepEqual(navigations, [release.artifacts[1].url])
})

test('a later refresh cancels pending click verification', async () => {
	let resolveClick: (value: DesktopRelease | null) => void = () => {}
	let calls = 0
	const downloads = new DesktopDownloads(() => {
		calls++
		if (calls === 2)
			return new Promise((resolve) => {
				resolveClick = resolve
			})
		return Promise.resolve(calls === 1 ? release : null)
	}, 'Mac')
	await downloads.refresh()
	const navigations: string[] = []
	const click = downloads.download((url) => navigations.push(url))
	assert.equal(downloads.getSnapshot().release, null)
	await downloads.refresh()
	resolveClick(release)
	await click
	assert.deepEqual(navigations, [])
	assert.equal(downloads.getSnapshot().phase, 'empty')
})

test('HTTP failure and malformed JSON never produce a release', async () => {
	const original = globalThis.fetch
	try {
		globalThis.fetch = async () => new Response('{}', { status: 503 })
		await assert.rejects(fetchDesktopDownloads(new AbortController().signal), /无法获取/)
		globalThis.fetch = async () => new Response('{invalid')
		await assert.rejects(fetchDesktopDownloads(new AbortController().signal), SyntaxError)
		globalThis.fetch = async () => new Response('{}')
		await assert.rejects(fetchDesktopDownloads(new AbortController().signal), /无效/)
	} finally {
		globalThis.fetch = original
	}
})

test('actual AbortSignal cancels an older request without overwriting current release', async () => {
	let calls = 0
	let cancelled = false
	const downloads = new DesktopDownloads((signal) => {
		if (++calls === 2) return Promise.resolve(release)
		return new Promise((_resolve, reject) => {
			signal.addEventListener(
				'abort',
				() => {
					cancelled = true
					reject(signal.reason)
				},
				{ once: true },
			)
		})
	}, 'Mac')
	const older = downloads.refresh()
	await downloads.refresh()
	await older
	assert.equal(cancelled, true)
	assert.equal(downloads.getSnapshot().phase, 'ready')
	assert.deepEqual(downloads.getSnapshot().release, release)
})

test('request timeout aborts the real signal and leaves no cached installer', async () => {
	let aborted = false
	const downloads = new DesktopDownloads(
		(signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener(
					'abort',
					() => {
						aborted = true
						reject(signal.reason)
					},
					{ once: true },
				)
			}),
		'Mac',
	)
	await downloads.refresh()
	assert.equal(aborted, true)
	assert.equal(downloads.getSnapshot().phase, 'error')
	assert.equal(downloads.getSnapshot().release, null)
})
