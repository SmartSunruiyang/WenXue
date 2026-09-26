import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { WindowCloseChoice, WindowClosePromptState } from '../main/DesktopBridge'

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
	auth: {
		setSession: (session: unknown) => ipcRenderer.invoke('auth:setSession', session),
		getSession: () => ipcRenderer.invoke('auth:getSession'),
		prepareSignOut: () => ipcRenderer.invoke('auth:prepareSignOut'),
		cancelSignOut: () => ipcRenderer.invoke('auth:cancelSignOut'),
		clearSession: () => ipcRenderer.invoke('auth:clearSession'),
	},
	updates: {
		getState: () => ipcRenderer.invoke('updates:getState'),
		check: (reason: 'manual' | 'signal' = 'manual') => ipcRenderer.invoke('updates:check', reason),
		download: () => ipcRenderer.invoke('updates:download'),
		openInstaller: () => ipcRenderer.invoke('updates:openInstaller'),
		restartInstall: () => ipcRenderer.invoke('updates:restartInstall'),
		onStateChange: (cb: (state: unknown) => void) => {
			const listener = (_event: IpcRendererEvent, state: unknown) => cb(state)
			ipcRenderer.on('updates:state-changed', listener)
			return () => ipcRenderer.off('updates:state-changed', listener)
		},
	},
	app: {
		getVersions: () => ipcRenderer.invoke('app:getVersions'),
		getShellInfo: () => ipcRenderer.invoke('app:getShellInfo'),
		openLogs: () => ipcRenderer.invoke('app:openLogs'),
		openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
		quit: () => ipcRenderer.invoke('app:quit'),
		minimizeWindow: () => ipcRenderer.invoke('app:minimizeWindow'),
		toggleMaximizeWindow: () => ipcRenderer.invoke('app:toggleMaximizeWindow'),
		requestClose: () => ipcRenderer.invoke('app:requestClose'),
		getClosePrompt: () => ipcRenderer.invoke('app:getClosePrompt'),
		respondToClosePrompt: (requestId: string, choice: WindowCloseChoice) =>
			ipcRenderer.invoke('app:respondToClosePrompt', requestId, choice),
		onClosePromptChange: (cb: (state: WindowClosePromptState) => void) => {
			const listener = (_event: IpcRendererEvent, state: WindowClosePromptState) => cb(state)
			ipcRenderer.on('app:close-prompt-changed', listener)
			return () => ipcRenderer.off('app:close-prompt-changed', listener)
		},
	},
})
