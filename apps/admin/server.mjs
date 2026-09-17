import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const port = Number(process.env.PORT ?? 3000)
const distDir = resolve('dist')
const adminBasePath = '/admin'

const contentTypes = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.js', 'application/javascript; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.svg', 'image/svg+xml'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.webp', 'image/webp'],
	['.ico', 'image/x-icon'],
])

export function createAdminStaticServer(rootDir = distDir) {
	return createServer((request, response) => {
		void serveStaticRequest(request, response, rootDir)
	})
}

async function serveStaticRequest(request, response, rootDir) {
	try {
		const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
		const filePath = await resolveFile(pathname, rootDir)
		const type = contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
		response.setHeader('content-type', type)
		response.setHeader(
			'cache-control',
			filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
		)
		const stream = createReadStream(filePath)
		stream.once('error', (error) => {
			if (!response.headersSent) {
				response.writeHead(500).end('Internal Server Error')
			} else {
				response.destroy(error)
			}
		})
		stream.pipe(response)
	} catch (error) {
		if (response.headersSent) {
			response.destroy(error instanceof Error ? error : undefined)
			return
		}
		const status = error instanceof URIError ? 400 : 500
		response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
		response.end(status === 400 ? 'Bad Request' : 'Internal Server Error')
	}
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === entryPath) {
	createAdminStaticServer().listen(port, '0.0.0.0')
}

/**
 * @param {string} pathname
 */
async function resolveFile(pathname, rootDir) {
	const effectivePathname = stripAdminBasePath(pathname)
	const safePath = normalize(decodeURIComponent(effectivePathname)).replace(/^(\.\.[/\\])+/, '')
	const candidate = resolve(rootDir, safePath === '/' ? 'index.html' : `.${safePath}`)
	const candidateRelativePath = relative(rootDir, candidate)
	if (
		candidateRelativePath &&
		!candidateRelativePath.startsWith('..') &&
		!candidateRelativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
		(await isFile(candidate))
	) {
		return candidate
	}
	return join(rootDir, 'index.html')
}

/**
 * @param {string} pathname
 */
function stripAdminBasePath(pathname) {
	if (pathname === adminBasePath) return '/'
	if (pathname.startsWith(`${adminBasePath}/`)) return pathname.slice(adminBasePath.length) || '/'
	return pathname
}

/**
 * @param {string} filePath
 */
async function isFile(filePath) {
	try {
		return (await stat(filePath)).isFile()
	} catch {
		return false
	}
}
