import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_ROOT = '/admin'
const ADMIN_ASSET_ROOT = '/admin/assets/'
const DEFAULT_DIST_ROOT = fileURLToPath(new URL('../../admin/dist/', import.meta.url))
const CACHE_HEADERS = {
	html: 'no-cache',
	asset: 'public, max-age=31536000, immutable',
}
/** @type {Record<string, string>} */
const CONTENT_TYPES = {
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
}

/** @type {Map<string, Promise<Buffer>>} */
const fileCache = new Map()

/**
 * @param {unknown} _event
 * @param {{ httpContext?: { url?: string, httpMethod?: string } }} context
 */
export async function adminConsole(_event, context) {
	return serveAdminConsole({
		url: context?.httpContext?.url ?? `http://localhost${ADMIN_ROOT}`,
		method: context?.httpContext?.httpMethod ?? 'GET',
	})
}

/**
 * @param {{
 *   url: string,
 *   method?: string,
 *   distRoot?: string,
 *   readFileImpl?: (path: string) => Promise<Buffer>,
 * }} input
 */
export async function serveAdminConsole(input) {
	const method = (input.method ?? 'GET').toUpperCase()
	if (method !== 'GET' && method !== 'HEAD') {
		return response(405, 'text/plain; charset=utf-8', 'Method Not Allowed', {
			allow: 'GET, HEAD',
			'cache-control': 'no-store',
		})
	}

	let pathname
	try {
		const decodedUrl = decodeURIComponent(input.url)
		const rawPath = decodedUrl.split(/[?#]/, 1)[0]
		if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rawPath)) {
			return response(404, 'text/plain; charset=utf-8', 'Not Found', {
				'cache-control': 'no-store',
			})
		}
		pathname = decodeURIComponent(new URL(input.url, 'http://localhost').pathname)
	} catch {
		return response(400, 'text/plain; charset=utf-8', 'Bad Request', {
			'cache-control': 'no-store',
		})
	}

	const distRoot = resolve(input.distRoot ?? DEFAULT_DIST_ROOT)
	const asset = resolveAdminFile(pathname, distRoot)
	if (!asset) {
		return response(404, 'text/plain; charset=utf-8', 'Not Found', {
			'cache-control': 'no-store',
		})
	}

	try {
		const body = await readCachedFile(asset.path, input.readFileImpl ?? readFile)
		return {
			statusCode: 200,
			headers: {
				'cache-control': asset.cacheControl,
				'content-length': String(body.byteLength),
				'content-type': asset.contentType,
				'x-content-type-options': 'nosniff',
			},
			body,
		}
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') {
			return response(404, 'text/plain; charset=utf-8', 'Not Found', {
				'cache-control': 'no-store',
			})
		}
		return response(500, 'text/plain; charset=utf-8', 'Internal Server Error', {
			'cache-control': 'no-store',
		})
	}
}

export function resetAdminConsoleFileCache() {
	fileCache.clear()
}

/**
 * @param {string} pathname
 * @param {string} distRoot
 */
function resolveAdminFile(pathname, distRoot) {
	if (pathname === ADMIN_ROOT || pathname === `${ADMIN_ROOT}/`) {
		return {
			path: resolve(distRoot, 'index.html'),
			contentType: CONTENT_TYPES['.html'],
			cacheControl: CACHE_HEADERS.html,
		}
	}

	if (!pathname.startsWith(ADMIN_ASSET_ROOT)) return null

	const assetRelativePath = pathname.slice(ADMIN_ASSET_ROOT.length)
	if (!isSafeAssetPath(assetRelativePath)) return null

	const assetRoot = resolve(distRoot, 'assets')
	const assetPath = resolve(assetRoot, assetRelativePath)
	const relativePath = relative(assetRoot, assetPath)
	if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || isAbsolute(relativePath)) {
		return null
	}

	return {
		path: assetPath,
		contentType: CONTENT_TYPES[extname(assetPath).toLowerCase()] ?? 'application/octet-stream',
		cacheControl: CACHE_HEADERS.asset,
	}
}

/**
 * @param {string} value
 */
function isSafeAssetPath(value) {
	if (!value || value.includes('\0') || value.includes('\\')) return false
	const segments = value.split('/')
	return segments.every(
		(segment) =>
			segment.length > 0 &&
			segment !== '.' &&
			segment !== '..' &&
			/^[A-Za-z0-9._-]+$/.test(segment),
	)
}

/**
 * @param {string} path
 * @param {(path: string) => Promise<Buffer>} readFileImpl
 */
async function readCachedFile(path, readFileImpl) {
	if (readFileImpl !== readFile) return readFileImpl(path)
	const cached = fileCache.get(path)
	if (cached) return cached

	const pending = readFileImpl(path).catch((error) => {
		fileCache.delete(path)
		throw error
	})
	fileCache.set(path, pending)
	return pending
}

/**
 * @param {number} statusCode
 * @param {string} contentType
 * @param {string} body
 * @param {Record<string, string>} headers
 */
function response(statusCode, contentType, body, headers) {
	return {
		statusCode,
		headers: {
			...headers,
			'content-type': contentType,
			'x-content-type-options': 'nosniff',
		},
		body,
	}
}

/**
 * @param {unknown} value
 * @returns {value is NodeJS.ErrnoException}
 */
function isNodeError(value) {
	return value instanceof Error
}
