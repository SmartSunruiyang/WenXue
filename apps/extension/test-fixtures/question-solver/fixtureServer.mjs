import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const child = createServer((request, response) => serve(request, response))
await listen(child)
const childAddress = child.address()
if (!childAddress || typeof childAddress === 'string') throw new Error('child_fixture_bind_failed')
const childOrigin = `http://127.0.0.1:${childAddress.port}`

const top = createServer(async (request, response) => {
	if (new URL(request.url ?? '/', 'http://fixture.invalid').pathname === '/cross-origin-top.html') {
		const html = (await readFile(join(root, 'cross-origin-top.html'), 'utf8')).replaceAll(
			'{{CHILD_ORIGIN}}',
			childOrigin,
		)
		response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
		response.end(html)
		return
	}
	await serve(request, response)
})
await listen(top)
const topAddress = top.address()
if (!topAddress || typeof topAddress === 'string') throw new Error('top_fixture_bind_failed')

process.stdout.write(
	`${JSON.stringify({
		topOrigin: `http://127.0.0.1:${topAddress.port}`,
		childOrigin,
	})}\n`,
)

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		top.close()
		child.close(() => process.exit(0))
	})
}

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
}

async function serve(request, response) {
	try {
		const pathname = decodeURIComponent(
			new URL(request.url ?? '/', 'http://fixture.invalid').pathname,
		)
		const relative = pathname === '/' ? 'assessment-lab.html' : pathname.replace(/^\/+/, '')
		if (relative.includes('..')) throw new Error('invalid_fixture_path')
		const body = await readFile(join(root, relative))
		response.writeHead(200, { 'Content-Type': contentType(relative) })
		response.end(body)
	} catch {
		response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
		response.end('Not found')
	}
}

function contentType(pathname) {
	switch (extname(pathname)) {
		case '.html':
			return 'text/html; charset=utf-8'
		case '.svg':
			return 'image/svg+xml'
		default:
			return 'application/octet-stream'
	}
}
