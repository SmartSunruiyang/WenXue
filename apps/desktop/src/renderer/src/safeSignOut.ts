interface SignOutResult {
	ok: boolean
	error?: string
}

export interface SafeSignOutDependencies {
	prepareSignOut: () => Promise<SignOutResult>
	signOutCloud: () => Promise<void>
	hasCloudSession: () => Promise<boolean>
	clearSession: () => Promise<SignOutResult>
	cancelSignOut: () => Promise<SignOutResult>
}

export async function executeSafeSignOut(dependencies: SafeSignOutDependencies): Promise<void> {
	const prepareResult = await dependencies.prepareSignOut()
	if (!prepareResult.ok) {
		throw new Error(prepareResult.error ?? '浏览器未能安全关闭')
	}

	try {
		await dependencies.signOutCloud()
	} catch (error) {
		if (isCloudSignOutOutcomeUnknown(error)) {
			throw new Error(
				`${errorMessage(error)}；退出结果暂时无法确认，为保护本机档案已保持退出锁定，请重新打开问学。`,
			)
		}

		let cloudSessionStillActive: boolean
		try {
			cloudSessionStillActive = await dependencies.hasCloudSession()
		} catch (confirmationError) {
			throw new Error(
				`${errorMessage(error)}；无法确认云端登录状态，为保护本机档案已保持退出锁定，请重新打开问学：${errorMessage(confirmationError)}`,
			)
		}

		if (cloudSessionStillActive) {
			try {
				const cancelResult = await dependencies.cancelSignOut()
				if (!cancelResult.ok) {
					throw new Error(cancelResult.error ?? '主进程拒绝解除退出保护')
				}
			} catch (cancelError) {
				throw new Error(
					`${errorMessage(error)}；退出保护恢复失败，请重新打开问学：${errorMessage(cancelError)}`,
				)
			}
			throw error
		}
	}

	await clearPreparedMainSession(dependencies.clearSession)
}

async function clearPreparedMainSession(
	clearSession: SafeSignOutDependencies['clearSession'],
): Promise<void> {
	try {
		const clearResult = await clearSession()
		if (!clearResult.ok) {
			throw new Error(clearResult.error ?? '主进程 session 清理失败')
		}
	} catch (error) {
		throw new Error(
			`${errorMessage(error)}；云端已退出，但本地收尾未完成，为保护本机档案已保持退出锁定，请重新打开问学。`,
		)
	}
}

function isCloudSignOutOutcomeUnknown(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'cloudSignOutOutcome' in error &&
		error.cloudSignOutOutcome === 'unknown'
	)
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message
	return typeof error === 'string' && error ? error : '退出登录失败'
}
