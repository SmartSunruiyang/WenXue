import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('two-origin question solver fixture server', () => {
	it('serves a top page, a distinct child origin, and an opaque-origin frame fixture', async () => {
		const child = spawn(
			process.execPath,
			[join(process.cwd(), 'test-fixtures/question-solver/fixtureServer.mjs')],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		)
		try {
			const addresses = await firstJsonLine(child.stdout)
			expect(addresses.topOrigin).not.toBe(addresses.childOrigin)
			const [top, frame] = await Promise.all([
				fetch(`${addresses.topOrigin}/cross-origin-top.html`).then((response) => response.text()),
				fetch(`${addresses.childOrigin}/cross-origin-frame.html`).then((response) =>
					response.text(),
				),
			])

			expect(top).toContain(`${addresses.childOrigin}/cross-origin-frame.html`)
			expect(top).toContain('sandbox="allow-scripts"')
			expect(top).toContain('srcdoc=')
			expect(frame).toContain('<canvas')
			expect(frame).toContain('background-image')
			expect(frame).toContain('data-final-submit')
		} finally {
			child.kill('SIGTERM')
			await new Promise<void>((resolve) => child.once('exit', () => resolve()))
		}
	})
})

function firstJsonLine(
	stream: NodeJS.ReadableStream,
): Promise<{ topOrigin: string; childOrigin: string }> {
	return new Promise((resolve, reject) => {
		let buffer = ''
		const timer = setTimeout(() => reject(new Error('fixture_server_start_timeout')), 5_000)
		stream.setEncoding('utf8')
		stream.on('data', (chunk: string) => {
			buffer += chunk
			const newline = buffer.indexOf('\n')
			if (newline < 0) return
			clearTimeout(timer)
			resolve(JSON.parse(buffer.slice(0, newline)))
		})
	})
}
