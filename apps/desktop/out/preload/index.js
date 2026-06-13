"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("wenxue", {
  browser: {
    launch: () => electron.ipcRenderer.invoke("browser:launch"),
    getStatus: () => electron.ipcRenderer.invoke("browser:getStatus"),
    onStatusChange: (cb) => {
      const listener = (_event, status) => cb(status);
      electron.ipcRenderer.on("browser:status-changed", listener);
      return () => electron.ipcRenderer.off("browser:status-changed", listener);
    }
  },
  app: {
    getVersions: () => electron.ipcRenderer.invoke("app:getVersions"),
    openLogs: () => electron.ipcRenderer.invoke("app:openLogs")
  }
});
