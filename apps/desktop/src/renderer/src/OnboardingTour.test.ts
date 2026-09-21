// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingTour } from './OnboardingTour'
import { strings } from './strings'

let container: HTMLDivElement
let root: Root
let preference: MediaQueryList
let onExit: ReturnType<typeof vi.fn>

const copy = strings.onboarding
function button(label: string) {
	const result = Array.from(container.querySelectorAll('button')).find(
		(item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
	)
	if (!result) throw new Error(`Missing button: ${label}`)
	return result
}
async function click(label: string) {
	await act(async () => button(label).click())
}
async function settleTransition() {
	await act(async () => vi.advanceTimersByTime(300))
}
async function next() {
	await click(copy.next)
	await settleTransition()
}
async function renderTour() {
	await act(async () => root.render(createElement(OnboardingTour, { onExit })))
}

beforeEach(async () => {
	vi.useFakeTimers()
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	preference = Object.assign(new EventTarget(), {
		matches: false,
		media: '(prefers-reduced-motion: reduce)',
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
	}) as MediaQueryList
	vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(preference))
	vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	onExit = vi.fn()
	await renderTour()
})

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('onboarding navigation and completion', () => {
	it('holds early scenes at their result and lets the user continue', async () => {
		expect(button(copy.previous).disabled).toBe(true)
		expect(container.querySelector('video')?.getAttribute('src')).toBe('onboarding/01-create.mp4')
		await act(async () => container.querySelector('video')!.dispatchEvent(new Event('ended')))
		await settleTransition()
		expect(container.querySelector('h1')?.textContent).toBe(copy.steps[0].title)
		expect(onExit).not.toHaveBeenCalled()
	})

	it('locks repeated next clicks during a transition and supports returning to the previous scene', async () => {
		await click(copy.next)
		expect(container.querySelector('[data-phase="leaving"]')).toBeTruthy()
		await click(copy.next)
		await settleTransition()
		expect(container.querySelector('h1')?.textContent).toBe(copy.steps[1].title)
		expect(document.activeElement).toBe(container.querySelector('h1'))
		await click(copy.previous)
		await settleTransition()
		expect(container.querySelector('h1')?.textContent).toBe(copy.steps[0].title)
	})

	it('keeps skip available during transition and cancels pending navigation', async () => {
		await click(copy.next)
		await click(copy.skip)
		await click(copy.skip)
		await settleTransition()
		expect(onExit).toHaveBeenCalledOnce()
		expect(onExit).toHaveBeenCalledWith('skipped')
		expect(container.querySelector('h1')?.textContent).toBe(copy.steps[0].title)
	})

	it('shows the brand ending after the final video and enters only after Start exploring', async () => {
		for (let index = 0; index < 5; index += 1) await next()
		expect(container.querySelector('video')?.getAttribute('src')).toBe('onboarding/06-stop.mp4')
		expect(button(copy.finishAfterPlayback).disabled).toBe(true)
		await act(async () => container.querySelector('video')!.dispatchEvent(new Event('ended')))
		await settleTransition()
		expect(container.querySelector('.onboarding-finish')).toBeTruthy()
		expect(container.querySelector('.onboarding-finish__logo')?.getAttribute('src')).toBe(
			'logo.png',
		)
		expect(container.querySelector('.onboarding-finish__slogan img')?.getAttribute('src')).toBe(
			'slogan.png',
		)
		expect(onExit).not.toHaveBeenCalled()
		await act(async () => vi.advanceTimersByTime(1200))
		await click(copy.start)
		expect(onExit).toHaveBeenCalledOnce()
		expect(onExit).toHaveBeenCalledWith('completed')
	})

	it('offers retry and skip when a recording cannot load', async () => {
		const previousVideo = container.querySelector('video')!
		await act(async () => previousVideo.dispatchEvent(new Event('error')))
		expect(container.querySelector('[role="alert"]')).toBeTruthy()
		await click(copy.retry)
		expect(container.querySelector('video')).not.toBe(previousVideo)
		expect(container.querySelector('[role="alert"]')).toBeNull()
		await click(copy.skip)
		expect(onExit).toHaveBeenCalledOnce()
		expect(onExit).toHaveBeenCalledWith('skipped')
	})

	it('uses manual playback and immediate navigation with reduced motion', async () => {
		await act(async () => {
			Object.assign(preference, { matches: true })
			preference.dispatchEvent(new Event('change'))
		})
		expect(container.querySelector('video')?.autoplay).toBe(false)
		await click(copy.next)
		expect(container.querySelector('h1')?.textContent).toBe(copy.steps[1].title)
		expect(container.querySelector('[data-phase="leaving"]')).toBeNull()
	})
})
