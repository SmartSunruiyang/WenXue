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

interface StoredBrowserProfile extends BrowserProfile {
	accountNamespace: string
}

interface ProfileFileState {
	document: Record<string, unknown>
	records: unknown[]
}

const COLORS: BrowserProfileColorKey[] = ['blue', 'purple', 'cyan', 'green', 'coral', 'red']
const PROFILE_ID = /^[a-zA-Z0-9_-]+$/
const MAX_ID_ATTEMPTS = 1000

export class BrowserProfileStore {
	private readonly filePath: string
	private readonly now: () => number
	private readonly idFactory: () => string
	private operationTail: Promise<void> = Promise.resolve()

	constructor(
		paths: AppPaths,
		private readonly profiles: ProfileStore,
		options: BrowserProfileStoreOptions = {},
	) {
		this.filePath = paths.dataFile('browsers.json')
		this.now = options.now ?? Date.now
		this.idFactory = options.idFactory ?? createProfileId
	}

	async list(accountNamespace: string): Promise<BrowserProfile[]> {
		return this.withStoreOperation(async () => {
			const normalizedAccountNamespace = requireAccountNamespace(accountNamespace)
			return this.storedProfiles((await this.readProfileFile()).records)
				.filter((profile) => profile.accountNamespace === normalizedAccountNamespace)
				.map(toBrowserProfile)
		})
	}

	async create(accountNamespace: string): Promise<BrowserProfile> {
		return this.withStoreOperation(async () => {
			const normalizedAccountNamespace = requireAccountNamespace(accountNamespace)
			const state = await this.readProfileFile()
			const profiles = this.storedProfiles(state.records)
			const accountProfiles = profiles.filter(
				(profile) => profile.accountNamespace === normalizedAccountNamespace,
			)
			const { id, userDataDir } = await this.createUniqueProfile(state.records)
			const profile: StoredBrowserProfile = {
				id,
				accountNamespace: normalizedAccountNamespace,
				displayName: defaultDisplayName(accountProfiles.length),
				type: 'persistent',
				colorKey: COLORS[accountProfiles.length % COLORS.length],
				createdAt: this.now(),
				lastUsedAt: null,
				userDataDir,
			}

			await this.writeProfileFile(state, [...state.records, profile])
			return toBrowserProfile(profile)
		})
	}

	async get(accountNamespace: string, id: string): Promise<BrowserProfile> {
		return this.withStoreOperation(async () =>
			toBrowserProfile(
				this.requireOwnedProfile(
					this.storedProfiles((await this.readProfileFile()).records),
					requireAccountNamespace(accountNamespace),
					id,
				),
			),
		)
	}

	async duplicate(accountNamespace: string, id: string): Promise<BrowserProfile> {
		return this.withStoreOperation(async () => {
			const normalizedAccountNamespace = requireAccountNamespace(accountNamespace)
			const state = await this.readProfileFile()
			const profiles = this.storedProfiles(state.records)
			const source = this.requireOwnedProfile(profiles, normalizedAccountNamespace, id)
			const accountProfileCount = profiles.filter(
				(profile) => profile.accountNamespace === normalizedAccountNamespace,
			).length
			const { id: nextId, userDataDir } = await this.copyToUniqueProfile(state.records, source.id)
			const profile: StoredBrowserProfile = {
				...source,
				id: nextId,
				displayName: `${source.displayName} 副本`,
				colorKey: COLORS[accountProfileCount % COLORS.length],
				createdAt: this.now(),
				lastUsedAt: null,
				userDataDir,
			}

			await this.writeProfileFile(state, [...state.records, profile])
			return toBrowserProfile(profile)
		})
	}

	async remove(accountNamespace: string, id: string): Promise<BrowserProfile> {
		return this.withStoreOperation(async () => {
			const normalizedAccountNamespace = requireAccountNamespace(accountNamespace)
			const state = await this.readProfileFile()
			const removed = this.requireOwnedProfile(
				this.storedProfiles(state.records),
				normalizedAccountNamespace,
				id,
			)

			await this.profiles.deleteProfile(id)
			await this.writeProfileFile(
				state,
				state.records.filter((record) => record !== removed),
			)
			return toBrowserProfile(removed)
		})
	}

	async rename(accountNamespace: string, id: string, displayName: string): Promise<BrowserProfile> {
		return this.withStoreOperation(async () => {
			const normalizedAccountNamespace = requireAccountNamespace(accountNamespace)
			const state = await this.readProfileFile()
			const profiles = this.storedProfiles(state.records)
			const current = this.requireOwnedProfile(profiles, normalizedAccountNamespace, id)
			const index = state.records.indexOf(current)
			const accountIndex = profiles
				.filter((profile) => profile.accountNamespace === normalizedAccountNamespace)
				.indexOf(current)
			const updated: StoredBrowserProfile = {
				...current,
				displayName: displayName.trim() || defaultDisplayName(accountIndex),
			}
			const next = [...state.records]
			next[index] = updated

			await this.writeProfileFile(state, next)
			return toBrowserProfile(updated)
		})
	}

	async touch(accountNamespace: string, id: string): Promise<BrowserProfile> {
		return this.withStoreOperation(async () => {
			const normalizedAccountNamespace = requireAccountNamespace(accountNamespace)
			const state = await this.readProfileFile()
			const current = this.requireOwnedProfile(
				this.storedProfiles(state.records),
				normalizedAccountNamespace,
				id,
			)
			const index = state.records.indexOf(current)
			const updated: StoredBrowserProfile = { ...current, lastUsedAt: this.now() }
			const next = [...state.records]
			next[index] = updated

			await this.writeProfileFile(state, next)
			return toBrowserProfile(updated)
		})
	}

