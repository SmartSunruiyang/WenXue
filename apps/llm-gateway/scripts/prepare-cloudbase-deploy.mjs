import { spawn } from 'node:child_process'
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const outputArgument = process.argv.slice(2).find((argument) => argument !== '--')
const outputPath = resolve(outputArgument ?? join(tmpdir(), 'wenxue-llm-gateway-deploy'))
const stagingPath = `${outputPath}.staging-${process.pid}`
const forbiddenName =
	/(^|[/\\])(\.env($|\.)|[^/\\]+\.(pem|key|p12|pfx)|credentials?\.json|secrets?\.json)$/i

const sources = [
	['apps/llm-gateway/Dockerfile', 'Dockerfile'],
	['apps/llm-gateway/package.json', 'apps/llm-gateway/package.json'],
	['apps/llm-gateway/cloudbase-functions.json', 'apps/llm-gateway/cloudbase-functions.json'],
	['apps/llm-gateway/src/adminConsole.mjs', 'apps/llm-gateway/src/adminConsole.mjs'],
	['apps/llm-gateway/src/gateway.mjs', 'apps/llm-gateway/src/gateway.mjs'],
	['apps/llm-gateway/src/index.mjs', 'apps/llm-gateway/src/index.mjs'],
	['apps/admin-api/src/adminApi.mjs', 'apps/admin-api/src/adminApi.mjs'],
	['apps/admin-api/src/cloudbaseAuth.mjs', 'apps/admin-api/src/cloudbaseAuth.mjs'],
	['apps/admin-api/src/cloudbaseStore.mjs', 'apps/admin-api/src/cloudbaseStore.mjs'],
	['apps/admin-api/src/index.mjs', 'apps/admin-api/src/index.mjs'],
	['apps/admin/dist', 'apps/admin/dist'],
]

assertOutsideSourceTree(outputPath)
assertOutsideSourceTree(stagingPath)
await rm(outputPath, { force: true, recursive: true })
await rm(stagingPath, { force: true, recursive: true })

let manifest
try {
	await buildAdminConsole()
	for (const [sourceRelativePath, destinationRelativePath] of sources) {
		const sourcePath = join(repoRoot, sourceRelativePath)
		const destinationPath = join(stagingPath, destinationRelativePath)
		await mkdir(dirname(destinationPath), { recursive: true })
		await cp(sourcePath, destinationPath, {
			errorOnExist: true,
			force: false,
			recursive: true,
			verbatimSymlinks: true,
		})
	}
	manifest = await scan(stagingPath, stagingPath)
	await rename(stagingPath, outputPath)
} catch (error) {
	await rm(stagingPath, { force: true, recursive: true })
	throw error
}

console.log(
	JSON.stringify(
		{
			ok: true,
			outputPath,
			files: manifest.files,
			totalBytes: manifest.totalBytes,
			contents: sources.map(([, destination]) => destination),
		},
		null,
		2,
	),
)

async function buildAdminConsole() {
	await new Promise((resolvePromise, reject) => {
		const child = spawn('pnpm', ['--filter', 'admin', 'build'], {
			cwd: repoRoot,
			env: {
				...process.env,
				VITE_BASE_PATH: '/admin/',
				VITE_CLOUDBASE_ACCESS_KEY: '',
				VITE_CLOUDBASE_ENV_ID: 'wenxue-d8gz76tacc3659f05',
				VITE_CLOUDBASE_REGION: 'ap-shanghai',
				VITE_WENXUE_ADMIN_API_BASE_URL: '',
			},
			stdio: 'inherit',
		})
		child.once('error', reject)
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolvePromise(undefined)
				return
			}
			reject(
				new Error(
					`AdminConsole build failed (${signal ? `signal ${signal}` : `exit code ${code}`})`,
				),
			)
		})
	})
}

/** @param {string} candidate */
function assertOutsideSourceTree(candidate) {
	const normalizedRoot = `${repoRoot}${sep}`
	const normalizedCandidate = `${candidate}${sep}`
	if (normalizedRoot.startsWith(normalizedCandidate)) {
		throw new Error('Deployment staging directory cannot contain the repository')
	}
	for (const [sourceRelativePath] of sources) {
		const sourcePath = resolve(repoRoot, sourceRelativePath)
		if (normalizedCandidate.startsWith(`${sourcePath}${sep}`)) {
			throw new Error(`Deployment staging directory cannot be inside ${sourceRelativePath}`)
		}
	}
}

/**
 * @param {string} directory
 * @param {string} root
 */
async function scan(directory, root) {
	let files = 0
	let totalBytes = 0
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		const relativePath = relative(root, path)
		if (forbiddenName.test(relativePath)) {
			throw new Error(`Refusing sensitive-looking deployment file: ${relativePath}`)
		}
		if (entry.isSymbolicLink()) {
			throw new Error(`Refusing symbolic link in deployment staging: ${relativePath}`)
		}
		if (entry.isDirectory()) {
			const nested = await scan(path, root)
			files += nested.files
			totalBytes += nested.totalBytes
			continue
		}
		if (!entry.isFile()) {
			throw new Error(`Unsupported deployment entry: ${relativePath}`)
		}
		const fileStat = await stat(path)
		files += 1
		totalBytes += fileStat.size
	}
	return { files, totalBytes }
}
