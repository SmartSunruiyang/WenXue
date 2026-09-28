import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { isValidSemver } from '@wenxue/client-operations'

const RELEASE_BINARY_EXTENSIONS = new Set(['.dmg', '.exe', '.yml', '.yaml'])
const MAX_UPDATE_METADATA_BYTES = 64 * 1024
export const REQUIRED_RELEASE_TARGETS = [
	{ platform: 'darwin', arch: 'arm64', kind: 'dmg' },
	{ platform: 'win32', arch: 'x64', kind: 'nsis' },
	{ platform: 'win32', arch: 'x64', kind: 'nsis-yaml' },
]

export function updateMetadataFileName(channel) {
	if (!['dev', 'beta', 'stable'].includes(channel)) throw new Error('Invalid release channel')
	return channel === 'stable' ? 'latest.yml' : `${channel}.yml`
}

export async function generateWindowsUpdateMetadata(rootValue, version, channel) {
	if (!isValidSemver(version)) {
		throw new Error('Invalid release version')
	}
	const root = path.resolve(rootValue)
	const entries = await readdir(root, { withFileTypes: true })
	const installers = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.exe'))
	if (installers.length !== 1) throw new Error('Expected exactly one Windows NSIS installer')
	const name = installers[0].name
	if (!/^WenXue-[^/\\]+\.exe$/.test(name) || !name.includes(`-${version}-`)) {
		throw new Error('Windows NSIS installer version does not match release version')
	}
	const { digest, size } = await hashFile(path.join(root, name))
	const url = encodeURIComponent(name)
	const metadata = {
		version,
		files: [{ url, sha512: digest, size }],
		path: url,
		sha512: digest,
	}
	await writeFile(
		path.join(root, updateMetadataFileName(channel)),
		`${JSON.stringify(metadata)}\n`,
		'utf8',
	)
	return metadata
}

export async function readReleaseArtifactSet(rootValue, options = {}) {
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
	assertReleaseTargetMatrix(
		records.map((record) => record.artifact),
		options.schemaVersion,
	)
	if (options.schemaVersion !== 1) await validateWindowsUpdateMetadata(records, options)
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

export function assertReleaseTargetMatrix(artifacts, schemaVersion = 2) {
	const requiredTargets =
		schemaVersion === 1 ? REQUIRED_RELEASE_TARGETS.slice(0, 2) : REQUIRED_RELEASE_TARGETS
	if (!Array.isArray(artifacts) || artifacts.length !== requiredTargets.length) {
		throw new Error(
			`Release artifact set must contain exactly ${requiredTargets.length} target artifacts`,
		)
	}
	const remaining = new Set(
		requiredTargets.map(({ platform, arch, kind }) => `${platform}/${arch}/${kind}`),
	)
	for (const artifact of artifacts) {
		if (!isRecord(artifact)) throw new Error('Release artifact is invalid')
		const target = `${artifact.platform}/${artifact.arch}/${artifact.kind}`
		const required = requiredTargets.find(
			(value) =>
				value.platform === artifact.platform &&
				value.arch === artifact.arch &&
				value.kind === artifact.kind,
		)
		if (!required || !remaining.has(target)) {
			throw new Error(`Unexpected, duplicate, or invalid release target ${target}`)
		}
		remaining.delete(target)
	}
	if (remaining.size !== 0) throw new Error(`Missing release target ${[...remaining].join(', ')}`)
}

export async function validateWindowsUpdateMetadata(records, { version, channel } = {}) {
	const installer = records.find((record) => record.artifact.kind === 'nsis')
	const metadata = records.find((record) => record.artifact.kind === 'nsis-yaml')
	if (!installer || !metadata || path.dirname(installer.file) !== path.dirname(metadata.file)) {
		throw new Error('Windows update metadata must be beside the NSIS installer')
	}
	if (channel && metadata.artifact.fileName !== updateMetadataFileName(channel)) {
		throw new Error('Windows update metadata channel filename is invalid')
	}
	if (metadata.artifact.size > MAX_UPDATE_METADATA_BYTES) {
		throw new Error('Windows update metadata exceeds the size limit')
	}
	const value = JSON.parse(await readFile(metadata.file, 'utf8'))
	const exeUrl = encodeURIComponent(installer.artifact.fileName)
	if (
		!isRecord(value) ||
		!onlyKeys(value, ['version', 'files', 'path', 'sha512']) ||
		!isValidSemver(value.version) ||
		(typeof version === 'string' && value.version !== version) ||
		!Array.isArray(value.files) ||
		value.files.length !== 1 ||
		!isRecord(value.files[0]) ||
		!onlyKeys(value.files[0], ['url', 'sha512', 'size']) ||
		value.files[0].url !== exeUrl ||
		value.path !== exeUrl ||
		value.files[0].sha512 !== installer.artifact.sha512 ||
		value.sha512 !== installer.artifact.sha512 ||
		value.files[0].size !== installer.artifact.size
	) {
		throw new Error('Windows update metadata does not match the NSIS installer')
	}
}

function onlyKeys(value, keys) {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
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
	const [platform, arch] = segments
	if (
		segments.length !== 3 ||
		!['darwin', 'win32'].includes(platform) ||
		!['arm64', 'x64'].includes(arch)
	) {
		throw new Error(`Artifact path must be platform/arch/file: ${relativePath}`)
	}
	if ((platform === 'win32' && arch !== 'x64') || (platform === 'darwin' && arch !== 'arm64')) {
		throw new Error(`Unsupported target ${platform}/${arch}`)
	}
	return { platform, arch }
}

function artifactKind(file) {
	const name = path.basename(file).toLowerCase()
	if (name.endsWith('.dmg')) return 'dmg'
	if (name.endsWith('.exe')) return 'nsis'
	if (name.endsWith('.yml')) return 'nsis-yaml'
	throw new Error(`Unsupported artifact ${file}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const [command, root, version, channel] = process.argv.slice(2)
	if (command !== 'create-windows-metadata' || !root || !version || !channel) {
		throw new Error(
			'Usage: release-artifact-set.mjs create-windows-metadata <dir> <version> <channel>',
		)
	}
	generateWindowsUpdateMetadata(root, version, channel).catch((error) => {
		console.error(error.message)
		process.exitCode = 1
	})
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
