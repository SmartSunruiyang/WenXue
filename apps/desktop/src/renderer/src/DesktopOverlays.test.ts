// @vitest-environment jsdom
import { AnnouncementDialog, UpdateDialog } from '@wenxue/client-operations/react'
import { act, createElement, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	cancelLauncherCaptcha,
	configureLauncherCaptcha,
	getLauncherCaptchaSnapshot,
	requestLauncherCaptcha,
} from './captchaChallenge'
import { CaptchaDialog } from './CaptchaDialog'
import {
	ConfirmationProvider,
	DesktopDialog,
	PopupMenu,
	SelectField,
	useConfirmation,
	type ConfirmationOptions,
} from './DesktopOverlays'

let container: HTMLDivElement
let root: Root

function button(text: string) {
	const target = Array.from(document.querySelectorAll('button')).find(
		(item) => item.textContent === text,
	)
	if (!target) throw new Error(`Missing button: ${text}`)
	return target
}

async function click(text: string) {
	await act(async () => {
		const target = button(text)
		target.focus()
		target.click()
	})
}

async function key(value: string, shiftKey = false) {
	await act(async () =>
		document.activeElement!.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: value,
				shiftKey,
				bubbles: true,
				cancelable: true,
			}),
		),
	)
}

async function render(children: ReactNode) {
	await act(async () => root.render(children))
}

function MenuFixture({ placement = 'bottom-end' }: { placement?: 'bottom-end' | 'right-start' }) {
	const [open, setOpen] = useState(false)
	const [dialog, setDialog] = useState(false)
	const anchorRef = useRef<HTMLButtonElement>(null)
	return createElement(
		'div',
		null,
		createElement('button', { type: 'button' }, '前一项'),
		createElement('button', { ref: anchorRef, onClick: () => setOpen(!open) }, '打开菜单'),
		createElement('button', { type: 'button' }, '后一项'),
		createElement(PopupMenu, {
			open,
			anchorRef,
			placement,
			label: '账号菜单',
			onClose: () => setOpen(false),
			children: [
				createElement('button', { key: 'first', role: 'menuitem' }, '我的'),
				createElement('button', { key: 'disabled', role: 'menuitem', disabled: true }, '不可用'),
				createElement(
					'button',
					{
						key: 'last',
						role: 'menuitem',
						onClick: () => {
							setOpen(false)
							setDialog(true)
						},
					},
					'退出',
				),
			],
		}),
		dialog &&
			createElement(DesktopDialog, {
				title: '退出登录',
				onClose: () => setDialog(false),
				children: createElement('button', null, '取消'),
			}),
	)
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(async () => {
	await act(async () => root.unmount())
	cancelLauncherCaptcha()
	container.remove()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('desktop popup menus', () => {
	it('navigates enabled actions and restores the trigger when Escape closes the menu', async () => {
		await render(createElement(MenuFixture))
		await click('打开菜单')
		expect(document.activeElement).toBe(button('我的'))
		expect(container.querySelector('[role="menu"]')).toBeNull()
		await key('ArrowDown')
		expect(document.activeElement).toBe(button('退出'))
		await key('ArrowDown')
		expect(document.activeElement).toBe(button('我的'))
		await key('End')
		expect(document.activeElement).toBe(button('退出'))
		await key('Home')
		expect(document.activeElement).toBe(button('我的'))
		await key('ArrowUp')
		expect(document.activeElement).toBe(button('退出'))
		await key('Escape')
		expect(document.querySelector('[role="menu"]')).toBeNull()
		expect(document.activeElement).toBe(button('打开菜单'))
	})

	it.each([false, true])(
		'Tab exits the menu in the expected page direction (reverse: %s)',
		async (reverse) => {
			await render(createElement(MenuFixture))
			await click('打开菜单')
			await key('Tab', reverse)
			expect(document.querySelector('[role="menu"]')).toBeNull()
			expect(document.activeElement).toBe(button(reverse ? '前一项' : '后一项'))
		},
	)

	it('does not steal focus from an outside action or a newly opened dialog', async () => {
		await render(createElement(MenuFixture))
		await click('打开菜单')
		await act(async () => {
			button('后一项').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
			button('后一项').focus()
		})
		expect(document.querySelector('[role="menu"]')).toBeNull()
		expect(document.activeElement).toBe(button('后一项'))
		await click('打开菜单')
		await click('退出')
		expect(document.querySelector('[role="menu"]')).toBeNull()
		expect(document.activeElement).toBe(button('取消'))
	})

	it.each(['bottom-end', 'right-start'] as const)(
		'keeps %s menus inside the viewport and repositions after resize',
		async (placement) => {
			vi.stubGlobal('innerWidth', 500)
			vi.stubGlobal('innerHeight', 400)
			vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
				this: HTMLElement,
			) {
				return this.getAttribute('role') === 'menu'
					? new DOMRect(0, 0, 200, 180)
					: new DOMRect(475, 370, 20, 20)
			})
			await render(createElement(MenuFixture, { placement }))
			await click('打开菜单')
			const menu = document.querySelector<HTMLElement>('[role="menu"]')!
			expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8)
			expect(parseFloat(menu.style.left) + 200).toBeLessThanOrEqual(492)
			expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8)
			expect(parseFloat(menu.style.top) + 180).toBeLessThanOrEqual(392)
			vi.stubGlobal('innerWidth', 400)
			await act(async () => window.dispatchEvent(new Event('resize')))
			expect(parseFloat(menu.style.left) + 200).toBeLessThanOrEqual(392)
		},
	)
})

