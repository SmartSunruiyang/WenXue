import path from 'node:path'
import { mkdir } from 'node:fs/promises'

export class AppPaths {
	constructor(private readonly userDataDir: string) {}

	profilesRoot(): string {
		return path.join(this.userDataDir, 'profiles')
	}

	logsDir(): string {
		return path.join(this.userDataDir, 'logs')
	}

	async ensure(): Promise<void> {
		await mkdir(this.profilesRoot(), { recursive: true })
		await mkdir(this.logsDir(), { recursive: true })
	}
}
