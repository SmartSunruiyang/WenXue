import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { EmptyState, Logo, StatusDot } from './misc'

const HIGH_RES_LOGO_SRC = '/assets/wenxue-logo-1254.png'
const HIGH_RES_LOGO_FILE = fileURLToPath(
	new URL('../../public/assets/wenxue-logo-1254.png', import.meta.url),
)

function readPngDimensions(filePath: string) {
	const png = readFileSync(filePath)

	return {
		width: png.readUInt32BE(16),
		height: png.readUInt32BE(20),
	}
}

describe('Logo', () => {
	test('renders the high-resolution transparent WenXue logo asset', () => {
		const logo = Logo({ className: 'size-8' })

		expect(isValidElement(logo)).toBe(true)
		expect((logo as ReactElement<{ src: string }>).props.src).toBe(HIGH_RES_LOGO_SRC)
	})

	test('keeps the rendered WenXue logo source large enough for crisp scaling', () => {
		expect(existsSync(HIGH_RES_LOGO_FILE)).toBe(true)

		const dimensions = readPngDimensions(HIGH_RES_LOGO_FILE)

		expect(dimensions.width).toBeGreaterThanOrEqual(1024)
		expect(dimensions.height).toBeGreaterThanOrEqual(1024)
	})
})

describe('EmptyState', () => {
	test('renders only the centered animated brand mark and slogan on the sidepanel home', () => {
		const emptyState = EmptyState() as ReactElement<{
			className: string
			children: [
				ReactElement<{ className: string; children: ReactElement<{ className: string }> }>,
				ReactElement<{ className: string }>,
			]
		}>
		const [logoWrap, slogan] = emptyState.props.children
		const logo = logoWrap.props.children as ReactElement<{ className: string }>

		expect(emptyState.props.className).toContain('wx-brand-stack')
		expect(logoWrap.props.className).toContain('wx-brand-logo-motion')
		expect(logo.props.className).toContain('wx-brand-logo')
		expect(logo.props.className).not.toContain('shadow')
		expect(slogan.props.className).toContain('wx-brand-slogan')
		expect(emptyState.props.children).toHaveLength(2)
	})
})

describe('StatusDot', () => {
	test.each([
		['waiting_for_user', '等待接管', true],
		['paused', '已暂停', false],
	] as const)('renders the %s status', (status, label, shouldPulse) => {
		const html = renderToStaticMarkup(createElement(StatusDot, { status }))

		expect(html).toContain(label)
		expect(html.includes('animate-pulse')).toBe(shouldPulse)
	})
})
