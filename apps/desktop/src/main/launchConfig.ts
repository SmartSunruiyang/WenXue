export interface LaunchOptions {
	userDataDir: string
	extensionDir: string
	startUrls?: string[]
	debugPipe?: boolean
}

export function buildArgv(opts: LaunchOptions): string[] {
	const argv = [
		`--user-data-dir=${opts.userDataDir}`,
		`--disable-extensions-except=${opts.extensionDir}`,
		`--load-extension=${opts.extensionDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--hide-crash-restore-bubble',
		'--disable-infobars',
	]

	if (opts.debugPipe) {
		argv.push('--remote-debugging-pipe')
	}
	if (opts.startUrls) {
		argv.push(...opts.startUrls)
	}

	return argv
}