describe('desktop select fields', () => {
	function SelectFixture({ onChange }: { onChange?: (value: string) => void }) {
		const [value, setValue] = useState('recent')
		return createElement(SelectField, {
			value,
			label: '排序方式',
			onChange: (next) => {
				onChange?.(next)
				setValue(next)
			},
			options: [
				{ value: 'recent', label: '最近使用' },
				{ value: 'name', label: '名称' },
				{ value: 'status', label: '状态' },
			],
		})
	}

	it('commits a keyboard choice and keeps focus on the combobox', async () => {
		const onChange = vi.fn()
		await render(createElement(SelectFixture, { onChange }))
		const select = document.querySelector<HTMLButtonElement>('[role="combobox"]')!
		select.focus()
		await key('ArrowDown')
		expect(select.getAttribute('aria-expanded')).toBe('true')
		expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe(
			'最近使用',
		)
		await key('ArrowDown')
		expect(onChange).not.toHaveBeenCalled()
		await key('Enter')
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith('name')
		expect(select.textContent).toBe('名称')
		expect(document.activeElement).toBe(select)
		expect(document.querySelector('[role="listbox"]')).toBeNull()
	})

	it('cancels a pending keyboard choice and accepts a pointer choice from its portal', async () => {
		const onChange = vi.fn()
		await render(createElement(SelectFixture, { onChange }))
		await click('最近使用')
		await key('End')
		await key('Escape')
		expect(onChange).not.toHaveBeenCalled()
		await click('最近使用')
		const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
			(item) => item.textContent === '状态',
		)!
		expect(container.contains(option)).toBe(false)
		await act(async () => option.click())
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith('status')
		expect(document.querySelector('[role="combobox"]')?.textContent).toBe('状态')
	})
})

