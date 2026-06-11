import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('wenxue', {
	browser: {
		launch: () => ipcRenderer.invoke('browser:launch'),
		getStatus: () => ipcRenderer.invoke('browser:getStatus'),
		onStatusChange: (cb: (status: string) => void) => {
			const listener = (_event: IpcRendererEvent, status: string) => cb(status)
			ipcRenderer.on('browser:status-changed', listener)
			return () => ipcRenderer.off('browser:status-changed', listener)
		},
	},
	app: {
		getVersions: () => ipcRenderer.invoke('app:getVersions'),
	},
})
