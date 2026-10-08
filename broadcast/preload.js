const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("broadcast", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  catalog: () => ipcRenderer.invoke("catalog"),
  keyStatus: () => ipcRenderer.invoke("platform:keyStatus"),
  authStatus: () => ipcRenderer.invoke("auth:status"),
  signIn: (email, password) => ipcRenderer.invoke("auth:signIn", email, password),
  signOut: () => ipcRenderer.invoke("auth:signOut"),
  currentChurch: () => ipcRenderer.invoke("church:current"),
  saveStyle: (style) => ipcRenderer.invoke("style:set", style),
  savePreacher: (preacher) => ipcRenderer.invoke("preachers:save", preacher),
  pickBulletin: () => ipcRenderer.invoke("bulletin:pick"),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  monitor: (deviceKey, channel) => ipcRenderer.invoke("audio:monitor", deviceKey, channel),
  setChannel: (index) => ipcRenderer.invoke("audio:channel", index),
  setTargets: (targets) => ipcRenderer.invoke("targets:set", "", targets),
  links: (targets) => ipcRenderer.invoke("links", "", targets),
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
