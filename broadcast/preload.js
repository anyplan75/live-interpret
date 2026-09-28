const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("broadcast", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  catalog: () => ipcRenderer.invoke("catalog"),
  listChurches: () => ipcRenderer.invoke("churches:list"),
  keyStatus: () => ipcRenderer.invoke("platform:keyStatus"),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  monitor: (deviceKey, channel) => ipcRenderer.invoke("audio:monitor", deviceKey, channel),
  setChannel: (index) => ipcRenderer.invoke("audio:channel", index),
  setTargets: (churchId, targets) => ipcRenderer.invoke("targets:set", churchId, targets),
  links: (churchId, targets) => ipcRenderer.invoke("links", churchId, targets),
  start: (opts) => ipcRenderer.invoke("broadcast:start", opts),
  stop: () => ipcRenderer.invoke("broadcast:stop"),
  copy: (text) => ipcRenderer.invoke("copy", text),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  showSession: () => ipcRenderer.invoke("show-session"),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("engine", listener);
    return () => ipcRenderer.removeListener("engine", listener);
  },
});
