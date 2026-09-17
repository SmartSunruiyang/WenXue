import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { AppPaths } from './AppPaths'
import type { ProfileStore } from './ProfileStore'

export type BrowserProfileType = 'persistent'
export type BrowserProfileColorKey = 'blue' | 'purple' | 'cyan' | 'green' | 'coral' | 'red'

export interface BrowserProfile {
	id: string
	displayName: string
	type: BrowserProfileType
	colorKey: BrowserProfileColorKey
	createdAt: number
	lastUsedAt: number | null
	userDataDir: string
}

export interface BrowserProfileStoreOptions {
	now?: () => number
	idFactory?: () => string
}

interface BrowserProfileFile {
	profiles: BrowserProfile[]
}

const COLORS: BrowserProfileColorKey[] = ['blue', 'purple', 'cyan', 'green', 'coral', 'red']
const PROFILE_ID = /^[a-zA-Z0-9_-]+$/

export class BrowserProfileStore {
	private readonly filePath: string
	private readonly now: () => number
	private readonly idFactory: () => string
	private operationQueue: Promise<void> = Promise.resolve()

	constructor(
		paths: AppPaths,
		private readonly profiles: ProfileStore,
		options: BrowserProfileStoreOptions = {},
	) {
		this.filePath = paths.dataFile('browsers.json')
		this.now = options.now ?? Date.now
		this.idFactory = options.idFactory ?? createProfileId
	}

	async list(): Promise<BrowserProfile[]> {
		// Writes are committed by atomic rename, so readers can safely observe the last committed
		// snapshot without waiting for a potentially large profile copy or deletion.
		return this.readProfiles()
	}

	async create(): Promise<BrowserProfile> {
		return this.enqueue(async () => {
			const profiles = await this.readProfiles()
			const id = this.nextProfileId(profiles)

			const userDataDir = await this.profiles.ensureProfile(id)
			const profile: BrowserProfile = {
				id,
				displayName: defaultDisplayName(profiles.length),
				type: 'persistent',
				colorKey: COLORS[profiles.length % COLORS.length],
				createdAt: this.now(),
				lastUsedAt: null,
				userDataDir,
			}

			await this.writeProfiles([...profiles, profile])
			return profile
		})
	}

	async duplicate(id: string): Promise<BrowserProfile> {
		return this.enqueue(async () => {
			const profiles = await this.readProfiles()
			const source = profiles.find((profile) => profile.id === id)
			if (!source) throw new Error(`Unknown browser profile: ${id}`)

			const nextId = this.nextProfileId(profiles)
			const userDataDir = await this.profiles.copyProfile(source.id, nextId)
			const profile: BrowserProfile = {
				...source,
				id: nextId,
				displayName: `${source.displayName} 副本`,
				colorKey: COLORS[profiles.length % COLORS.length],
				createdAt: this.now(),
				lastUsedAt: null,
				userDataDir,
			}

			await this.writeProfiles([...profiles, profile])
			return profile
		})
	}

	async remove(id: string): Promise<BrowserProfile> {
		return this.enqueue(async () => {
			const profiles = await this.readProfiles()
			const index = profiles.findIndex((profile) => profile.id === id)
			if (index < 0) throw new Error(`Unknown browser profile: ${id}`)

			const removed = profiles[index]
			await this.profiles.deleteProfile(id)
			await this.writeProfiles(profiles.filter((profile) => profile.id !== id))
			return removed
		})
	}

	async rename(id: string, displayName: string): Promise<BrowserProfile> {
		return this.enqueue(async () => {
			const profiles = await this.readProfiles()
			const index = profiles.findIndex((profile) => profile.id === id)
			if (index < 0) throw new Error(`Unknown browser profile: ${id}`)

			const next = [...profiles]
			next[index] = {
				...next[index],
				displayName: displayName.trim() || defaultDisplayName(index),
			}
			await this.writeProfiles(next)
			return next[index]
		})
	}

	async touch(id: string): Promise<BrowserProfile> {
		return this.enqueue(async () => {
			const profiles = await this.readProfiles()
			const index = profiles.findIndex((profile) => profile.id === id)
			if (index < 0) throw new Error(`Unknown browser profile: ${id}`)

			const next = [...profiles]
			next[index] = {
				...next[index],
				lastUsedAt: this.now(),
			}
			await this.writeProfiles(next)
			return next[index]
		})
	}

	private async readProfiles(): Promise<BrowserProfile[]> {
		try {
			const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<BrowserProfileFile>
			if (Array.isArray(raw.profiles)) {
				return raw.profiles.map((profile) => ({ ...profile }))
			}
		} catch (error) {
			if (!isMissingFile(error)) {
				throw error
			}
		}

		return []
	}

	private async writeProfiles(profiles: BrowserProfile[]): Promise<void> {
		const temporaryPath = `${this.filePath}.wenxue-${randomUUID()}.tmp`
		try {
			await writeFile(temporaryPath, `${JSON.stringify({ profiles }, null, 2)}\n`, {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			})
			await rename(temporaryPath, this.filePath)
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined)
			throw error
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationQueue.then(operation)
		this.operationQueue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	private nextProfileId(profiles: BrowserProfile[]): string {
		let id = this.idFactory()
		while (profiles.some((profile) => profile.id === id)) {
			id = this.idFactory()
		}
		if (!PROFILE_ID.test(id)) {
			throw new Error(`Invalid profile id: ${id}`)
		}
		return id
	}
}

function createProfileId(): string {
	return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function defaultDisplayName(index: number): string {
	return `浏览器 ${index + 1}`
}

function isMissingFile(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
