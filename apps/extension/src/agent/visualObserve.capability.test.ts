import { describe, expect, it, vi } from 'vitest'

import { createVisualObserveTools } from './visualObserve'

describe('visual_observe question_solver capability', () => {
	it('suggests the solver for an assessment observation without dispatching it', async () => {
		const execute = vi.fn()
		const expected = {
			pageType: 'online_quiz',
			visibleRegion: 'question 1 with four visible choices',
			controls: [],
			blockingElements: [],
			checks: [],
			visualWarnings: [],
			recommendedNextObservation: 'none',
			confidence: 'high',
		}
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									tool_calls: [
										{
											function: {
												name: 'visual_observation',
												arguments: JSON.stringify(expected),
											},
										},
									],
								},
							},
						],
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				),
		)
		const tools = createVisualObserveTools({
			getVisionModel: () => ({
				baseURL: 'https://vision.example/v1',
				model: 'vision-model',
				apiKey: 'test-key',
			}),
			captureVisibleTab: vi.fn(async () => ({
				ok: true as const,
				protocolVersion: 2 as const,
				dataUrl: 'data:image/jpeg;base64,SCREENSHOT' as const,
				tab: { id: 1, windowId: 2 },
			})),
			fetchImpl,
			questionSolver: { execute },
		})

		const result = JSON.parse(
			await tools.visual_observe.execute({
				mode: 'observe',
				purpose: 'observe',
				reason: 'Classify the current page.',
			}),
		)

		expect(result).toMatchObject({
			scene: { kind: 'assessment', confidence: 'medium' },
			suggestedCapabilities: [{ name: 'question_solver' }],
		})
		expect(execute).not.toHaveBeenCalled()
	})

	it('dispatches before ordinary vision-model or screenshot checks', async () => {
		const execute = vi.fn(async (request) => ({
			mode: 'capability' as const,
			capability: 'question_solver' as const,
			action: request.action,
			scope: request.scope,
			status: 'completed' as const,
			executionStatus: 'completed' as const,
			platform: 'chaoxing',
			adapters: [],
			counts: {
				pages: 0,
				discovered: 0,
				inspected: 0,
				answered: 0,
				answeredNotFilled: 0,
				filledVerified: 0,
				needsReviewNotFilled: 0,
				fillFailed: 0,
				filledUnverified: 0,
				skipped: 0,
			},
			questions: [],
			delivery: { chunkIndex: 0, hasMore: false, remainingQuestionCount: 0 },
			finalSubmissionPerformed: false as const,
		}))
		const getVisionModel = vi.fn(() => undefined)
		const captureVisibleTab = vi.fn()
		const tools = createVisualObserveTools({
			getVisionModel,
			captureVisibleTab,
			questionSolver: { execute },
		})

		const raw = await tools.visual_observe.execute({
			mode: 'capability',
			reason: 'The user explicitly asked to answer this assessment.',
			capability: { name: 'question_solver', action: 'answer', scope: 'current_page' },
		})
		const result = JSON.parse(raw)

		expect(result).toMatchObject({
			mode: 'capability',
			capability: 'question_solver',
			action: 'answer',
			status: 'completed',
		})
		expect(execute).toHaveBeenCalledOnce()
		expect(getVisionModel).not.toHaveBeenCalled()
		expect(captureVisibleTab).not.toHaveBeenCalled()
	})
})
