import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { ExtensionHandoffAuthSession } from './LauncherAuthSession'

export const WENXUE_EXTENSION_ID = 'akldabonmimlicnjlflnapfeklbfemhj'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_COMPLETE_BODY_BYTES = 4096

export interface ExtensionSessionHandoffOptions {
	extensionId?: string
	timeoutMs?: number
	listenHost?: string
	publicHost?: string
	createHttpServer?: typeof createServer
}

export interface ExtensionSessionHandoffResult {
	ok: boolean
	error?: string
}

interface CompletionPayload {
	ok: boolean
	error?: string
}

export class ExtensionSessionHandoff {
	private readonly extensionId: string
	private readonly timeoutMs: number
	private readonly listenHost: string
	private readonly publicHost: string
	private readonly createHttpServer: typeof createServer

	constructor(options: ExtensionSessionHandoffOptions = {}) {
		this.extensionId = options.extensionId ?? WENXUE_EXTENSION_ID
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.listenHost = options.listenHost ?? '127.0.0.1'
		this.publicHost = options.publicHost ?? this.listenHost
		this.createHttpServer = options.createHttpServer ?? createServer
	}

	async run(
		session: ExtensionHandoffAuthSession,
		openUrl: (url: string) => Promise<void>,
	): Promise<ExtensionSessionHandoffResult> {
		const nonce = randomUUID()
		const basePath = `/wenxue-auth-handoff/${nonce}`
		let complete: (result: ExtensionSessionHandoffResult) => void = () => undefined
		const completion = new Promise<ExtensionSessionHandoffResult>((resolve) => {
			complete = resolve
		})
		const server = this.createHttpServer((request, response) => {
			this.handleRequest({ request, response, basePath, session, complete })
		})

		await listen(server, this.listenHost)
		const address = server.address()
		if (!address || typeof address === 'string') {
			await close(server)
			throw new Error('无法创建本机会话交接服务')
		}

		const url = `http://${this.publicHost}:${address.port}${basePath}`
		try {
			await openUrl(url)
			return await withTimeout(completion, this.timeoutMs)
		} finally {
			await close(server)
		}
	}

	private handleRequest(input: {
		request: IncomingMessage
		response: ServerResponse
		basePath: string
		session: ExtensionHandoffAuthSession
		complete: (result: ExtensionSessionHandoffResult) => void
	}): void {
		const url = new URL(input.request.url ?? '/', 'http://localhost')
		if (input.request.method === 'GET' && url.pathname === input.basePath) {
			writeHtml(input.response, renderHandoffPage(input.session, this.extensionId))
			return
		}
		if (input.request.method === 'POST' && url.pathname === `${input.basePath}/complete`) {
			void readRequestBody(input.request).then((body) => {
				const payload = parseCompletionPayload(body)
				input.complete(payload)
				writeJson(input.response, payload)
			})
			return
		}
		if (url.pathname === '/favicon.ico') {
			input.response.writeHead(204)
			input.response.end()
			return
		}

		input.response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
		input.response.end('Not found')
	}
}

function renderHandoffPage(session: ExtensionHandoffAuthSession, extensionId: string): string {
	const message = JSON.stringify({
		type: 'WENXUE_AUTH_SESSION',
		session,
	})
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>问学会话交接</title>
<style>
body{margin:0;display:grid;min-height:100vh;place-items:center;background:#fff;color:#111;font:14px system-ui,-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
main{display:grid;gap:10px;text-align:center}
strong{font-size:18px}
span{color:#666}
</style>
</head>
<body>
<main>
<strong id="title">正在连接问学插件</strong>
<span id="detail">请保持此标签页打开。</span>
</main>
<script>
const message = ${message};
const title = document.getElementById('title');
const detail = document.getElementById('detail');
function finish(payload) {
  fetch(location.pathname + '/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}
if (!globalThis.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
  title.textContent = '无法连接问学插件';
  detail.textContent = '当前浏览器未开放外部扩展消息。';
  finish({ ok: false, error: 'chrome.runtime.sendMessage unavailable' });
} else {
  chrome.runtime.sendMessage(${JSON.stringify(extensionId)}, message, (response) => {
    const lastError = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (lastError || !response || response.ok !== true) {
      title.textContent = '会话交接失败';
      detail.textContent = lastError || (response && response.error) || '问学插件未返回成功状态。';
      finish({ ok: false, error: detail.textContent });
      return;
    }
    title.textContent = '会话已交接';
    detail.textContent = '可以关闭此标签页并继续使用问学。';
    finish({ ok: true });
  });
}
</script>
</body>
</html>`
}

function writeHtml(response: ServerResponse, html: string): void {
	response.writeHead(200, {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-store',
	})
	response.end(html)
}

function writeJson(response: ServerResponse, payload: CompletionPayload): void {
	response.writeHead(200, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	})
	response.end(JSON.stringify(payload))
}

async function listen(server: Server, host: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, host, () => {
			server.off('error', reject)
			resolve()
		})
	})
}

async function close(server: Server): Promise<void> {
	await new Promise<void>((resolve) => {
		server.close(() => resolve())
	})
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => {
					reject(new Error('问学插件会话交接超时'))
				}, timeoutMs)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
	let body = ''
	for await (const chunk of request) {
		body += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
		if (body.length > MAX_COMPLETE_BODY_BYTES) break
	}
	return body
}

function parseCompletionPayload(body: string): CompletionPayload {
	try {
		const parsed = JSON.parse(body) as unknown
		if (isRecord(parsed) && parsed.ok === true) return { ok: true }
		if (isRecord(parsed) && parsed.ok === false) {
			return {
				ok: false,
				error: typeof parsed.error === 'string' ? parsed.error : '问学插件会话交接失败',
			}
		}
	} catch {
		return { ok: false, error: '问学插件会话交接响应格式异常' }
	}
	return { ok: false, error: '问学插件会话交接响应格式异常' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}
