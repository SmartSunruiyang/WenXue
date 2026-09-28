// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowClosePromptState } from './wenxue'
import { WindowCloseDialog, type WindowCloseDialogCopy } from './WindowCloseDialog'

const copy: WindowCloseDialogCopy = {
	title: 'Browser is running',
	description: 'Choose what to close.',
	cancel: 'Cancel',
	launcherOnly: 'Launcher only',
	closeBrowsers: 'Close browsers too',
	errorTitle: 'Could not close safely',
	errorDescription: 'The launcher remains open. Try again.',
	dismiss: 'Got it',
	communicationError: 'Unable to process the request. Try again.',
	updateRestart: {
		title: 'Restart with update?',
		description: 'Save work first.',
		confirm: 'Close browsers and restart',
	},
	updateQuit: {
		title: 'Exit with update?',
		description: 'Save work first.',
		skip: 'Exit without installing',
		confirm: 'Close browsers and install',
	},
}
let container: HTMLDivElement
let root: Root
let listener: (state: WindowClosePromptState) => void
const unsubscribe = vi.fn()
const getClosePrompt = vi.fn<() => Promise<WindowClosePromptState>>()
const respondToClosePrompt = vi.fn<Window['wenxue']['app']['respondToClosePrompt']>()

beforeEach(() => {
	vi.clearAllMocks()
	;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	getClosePrompt.mockResolvedValue(null)
	respondToClosePrompt.mockResolvedValue({ ok: true })
	window.wenxue = {
		app: {
			getClosePrompt,
			respondToClosePrompt,
			onClosePromptChange(callback: (state: WindowClosePromptState) => void) {
				listener = callback
				return unsubscribe
			},
		},
	} as unknown as typeof window.wenxue
})

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
})

async function render() {
	await act(async () => root.render(createElement(WindowCloseDialog, { copy })))
}

function button(text: string): HTMLButtonElement {
	const target = Array.from(document.querySelectorAll('button')).find(
		(item) => item.textContent === text,
	)
	if (!target) throw new Error(`Missing button: ${text}`)
	return target
}

describe('WindowCloseDialog', () => {
	it('shows only cancel and confirmed restart actions for an update restart', async () => {
		await render()
		await act(async () =>
			listener({ requestId: 'restart', kind: 'confirm', purpose: 'update-restart' }),
		)
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			copy.updateRestart.title,
		)
		expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(2)
		expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(copy.launcherOnly)
		await act(async () => button(copy.updateRestart.confirm).click())
		expect(respondToClosePrompt).toHaveBeenCalledWith('restart', 'closeBrowsers')
	})

	it('shows skip and install choices without a duplicate cancel action for update quit', async () => {
		await render()
		await act(async () => listener({ requestId: 'quit', kind: 'confirm', purpose: 'update-quit' }))
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(copy.updateQuit.title)
		expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(2)
		await act(async () => button(copy.updateQuit.skip).click())
		expect(respondToClosePrompt).toHaveBeenCalledWith('quit', 'launcherOnly')
	})

	it('recovers an existing request when mounted after the main-process event', async () => {
		getClosePrompt.mockResolvedValue({ requestId: 'existing', kind: 'confirm' })
		await render()
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(copy.title)
		await act(async () => button(copy.launcherOnly).click())
		expect(respondToClosePrompt).toHaveBeenCalledWith('existing', 'launcherOnly')
	})

	it('does not overwrite a fresh event with an older initial snapshot', async () => {
		let resolve!: (state: WindowClosePromptState) => void
		getClosePrompt.mockReturnValue(
			new Promise((done) => {
				resolve = done
			}),
		)
		await render()
		await act(async () => listener({ requestId: 'fresh', kind: 'confirm' }))
		await act(async () => resolve(null))
		expect(document.querySelector('[role="dialog"]')).not.toBeNull()
		await act(async () => button(copy.closeBrowsers).click())
		expect(respondToClosePrompt).toHaveBeenCalledWith('fresh', 'closeBrowsers')
	})

	it('treats Escape as cancellation and removes the prompt after its state is cleared', async () => {
		await render()
		await act(async () => listener({ requestId: 'cancel', kind: 'confirm' }))
		await act(async () =>
			document.activeElement!.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
			),
		)
		expect(respondToClosePrompt).toHaveBeenCalledWith('cancel', 'cancel')
		await act(async () => listener(null))
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	it('only dismisses failure notices and never offers a destructive response', async () => {
		await render()
		await act(async () => listener({ requestId: 'failure', kind: 'error' }))
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(copy.errorDescription)
		expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(1)
		await act(async () => button(copy.dismiss).click())
		expect(respondToClosePrompt).toHaveBeenCalledWith('failure', 'dismiss')
	})

	it('prevents duplicate submissions while waiting and lets users retry failed responses', async () => {
		let reject!: (error: Error) => void
		respondToClosePrompt.mockReturnValueOnce(
			new Promise((_resolve, fail) => {
				reject = fail
			}),
		)
		await render()
		await act(async () => listener({ requestId: 'retry', kind: 'confirm' }))
		await act(async () => {
			button(copy.closeBrowsers).click()
			button(copy.closeBrowsers).click()
		})
		expect(respondToClosePrompt).toHaveBeenCalledOnce()
		expect(button(copy.cancel).disabled).toBe(true)
		await act(async () => reject(new Error('disconnected')))
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.communicationError)
		expect(button(copy.cancel).disabled).toBe(false)
		await act(async () => button(copy.cancel).click())
		expect(respondToClosePrompt).toHaveBeenLastCalledWith('retry', 'cancel')
	})

	it('unsubscribes when the application view unmounts', async () => {
		await render()
		await act(async () => root.unmount())
		expect(unsubscribe).toHaveBeenCalledOnce()
		root = createRoot(container)
	})
})
