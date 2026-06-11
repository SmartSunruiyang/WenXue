import { mkdir } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
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

	listProfiles(): string[] {
		return readdirSync(this.paths.profilesRoot(), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b))
	}

	private profileDir(id: string): string {
		if (!PROFILE_ID.test(id)) {
			throw new Error(`Invalid profile id: ${id}`)
		}

		return path.join(this.paths.profilesRoot(), id)
	}
}
