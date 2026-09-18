// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { DEMO_CONFIG } from '@/agent/constants'
import { SETTINGS_SECTIONS, WENXUE_GITHUB_URL, WENXUE_WEBSITE_URL } from '@/components/SettingsForm'
import { isConfigStorageChange } from '@/lib/configStorage'
import { BUILT_IN_MODEL_ID, BUILT_IN_VISION_MODEL_ID } from '@/lib/modelConfig'

import App, { SETTINGS_PAGE_VERSION, resolveActiveSettingsSection } from './App'

type StorageChangeListener = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
) => void

function createStorageHarness() {
	const values: Record<string, unknown> = {
		llmConfig: DEMO_CONFIG,
		selectedModelId: BUILT_IN_MODEL_ID,
		visionModelId: BUILT_IN_VISION_MODEL_ID,
		customModels: [],
		uiLanguage: 'zh-CN',
		advancedConfig: {
			systemInstruction: 'Initial instruction',
			experimentalLlmsTxt: false,
			experimentalIncludeAllTabs: true,
			logRetentionDays: 3,
			logMaxEntries: 5000,
		},
	}
	const listeners = new Set<StorageChangeListener>()
	const local = {
		get: async (keys: string | string[]) =>
			Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]])),
		set: async (updates: Record<string, unknown>) => {
			const changes: Record<string, chrome.storage.StorageChange> = {}
			for (const [key, newValue] of Object.entries(updates)) {
				changes[key] = { oldValue: values[key], newValue }
				values[key] = newValue
			}
			for (const listener of listeners) listener(changes, 'local')
		},
		remove: async (key: string) => {
			const changes = { [key]: { oldValue: values[key], newValue: undefined } }
			delete values[key]
			for (const listener of listeners) listener(changes, 'local')
		},
	}
	vi.stubGlobal('chrome', {
		storage: {
			local,
			onChanged: {
				addListener: (listener: StorageChangeListener) => listeners.add(listener),
				removeListener: (listener: StorageChangeListener) => listeners.delete(listener),
			},
		},
	})
	return { values, local }
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
	Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
		textarea,
		value,
	)
	textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('options navigation', () => {
	it('selects the last section above the viewport focus line', () => {
		expect(
			resolveActiveSettingsSection({
				sectionTops: [
					['model', -80],
					['language', 240],
					['advanced', 620],
					['logs', 980],
					['about', 1380],
				],
				viewportHeight: 900,
				scrollY: 600,
				documentHeight: 2600,
			}),
		).toBe('model')
	})

	it('selects the final section when the page reaches the bottom', () => {
		expect(
			resolveActiveSettingsSection({
				sectionTops: [
					['model', -1300],
					['language', -900],
					['advanced', -520],
					['logs', -140],
					['about', 360],
				],
				viewportHeight: 900,
				scrollY: 1700,
				documentHeight: 2600,
			}),
		).toBe('about')
	})

	it('keeps about as the final settings destination', () => {
		expect(SETTINGS_SECTIONS.at(-1)?.id).toBe('about')
	})

	it('shows the requested public version', () => {
		expect(SETTINGS_PAGE_VERSION).toBe('v0.0.1')
	})

	it('recognizes external model settings updates for live synchronization', () => {
		expect(
			isConfigStorageChange(
				{ visionModelId: { oldValue: undefined, newValue: 'custom:vision' } },
				'local',
			),
		).toBe(true)
		expect(
			isConfigStorageChange({ unrelated: { oldValue: undefined, newValue: true } }, 'local'),
		).toBe(false)
	})
})

