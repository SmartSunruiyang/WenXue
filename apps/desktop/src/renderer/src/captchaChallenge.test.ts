import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	cancelLauncherCaptcha,
	configureLauncherCaptcha,
	getLauncherCaptchaSnapshot,
	refreshLauncherCaptcha,
	requestLauncherCaptcha,
	submitLauncherCaptcha,
	withCaptchaAwareTimeout,
} from './captchaChallenge'
import { strings } from './strings'

const IMAGE = 'data:image/png;base64,aGVsbG8='
const NEXT_IMAGE = 'data:image/png;base64,d29ybGQ='
const CHALLENGE_URL = `${IMAGE}?state=POST%3A%2Fsignin&token=image-secret`
const TOKEN = { captcha_token: 'verified-secret', expires_in: 120 }
const createCaptchaData = vi.fn<() => Promise<unknown>>()
const verifyCaptchaData = vi.fn<() => Promise<unknown>>()

function defer<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function openChallenge() {
	const result = requestLauncherCaptcha(CHALLENGE_URL)
	void result.catch(() => undefined)
	return result
}

beforeEach(() => {
	vi.useFakeTimers()
	createCaptchaData.mockReset().mockResolvedValue({ data: NEXT_IMAGE, token: 'refreshed-secret' })
	verifyCaptchaData.mockReset().mockResolvedValue(TOKEN)
	configureLauncherCaptcha({ createCaptchaData, verifyCaptchaData })
})

afterEach(() => {
	cancelLauncherCaptcha()
	vi.useRealTimers()
})

describe('launcher captcha', () => {
	it('exposes only the raster image and presentation state, and verifies through the SDK', async () => {
		const result = openChallenge()
		expect(getLauncherCaptchaSnapshot()).toEqual({
			id: expect.any(Number),
			image: IMAGE,
			status: 'ready',
			error: null,
		})
		await submitLauncherCaptcha(' ABCd ')
		expect(verifyCaptchaData).toHaveBeenCalledWith({ token: 'image-secret', key: 'ABCd' })
		await expect(result).resolves.toEqual(TOKEN)
		expect(getLauncherCaptchaSnapshot()).toBeNull()
	})

	it.each([
		'https://example.com/image.png?state=test&token=secret',
		'data:image/svg+xml;base64,PHN2Zz4=?state=test&token=secret',
		`${IMAGE}?token=secret`,
		`${IMAGE}?state=test`,
		IMAGE,
	])('rejects unsupported or incomplete challenge URLs: %s', async (url) => {
		await expect(requestLauncherCaptcha(url)).rejects.toThrow(strings.auth.captcha.unavailable)
		expect(getLauncherCaptchaSnapshot()).toBeNull()
	})

	it('keeps one active challenge and permits another after cancellation', async () => {
		const first = openChallenge()
		await expect(requestLauncherCaptcha(CHALLENGE_URL)).rejects.toThrow(
			strings.auth.captcha.unavailable,
		)
		cancelLauncherCaptcha()
		await expect(first).rejects.toThrow(strings.auth.captcha.cancelled)
		const second = openChallenge()
		await submitLauncherCaptcha('answer')
		await expect(second).resolves.toEqual(TOKEN)
	})

	it('allows a wrong answer to be retried without leaking SDK errors', async () => {
		verifyCaptchaData.mockRejectedValueOnce(new Error('private-token-and-server-details'))
		const result = openChallenge()
		await submitLauncherCaptcha('wrong')
		expect(getLauncherCaptchaSnapshot()).toMatchObject({ status: 'ready', error: 'invalid' })
		expect(JSON.stringify(getLauncherCaptchaSnapshot())).not.toContain('private-token')
		await submitLauncherCaptcha('correct')
		await expect(result).resolves.toEqual(TOKEN)
	})

	it('uses the refreshed challenge token for verification', async () => {
		const result = openChallenge()
		await refreshLauncherCaptcha()
		expect(createCaptchaData).toHaveBeenCalledWith({ state: 'POST:/signin' })
		expect(getLauncherCaptchaSnapshot()?.image).toBe(NEXT_IMAGE)
		await submitLauncherCaptcha('answer')
		expect(verifyCaptchaData).toHaveBeenCalledWith({ token: 'refreshed-secret', key: 'answer' })
		await expect(result).resolves.toEqual(TOKEN)
	})

	it('discards a refresh response arriving after cancellation and a newer challenge', async () => {
		const refresh = defer<unknown>()
		createCaptchaData.mockReturnValueOnce(refresh.promise)
		const first = openChallenge()
		const refreshing = refreshLauncherCaptcha()
		cancelLauncherCaptcha()
		await expect(first).rejects.toThrow(strings.auth.captcha.cancelled)
		const second = openChallenge()
		refresh.resolve({ data: NEXT_IMAGE, token: 'old-secret' })
		await refreshing
		expect(getLauncherCaptchaSnapshot()).toMatchObject({ image: IMAGE, status: 'ready' })
		await submitLauncherCaptcha('answer')
		expect(verifyCaptchaData).toHaveBeenCalledWith({ token: 'image-secret', key: 'answer' })
		await expect(second).resolves.toEqual(TOKEN)
	})

	it('does not resume the protected request when verification completes after cancellation', async () => {
		const verification = defer<unknown>()
		verifyCaptchaData.mockReturnValueOnce(verification.promise)
		const result = openChallenge()
		const submitting = submitLauncherCaptcha('answer')
		cancelLauncherCaptcha()
		await expect(result).rejects.toThrow(strings.auth.captcha.cancelled)
		verification.resolve(TOKEN)
		await submitting
		expect(getLauncherCaptchaSnapshot()).toBeNull()
	})

	it('bounds verification network waiting and keeps the challenge retryable', async () => {
		verifyCaptchaData.mockReturnValueOnce(new Promise(() => undefined))
		const result = openChallenge()
		const submitting = submitLauncherCaptcha('answer')
		await vi.advanceTimersByTimeAsync(12_000)
		await submitting
		expect(getLauncherCaptchaSnapshot()).toMatchObject({ status: 'ready', error: 'unavailable' })
		await submitLauncherCaptcha('retry')
		await expect(result).resolves.toEqual(TOKEN)
	})
})

