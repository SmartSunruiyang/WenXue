const gatewayUrl = process.env.WENXUE_GATEWAY_URL
const accessToken = process.env.CLOUDBASE_ACCESS_TOKEN
const model = process.env.WENXUE_M0_MODEL ?? 'qwen-plus'

if (!gatewayUrl || !accessToken) {
	console.error('Missing WENXUE_GATEWAY_URL or CLOUDBASE_ACCESS_TOKEN')
	process.exit(1)
}

const startedAt = Date.now()
const response = await fetch(new URL('/v1/chat/completions', gatewayUrl), {
	method: 'POST',
	headers: {
		authorization: `Bearer ${accessToken}`,
		'content-type': 'application/json',
		accept: 'text/event-stream',
	},
	body: JSON.stringify({
		model,
		stream: true,
		messages: [{ role: 'user', content: '用一句中文回答：问学网关 M0 是否连通？' }],
	}),
})

if (!response.ok || !response.body) {
	console.error(`Gateway request failed: ${response.status}`)
	process.exit(1)
}

let usage = null
let chunks = 0
const decoder = new TextDecoder()
const reader = response.body.getReader()

while (true) {
	const { done, value } = await reader.read()
	if (done) {
		break
	}
	chunks += 1
	const text = decoder.decode(value, { stream: true })
	usage = extractUsage(text) ?? usage
}

const tail = decoder.decode()
if (tail) {
	usage = extractUsage(tail) ?? usage
}

const latencyMs = Date.now() - startedAt
const totalTokens = readTotalTokens(usage)
console.log(
	JSON.stringify(
		{
			ok: totalTokens > 0,
			chunks,
			latencyMs,
			usage,
		},
		null,
		2,
	),
)

process.exit(totalTokens > 0 ? 0 : 1)

/**
 * @param {string} frame
 * @returns {Record<string, unknown> | null}
 */
function extractUsage(frame) {
	for (const line of frame.split(/\r?\n/)) {
		if (!line.startsWith('data:')) {
			continue
		}
		const data = line.slice(5).trim()
		if (!data || data === '[DONE]') {
			continue
		}
		try {
			const payload = JSON.parse(data)
			if (payload && typeof payload === 'object' && payload.usage) {
				return payload.usage
			}
		} catch {
			continue
		}
	}
	return null
}

/**
 * @param {Record<string, unknown> | null} usage
 */
function readTotalTokens(usage) {
	if (!usage) {
		return 0
	}
	if (typeof usage.total_tokens === 'number') {
		return usage.total_tokens
	}
	if (typeof usage.totalTokens === 'number') {
		return usage.totalTokens
	}
	return 0
}
