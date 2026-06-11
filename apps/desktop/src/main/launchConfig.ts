export interface LaunchOptions {
	userDataDir: string
	extensionDir: string
	startUrl?: string
	debugPipe?: boolean
}

export function buildArgv(opts: LaunchOptions): string[] {
	const argv = [
		`--user-data-dir=${opts.userDataDir}`,
		`--load-extension=${opts.extensionDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--hide-crash-restore-bubble',
	]

	if (opts.debugPipe) {
		argv.push('--remote-debugging-pipe')
	}

	if (opts.startUrl) {
		argv.push(opts.startUrl)
	}

	return argv
}
