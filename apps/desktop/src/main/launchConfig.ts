export interface LaunchOptions {
	userDataDir: string
	extensionDir: string
	startUrl?: string
	debugPipe?: boolean
	remoteDebuggingPort?: number
}

export function buildArgv(opts: LaunchOptions): string[] {
	const argv = [
		`--user-data-dir=${opts.userDataDir}`,
		`--disable-extensions-except=${opts.extensionDir}`,
		`--load-extension=${opts.extensionDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--hide-crash-restore-bubble',
	]

	if (opts.debugPipe) {
		argv.push('--remote-debugging-pipe')
	}
	if (opts.remoteDebuggingPort !== undefined) {
		argv.push('--remote-debugging-address=127.0.0.1')
		argv.push(`--remote-debugging-port=${opts.remoteDebuggingPort}`)
	}

	if (opts.startUrl) {
		argv.push(opts.startUrl)
	}

	return argv
}