describe('captcha-aware timeout', () => {
	it('times out a network operation without an active challenge', async () => {
		const operation = withCaptchaAwareTimeout(
			() => new Promise(() => undefined),
			12_000,
			() => new Error('network timeout'),
		)
		const assertion = expect(operation).rejects.toThrow('network timeout')
		await vi.advanceTimersByTimeAsync(12_000)
		await assertion
	})

	it('excludes user interaction while preserving the remaining network budget', async () => {
		const operation = withCaptchaAwareTimeout(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 5_000))
				await requestLauncherCaptcha(CHALLENGE_URL)
				await new Promise((resolve) => setTimeout(resolve, 7_001))
				return 'too late'
			},
			12_000,
			() => new Error('network timeout'),
		)
		const settled = vi.fn()
		void operation.then(settled, settled)
		const assertion = expect(operation).rejects.toThrow('network timeout')
		await vi.advanceTimersByTimeAsync(5_000)
		expect(getLauncherCaptchaSnapshot()).not.toBeNull()
		await vi.advanceTimersByTimeAsync(120_000)
		expect(settled).not.toHaveBeenCalled()
		await submitLauncherCaptcha('answer')
		await vi.advanceTimersByTimeAsync(6_999)
		expect(settled).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		await assertion
	})

	it('rejects promptly on cancellation and clears its timer', async () => {
		const operation = withCaptchaAwareTimeout(
			() => requestLauncherCaptcha(CHALLENGE_URL),
			12_000,
			() => new Error('network timeout'),
		)
		const assertion = expect(operation).rejects.toThrow(strings.auth.captcha.cancelled)
		await vi.advanceTimersByTimeAsync(0)
		cancelLauncherCaptcha()
		await assertion
		expect(vi.getTimerCount()).toBe(0)
	})
})
