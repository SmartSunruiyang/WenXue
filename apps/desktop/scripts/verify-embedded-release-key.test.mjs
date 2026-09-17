import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(new URL('./verify-embedded-release-key.mjs', import.meta.url))

test('proves the release key and protected gateway URL are embedded in both bundles', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'wenxue-embedded-release-config-'))
	try {
		const { publicKey } = generateKeyPairSync('ed25519')
		const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
		const der = publicKey.export({ format: 'der', type: 'spki' })
		const chunks = der.toString('base64').match(/.{1,48}/g) ?? []
		const gatewayBaseUrl = 'https://gateway.wenxue.example'
		const mainBundle = path.join(root, 'main.js')
		const rendererDir = path.join(root, 'renderer')
		const extensionDir = path.join(root, 'extension')
		const fingerprintOutput = path.join(root, 'proof', 'release-public-key-fingerprint.txt')
		await mkdir(rendererDir)
		await mkdir(extensionDir)
		await writeFile(mainBundle, `${chunks.join(' ')} ${gatewayBaseUrl}`)
		await writeFile(path.join(rendererDir, 'index.js'), gatewayBaseUrl)
		await writeFile(path.join(extensionDir, 'background.js'), gatewayBaseUrl)
		const args = [
			scriptPath,
			'--bundle',
			mainBundle,
			'--gateway-base-url',
			gatewayBaseUrl,
			'--renderer-dir',
			rendererDir,
			'--extension-dir',
			extensionDir,
			'--fingerprint-output',
			fingerprintOutput,
		]
		await execFileAsync(process.execPath, args, {
			env: { ...process.env, WENXUE_RELEASE_ED25519_PUBLIC_KEY: publicKeyPem },
		})
		assert.equal(
			(await readFile(fingerprintOutput, 'utf8')).trim(),
			createHash('sha256').update(der).digest('hex'),
		)

		const unsafeGatewayArgs = [...args]
		unsafeGatewayArgs[unsafeGatewayArgs.indexOf(gatewayBaseUrl)] = `${gatewayBaseUrl}/tenant`
		await assert.rejects(
			execFileAsync(process.execPath, unsafeGatewayArgs, {
				env: { ...process.env, WENXUE_RELEASE_ED25519_PUBLIC_KEY: publicKeyPem },
			}),
			/must be a safe HTTPS origin/i,
		)

		await writeFile(path.join(rendererDir, 'index.js'), 'https://wrong.example')
		await assert.rejects(
			execFileAsync(process.execPath, args, {
				env: { ...process.env, WENXUE_RELEASE_ED25519_PUBLIC_KEY: publicKeyPem },
			}),
			/renderer does not contain the configured gateway URL/i,
		)

		await writeFile(path.join(rendererDir, 'index.js'), gatewayBaseUrl)
		await writeFile(path.join(extensionDir, 'background.js'), 'https://wrong.example')
		await assert.rejects(
			execFileAsync(process.execPath, args, {
				env: { ...process.env, WENXUE_RELEASE_ED25519_PUBLIC_KEY: publicKeyPem },
			}),
			/extension does not contain the configured gateway URL/i,
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
