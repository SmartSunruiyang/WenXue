"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("wenxue", {
  browser: {
    launch: () => electron.ipcRenderer.invoke("browser:launch"),
    launchProfile: (profileId) => electron.ipcRenderer.invoke("browser:launchProfile", profileId),
    stopProfile: (profileId) => electron.ipcRenderer.invoke("browser:stopProfile", profileId),
    listProfiles: () => electron.ipcRenderer.invoke("browser:listProfiles"),
    addProfile: () => electron.ipcRenderer.invoke("browser:addProfile"),
    renameProfile: (profileId, displayName) => electron.ipcRenderer.invoke("browser:renameProfile", profileId, displayName),
    duplicateProfile: (profileId) => electron.ipcRenderer.invoke("browser:duplicateProfile", profileId),
    removeProfile: (profileId) => electron.ipcRenderer.invoke("browser:removeProfile", profileId),
    openProfileFolder: (profileId) => electron.ipcRenderer.invoke("browser:openProfileFolder", profileId),
    getStatus: () => electron.ipcRenderer.invoke("browser:getStatus"),
    getStatuses: () => electron.ipcRenderer.invoke("browser:getStatuses"),
    onStatusChange: (cb) => {
      const listener = (_event, status) => cb(status);
      electron.ipcRenderer.on("browser:status-changed", listener);
      return () => electron.ipcRenderer.off("browser:status-changed", listener);
    },
    onProfileStatusChange: (cb) => {
      const listener = (_event, payload) => cb(payload);
      electron.ipcRenderer.on("browser:profile-status-changed", listener);
      return () => electron.ipcRenderer.off("browser:profile-status-changed", listener);
    }
  },
  logs: {
    query: (filter) => electron.ipcRenderer.invoke("logs:query", filter),
    clear: () => electron.ipcRenderer.invoke("logs:clear")
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    update: (patch) => electron.ipcRenderer.invoke("settings:update", patch)
  },
  tokens: {
    getSummary: () => electron.ipcRenderer.invoke("tokens:getSummary")
  },
  auth: {
    setSession: (session) => electron.ipcRenderer.invoke("auth:setSession", session),
    getSession: () => electron.ipcRenderer.invoke("auth:getSession"),
    clearSession: () => electron.ipcRenderer.invoke("auth:clearSession")
  },
  app: {
    getVersions: () => electron.ipcRenderer.invoke("app:getVersions"),
    getShellInfo: () => electron.ipcRenderer.invoke("app:getShellInfo"),
    openLogs: () => electron.ipcRenderer.invoke("app:openLogs"),
    minimizeWindow: () => electron.ipcRenderer.invoke("app:minimizeWindow"),
    toggleMaximizeWindow: () => electron.ipcRenderer.invoke("app:toggleMaximizeWindow"),
    requestClose: () => electron.ipcRenderer.invoke("app:requestClose")
  }
});
