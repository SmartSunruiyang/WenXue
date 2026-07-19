import * as z from 'zod/v4'

import type { RemotePageController } from './RemotePageController'

interface FrameTool {
	description: string
	inputSchema: z.ZodType
	execute: (input: unknown) => Promise<string>
}

export function createFrameTools(pageController: RemotePageController): Record<string, FrameTool> {
	return {
		list_frames: {
			description:
				'List frame metadata (including cross-origin iframes) in the current tab: frameId, URL, origin, parent, and whether each frame is same-origin with the top frame. This tool is read-only; assessment frame handling belongs to visual_observe.question_solver.',
			inputSchema: z.object({}),
			execute: async () => {
				const frames = await pageController.listFrames()
				if (!frames.length) return 'No frames found.'
				return frames
					.map(
						(f) =>
							`frameId=${f.frameId} ${f.sameOriginWithTop ? '(same-origin)' : '(cross-origin)'} ` +
							`parent=${f.parentFrameId} origin=${f.origin} ${f.url}`,
					)
					.join('\n')
			},
		},
	}
}
