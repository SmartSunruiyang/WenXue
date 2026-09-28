import { useEffect, useState, useSyncExternalStore } from 'react'
import { DesktopDownloads, fetchDesktopDownloads } from './desktopDownloads'

export function useDesktopDownloads() {
	const [downloads] = useState(
		() => new DesktopDownloads(fetchDesktopDownloads, navigator.userAgent),
	)
	const state = useSyncExternalStore(downloads.subscribe, downloads.getSnapshot)
	useEffect(() => {
		void downloads.refresh()
		const restore = () => {
			if (document.visibilityState === 'visible') void downloads.refresh()
		}
		window.addEventListener('pageshow', restore)
		document.addEventListener('visibilitychange', restore)
		return () => {
			window.removeEventListener('pageshow', restore)
			document.removeEventListener('visibilitychange', restore)
			downloads.dispose()
		}
	}, [downloads])
	return { state, downloads }
}
