import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import * as adminTargets from '../../admin-api/src/index.mjs'
import * as targets from './index.mjs'

interface FunctionTarget {
	name: string
	target: string
	triggerPath: string
}

interface FunctionConfig {
	functions: FunctionTarget[]
}

const DISPATCH_PATHS = [
	'/api/admin/v1/announcements',
	'/api/admin/v1/announcement-withdraw',
	'/api/admin/v1/release-candidates',
	'/api/admin/v1/releases',
	'/api/admin/v1/release-publish',
	'/api/admin/v1/release-state',
	'/api/internal/v1/release-candidates/register',
	'/v1/client/announcements/pending',
	'/v1/client/announcement-ack',
	'/v1/client/update-policy',
	'/v1/client/update-events',
	'/v1/public/desktop-downloads',
] as const

describe('combined dispatch targets', () => {
	it.each([
		['adminReleaseCandidates', 'releaseCandidates'],
		['adminReleases', 'releases'],
		['adminReleasePublish', 'releasePublish'],
		['clientUpdatePolicy', 'clientUpdatePolicy'],
		['clientUpdateEvents', 'clientUpdateEvents'],
		['publicDesktopDownloads', 'publicDesktopDownloads'],
		['releaseCandidateRegister', 'releaseCandidateRegister'],
	] as const)(
		'reuses the standalone %s implementation without schema drift',
		(gatewayName, adminName) => {
			expect(targets[gatewayName]).toBe(adminTargets[adminName])
		},
	)

	it.each([
		['adminAnnouncements', targets.adminAnnouncements],
		['adminAnnouncementWithdraw', targets.adminAnnouncementWithdraw],
		['adminReleaseCandidates', targets.adminReleaseCandidates],
		['adminReleases', targets.adminReleases],
		['adminReleasePublish', targets.adminReleasePublish],
		['adminReleaseState', targets.adminReleaseState],
		['releaseCandidateRegister', targets.releaseCandidateRegister],
		['clientAnnouncementsPending', targets.clientAnnouncementsPending],
		['clientAnnouncementAck', targets.clientAnnouncementAck],
		['clientUpdatePolicy', targets.clientUpdatePolicy],
		['clientUpdateEvents', targets.clientUpdateEvents],
		['publicDesktopDownloads', targets.publicDesktopDownloads],
	])('exposes %s through the same AdminApi implementation', async (_name, target) => {
		const response = await target(
			{},
			{
				httpContext: {
					headers: {
						origin: 'https://desktop.example.test',
						'access-control-request-method': 'POST',
					},
				},
			},
		)

		expect(response.statusCode).toBe(204)
		expect(response.headers['access-control-allow-methods']).toContain('POST')
	})

	it('keeps standalone and combined CloudBase route paths in parity', async () => {
		const gatewayConfig = await readConfig(new URL('../cloudbase-functions.json', import.meta.url))
		const adminConfig = await readConfig(
			new URL('../../admin-api/cloudbase-functions.json', import.meta.url),
		)
		const gatewayPaths = new Set(gatewayConfig.functions.map((entry) => entry.triggerPath))
		const adminPaths = new Set(adminConfig.functions.map((entry) => entry.triggerPath))

		for (const path of DISPATCH_PATHS) {
			expect(gatewayPaths.has(path), `Gateway is missing ${path}`).toBe(true)
			expect(adminPaths.has(path), `AdminApi is missing ${path}`).toBe(true)
		}
	})
})

async function readConfig(url: URL): Promise<FunctionConfig> {
	return JSON.parse(await readFile(url, 'utf8')) as FunctionConfig
}
