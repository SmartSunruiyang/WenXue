import { describe, expect, it, vi } from 'vitest'

import { createFrameTools } from './frameTools'

describe('list_frames tool', () => {
	it('formats frames with origin and same/cross-origin marker', async () => {
		const pageController = {
			listFrames: vi.fn(async () => [
				{
					frameId: 0,
					url: 'https://top.com/',
					origin: 'https://top.com',
					sameOriginWithTop: true,
					parentFrameId: -1,
				},
				{
					frameId: 7,
					url: 'https://x.com/i',
					origin: 'https://x.com',
					sameOriginWithTop: false,
					parentFrameId: 0,
				},
			]),
		}
		const tools = createFrameTools(pageController as any)
		const out = await tools.list_frames.execute({})
		expect(out).toContain('frameId=0')
		expect(out).toContain('(same-origin)')
		expect(out).toContain('frameId=7')
		expect(out).toContain('(cross-origin)')
	})

	it('reports when there are no frames', async () => {
		const tools = createFrameTools({ listFrames: async () => [] } as any)
		expect(await tools.list_frames.execute({})).toBe('No frames found.')
	})
})
