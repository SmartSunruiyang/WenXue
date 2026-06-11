import { startMainBootstrap } from './MainBootstrap'

startMainBootstrap().catch((error: unknown) => {
	console.error(error)
	process.exitCode = 1
})
