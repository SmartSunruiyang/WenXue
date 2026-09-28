import assert from 'node:assert/strict'
import test from 'node:test'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AnnouncementDialog, UpdateDialog } from './react.mjs'

test('important announcements expose one fixed acknowledgement action and no close control', () => {
	const markup = renderToStaticMarkup(
		h(AnnouncementDialog, {
			presentation: 'preview',
			announcement: {
				id: 'announcement-1',
				importance: 'important',
				title: '维护通知',
				body: '请保存当前工作。',
				publishedAt: '2026-07-17T00:00:00.000Z',
				expiresAt: '2026-07-24T00:00:00.000Z',
			},
		}),
	)
	assert.match(markup, /我知道了/)
	assert.doesNotMatch(markup, /aria-label="关闭消息"/)
	assert.match(markup, /aria-labelledby=/)
})

test('normal announcements retain the fixed close control and safe detail hostname', () => {
	const markup = renderToStaticMarkup(
		h(AnnouncementDialog, {
			presentation: 'preview',
			announcement: {
				id: 'announcement-2',
				importance: 'normal',
				title: '功能说明',
				body: '查看完整说明。',
				detailUrl: 'https://docs.wenxue.example/releases/1',
				publishedAt: '2026-07-17T00:00:00.000Z',
				expiresAt: '2026-07-24T00:00:00.000Z',
			},
		}),
	)
	assert.match(markup, /aria-label="关闭消息"/)
	assert.match(markup, /docs\.wenxue\.example/)
})

test('announcement details are hidden unless the shared contract accepts HTTPS', () => {
	const markup = renderToStaticMarkup(
		h(AnnouncementDialog, {
			presentation: 'preview',
			announcement: {
				id: 'announcement-unsafe-link',
				importance: 'normal',
				title: '功能说明',
				body: '不应打开非 HTTPS 链接。',
				detailUrl: 'javascript:alert(1)',
				publishedAt: '2026-07-17T00:00:00.000Z',
				expiresAt: '2026-07-24T00:00:00.000Z',
			},
		}),
	)
	assert.doesNotMatch(markup, /查看详情/)
	assert.doesNotMatch(markup, /javascript:/)
})

test('mandatory updates expose download and exit actions without a later control', () => {
	const markup = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: {
				phase: 'available',
				release: {
					releaseId: 'release-1',
					version: '1.1.0',
					channel: 'stable',
					title: '需要更新问学',
					notes: '此版本包含关键修复。',
					mode: 'mandatory',
					distribution: { mode: 'manual-unsigned' },
					size: 120_000_000,
				},
			},
			onExit: () => undefined,
		}),
	)
	assert.match(markup, /下载更新/)
	assert.match(markup, /退出问学/)
	assert.match(markup, /未签名安装包/)
	assert.match(markup, /Gatekeeper/)
	assert.match(markup, /SmartScreen/)
	assert.doesNotMatch(markup, />稍后</)
	assert.doesNotMatch(markup, /aria-label="稍后更新"/)
})

test('ready manual downloads hand off to the operating-system installer without claiming success', () => {
	const markup = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: {
				phase: 'ready',
				release: {
					releaseId: 'release-1',
					version: '1.1.0',
					channel: 'stable',
					title: '问学 1.1.0 可用',
					notes: '安装包已经完成完整性校验。',
					mode: 'optional',
					distribution: { mode: 'manual-unsigned' },
					size: 120_000_000,
				},
			},
		}),
	)
	assert.match(markup, /打开安装包/)
	assert.doesNotMatch(markup, /重启并安装|安装成功/)
})

test('shows manual Windows fallback even when retry is unavailable, and describes only local attempt status', () => {
	const markup = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: {
				phase: 'error',
				message: '后台下载失败',
				retryable: false,
				manualDownloadAvailable: true,
				lastInstallAttempt: { targetVersion: '1.1.0', status: 'unconfirmed' },
			},
			onManualDownload: () => undefined,
		}),
	)
	assert.match(markup, /手动下载安装包/)
	assert.match(markup, /更新尝试已记录，等待新版启动确认/)
	assert.doesNotMatch(markup, /已交接/)
	assert.doesNotMatch(markup, />重试</)
	assert.doesNotMatch(markup, /安装成功/)
})

test('platform Windows update offers background download and both safe install intents', () => {
	const release = {
		releaseId: 'release-2',
		version: '2.0.0',
		channel: 'stable',
		title: '问学更新',
		notes: '平台更新',
		mode: 'optional',
		distribution: { mode: 'platform-unsigned' },
		installAction: 'restart',
		size: 100_000_000,
	}
	const available = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: { phase: 'available', release },
		}),
	)
	const ready = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: { phase: 'ready', release },
		}),
	)
	assert.match(available, /后台下载更新/)
	assert.match(ready, /退出并安装/)
	assert.match(ready, /立即重启更新/)
	assert.match(ready, /未签名安装包/)
	assert.doesNotMatch(ready, /打开安装包/)
})

test('platform macOS update explains the manual DMG replacement', () => {
	const markup = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: {
				phase: 'ready',
				release: {
					releaseId: 'release-2',
					version: '2.0.0',
					channel: 'stable',
					title: '问学更新',
					notes: '平台更新',
					mode: 'optional',
					distribution: { mode: 'platform-unsigned' },
					installAction: 'open-dmg',
					size: 100_000_000,
				},
			},
		}),
	)
	assert.match(markup, /打开 DMG/)
	assert.match(markup, /手动覆盖问学应用/)
	assert.match(markup, /未签名安装包/)
	assert.doesNotMatch(markup, /立即重启更新/)
})

test('beta update dialogs show the public version label', () => {
	const markup = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: {
				phase: 'available',
				release: {
					releaseId: 'electron-beta-0.0.1-beta',
					version: '0.0.1-beta',
					channel: 'beta',
					title: '问学 beta 更新',
					notes: '更新说明',
					mode: 'optional',
					distribution: { mode: 'manual-unsigned' },
					size: 120_000_000,
				},
			},
		}),
	)
	assert.match(markup, /v0\.0\.1beta · beta/)
})

test('preview update dialogs retain the preview label and beta channel', () => {
	const markup = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: {
				phase: 'available',
				release: {
					releaseId: 'electron-beta-0.1.2-preview',
					version: '0.1.2-preview',
					channel: 'beta',
					title: '问学预览版更新',
					notes: '更新说明',
					mode: 'optional',
					distribution: { mode: 'platform-unsigned' },
					size: 120_000_000,
				},
			},
		}),
	)
	assert.match(markup, /v0\.1\.2 preview · beta/)
	assert.doesNotMatch(markup, /stable/)
})

test('handed-off updates explain that installation completion is not observable', () => {
	const markup = renderToStaticMarkup(
		h(UpdateDialog, {
			presentation: 'preview',
			state: {
				phase: 'handedOff',
				release: {
					releaseId: 'release-1',
					version: '1.1.0',
					channel: 'stable',
					title: '问学 1.1.0 可用',
					notes: '安装包已打开。',
					mode: 'optional',
					distribution: { mode: 'manual-unsigned' },
					size: 120_000_000,
				},
			},
		}),
	)
	assert.match(markup, /安装包已打开/)
	assert.match(markup, /问学无法确认安装结果/)
	assert.match(markup, /再次打开安装包/)
	assert.doesNotMatch(markup, /安装成功/)
})
