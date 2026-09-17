import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createAdminStaticServer } from './server.mjs'

let rootDir
let server
let origin

before(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), 'wenxue-admin-server-'))
	await writeFile(path.join(rootDir, 'index.html'), '<h1>admin ready</h1>')
	server = createAdminStaticServer(rootDir)
	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('test server address is unavailable')
	origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
	await new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()))
	})
	await rm(rootDir, { force: true, recursive: true })
})

test('malformed URL encoding returns 400 without terminating the server', async () => {
	assert.equal((await request('/%')).status, 400)
	const healthy = await request('/admin/')
	assert.equal(healthy.status, 200)
	assert.match(healthy.body, /admin ready/)
})

test('path traversal falls back to the SPA entry without reading outside the root', async () => {
	const response = await request('/..%2F..%2Fetc%2Fpasswd')
	assert.equal(response.status, 200)
	assert.match(response.body, /admin ready/)
	assert.doesNotMatch(response.body, /root:/)
})

function request(pathname) {
	return new Promise((resolve, reject) => {
		get(`${origin}${pathname}`, (response) => {
			let body = ''
			response.setEncoding('utf8')
			response.on('data', (chunk) => {
				body += chunk
			})
			response.on('end', () => resolve({ status: response.statusCode, body }))
		}).once('error', reject)
	})
}
