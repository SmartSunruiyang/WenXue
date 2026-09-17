// @vitest-environment jsdom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Markdown } from './markdown'

describe('Markdown images', () => {
	it.each([
		'https://attacker.example/pixel?data=secret',
		'http://127.0.0.1:8080/internal',
		'//attacker.example/protocol-relative.png',
	])('does not create a loadable image for remote source %s', (src) => {
		const markup = renderToStaticMarkup(
			React.createElement(Markdown, { text: `![sensitive](${src})` }),
		)

		expect(markup).not.toContain('<img')
		expect(markup).not.toContain(src)
		expect(markup).toContain('已阻止远程图片')
	})

	it('does not render embedded data images from model output', () => {
		const src = 'data:image/png;base64,iVBORw0KGgo='
		const markup = renderToStaticMarkup(React.createElement(Markdown, { text: `![local](${src})` }))

		expect(markup).not.toContain('<img')
		expect(markup).not.toContain('data:image/png;base64')
		expect(markup).toContain('已阻止远程图片')
	})
})
