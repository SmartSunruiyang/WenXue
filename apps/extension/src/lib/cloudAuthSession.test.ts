import { describe, expect, it, vi } from 'vitest'
import {
	WENXUE_CLOUD_AUTH_SESSION_KEY,
	loadExtensionCloudAuthSession,
	normalizeExtensionCloudAuthSession,
	saveExtensionCloudAuthSession,
	type CloudAuthStorageArea,
} from '@/lib/cloudAuthSession'

describe('cloudAuthSession', () => {
	it('normalizes external product-user sessions only', () => {
		expect(
			normalizeExtensionCloudAuthSession({
				uid: '2071249607247777793',
				username: 'product-user',
				type: 'external',
				accessToken: 'access-token',
				expiresAt: 100_000,
				envId: 'wenxue-d8gz76tacc3659f05',
				region: 'ap-shanghai',
				gatewayBaseUrl: 'https://gateway.example',
			}),
		).toEqual({
			uid: '2071249607247777793',
			username: 'product-user',
			name: undefined,
			type: 'external',
			accessToken: 'access-token',
			expiresAt: 100_000,
			envId: 'wenxue-d8gz76tacc3659f05',
			region: 'ap-shanghai',
			gatewayBaseUrl: 'https://gateway.example',
		})

		expect(
			normalizeExtensionCloudAuthSession({
				uid: 'internal-uid',
				type: 'internal',
				accessToken: 'access-token',
				expiresAt: 100_000,
				envId: 'wenxue-d8gz76tacc3659f05',
				region: 'ap-shanghai',
				gatewayBaseUrl: 'https://gateway.example',
			}),
		).toBeNull()
		expect(normalizeExtensionCloudAuthSession({ uid: 'u', type: 'external' })).toBeNull()
	})

	it('saves and loads the session from chrome storage shape', async () => {
		const backing = new Map<string, unknown>()
		const storage: CloudAuthStorageArea = {
			get: vi.fn(async (keys) => {
				const key = Array.isArray(keys) ? keys[0] : keys
				return { [key]: backing.get(key) }
			}),
			set: vi.fn(async (values) => {
				Object.entries(values).forEach(([key, value]) => backing.set(key, value))
			}),
			remove: vi.fn(async (key) => {
				backing.delete(key)
			}),
		}

		await saveExtensionCloudAuthSession(storage, {
			uid: '2071249607247777793',
			type: 'external',
			accessToken: 'access-token',
			expiresAt: 100_000,
			envId: 'wenxue-d8gz76tacc3659f05',
			region: 'ap-shanghai',
			gatewayBaseUrl: 'https://gateway.example',
		})

		expect(storage.set).toHaveBeenCalledWith({
			[WENXUE_CLOUD_AUTH_SESSION_KEY]: expect.objectContaining({
				uid: '2071249607247777793',
				accessToken: 'access-token',
			}),
		})
		await expect(loadExtensionCloudAuthSession(storage)).resolves.toEqual(
			expect.objectContaining({ uid: '2071249607247777793' }),
		)
	})
})
