import { mkdir } from 'node:fs/promises'
import path from 'node:path'

export class AppPaths {
	constructor(private readonly userDataDir: string) {}

	userDataRoot(): string {
		return this.userDataDir
	}

	profilesRoot(): string {
		return path.join(this.userDataDir, 'profiles')
	}

	logsDir(): string {
		return path.join(this.userDataDir, 'logs')
	}

	dataFile(name: string): string {
		return path.join(this.userDataDir, name)
	}

	async ensure(): Promise<void> {
		await mkdir(this.profilesRoot(), { recursive: true })
		await mkdir(this.logsDir(), { recursive: true })
	}
}
