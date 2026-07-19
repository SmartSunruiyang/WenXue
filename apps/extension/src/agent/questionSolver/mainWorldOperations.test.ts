// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import type { FrameRef, JsonValue } from './contracts'
import { executeFixedMainWorldOperation, validateOperationArgs } from './mainWorldOperations'

describe('fixed MAIN-world operations', () => {
	it('dispatches a bundled function to one exact document in MAIN world', async () => {
		document.body.innerHTML = '<input id="blank-1" value="old">'
		const executeScript = vi.fn(async (details: any) => [
			{ frameId: 0, documentId: 'document-1', result: details.func(details.args[0]) },
		])
		const result = await executeFixedMainWorldOperation({
			operationId: 'common.native_input_set',
			operationArgs: {
				questionFingerprint: 'q',
				values: [{ key: 'blank-1', value: 'new' }],
			},
			target: frame(),
			api: { scripting: { executeScript } as any },
		})
		expect(result).toEqual({ updated: 1 })
		expect((document.querySelector('#blank-1') as HTMLInputElement).value).toBe('new')
		expect(executeScript).toHaveBeenCalledWith(
			expect.objectContaining({
				target: { tabId: 1, documentIds: ['document-1'] },
				world: 'MAIN',
				func: expect.any(Function),
				args: [expect.any(Object)],
			}),
		)
		expect(JSON.stringify(executeScript.mock.calls[0][0])).not.toContain('document.body')
	})

	it('never accepts selectors, script source or unknown operation arguments', () => {
		expect(() =>
			validateOperationArgs('common.native_input_set', {
				questionFingerprint: 'q',
				values: [],
				selector: '#target',
			} as JsonValue),
		).toThrowError('main_world_args_invalid')
		expect(() =>
			validateOperationArgs('common.native_input_set', {
				questionFingerprint: 'q',
				values: [],
				script: 'alert(1)',
			} as JsonValue),
		).toThrowError('main_world_args_invalid')
	})

	it('refuses ambiguous global control keys instead of writing outside the bound question', async () => {
		document.body.innerHTML = `
			<input data-blank-key="blank-1" value="first">
			<input data-blank-key="blank-1" value="second">
		`
		const executeScript = vi.fn(async (details: any) => [
			{ frameId: 0, documentId: 'document-1', result: details.func(details.args[0]) },
		])
		const result = await executeFixedMainWorldOperation({
			operationId: 'common.native_input_set',
			operationArgs: {
				questionFingerprint: 'q',
				values: [{ key: 'blank-1', value: 'new' }],
			},
			target: frame(),
			api: { scripting: { executeScript } as any },
		})

		expect(result).toEqual({ updated: 0 })
		expect(
			Array.from(document.querySelectorAll<HTMLInputElement>('input')).map(({ value }) => value),
		).toEqual(['first', 'second'])
	})

	it('refuses document-order fallback keys that could target another question', async () => {
		document.body.innerHTML = `
			<div class="question"><input value="first"></div>
			<div class="question"><input value="second"></div>
		`
		const executeScript = vi.fn(async (details: any) => [
			{ frameId: 0, documentId: 'document-1', result: details.func(details.args[0]) },
		])
		const result = await executeFixedMainWorldOperation({
			operationId: 'common.native_input_set',
			operationArgs: {
				questionFingerprint: 'second-question',
				values: [{ key: '2', value: 'wrongly-targeted' }],
			},
			target: frame(),
			api: { scripting: { executeScript } as any },
		})

		expect(result).toEqual({ updated: 0 })
		expect(
			Array.from(document.querySelectorAll<HTMLInputElement>('input')).map(({ value }) => value),
		).toEqual(['first', 'second'])
	})

	it('reads only visible GXK question names and no answer-like field', async () => {
		document.body.innerHTML = `
			<style>
				.display-secret { display: none }
				.offscreen-secret { position: absolute; left: -9999px }
				.clipped-secret { position: absolute; clip: rect(0, 0, 0, 0) }
				.zero-secret { width: 0; height: 0; overflow: hidden }
				.scaled-secret { transform: scale(0) }
				.content-secret { content-visibility: hidden }
				.transparent-secret { color: transparent }
				.font-zero-secret { font-size: 0 }
				.filter-secret { filter: opacity(0) }
			</style>
			<div class="subject_describe"><div>Visible question name
				<span class="display-secret">HIDDEN_DISPLAY_ANSWER</span>
				<span class="offscreen-secret">HIDDEN_OFFSCREEN_ANSWER</span>
				<span class="clipped-secret">HIDDEN_CLIPPED_ANSWER</span>
				<span class="zero-secret">HIDDEN_ZERO_ANSWER</span>
				<span class="scaled-secret">HIDDEN_SCALED_ANSWER</span>
				<span class="content-secret">HIDDEN_CONTENT_ANSWER</span>
				<span class="transparent-secret">HIDDEN_TRANSPARENT_ANSWER</span>
				<span class="font-zero-secret">HIDDEN_FONT_ZERO_ANSWER</span>
				<span class="filter-secret">HIDDEN_FILTER_ANSWER</span>
				<svg><text style="display: none">HIDDEN_SVG_ANSWER</text></svg>
			</div></div>
			<input name="correctAnswer" value="B">
		`
		const executeScript = vi.fn(async (details: any) => [
			{ frameId: 0, documentId: 'document-1', result: details.func(details.args[0]) },
		])
		const result = await executeFixedMainWorldOperation({
			operationId: 'zhihuishu.gxk_project_exam_response',
			operationArgs: {},
			target: frame(),
			api: { scripting: { executeScript } as any },
		})
		expect(result).toEqual({ questionNames: ['Visible question name'] })
		expect(JSON.stringify(result)).not.toMatch(/hidden|answer|correct|right|\bB\b/i)
	})

	it('shares passive network state without letting quiet snapshots replace its owner', async () => {
		const originalFetch = window.fetch
		const originalXhrSend = XMLHttpRequest.prototype.send
		const replacementFetch = vi.fn(async () => new Response('ok')) as typeof window.fetch
		window.fetch = replacementFetch
		const executeScript = vi.fn(async (details: any) => [
			{ frameId: 0, documentId: 'document-1', result: details.func(details.args[0]) },
		])
		const api = { scripting: { executeScript } as any }
		try {
			await executeFixedMainWorldOperation({
				operationId: 'common.passive_capture_arm',
				operationArgs: {},
				target: frame(),
				api,
			})
			const installedFetch = window.fetch
			expect(installedFetch).not.toBe(replacementFetch)

			const snapshot = await executeFixedMainWorldOperation({
				operationId: 'common.network_quiet_snapshot',
				operationArgs: {},
				target: frame(),
				api,
			})
			expect(snapshot).toMatchObject({ activeRequests: 0 })
			expect(window.fetch).toBe(installedFetch)

			await executeFixedMainWorldOperation({
				operationId: 'common.passive_capture_disarm',
				operationArgs: {},
				target: frame(),
				api,
			})
			expect(window.fetch).toBe(replacementFetch)
			expect(XMLHttpRequest.prototype.send).toBe(originalXhrSend)
		} finally {
			window.fetch = originalFetch
			XMLHttpRequest.prototype.send = originalXhrSend
		}
	})

	it('requires documentId even for a read operation', async () => {
		const target = frame()
		delete target.documentId
		await expect(
			executeFixedMainWorldOperation({
				operationId: 'common.network_quiet_snapshot',
				operationArgs: {},
				target,
				api: { scripting: { executeScript: vi.fn() } as any },
			}),
		).rejects.toMatchObject({ code: 'document_identity_unavailable' })
	})
})

function frame(): FrameRef {
	return {
		tabId: 1,
		frameId: 0,
		parentFrameId: -1,
		documentId: 'document-1',
		documentToken: 'token',
		urlFingerprint: 'a'.repeat(64),
	}
}
