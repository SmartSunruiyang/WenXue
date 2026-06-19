/**
 * 超星学习通「图片解析」步骤（Task 9，Spec §8.1 第 2 步 / §8.4）。
 *
 * {@link extractQuestion} 在同步 DOM 阶段已把视觉图分类为 `{type:'image'}` 占位部件
 * （仅带 `fallbackUrl`）。本文件负责**异步**地把这些占位部件解析成内联 base64：页内带 cookie
 * 抓图 → canvas 降采样 → data URL，写回 `part.dataUrl`。
 *
 * 抓取 / 编码（真实 `fetch` + `<canvas>`）在 jsdom 下无法运行，故全部经**可注入依赖**
 * （`deps.fetchImpl` / `deps.downscale`）隔离：单测注入 fake 即可覆盖**逻辑**（成功写
 * dataUrl、失败保 fallbackUrl、选项图失败置 needsReview、按 URL 去重），无需真实网络 / canvas。
 * 默认实现 {@link defaultDownscale} 只在内容脚本里走，不在测试里被触发。
 *
 * 失败兜底（§8.4）：抓图 / 编码失败时保留 `fallbackUrl`、不写 `dataUrl`（序列化阶段退化为
 * URL 文本）；若失败的是**选项图**（图即答案，无法可靠作答）→ 置该题 `needsReview = true`，
 * 宁缺勿猜。题干图失败不置 needsReview（题面退化为 URL 文本仍可尝试作答）。
 */

import type { ChaoxingQuestion, ContentPart } from './types'

/** 降采样最长边上限（px）。 */
const MAX_LONGEST_SIDE = 1280

/** JPEG 导出质量。 */
const JPEG_QUALITY = 0.85

export interface ResolveImagesDeps {
	/** 抓图实现，默认全局 `fetch`（测试注入 fake，避免真实网络）。 */
	fetchImpl?: typeof fetch
	/** Blob → data URL 降采样实现，默认 {@link defaultDownscale}（测试注入 canned 串，避免真实 canvas）。 */
	downscale?: (blob: Blob) => Promise<string>
}

/** 标注一个待解析图片部件的来源（用于失败时决定是否置 needsReview）。 */
interface ImageTask {
	part: Extract<ContentPart, { type: 'image' }>
	/** 该图是否为选项图（图即答案）：失败时置 needsReview。 */
	isOption: boolean
}

/**
 * 把一道题里所有 `{type:'image'}` 占位部件解析为内联 base64（就地写 `part.dataUrl`），
 * 返回**同一个**被改写后的题对象。
 *
 * @param q    读题阶段产出的题（其图片部件仅带 `fallbackUrl`）。
 * @param deps 可注入的抓图 / 降采样实现；缺省走真实内容脚本能力。
 */
export async function resolveQuestionImages(
	q: ChaoxingQuestion,
	deps: ResolveImagesDeps = {},
): Promise<ChaoxingQuestion> {
	const fetchImpl = deps.fetchImpl ?? globalThis.fetch
	const downscale = deps.downscale ?? defaultDownscale

	const tasks = collectImageTasks(q)
	if (tasks.length === 0) return q

	// 按 URL 去重：同一 URL 只抓 + 降采样一次，结果缓存为 Promise 供并发任务共享。
	const cache = new Map<string, Promise<string>>()
	const resolveOne = (url: string): Promise<string> => {
		let pending = cache.get(url)
		if (!pending) {
			pending = fetchAndDownscale(url, fetchImpl, downscale)
			cache.set(url, pending)
		}
		return pending
	}

	let needsReview = false
	await Promise.all(
		tasks.map(async ({ part, isOption }) => {
			// 已有 dataUrl（极少见：上游已解析）→ 跳过。
			if (part.dataUrl) return
			const url = part.fallbackUrl
			if (!url) {
				if (isOption) needsReview = true
				return
			}
			try {
				part.dataUrl = await resolveOne(url)
			} catch {
				// 失败：保留 fallbackUrl，不写 dataUrl。选项图（图即答案）→ 置 needsReview（§8.4）。
				if (isOption) needsReview = true
			}
		}),
	)

	if (needsReview) q.needsReview = true
	return q
}

/**
 * 收集题干 + 选项 + 小题选项里的全部图片部件，标注其是否为「图即答案」（失败置 needsReview）。
 *
 * 小题（连线 / 完形 / 阅读的 subQuestions）的 options 同样是「图即答案」语义：选错框 / 错小题
 * 无法可靠作答，故其图失败也按选项图处理（§8.4）。小题自身无独立题干图，仅遍历其 options。
 */
function collectImageTasks(q: ChaoxingQuestion): ImageTask[] {
	const tasks: ImageTask[] = []
	for (const part of q.stem) {
		if (part.type === 'image') tasks.push({ part, isOption: false })
	}
	for (const option of q.options ?? []) {
		for (const part of option.content) {
			if (part.type === 'image') tasks.push({ part, isOption: true })
		}
	}
	for (const sub of q.subQuestions ?? []) {
		for (const option of sub.options ?? []) {
			for (const part of option.content) {
				if (part.type === 'image') tasks.push({ part, isOption: true })
			}
		}
	}
	return tasks
}

/** 抓图（带 cookie）→ blob → 降采样为 data URL。任一步失败即抛出（由调用方兜底）。 */
async function fetchAndDownscale(
	url: string,
	fetchImpl: typeof fetch,
	downscale: (blob: Blob) => Promise<string>,
): Promise<string> {
	const response = await fetchImpl(url, { credentials: 'include' })
	if (!response.ok) {
		throw new Error(`image fetch failed (HTTP ${response.status}) for ${url}`)
	}
	const blob = await response.blob()
	return downscale(blob)
}

/**
 * 默认降采样：把 blob 画到 `<canvas>`（最长边 ≤ {@link MAX_LONGEST_SIDE}），导出 JPEG data URL。
 *
 * 仅在内容脚本里运行——依赖 `Image` / `<canvas>` / `URL.createObjectURL`，jsdom 不支持；
 * 单测一律注入 `downscale` 桩绕开此函数。跨域污染会令 `toDataURL` 抛 `SecurityError`，
 * 由 {@link resolveQuestionImages} 当作失败兜底（§8.4）。
 */
async function defaultDownscale(blob: Blob): Promise<string> {
	const objectUrl = URL.createObjectURL(blob)
	try {
		const image = await loadImage(objectUrl)
		const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, MAX_LONGEST_SIDE)

		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('2D canvas context unavailable')
		ctx.drawImage(image, 0, 0, width, height)

		return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
	} finally {
		URL.revokeObjectURL(objectUrl)
	}
}

/** 计算「保持纵横比、最长边 ≤ max」后的整数宽高；原图已够小则原样返回。 */
function fitWithin(
	naturalWidth: number,
	naturalHeight: number,
	max: number,
): { width: number; height: number } {
	const w = naturalWidth || max
	const h = naturalHeight || max
	const longest = Math.max(w, h)
	if (longest <= max) return { width: w, height: h }
	const scale = max / longest
	return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/** 把 object URL 载入为已解码的 `HTMLImageElement`（载入失败即 reject）。 */
function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error(`failed to decode image: ${src}`))
		image.src = src
	})
}