	async listForReconciliation(): Promise<Array<{ id: string; accountNamespace: string | null }>> {
		return this.withStoreOperation(async () => {
			const state = await this.readProfileFile()
			const ownedById = new Map(
				this.storedProfiles(state.records).map((profile) => [profile.id, profile.accountNamespace]),
			)
			return Array.from(this.reservedProfileIds(state.records), (id) => ({
				id,
				accountNamespace: ownedById.get(id) ?? null,
			}))
		})
	}

	private async withStoreOperation<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.operationTail
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		this.operationTail = previous.catch(() => undefined).then(() => gate)
		await previous.catch(() => undefined)
		try {
			return await operation()
		} finally {
			release()
		}
	}

	private async readProfileFile(): Promise<ProfileFileState> {
		try {
			const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
			if (isRecord(raw) && Array.isArray(raw.profiles)) {
				return { document: { ...raw }, records: [...raw.profiles] }
			}
			throw new Error(`Invalid browser profile metadata: ${this.filePath}`)
		} catch (error) {
			if (!isMissingFile(error)) throw error
		}

		return { document: {}, records: [] }
	}

	private async writeProfileFile(state: ProfileFileState, records: unknown[]): Promise<void> {
		await writeFile(
			this.filePath,
			`${JSON.stringify({ ...state.document, profiles: records }, null, 2)}\n`,
			'utf8',
		)
	}

	private storedProfiles(records: unknown[]): StoredBrowserProfile[] {
		const idCounts = new Map<string, number>()
		for (const record of records) {
			const id = recordProfileId(record)
			if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
		}
		return records
			.filter(isStoredBrowserProfile)
			.filter((profile) => idCounts.get(profile.id) === 1)
	}

	private reservedProfileIds(records: unknown[]): Set<string> {
		return new Set([
			...records.flatMap((record) => {
				const id = recordProfileId(record)
				return id ? [id] : []
			}),
			...this.profiles.listProfiles(),
		])
	}

	private async createUniqueProfile(
		records: unknown[],
	): Promise<{ id: string; userDataDir: string }> {
		const reservedIds = this.reservedProfileIds(records)
		while (true) {
			const id = this.nextProfileId(reservedIds)
			try {
				return { id, userDataDir: await this.profiles.createProfile(id) }
			} catch (error) {
				if (!isAlreadyExists(error)) throw error
				reservedIds.add(id)
			}
		}
	}

	private async copyToUniqueProfile(
		records: unknown[],
		sourceId: string,
	): Promise<{ id: string; userDataDir: string }> {
		const reservedIds = this.reservedProfileIds(records)
		while (true) {
			const id = this.nextProfileId(reservedIds)
			try {
				return { id, userDataDir: await this.profiles.copyProfile(sourceId, id) }
			} catch (error) {
				if (!isAlreadyExists(error)) throw error
				reservedIds.add(id)
			}
		}
	}

	private nextProfileId(reservedIds: Set<string>): string {
		for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
			const id = this.idFactory()
			if (!PROFILE_ID.test(id)) throw new Error(`Invalid profile id: ${id}`)
			if (!reservedIds.has(id)) return id
		}
		throw new Error('Unable to allocate a unique browser profile id')
	}

	private requireOwnedProfile(
		profiles: StoredBrowserProfile[],
		accountNamespace: string,
		id: string,
	): StoredBrowserProfile {
		const profile = profiles.find(
			(candidate) => candidate.id === id && candidate.accountNamespace === accountNamespace,
		)
		if (!profile) throw new Error(`Unknown browser profile: ${id}`)
		return profile
	}
}

function createProfileId(): string {
	return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function defaultDisplayName(index: number): string {
	return `浏览器 ${index + 1}`
}

function requireAccountNamespace(value: string): string {
	const normalized = value.trim()
	if (!normalized) throw new Error('Invalid account namespace')
	return normalized
}

function toBrowserProfile(profile: StoredBrowserProfile): BrowserProfile {
	return {
		id: profile.id,
		displayName: profile.displayName,
		type: profile.type,
		colorKey: profile.colorKey,
		createdAt: profile.createdAt,
		lastUsedAt: profile.lastUsedAt,
		userDataDir: profile.userDataDir,
	}
}

function isStoredBrowserProfile(value: unknown): value is StoredBrowserProfile {
	if (!isRecord(value)) return false
	return (
		typeof value.accountNamespace === 'string' &&
		value.accountNamespace.length > 0 &&
		value.accountNamespace === value.accountNamespace.trim() &&
		typeof value.id === 'string' &&
		PROFILE_ID.test(value.id) &&
		typeof value.displayName === 'string' &&
		value.type === 'persistent' &&
		typeof value.colorKey === 'string' &&
		COLORS.includes(value.colorKey as BrowserProfileColorKey) &&
		typeof value.createdAt === 'number' &&
		Number.isFinite(value.createdAt) &&
		(value.lastUsedAt === null ||
			(typeof value.lastUsedAt === 'number' && Number.isFinite(value.lastUsedAt))) &&
		typeof value.userDataDir === 'string' &&
		value.userDataDir.length > 0
	)
}

function recordProfileId(value: unknown): string | null {
	return isRecord(value) && typeof value.id === 'string' && PROFILE_ID.test(value.id)
		? value.id
		: null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
