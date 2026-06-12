import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { isValidElement, type ReactElement } from 'react'
import { describe, expect, test } from 'vitest'

import { Logo } from './misc'

const HIGH_RES_LOGO_SRC = '/assets/wenxue-logo-1254.png'
const HIGH_RES_LOGO_FILE = fileURLToPath(
	new URL('../../public/assets/wenxue-logo-1254.png', import.meta.url)
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
