// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { MagicSelect } from './magic-select'

const options = [
	{ value: 'alpha', label: 'Alpha' },
	{ value: 'beta', label: 'Beta' },
	{ value: 'gamma', label: 'Gamma' },
]

describe('MagicSelect keyboard and dismissal', () => {
	let container: HTMLDivElement
	let root: Root
	let onChange: Mock<(value: string) => void>

	beforeEach(async () => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
		onChange = vi.fn<(value: string) => void>()
		await act(async () => {
			root.render(
				createElement(
					'div',
					null,
					createElement(MagicSelect, { id: 'model', value: 'beta', options, onChange }),
					createElement('button', { id: 'outside' }, 'Outside'),
				),
			)
		})
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
		vi.restoreAllMocks()
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
	})

	const key = async (value: string, shiftKey = false) => {
		const event = new KeyboardEvent('keydown', {
			key: value,
			shiftKey,
			bubbles: true,
			cancelable: true,
		})
		await act(async () => document.activeElement?.dispatchEvent(event))
		return event
	}

	const open = async () => {
		const trigger = container.querySelector<HTMLButtonElement>('#model')!
		trigger.focus()
		await key('ArrowDown')
		return trigger
	}

	it('opens at the selected item and supports arrows, Home, End and selection', async () => {
		const trigger = await open()
		expect(document.activeElement?.textContent).toBe('Beta')
		expect(container.querySelector('[role="listbox"]')?.getAttribute('popover')).toBe('manual')
		await key('End')
		expect(document.activeElement?.textContent).toBe('Gamma')
		await key('ArrowDown')
		expect(document.activeElement?.textContent).toBe('Alpha')
		await key('ArrowUp')
		expect(document.activeElement?.textContent).toBe('Gamma')
		await key('Home')
		expect(document.activeElement?.textContent).toBe('Alpha')
		await act(async () => (document.activeElement as HTMLButtonElement).click())
		expect(onChange).toHaveBeenCalledWith('alpha')
		expect(container.querySelector('[role="listbox"]')).toBeNull()
		expect(document.activeElement).toBe(trigger)
	})

	it('consumes Escape and restores the trigger without changing the value', async () => {
		const trigger = await open()
		const outerKeyDown = vi.fn()
		window.addEventListener('keydown', outerKeyDown)
		try {
			await key('Escape')
			expect(container.querySelector('[role="listbox"]')).toBeNull()
			expect(document.activeElement).toBe(trigger)
			expect(outerKeyDown).not.toHaveBeenCalled()
			expect(onChange).not.toHaveBeenCalled()
		} finally {
			window.removeEventListener('keydown', outerKeyDown)
		}
	})

	it('reveals the focused selection within a long list without scrolling the page', async () => {
		vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(320)
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
		vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(160)
		const pageScroll = window.scrollY
		await open()
		const menu = container.querySelector<HTMLElement>('[role="listbox"]')!
		expect(document.activeElement?.textContent).toBe('Beta')
		expect(menu.scrollTop).toBe(200)
		expect(window.scrollY).toBe(pageScroll)
	})

	it.each([false, true])('leaves Tab navigation to the browser (shift=%s)', async (shift) => {
		const trigger = await open()
		const event = await key('Tab', shift)
		expect(container.querySelector('[role="listbox"]')).toBeNull()
		expect(document.activeElement).toBe(trigger)
		expect(event.defaultPrevented).toBe(false)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('closes on outside focus without stealing that focus', async () => {
		await open()
		const outside = container.querySelector<HTMLButtonElement>('#outside')!
		await act(async () => outside.focus())
		expect(container.querySelector('[role="listbox"]')).toBeNull()
		expect(document.activeElement).toBe(outside)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('closes on outside pointer interaction', async () => {
		await open()
		await act(async () => {
			container
				.querySelector('#outside')!
				.dispatchEvent(new Event('pointerdown', { bubbles: true }))
		})
		expect(container.querySelector('[role="listbox"]')).toBeNull()
		expect(onChange).not.toHaveBeenCalled()
	})
})
