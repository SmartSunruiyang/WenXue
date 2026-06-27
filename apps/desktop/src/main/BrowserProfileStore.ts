import { readFile, writeFile } from 'node:fs/promises'
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
		return this.readProfiles()
	}

	async create(): Promise<BrowserProfile> {
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
	}

	async duplicate(id: string): Promise<BrowserProfile> {
		const profiles = await this.readProfiles()
		const source = profiles.find((profile) => profile.id === id)
		if (!source) {
			throw new Error(`Unknown browser profile: ${id}`)
		}

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
	}

	async remove(id: string): Promise<BrowserProfile> {
		const profiles = await this.readProfiles()
		const index = profiles.findIndex((profile) => profile.id === id)
		if (index < 0) {
			throw new Error(`Unknown browser profile: ${id}`)
		}

		const removed = profiles[index]
		await this.profiles.deleteProfile(id)
		await this.writeProfiles(profiles.filter((profile) => profile.id !== id))
		return removed
	}

	async rename(id: string, displayName: string): Promise<BrowserProfile> {
		const profiles = await this.readProfiles()
		const index = profiles.findIndex((profile) => profile.id === id)
		if (index < 0) {
			throw new Error(`Unknown browser profile: ${id}`)
		}

		const next = [...profiles]
		next[index] = {
			...next[index],
			displayName: displayName.trim() || defaultDisplayName(index),
		}
		await this.writeProfiles(next)
		return next[index]
	}

	async touch(id: string): Promise<BrowserProfile> {
		const profiles = await this.readProfiles()
		const index = profiles.findIndex((profile) => profile.id === id)
		if (index < 0) {
			throw new Error(`Unknown browser profile: ${id}`)
		}

		const next = [...profiles]
		next[index] = {
			...next[index],
			lastUsedAt: this.now(),
		}
		await this.writeProfiles(next)
		return next[index]
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
		await writeFile(this.filePath, `${JSON.stringify({ profiles }, null, 2)}\n`, 'utf8')
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
