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
				'List all frames (including cross-origin iframes) in the current tab: frameId, url, origin, ' +
				'and whether each is same-origin with the top frame. Pass a frameId to execute_javascript ' +
				'(frame_id) to run code inside that specific frame; this is how to reach cross-origin ' +
				'iframe content.',
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
