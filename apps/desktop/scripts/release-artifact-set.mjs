import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const RELEASE_BINARY_EXTENSIONS = new Set(['.dmg', '.exe'])
export const REQUIRED_RELEASE_TARGETS = [
	{ platform: 'darwin', arch: 'arm64', kind: 'dmg' },
	{ platform: 'win32', arch: 'x64', kind: 'nsis' },
]

export async function readReleaseArtifactSet(rootValue) {
	const root = path.resolve(rootValue)
	const files = await collectReleaseFiles(root)
	const records = await Promise.all(
		files.map(async (file) => {
			const relativePath = path.relative(root, file).split(path.sep).join('/')
			const target = targetFromPath(relativePath)
			const { digest, size } = await hashFile(file)
			return {
				file,
				relativePath,
				artifact: {
					platform: target.platform,
					arch: target.arch,
					kind: artifactKind(file),
					fileName: path.basename(file),
					sha512: digest,
					size,
				},
			}
		}),
	)
	records.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
	assertReleaseTargetMatrix(records.map((record) => record.artifact))
	const entries = records.map(({ relativePath, artifact }) => ({
		path: relativePath,
		...artifact,
	}))
	return {
		root,
		records,
		entries,
		artifactSetSha512: createHash('sha512').update(canonicalJson(entries)).digest('base64'),
	}
}

export function assertReleaseTargetMatrix(artifacts) {
	if (!Array.isArray(artifacts) || artifacts.length !== REQUIRED_RELEASE_TARGETS.length) {
		throw new Error('Release artifact set must contain exactly two target installers')
	}
	const remaining = new Set(
		REQUIRED_RELEASE_TARGETS.map(({ platform, arch }) => `${platform}/${arch}`),
	)
	for (const artifact of artifacts) {
		if (!isRecord(artifact)) throw new Error('Release artifact is invalid')
		const target = `${artifact.platform}/${artifact.arch}`
		const required = REQUIRED_RELEASE_TARGETS.find(
			(value) => value.platform === artifact.platform && value.arch === artifact.arch,
		)
		if (!required || !remaining.has(target) || artifact.kind !== required.kind) {
			throw new Error(`Unexpected, duplicate, or invalid release target ${target}:${artifact.kind}`)
		}
		remaining.delete(target)
	}
	if (remaining.size !== 0) throw new Error(`Missing release target ${[...remaining].join(', ')}`)
}

async function collectReleaseFiles(root) {
	const result = []
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name)
		if (entry.isDirectory()) result.push(...(await collectReleaseFiles(target)))
		if (entry.isFile() && isReleaseFile(entry.name)) result.push(target)
	}
	if (result.length === 0) throw new Error(`No release artifacts found under ${root}`)
	return result
}

async function hashFile(file) {
	const hash = createHash('sha512')
	for await (const chunk of createReadStream(file)) hash.update(chunk)
	return {
		digest: hash.digest('base64'),
		size: (await stat(file)).size,
	}
}

function isReleaseFile(fileName) {
	return RELEASE_BINARY_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

function targetFromPath(relativePath) {
	const segments = relativePath.split('/')
	const platform = segments.find((segment) => segment === 'darwin' || segment === 'win32')
	const arch = segments.find((segment) => segment === 'arm64' || segment === 'x64')
	if (!platform || !arch) throw new Error(`Artifact path has no platform/arch: ${relativePath}`)
	if (platform === 'win32' && arch !== 'x64') {
		throw new Error(`Unsupported target ${platform}/${arch}`)
	}
	return { platform, arch }
}

function artifactKind(file) {
	const name = path.basename(file).toLowerCase()
	if (name.endsWith('.dmg')) return 'dmg'
	if (name.endsWith('.exe')) return 'nsis'
	throw new Error(`Unsupported artifact ${file}`)
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`
	}
	return JSON.stringify(value)
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
