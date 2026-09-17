import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { cp, mkdir, open, readFile, readlink, rename, rm, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { AppPaths } from './AppPaths'

const PROFILE_ID = /^[a-zA-Z0-9_-]+$/
const PROFILE_LAUNCH_MARKER = '.wenxue-launching.json'
const PROFILE_LAUNCH_MARKER_MAX_AGE_MS = 60_000

export class ProfileStore {
	constructor(private readonly paths: AppPaths) {}

	async ensureProfile(id = 'default'): Promise<string> {
		const dir = this.profileDir(id)
		await mkdir(dir, { recursive: true })
		return dir
	}

	async createProfile(id: string): Promise<string> {
		const dir = this.profileDir(id)
		await mkdir(dir)
		return dir
	}

	async markProfileLaunching(id: string): Promise<void> {
		const markerPath = path.join(this.profileDir(id), PROFILE_LAUNCH_MARKER)
		await atomicWriteFile(
			markerPath,
			`${JSON.stringify({ host: hostname(), ownerPid: process.pid, createdAt: Date.now() })}\n`,
			0o600,
		)
	}

	async clearProfileLaunching(id: string): Promise<void> {
		await rm(path.join(this.profileDir(id), PROFILE_LAUNCH_MARKER), { force: true })
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
		if (await isProfileInUse(dir)) throw profileInUseError(dir)

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

	async isProfileInUse(id = 'default'): Promise<boolean> {
		return isProfileInUse(this.profileDir(id))
	}

	profilePath(id = 'default'): string {
		return this.profileDir(id)
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
		await rm(path.join(targetDir, PROFILE_LAUNCH_MARKER), { force: true })
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

async function isProfileInUse(profileDir: string): Promise<boolean> {
	if (await hasRecentLaunchMarker(profileDir)) return true

	try {
		await stat(path.join(profileDir, 'lockfile'))
		return true
	} catch (error) {
		if (!isMissingFile(error)) throw error
	}

	const lockPath = path.join(profileDir, 'SingletonLock')
	let target: string
	try {
		target = await readlink(lockPath)
	} catch (error) {
		if (isMissingFile(error)) return false
		if (hasErrorCode(error, 'EINVAL') || hasErrorCode(error, 'UNKNOWN')) {
			return true
		}
		throw error
	}

	const separator = target.lastIndexOf('-')
	const pid = Number(target.slice(separator + 1))
	if (separator <= 0 || !Number.isInteger(pid) || pid <= 0) {
		return true
	}
	if (target.slice(0, separator) !== hostname()) return true
	return isProcessRunning(pid)
}

async function assertProfileNotInUse(profileDir: string): Promise<void> {
	if (await isProfileInUse(profileDir)) throw profileInUseError(profileDir)
}

async function hasRecentLaunchMarker(profileDir: string): Promise<boolean> {
	const markerPath = path.join(profileDir, PROFILE_LAUNCH_MARKER)
	try {
		const markerStat = await stat(markerPath)
		let createdAt = markerStat.mtimeMs
		try {
			const parsed: unknown = JSON.parse(await readFile(markerPath, 'utf8'))
			if (
				isRecord(parsed) &&
				typeof parsed.createdAt === 'number' &&
				Number.isFinite(parsed.createdAt)
			) {
				createdAt = parsed.createdAt
			}
		} catch {
			// A recently written but partial/corrupt launch marker remains fail-closed.
		}
		const age = Date.now() - createdAt
		return age < 0 || age <= PROFILE_LAUNCH_MARKER_MAX_AGE_MS
	} catch (error) {
		if (isMissingFile(error)) return false
		throw error
	}
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
