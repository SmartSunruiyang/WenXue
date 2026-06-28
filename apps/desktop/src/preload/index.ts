import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('wenxue', {
	browser: {
		launch: () => ipcRenderer.invoke('browser:launch'),
		launchProfile: (profileId: string) => ipcRenderer.invoke('browser:launchProfile', profileId),
		stopProfile: (profileId: string) => ipcRenderer.invoke('browser:stopProfile', profileId),
		listProfiles: () => ipcRenderer.invoke('browser:listProfiles'),
		addProfile: () => ipcRenderer.invoke('browser:addProfile'),
		renameProfile: (profileId: string, displayName: string) =>
			ipcRenderer.invoke('browser:renameProfile', profileId, displayName),
		duplicateProfile: (profileId: string) =>
			ipcRenderer.invoke('browser:duplicateProfile', profileId),
		removeProfile: (profileId: string) => ipcRenderer.invoke('browser:removeProfile', profileId),
		openProfileFolder: (profileId: string) =>
			ipcRenderer.invoke('browser:openProfileFolder', profileId),
		getStatus: () => ipcRenderer.invoke('browser:getStatus'),
		getStatuses: () => ipcRenderer.invoke('browser:getStatuses'),
		onStatusChange: (cb: (status: string) => void) => {
			const listener = (_event: IpcRendererEvent, status: string) => cb(status)
			ipcRenderer.on('browser:status-changed', listener)
			return () => ipcRenderer.off('browser:status-changed', listener)
		},
		onProfileStatusChange: (cb: (payload: { profileId: string; status: string }) => void) => {
			const listener = (_event: IpcRendererEvent, payload: { profileId: string; status: string }) =>
				cb(payload)
			ipcRenderer.on('browser:profile-status-changed', listener)
			return () => ipcRenderer.off('browser:profile-status-changed', listener)
		},
	},
	logs: {
		query: (filter?: unknown) => ipcRenderer.invoke('logs:query', filter),
		clear: () => ipcRenderer.invoke('logs:clear'),
	},
	settings: {
		get: () => ipcRenderer.invoke('settings:get'),
		update: (patch: unknown) => ipcRenderer.invoke('settings:update', patch),
	},
	tokens: {
		getSummary: () => ipcRenderer.invoke('tokens:getSummary'),
	},
	app: {
		getVersions: () => ipcRenderer.invoke('app:getVersions'),
		getShellInfo: () => ipcRenderer.invoke('app:getShellInfo'),
		openLogs: () => ipcRenderer.invoke('app:openLogs'),
		minimizeWindow: () => ipcRenderer.invoke('app:minimizeWindow'),
		toggleMaximizeWindow: () => ipcRenderer.invoke('app:toggleMaximizeWindow'),
		requestClose: () => ipcRenderer.invoke('app:requestClose'),
	},
})
