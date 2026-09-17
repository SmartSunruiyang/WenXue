import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { cp, mkdir, open, readFile, readlink, rename, rm, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { AppPaths } from './AppPaths'

const PROFILE_ID = /^[a-zA-Z0-9_-]+$/

export class ProfileStore {
	constructor(private readonly paths: AppPaths) {}

	async ensureProfile(id = 'default'): Promise<string> {
		const dir = this.profileDir(id)
		await mkdir(dir, { recursive: true })
		return dir
	}

	async prepareForUnpackedExtension(id = 'default'): Promise<string> {
		const dir = await this.ensureProfile(id)
		const defaultDir = path.join(dir, 'Default')
		const preferencesPath = path.join(defaultDir, 'Preferences')
		await mkdir(defaultDir, { recursive: true })

		let preferences: Record<string, unknown> = {}
		let preferencesMode = 0o600
		try {
			const parsed: unknown = JSON.parse(await readFile(preferencesPath, 'utf8'))
			if (!isRecord(parsed)) {
				throw new Error(`Chrome Preferences must contain a JSON object: ${preferencesPath}`)
			}
			preferences = parsed
			preferencesMode = (await stat(preferencesPath)).mode & 0o777
		} catch (error) {
			if (!isMissingFile(error)) throw error
		}

		const extensions = isRecord(preferences.extensions) ? preferences.extensions : {}
		const ui = isRecord(extensions.ui) ? extensions.ui : {}
		if (ui.developer_mode === true) return dir
		await assertProfileNotInUse(dir)

		await atomicWriteFile(
			preferencesPath,
			`${JSON.stringify({
				...preferences,
				extensions: {
					...extensions,
					ui: { ...ui, developer_mode: true },
				},
			})}\n`,
			preferencesMode,
		)
		return dir
	}

	listProfiles(): string[] {
		return readdirSync(this.paths.profilesRoot(), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b))
	}

	async copyProfile(sourceId: string, targetId: string): Promise<string> {
		await assertProfileNotInUse(this.profileDir(sourceId))
		const targetDir = this.profileDir(targetId)
		await cp(this.profileDir(sourceId), targetDir, {
			errorOnExist: true,
			force: false,
			recursive: true,
		})
		return targetDir
	}

	async deleteProfile(id: string): Promise<void> {
		const profileDir = this.profileDir(id)
		await assertProfileNotInUse(profileDir)
		await rm(profileDir, { force: true, recursive: true })
	}

	private profileDir(id: string): string {
		if (!PROFILE_ID.test(id)) {
			throw new Error(`Invalid profile id: ${id}`)
		}

		return path.join(this.paths.profilesRoot(), id)
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function atomicWriteFile(filePath: string, content: string, mode: number): Promise<void> {
	const temporaryPath = `${filePath}.wenxue-${randomUUID()}.tmp`
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(temporaryPath, 'wx', mode)
		await handle.writeFile(content, 'utf8')
		await handle.sync()
		await handle.close()
		handle = undefined
		await rename(temporaryPath, filePath)
	} catch (error) {
		await handle?.close().catch(() => undefined)
		await rm(temporaryPath, { force: true }).catch(() => undefined)
		throw error
	}
}

async function assertProfileNotInUse(profileDir: string): Promise<void> {
	try {
		await stat(path.join(profileDir, 'lockfile'))
		throw profileInUseError(profileDir)
	} catch (error) {
		if (!isMissingFile(error)) throw error
	}

	const lockPath = path.join(profileDir, 'SingletonLock')
	let target: string
	try {
		target = await readlink(lockPath)
	} catch (error) {
		if (isMissingFile(error)) return
		if (hasErrorCode(error, 'EINVAL') || hasErrorCode(error, 'UNKNOWN')) {
			throw profileInUseError(profileDir)
		}
		throw error
	}

	const separator = target.lastIndexOf('-')
	const pid = Number(target.slice(separator + 1))
	if (separator <= 0 || !Number.isInteger(pid) || pid <= 0) {
		throw profileInUseError(profileDir)
	}
	if (target.slice(0, separator) !== hostname()) throw profileInUseError(profileDir)
	if (isProcessRunning(pid)) throw profileInUseError(profileDir)
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return !hasErrorCode(error, 'ESRCH')
	}
}

function profileInUseError(profileDir: string): Error {
	return new Error(
		`Browser profile is already in use. Close its Chrome for Testing window before relaunching: ${profileDir}`,
	)
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
