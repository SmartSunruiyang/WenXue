import { describe, expect, it, vi } from 'vitest'

import { resolveQuestionImages } from './images'
import type { ChaoxingQuestion, ContentPart } from './types'

/** A 200-OK fetch returning a tiny fake blob (jsdom has no real image decode). */
function okFetch(): typeof fetch {
	return vi.fn(
		async () => new Response(new Blob(['x'], { type: 'image/png' }), { status: 200 }),
	) as unknown as typeof fetch
}

/** A downscale stub that ignores the blob and returns a canned data URL. */
const cannedDownscale = vi.fn(async () => 'data:image/jpeg;base64,CANNED')

function imagePart(label: string, url: string): ContentPart {
	return { type: 'image', label, fallbackUrl: url }
}

function makeQuestion(partial: Partial<ChaoxingQuestion>): ChaoxingQuestion {
	return {
		id: 'q1',
		typeCode: 0,
		type: 'single',
		stem: [{ type: 'text', text: 'stem' }],
		hasImages: true,
		needsReview: false,
		...partial,
	}
}

describe('resolveQuestionImages', () => {
	it('fetches each stem image with credentials and sets dataUrl from downscale', async () => {
		const fetchImpl = okFetch()
		const q = makeQuestion({
			stem: [{ type: 'text', text: '题干 [题干图1]' }, imagePart('题干图1', 'https://x/a.png')],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.stem[1] as Extract<ContentPart, { type: 'image' }>
		expect(img.dataUrl).toBe('data:image/jpeg;base64,CANNED')
		expect(img.fallbackUrl).toBe('https://x/a.png')
		expect(out.needsReview).toBe(false)
		// credentials: 'include' must be passed for cookie-bearing CDN fetch.
		expect(fetchImpl).toHaveBeenCalledWith('https://x/a.png', { credentials: 'include' })
	})

	it('resolves option images too', async () => {
		const fetchImpl = okFetch()
		const q = makeQuestion({
			options: [
				{
					key: 'A',
					content: [{ type: 'text', text: '[选项A图]' }, imagePart('选项A图', 'https://x/o.png')],
				},
				{ key: 'B', content: [{ type: 'text', text: 'B. 文字' }] },
			],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.options![0].content[1] as Extract<ContentPart, { type: 'image' }>
		expect(img.dataUrl).toBe('data:image/jpeg;base64,CANNED')
		expect(out.needsReview).toBe(false)
	})

	it('dedups by URL: a repeated URL is fetched + downscaled once', async () => {
		const fetchImpl = okFetch()
		const downscale = vi.fn(async () => 'data:image/jpeg;base64,DEDUP')
		const q = makeQuestion({
			stem: [imagePart('题干图1', 'https://x/same.png')],
			options: [{ key: 'A', content: [imagePart('选项A图', 'https://x/same.png')] }],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale })

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(downscale).toHaveBeenCalledTimes(1)
		const stemImg = out.stem[0] as Extract<ContentPart, { type: 'image' }>
		const optImg = out.options![0].content[0] as Extract<ContentPart, { type: 'image' }>
		expect(stemImg.dataUrl).toBe('data:image/jpeg;base64,DEDUP')
		expect(optImg.dataUrl).toBe('data:image/jpeg;base64,DEDUP')
	})

	it('on a failed STEM image: keeps fallbackUrl, leaves dataUrl unset, AND sets needsReview', async () => {
		const fetchImpl = vi.fn(
			async () => new Response('forbidden', { status: 403 }),
		) as unknown as typeof fetch
		const q = makeQuestion({
			stem: [{ type: 'text', text: '[题干图1]' }, imagePart('题干图1', 'https://x/blocked.png')],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.stem[1] as Extract<ContentPart, { type: 'image' }>
		expect(img.dataUrl).toBeUndefined()
		expect(img.fallbackUrl).toBe('https://x/blocked.png')
		// 题干图抓取失败 = 模型看不到题面的图 → 宁可标记人工，绝不对图盲答。
		expect(out.needsReview).toBe(true)
	})

	it('on a failed OPTION image: keeps fallbackUrl AND sets needsReview (image-as-answer, §8.4)', async () => {
		const fetchImpl = vi.fn(
			async () => new Response('forbidden', { status: 403 }),
		) as unknown as typeof fetch
		const q = makeQuestion({
			options: [
				{ key: 'A', content: [imagePart('选项A图', 'https://x/blocked.png')] },
				{ key: 'B', content: [{ type: 'text', text: 'B. 文字' }] },
			],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.options![0].content[0] as Extract<ContentPart, { type: 'image' }>
		expect(img.dataUrl).toBeUndefined()
		expect(img.fallbackUrl).toBe('https://x/blocked.png')
		expect(out.needsReview).toBe(true)
	})

	it('treats a thrown fetch (network error) as failure', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('network down')
		}) as unknown as typeof fetch
		const q = makeQuestion({
			options: [{ key: 'A', content: [imagePart('选项A图', 'https://x/x.png')] }],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.options![0].content[0] as Extract<ContentPart, { type: 'image' }>
		expect(img.dataUrl).toBeUndefined()
		expect(out.needsReview).toBe(true)
	})

	it('treats a thrown downscale (canvas taint) as failure', async () => {
		const fetchImpl = okFetch()
		const downscale = vi.fn(async () => {
			throw new Error('tainted canvas')
		})
		const q = makeQuestion({
			options: [{ key: 'A', content: [imagePart('选项A图', 'https://x/x.png')] }],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale })

		const img = out.options![0].content[0] as Extract<ContentPart, { type: 'image' }>
		expect(img.dataUrl).toBeUndefined()
		expect(out.needsReview).toBe(true)
	})

	it('resolves images nested inside subQuestion options (line/fill/reader)', async () => {
		const fetchImpl = okFetch()
		const q = makeQuestion({
			type: 'fill',
			stem: [{ type: 'text', text: '完形材料' }],
			subQuestions: [
				{
					id: 'q1-sub0',
					typeCode: NaN,
					type: 'unknown',
					stem: [],
					hasImages: true,
					needsReview: false,
					options: [
						{ key: 'A', content: [imagePart('小题0选项A图', 'https://x/sub.png')] },
						{ key: 'B', content: [{ type: 'text', text: 'B. 文字' }] },
					],
				},
			],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.subQuestions![0].options![0].content[0] as Extract<
			ContentPart,
			{ type: 'image' }
		>
		expect(img.dataUrl).toBe('data:image/jpeg;base64,CANNED')
		expect(fetchImpl).toHaveBeenCalledWith('https://x/sub.png', { credentials: 'include' })
	})

	it('on a failed subQuestion option image: sets needsReview (image-as-answer)', async () => {
		const fetchImpl = vi.fn(
			async () => new Response('forbidden', { status: 403 }),
		) as unknown as typeof fetch
		const q = makeQuestion({
			type: 'line',
			stem: [{ type: 'text', text: '连线' }],
			subQuestions: [
				{
					id: 'q1-box0',
					typeCode: NaN,
					type: 'unknown',
					stem: [],
					hasImages: true,
					needsReview: false,
					options: [{ key: 'x', content: [imagePart('连线0选项x图', 'https://x/blocked.png')] }],
				},
			],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.subQuestions![0].options![0].content[0] as Extract<
			ContentPart,
			{ type: 'image' }
		>
		expect(img.dataUrl).toBeUndefined()
		expect(out.needsReview).toBe(true)
	})

	it('is a no-op for a question with no image parts', async () => {
		const fetchImpl = okFetch()
		const q = makeQuestion({ stem: [{ type: 'text', text: '纯文本题' }], hasImages: false })

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		expect(fetchImpl).not.toHaveBeenCalled()
		expect(out.needsReview).toBe(false)
	})

	it('keeps an already-resolved dataUrl and skips re-fetching it', async () => {
		const fetchImpl = okFetch()
		const q = makeQuestion({
			stem: [
				{
					type: 'image',
					label: '题干图1',
					fallbackUrl: 'https://x/a.png',
					dataUrl: 'data:image/jpeg;base64,PRE',
				},
			],
		})

		const out = await resolveQuestionImages(q, { fetchImpl, downscale: cannedDownscale })

		const img = out.stem[0] as Extract<ContentPart, { type: 'image' }>
		expect(img.dataUrl).toBe('data:image/jpeg;base64,PRE')
		expect(fetchImpl).not.toHaveBeenCalled()
	})
})