describe('desktop dialogs and destructive confirmations', () => {
	it.each(['announcement', 'update'] as const)(
		'keeps the background %s inert to Escape and permits normal Tab within the foreground dialog',
		async (background) => {
			const onDismiss = vi.fn()
			let openDialog!: () => void
			function Fixture() {
				const [open, setOpen] = useState(false)
				openDialog = () => setOpen(true)
				return createElement(
					'div',
					null,
					background === 'announcement'
						? createElement(AnnouncementDialog, {
								announcement: {
									id: 'message',
									importance: 'normal',
									title: '消息',
									body: '正文',
									publishedAt: '2026-09-22T00:00:00Z',
									expiresAt: '2026-09-23T00:00:00Z',
								},
								onDismiss,
							})
						: createElement(UpdateDialog, { state: { phase: 'checking' }, onDismiss }),
					open &&
						createElement(DesktopDialog, {
							title: '关闭窗口',
							onClose: () => setOpen(false),
							children: [
								createElement('button', { key: 'cancel' }, '取消关闭'),
								createElement('button', { key: 'confirm' }, '确认关闭'),
							],
						}),
				)
			}
			await render(createElement(Fixture))
			const previousFocus = document.activeElement
			await act(async () => openDialog())
			expect(document.activeElement).toBe(button('取消关闭'))
			const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
			await act(async () => document.activeElement!.dispatchEvent(tab))
			expect(tab.defaultPrevented).toBe(false)
			await act(async () => button('确认关闭').focus())
			await key('Escape')
			expect(onDismiss).not.toHaveBeenCalled()
			expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
			expect(document.activeElement).toBe(previousFocus)
		},
	)

	it('lets a select inside a dialog consume Escape before closing its parent and uses its local overlay layer', async () => {
		const onClose = vi.fn()
		await render(
			createElement(DesktopDialog, {
				title: '设置',
				onClose,
				children: [
					createElement(SelectField, {
						key: 'select',
						label: '选项',
						value: 'a',
						onChange: vi.fn(),
						options: [
							{ value: 'a', label: '选项 A' },
							{ value: 'b', label: '选项 B' },
						],
					}),
					createElement('button', { key: 'done' }, '完成'),
				],
			}),
		)
		await click('选项 A')
		const list = document.querySelector('[role="listbox"]')!
		expect(list.closest('.wx-dialog-backdrop')).toBeTruthy()
		await key('Escape')
		expect(document.querySelector('[role="listbox"]')).toBeNull()
		expect(onClose).not.toHaveBeenCalled()
		await click('选项 A')
		const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
		await act(async () => document.activeElement!.dispatchEvent(tab))
		expect(tab.defaultPrevented).toBe(false)
		expect(document.querySelector('[role="listbox"]')).toBeNull()
		await key('Escape')
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('shares the modal stack with the actual captcha and restores its input after cancelling a window prompt', async () => {
		configureLauncherCaptcha({ createCaptchaData: vi.fn(), verifyCaptchaData: vi.fn() })
		const result = requestLauncherCaptcha('data:image/png;base64,YQ==?token=test&state=test').catch(
			(error: unknown) => error,
		)
		let openDialog!: () => void
		function Fixture() {
			const [open, setOpen] = useState(false)
			openDialog = () => setOpen(true)
			return createElement(
				'div',
				null,
				createElement(CaptchaDialog),
				open &&
					createElement(DesktopDialog, {
						title: '关闭窗口',
						onClose: () => setOpen(false),
						children: createElement('button', null, '取消关闭'),
					}),
			)
		}
		await render(createElement(Fixture))
		const input = document.querySelector<HTMLInputElement>('input[name="captcha"]')!
		expect(document.querySelector('dialog')).toBeNull()
		expect(document.activeElement).toBe(input)
		await act(async () => openDialog())
		expect(document.activeElement).toBe(button('取消关闭'))
		await key('Escape')
		expect(getLauncherCaptchaSnapshot()).not.toBeNull()
		expect(document.activeElement).toBe(input)
		await key('Escape')
		expect(getLauncherCaptchaSnapshot()).toBeNull()
		expect(await result).toBeInstanceOf(Error)
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	it('traps keyboard focus and restores the opener after Escape', async () => {
		function Fixture() {
			const [open, setOpen] = useState(false)
			return createElement(
				'div',
				null,
				createElement('button', { onClick: () => setOpen(true) }, '编辑'),
				open &&
					createElement(DesktopDialog, {
						title: '编辑资料',
						onClose: () => setOpen(false),
						children: [
							createElement('button', { key: 'cancel' }, '取消'),
							createElement('button', { key: 'save' }, '保存'),
						],
					}),
			)
		}
		await render(createElement(Fixture))
		await click('编辑')
		expect(document.activeElement).toBe(button('取消'))
		await key('Tab', true)
		expect(document.activeElement).toBe(button('保存'))
		await key('Tab')
		expect(document.activeElement).toBe(button('取消'))
		await act(async () => button('编辑').focus())
		expect(document.activeElement).toBe(button('取消'))
		await key('Escape')
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(document.activeElement).toBe(button('编辑'))
	})

	it('lets only the top dialog trap focus and handle Escape', async () => {
		function Fixture() {
			const [nested, setNested] = useState(false)
			return createElement(DesktopDialog, {
				title: '底层',
				onClose: vi.fn(),
				children: [
					createElement('button', { key: 'open', onClick: () => setNested(true) }, '打开上层'),
					nested &&
						createElement(DesktopDialog, {
							key: 'nested',
							title: '上层',
							onClose: () => setNested(false),
							children: createElement('button', null, '上层操作'),
						}),
				],
			})
		}
		await render(createElement(Fixture))
		await click('打开上层')
		expect(document.activeElement).toBe(button('上层操作'))
		await key('Escape')
		expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
		expect(document.activeElement).toBe(button('打开上层'))
	})

	it('defaults to cancel and resolves false on Escape, supersession, and unmount', async () => {
		let confirm!: (options: ConfirmationOptions) => Promise<boolean>
		function Fixture() {
			confirm = useConfirmation()
			return null
		}
		await render(
			createElement(ConfirmationProvider, {
				labels: { cancel: '取消', confirm: '确认' },
				children: createElement(Fixture),
			}),
		)
		const options = { title: '删除浏览器', description: '将删除本机数据。', danger: true }
		let result!: Promise<boolean>
		await act(async () => {
			result = confirm(options)
		})
		expect(document.activeElement).toBe(button('取消'))
		await key('Escape')
		await expect(result).resolves.toBe(false)
		let first!: Promise<boolean>
		let second!: Promise<boolean>
		await act(async () => {
			first = confirm(options)
		})
		await act(async () => button('确认').focus())
		await act(async () => {
			second = confirm({ ...options, title: '清空日志' })
		})
		await expect(first).resolves.toBe(false)
		expect(document.activeElement).toBe(button('取消'))
		await render(null)
		await expect(second).resolves.toBe(false)
		await expect(confirm(options)).resolves.toBe(false)
	})

	it('resolves true only when the confirm action is chosen', async () => {
		let confirm!: (options: ConfirmationOptions) => Promise<boolean>
		function Fixture() {
			confirm = useConfirmation()
			return null
		}
		await render(
			createElement(ConfirmationProvider, {
				labels: { cancel: '取消', confirm: '确认' },
				children: createElement(Fixture),
			}),
		)
		let result!: Promise<boolean>
		await act(async () => {
			result = confirm({
				title: '退出',
				description: '关闭浏览器后退出账号。',
				confirmLabel: '退出登录',
			})
		})
		await click('退出登录')
		await expect(result).resolves.toBe(true)
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})
})