describe('options live settings', () => {
	it('settles the save indicator when a draft is reverted before debounce finishes', async () => {
		vi.useFakeTimers()
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		const { local } = createStorageHarness()
		const save = vi.spyOn(local, 'set')
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)

		try {
			await act(async () => root.render(createElement(App)))
			const textarea = container.querySelector<HTMLTextAreaElement>('#system-instruction')!
			await act(async () => changeTextarea(textarea, 'Temporary draft'))
			expect(container.querySelector('.settings-page-save-status')?.textContent).toContain(
				'正在保存',
			)
			await act(async () => vi.advanceTimersByTimeAsync(200))
			await act(async () => changeTextarea(textarea, 'Initial instruction'))
			await act(async () => vi.advanceTimersByTimeAsync(1000))
			expect(save).not.toHaveBeenCalled()
			expect(textarea.value).toBe('Initial instruction')
			expect(container.querySelector('.settings-page-save-status')?.textContent).toContain('已保存')
		} finally {
			await act(async () => root.unmount())
			container.remove()
			save.mockRestore()
			vi.useRealTimers()
			vi.unstubAllGlobals()
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
		}
	})

	it.each(['success', 'failure'] as const)(
		'keeps a reverted draft accurate while an earlier save finishes with %s',
		async (outcome) => {
			vi.useFakeTimers()
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
			const { values, local } = createStorageHarness()
			const persist = local.set
			let settleSave!: () => Promise<void>
			const save = vi.spyOn(local, 'set').mockImplementationOnce(
				(updates) =>
					new Promise<void>((resolve, reject) => {
						settleSave = async () => {
							if (outcome === 'failure') {
								reject(new Error('Storage unavailable'))
								return
							}
							await persist(updates)
							resolve()
						}
					}),
			)
			const error = vi.spyOn(console, 'error').mockImplementation(() => {})
			const container = document.createElement('div')
			document.body.append(container)
			const root = createRoot(container)

			try {
				await act(async () => root.render(createElement(App)))
				const textarea = container.querySelector<HTMLTextAreaElement>('#system-instruction')!
				await act(async () => changeTextarea(textarea, 'Temporary draft'))
				await act(async () => vi.advanceTimersByTimeAsync(500))
				expect(save).toHaveBeenCalledTimes(1)
				await act(async () => changeTextarea(textarea, 'Initial instruction'))
				expect(container.querySelector('.settings-page-save-status')?.textContent).toContain(
					'正在保存',
				)
				await act(async () => settleSave())
				await act(async () => vi.advanceTimersByTimeAsync(1000))
				expect((values.advancedConfig as { systemInstruction: string }).systemInstruction).toBe(
					'Initial instruction',
				)
				expect(textarea.value).toBe('Initial instruction')
				expect(container.querySelector('.settings-page-save-status')?.textContent).toContain(
					'已保存',
				)
				expect(container.querySelector('[role="alert"]')).toBeNull()
				expect(save).toHaveBeenCalledTimes(outcome === 'success' ? 2 : 1)
			} finally {
				await act(async () => root.unmount())
				container.remove()
				save.mockRestore()
				error.mockRestore()
				vi.useRealTimers()
				vi.unstubAllGlobals()
				Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
			}
		},
	)

	it('keeps selector dismissal separate from dialog dismissal and traps modal focus', async () => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		createStorageHarness()
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		const key = async (value: string, shiftKey = false) => {
			await act(async () => {
				document.activeElement?.dispatchEvent(
					new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }),
				)
			})
		}

		try {
			await act(async () => root.render(createElement(App)))
			const add = container.querySelector<HTMLButtonElement>('button[aria-label="添加自定义模型"]')!
			await act(async () => {
				add.focus()
				add.click()
			})
			const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
			const provider = dialog.querySelector<HTMLButtonElement>('#custom-model-provider')!
			expect(document.activeElement).toBe(provider)
			await key('ArrowDown')
			expect(document.activeElement?.getAttribute('role')).toBe('option')
			await key('Escape')
			expect(dialog.querySelector('[role="listbox"]')).toBeNull()
			expect(container.querySelector('[role="dialog"]')).toBe(dialog)
			expect(document.activeElement).toBe(provider)

			const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!
			const cancel = dialog.querySelector<HTMLButtonElement>('.settings-dialog-footer button')!
			await act(async () => close.focus())
			await key('Tab', true)
			expect(document.activeElement).toBe(cancel)
			await key('Tab')
			expect(document.activeElement).toBe(close)
			await key('Escape')
			expect(container.querySelector('[role="dialog"]')).toBeNull()
			expect(document.activeElement).toBe(add)
		} finally {
			await act(async () => root.unmount())
			container.remove()
			vi.unstubAllGlobals()
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
		}
	})

	it('preserves focused text and an open model draft during local save, then reflects external changes', async () => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		const { values, local } = createStorageHarness()
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)

		try {
			await act(async () => root.render(createElement(App)))
			const aboutLinks = [...container.querySelectorAll<HTMLAnchorElement>('#about a')]
			expect(aboutLinks.map((link) => link.getAttribute('href'))).toEqual([
				WENXUE_GITHUB_URL,
				WENXUE_WEBSITE_URL,
			])
			expect(container.querySelector('#about')?.textContent).not.toContain('隐私')
			expect(container.querySelector('#about')?.textContent).not.toContain('@Simon')
			await act(async () => {
				container
					.querySelector<HTMLButtonElement>('#vision-model')
					?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			})
			const visionChoices = [
				...container.querySelectorAll<HTMLButtonElement>('#vision-model-listbox [role="option"]'),
			].map((button) => button.textContent)
			expect(visionChoices).toHaveLength(1)
			expect(visionChoices[0]).toContain('qwen3.7-plus')
			expect(visionChoices.join('')).not.toContain('qwen3.7-max')
			const textarea = container.querySelector<HTMLTextAreaElement>('#system-instruction')
			expect(textarea).not.toBeNull()
			textarea?.focus()
			await act(async () => {
				if (textarea) changeTextarea(textarea, 'First draft')
			})
			await act(async () => new Promise((resolve) => window.setTimeout(resolve, 620)))
			expect((values.advancedConfig as { systemInstruction: string }).systemInstruction).toBe(
				'First draft',
			)
			expect(container.querySelector('#system-instruction')).toBe(textarea)
			expect(document.activeElement).toBe(textarea)
			expect(container.querySelector('.settings-page-save-status')?.textContent).toContain('已保存')

			await act(async () => {
				container
					.querySelector<HTMLButtonElement>('button[aria-label="添加自定义模型"]')
					?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			})
			const draftModel = container.querySelector<HTMLInputElement>('#custom-model-name')
			expect(draftModel).not.toBeNull()
			await act(async () => {
				if (draftModel) {
					Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
						draftModel,
						'draft-vision',
					)
					draftModel.dispatchEvent(new Event('input', { bubbles: true }))
				}
				if (textarea) changeTextarea(textarea, 'Second draft')
			})
			await act(async () => new Promise((resolve) => window.setTimeout(resolve, 620)))
			expect(container.querySelector('#system-instruction')).toBe(textarea)
			expect(container.querySelector('#custom-model-name')).toBe(draftModel)
			expect(draftModel?.value).toBe('draft-vision')

			await act(async () => {
				await local.set({
					advancedConfig: {
						...(values.advancedConfig as Record<string, unknown>),
						systemInstruction: 'External update',
					},
				})
				await new Promise((resolve) => window.setTimeout(resolve, 100))
			})
			expect(container.querySelector<HTMLTextAreaElement>('#system-instruction')?.value).toBe(
				'External update',
			)
		} finally {
			await act(async () => root.unmount())
			container.remove()
			vi.unstubAllGlobals()
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
		}
	})

	it('preserves an unsaved draft after a storage failure and lets the user retry', async () => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		const { values, local } = createStorageHarness()
		const save = vi.spyOn(local, 'set').mockRejectedValueOnce(new Error('Storage unavailable'))
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)

		try {
			await act(async () => root.render(createElement(App)))
			const textarea = container.querySelector<HTMLTextAreaElement>('#system-instruction')!
			await act(async () => changeTextarea(textarea, 'Keep this draft'))
			await act(async () => new Promise((resolve) => window.setTimeout(resolve, 620)))
			expect(container.querySelector('[role="alert"]')?.textContent).toContain('未能保存')
			expect(textarea.value).toBe('Keep this draft')
			expect((values.advancedConfig as { systemInstruction: string }).systemInstruction).toBe(
				'Initial instruction',
			)

			await act(async () => {
				container
					.querySelector<HTMLButtonElement>('.settings-save-error button')
					?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			})
			await act(async () => new Promise((resolve) => window.setTimeout(resolve, 620)))
			expect((values.advancedConfig as { systemInstruction: string }).systemInstruction).toBe(
				'Keep this draft',
			)
			expect(container.querySelector('[role="alert"]')).toBeNull()
			expect(container.querySelector('.settings-page-save-status')?.textContent).toContain('已保存')
			expect(save).toHaveBeenCalledTimes(2)
		} finally {
			await act(async () => root.unmount())
			container.remove()
			save.mockRestore()
			error.mockRestore()
			vi.unstubAllGlobals()
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
		}
	})
})
