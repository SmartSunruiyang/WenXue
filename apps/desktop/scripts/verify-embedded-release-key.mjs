import { createHash, createPublicKey } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

async function main() {
	const options = readOptions(process.argv.slice(2))
	const bundlePath = path.resolve(options.bundle)
	const rawKey = requireValue(
		process.env.WENXUE_RELEASE_ED25519_PUBLIC_KEY,
		'WENXUE_RELEASE_ED25519_PUBLIC_KEY',
	)
	const publicKey = releasePublicKey(rawKey)
	const der = publicKey.export({ format: 'der', type: 'spki' })
	const fingerprint = createHash('sha256').update(der).digest('hex')
	const bundle = await readFile(bundlePath, 'utf8')
	const base64Chunks = der.toString('base64').match(/.{1,48}/g) ?? []
	if (base64Chunks.length === 0 || base64Chunks.some((chunk) => !bundle.includes(chunk))) {
		throw new Error('Built desktop main bundle does not contain the configured release public key')
	}
	if (options.gatewayBaseUrl) {
		const gatewayBaseUrl = requireHttpsUrl(options.gatewayBaseUrl, '--gateway-base-url')
		if (!bundle.includes(gatewayBaseUrl)) {
			throw new Error('Built desktop main bundle does not contain the configured gateway URL')
		}
		const rendererDir = path.resolve(requireValue(options.rendererDir, '--renderer-dir'))
		const rendererBundles = await collectJavaScriptFiles(rendererDir)
		if (rendererBundles.length === 0 || !(await includesValue(rendererBundles, gatewayBaseUrl))) {
			throw new Error('Built desktop renderer does not contain the configured gateway URL')
		}
	}
	if (options.fingerprintOutput) {
		const fingerprintOutput = path.resolve(options.fingerprintOutput)
		await mkdir(path.dirname(fingerprintOutput), { recursive: true })
		await writeFile(fingerprintOutput, `${fingerprint}\n`, 'utf8')
	}
	process.stdout.write(`${fingerprint}\n`)
}

async function collectJavaScriptFiles(root) {
	const result = []
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name)
		if (entry.isDirectory()) result.push(...(await collectJavaScriptFiles(target)))
		if (entry.isFile() && entry.name.endsWith('.js')) result.push(target)
	}
	return result
}

async function includesValue(files, expected) {
	for (const file of files) {
		if ((await readFile(file, 'utf8')).includes(expected)) return true
	}
	return false
}

function readOptions(argv) {
	const values = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		const value = argv[index + 1]
		if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? ''}`)
		values.set(key.slice(2), value)
	}
	return {
		bundle: requireValue(values.get('bundle'), '--bundle'),
		fingerprintOutput: values.get('fingerprint-output'),
		gatewayBaseUrl: values.get('gateway-base-url'),
		rendererDir: values.get('renderer-dir'),
	}
}

function releasePublicKey(raw) {
	const value = requireValue(raw, 'release public key').split('\\n').join('\n')
	return value.includes('BEGIN PUBLIC KEY')
		? createPublicKey(value)
		: createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' })
}

function requireValue(value, name) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required`)
	return value.trim()
}

function requireHttpsUrl(value, name) {
	const parsed = new URL(requireValue(value, name))
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
		throw new Error(`${name} must be a safe HTTPS URL`)
	}
	return parsed.toString().replace(/\/$/, '')
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
