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
  previewBilling: (targets, spoken, extraChannels) => ipcRenderer.invoke("billing:preview", targets, spoken, extraChannels),
  saveStyle: (style) => ipcRenderer.invoke("style:set", style),
  savePreacher: (preacher) => ipcRenderer.invoke("preachers:save", preacher),
  pickBulletin: () => ipcRenderer.invoke("bulletin:pick"),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  phoneJoin: () => ipcRenderer.invoke("phone:info"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  monitor: (deviceKey, channel) => ipcRenderer.invoke("audio:monitor", deviceKey, channel),
  setChannel: (index) => ipcRenderer.invoke("audio:channel", index),
  setTargets: (targets, spoken) => ipcRenderer.invoke("targets:set", "", targets, spoken),
  setSpoken: (spoken) => ipcRenderer.invoke("spoken:set", spoken),
  setChannelSpoken: (index, spoken) => ipcRenderer.invoke("channel:spoken", index, spoken),
  setChannelOn: (index, on) => ipcRenderer.invoke("channel:on", index, on),
  setChannelName: (index, name) => ipcRenderer.invoke("channel:name", index, name),
  setShowChannelNames: (on) => ipcRenderer.invoke("channel:showNames", on),
  links: (targets, spoken) => ipcRenderer.invoke("links", "", targets, spoken),
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
