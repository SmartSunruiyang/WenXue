// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSettings, type AccountSettingsProps } from './AccountSettings'
import { strings } from './strings'

const user = {
	userId: 'account-0123456789-abcdefghijklmnopqrstuvwxyz',
	email: 'alice@example.com',
	nickname: '阿丽',
	avatarUrl: 'https://storage.example/current.png',
	expiresAt: 3600000,
}
let root: Root
let container: HTMLDivElement
let props: AccountSettingsProps
let onSave: ReturnType<typeof vi.fn>
let onLogout: ReturnType<typeof vi.fn>
const copy = strings.account

function button(label: string) {
	const target = Array.from(container.querySelectorAll('button')).find(
		(item) => item.textContent === label || item.getAttribute('aria-label') === label,
	)
	if (!target) throw new Error(`Missing button: ${label}`)
	return target
}

function input(suffix: string) {
	const target = container.querySelector<HTMLInputElement>(`input[id$="-${suffix}"]`)
	if (!target) throw new Error(`Missing input: ${suffix}`)
	return target
}

async function changeNickname(value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
			input('nickname'),
			value,
		)
		input('nickname').dispatchEvent(new Event('input', { bubbles: true }))
	})
}

async function selectAvatar() {
	const avatar = new File(['image'], 'new.png', { type: 'image/png' })
	await act(async () => {
		const field = container.querySelector<HTMLInputElement>('input[type="file"]')!
		Object.defineProperty(field, 'files', { configurable: true, value: [avatar] })
		field.dispatchEvent(new Event('change', { bubbles: true }))
	})
	return avatar
}

async function render(overrides: Partial<AccountSettingsProps> = {}) {
	props = { ...props, ...overrides }
	await act(async () => root.render(createElement(AccountSettings, props)))
}

async function save() {
	await act(async () => button(copy.save).click())
}

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.stubGlobal(
		'URL',
		class extends URL {
			static createObjectURL = vi.fn().mockReturnValue('blob:avatar-preview')
			static revokeObjectURL = vi.fn()
		},
	)
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: vi.fn().mockResolvedValue(undefined) },
	})
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	onSave = vi.fn().mockResolvedValue(undefined)
	onLogout = vi.fn().mockResolvedValue(undefined)
	props = { user, onSave, onLogout, disabled: false, logoutBusy: false }
	await render()
})

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	vi.unstubAllGlobals()
})

describe('account settings', () => {
	it('shows the saved avatar, full read-only UID and email and copies the UID', async () => {
		expect(container.querySelector('img')?.src).toBe(user.avatarUrl)
		expect(input('uid').value).toBe(user.userId)
		expect(input('uid').readOnly).toBe(true)
		expect(input('email').value).toBe(user.email)
		expect(input('email').readOnly).toBe(true)
		expect(button(copy.save).disabled).toBe(true)
		await act(async () => button(copy.copyUid).click())
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(user.userId)
		expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.copied)
	})

	it('keeps avatar selection local and preserves both drafts through a failed save', async () => {
		await changeNickname('新昵称')
		const avatar = await selectAvatar()
		expect(container.querySelector('img')?.src).toBe('blob:avatar-preview')
		expect(onSave).not.toHaveBeenCalled()
		onSave.mockRejectedValueOnce(new Error(copy.errors.save))
		await save()
		expect(onSave).toHaveBeenCalledWith({ nickname: '新昵称', avatar })
		expect(input('nickname').value).toBe('新昵称')
		expect(container.querySelector('img')?.src).toBe('blob:avatar-preview')
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.errors.save)
		expect(button(copy.save).disabled).toBe(false)
	})

	it('preserves unsaved changes across same-account session refreshes and clears after save', async () => {
		await changeNickname('我的草稿')
		await selectAvatar()
		await render({ user: { ...user, nickname: '云端昵称', expiresAt: 7200000 } })
		expect(input('nickname').value).toBe('我的草稿')
		expect(container.querySelector('img')?.src).toBe('blob:avatar-preview')
		onSave.mockImplementation(async () => {
			props = {
				...props,
				user: { ...user, nickname: '我的草稿', avatarUrl: 'https://storage.example/new.png' },
			}
			root.render(createElement(AccountSettings, props))
		})
		await save()
		expect(input('nickname').value).toBe('我的草稿')
		expect(container.querySelector('img')?.src).toBe('https://storage.example/new.png')
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview')
		expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.saved)
		expect(button(copy.save).disabled).toBe(true)
	})

	it('blocks repeated save and logout while saving', async () => {
		let finish!: () => void
		onSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
		await changeNickname('新昵称')
		await save()
		expect(button(copy.saving).disabled).toBe(true)
		expect(button(copy.logout).disabled).toBe(true)
		expect(input('nickname').disabled).toBe(true)
		await act(async () => {
			container
				.querySelector('form')!
				.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
			button(copy.logout).click()
		})
		expect(onSave).toHaveBeenCalledOnce()
		expect(onLogout).not.toHaveBeenCalled()
		await act(async () => finish())
	})

	it('sends the logout intent and displays its busy state', async () => {
		await act(async () => button(copy.logout).click())
		expect(onLogout).toHaveBeenCalledOnce()
		await render({ logoutBusy: true })
		expect(button(copy.loggingOut).disabled).toBe(true)
		expect(button(copy.changeAvatar).disabled).toBe(true)
	})

	it('releases the local preview and resets the draft when the account changes', async () => {
		await changeNickname('未保存昵称')
		await selectAvatar()
		await render({ user: { ...user, userId: 'other-account', nickname: '另一用户' } })
		expect(input('nickname').value).toBe('另一用户')
		expect(input('uid').value).toBe('other-account')
		expect(container.querySelector('img')?.src).toBe(user.avatarUrl)
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview')
	})

	it('releases a preview when the settings route unmounts during saving', async () => {
		let finish!: () => void
		onSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
		await selectAvatar()
		await save()
		await act(async () => root.render(null))
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview')
		await act(async () => finish())
		expect(container.textContent).toBe('')
	})
})
