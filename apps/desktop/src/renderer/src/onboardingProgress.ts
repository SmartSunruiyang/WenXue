export type OnboardingOutcome = 'completed' | 'skipped'
type OnboardingStatus = OnboardingOutcome | 'existing'
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>

export const ONBOARDING_VIDEO_SOURCES = [
	'onboarding/01-create.mp4',
	'onboarding/02-open.mp4',
	'onboarding/03-website.mp4',
	'onboarding/04-assistant.mp4',
	'onboarding/05-task.mp4',
	'onboarding/06-stop.mp4',
] as const

export function hasOnboardingMedia(availablePaths: readonly string[]): boolean {
	return ONBOARDING_VIDEO_SOURCES.every((source) => availablePaths.includes(`../public/${source}`))
}

const sessionProgress = new Map<string, OnboardingStatus>()

function progressKey(userId: string): string {
	return `wenxue:onboarding:v1:${encodeURIComponent(userId)}`
}

function readProgress(userId: string, storage?: ProgressStorage): OnboardingStatus | null {
	const cached = sessionProgress.get(userId)
	if (cached) return cached
	try {
		const saved = (storage ?? window.localStorage).getItem(progressKey(userId))
		if (saved === 'completed' || saved === 'skipped' || saved === 'existing') return saved
	} catch {
		return null
	}
	return null
}

function writeProgress(
	userId: string,
	status: OnboardingStatus,
	storage?: ProgressStorage,
): boolean {
	sessionProgress.set(userId, status)
	try {
		;(storage ?? window.localStorage).setItem(progressKey(userId), status)
		return true
	} catch {
		return false
	}
}

export function shouldOfferOnboarding(
	userId: string,
	profileCount: number,
	mediaAvailable: boolean,
	storage?: ProgressStorage,
): boolean {
	if (!mediaAvailable) return false
	if (readProgress(userId, storage)) return false
	if (profileCount > 0) {
		writeProgress(userId, 'existing', storage)
		return false
	}
	return true
}

export function finishOnboarding(
	userId: string,
	outcome: OnboardingOutcome,
	storage?: ProgressStorage,
): boolean {
	return writeProgress(userId, outcome, storage)
}
