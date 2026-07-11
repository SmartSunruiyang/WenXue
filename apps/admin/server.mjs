import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

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

createServer(async (request, response) => {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
	const filePath = await resolveFile(pathname)
	const type = contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
	response.setHeader('content-type', type)
	response.setHeader(
		'cache-control',
		filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
	)
	createReadStream(filePath).pipe(response)
}).listen(port, '0.0.0.0')

/**
 * @param {string} pathname
 */
async function resolveFile(pathname) {
	const effectivePathname = stripAdminBasePath(pathname)
	const safePath = normalize(decodeURIComponent(effectivePathname)).replace(/^(\.\.[/\\])+/, '')
	const candidate = join(distDir, safePath === '/' ? 'index.html' : safePath)
	if (candidate.startsWith(distDir) && (await isFile(candidate))) return candidate
	return join(distDir, 'index.html')
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
