import { describe, expect, it, vi } from 'vitest'
import { executeSafeSignOut } from './safeSignOut'

function createHarness() {
	const calls: string[] = []
	const prepareSignOut = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => {
		calls.push('prepare')
		return { ok: true }
	})
	const signOutCloud = vi.fn(async () => {
		calls.push('cloud')
	})
	const hasCloudSession = vi.fn(async () => {
		calls.push('cloud-state')
		return true
	})
	const clearSession = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => {
		calls.push('clear')
		return { ok: true }
	})
	const cancelSignOut = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => {
		calls.push('cancel')
		return { ok: true }
	})

	return { calls, prepareSignOut, signOutCloud, hasCloudSession, clearSession, cancelSignOut }
}

describe('executeSafeSignOut', () => {
	it('prepares browsers before cloud sign-out and clears the main session last', async () => {
		const harness = createHarness()

		await executeSafeSignOut(harness)

		expect(harness.calls).toEqual(['prepare', 'cloud', 'clear'])
		expect(harness.cancelSignOut).not.toHaveBeenCalled()
	})

	it('does not sign out or clear the session when browser preparation fails', async () => {
		const harness = createHarness()
		harness.prepareSignOut.mockResolvedValueOnce({ ok: false, error: 'still running' })

		await expect(executeSafeSignOut(harness)).rejects.toThrow('still running')

		expect(harness.calls).toEqual([])
		expect(harness.signOutCloud).not.toHaveBeenCalled()
		expect(harness.clearSession).not.toHaveBeenCalled()
		expect(harness.cancelSignOut).not.toHaveBeenCalled()
	})

	it('cancels the prepared main-process guard when cloud sign-out fails', async () => {
		const harness = createHarness()
		harness.signOutCloud.mockImplementationOnce(async () => {
			harness.calls.push('cloud')
			throw new Error('offline')
		})

		await expect(executeSafeSignOut(harness)).rejects.toThrow('offline')

		expect(harness.calls).toEqual(['prepare', 'cloud', 'cloud-state', 'cancel'])
		expect(harness.clearSession).not.toHaveBeenCalled()
	})

	it('keeps the guard when cloud sign-out succeeds but main-session clearing fails', async () => {
		const harness = createHarness()
		harness.clearSession.mockImplementationOnce(async () => {
			harness.calls.push('clear')
			return { ok: false, error: 'clear failed' }
		})

		await expect(executeSafeSignOut(harness)).rejects.toThrow(
			'clear failed；云端已退出，但本地收尾未完成，为保护本机档案已保持退出锁定，请重新打开问学。',
		)
		expect(harness.calls).toEqual(['prepare', 'cloud', 'clear'])
		expect(harness.cancelSignOut).not.toHaveBeenCalled()
	})

	it('reports both the original and recovery errors when cancelling the guard fails', async () => {
		const harness = createHarness()
		harness.signOutCloud.mockImplementationOnce(async () => {
			harness.calls.push('cloud')
			throw new Error('offline')
		})
		harness.cancelSignOut.mockImplementationOnce(async () => {
			harness.calls.push('cancel')
			throw new Error('cancel failed')
		})

		await expect(executeSafeSignOut(harness)).rejects.toThrow(
			'offline；退出保护恢复失败，请重新打开问学：cancel failed',
		)
		expect(harness.calls).toEqual(['prepare', 'cloud', 'cloud-state', 'cancel'])
	})

	it('treats an unsuccessful cancel result as a guard recovery failure', async () => {
		const harness = createHarness()
		harness.signOutCloud.mockRejectedValueOnce(new Error('offline'))
		harness.cancelSignOut.mockImplementationOnce(async () => {
			harness.calls.push('cancel')
			return { ok: false, error: 'busy' }
		})

		await expect(executeSafeSignOut(harness)).rejects.toThrow(
			'offline；退出保护恢复失败，请重新打开问学：busy',
		)
	})

	it('keeps the guard when a timed-out cloud sign-out has an unknown outcome', async () => {
		const harness = createHarness()
		harness.signOutCloud.mockImplementationOnce(async () => {
			harness.calls.push('cloud')
			throw Object.assign(new Error('timeout'), { cloudSignOutOutcome: 'unknown' })
		})

		await expect(executeSafeSignOut(harness)).rejects.toThrow(
			'timeout；退出结果暂时无法确认，为保护本机档案已保持退出锁定，请重新打开问学。',
		)
		expect(harness.calls).toEqual(['prepare', 'cloud'])
		expect(harness.hasCloudSession).not.toHaveBeenCalled()
		expect(harness.cancelSignOut).not.toHaveBeenCalled()
		expect(harness.clearSession).not.toHaveBeenCalled()
	})

	it('keeps the guard when a settled sign-out error cannot be followed by a session check', async () => {
		const harness = createHarness()
		harness.signOutCloud.mockImplementationOnce(async () => {
			harness.calls.push('cloud')
			throw new Error('sdk error')
		})
		harness.hasCloudSession.mockImplementationOnce(async () => {
			harness.calls.push('cloud-state')
			throw new Error('lookup failed')
		})

		await expect(executeSafeSignOut(harness)).rejects.toThrow(
			'sdk error；无法确认云端登录状态，为保护本机档案已保持退出锁定，请重新打开问学：lookup failed',
		)
		expect(harness.calls).toEqual(['prepare', 'cloud', 'cloud-state'])
		expect(harness.cancelSignOut).not.toHaveBeenCalled()
		expect(harness.clearSession).not.toHaveBeenCalled()
	})

	it('finishes local clearing when a settled cloud error left no cloud session', async () => {
		const harness = createHarness()
		harness.signOutCloud.mockImplementationOnce(async () => {
			harness.calls.push('cloud')
			throw new Error('sdk error')
		})
		harness.hasCloudSession.mockImplementationOnce(async () => {
			harness.calls.push('cloud-state')
			return false
		})

		await executeSafeSignOut(harness)

		expect(harness.calls).toEqual(['prepare', 'cloud', 'cloud-state', 'clear'])
		expect(harness.cancelSignOut).not.toHaveBeenCalled()
	})
})
