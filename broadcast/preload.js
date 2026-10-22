const { contextBridge, ipcRenderer } = require("electron");

const engineQueue = [];
let engineListener = null;
ipcRenderer.on("engine", (_event, payload) => {
  if (engineListener) engineListener(payload);
  else engineQueue.push(payload);
});

contextBridge.exposeInMainWorld("broadcast", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  catalog: () => ipcRenderer.invoke("catalog"),
  keyStatus: () => ipcRenderer.invoke("platform:keyStatus"),
  authStatus: () => ipcRenderer.invoke("auth:status"),
  signIn: (email, password) => ipcRenderer.invoke("auth:signIn", email, password),
  signOut: () => ipcRenderer.invoke("auth:signOut"),
  operatorList: () => ipcRenderer.invoke("operator:list"),
  operatorCredit: (accountId, amountKrw) => ipcRenderer.invoke("operator:credit", accountId, amountKrw),
  currentChurch: () => ipcRenderer.invoke("church:current"),
  previewBilling: (targets, spoken, extraChannels) => ipcRenderer.invoke("billing:preview", targets, spoken, extraChannels),
  saveStyle: (style) => ipcRenderer.invoke("style:set", style),
  savePreacher: (preacher) => ipcRenderer.invoke("preachers:save", preacher),
  pickBulletin: () => ipcRenderer.invoke("bulletin:pick"),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  phoneJoin: () => ipcRenderer.invoke("phone:info"),
  setPhoneCount: (count) => ipcRenderer.invoke("phone:set-count", count),
  addPhoneChannel: () => ipcRenderer.invoke("phone:add-channel"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  monitor: (deviceKey, channel) => ipcRenderer.invoke("audio:monitor", deviceKey, channel),
  setChannel: (index) => ipcRenderer.invoke("audio:channel", index),
  setTargets: (targets, spoken) => ipcRenderer.invoke("targets:set", "", targets, spoken),
  setSpoken: (spoken) => ipcRenderer.invoke("spoken:set", spoken),
  setChannelSpoken: (index, spoken) => ipcRenderer.invoke("channel:spoken", index, spoken),
  setChannelOn: (index, on) => ipcRenderer.invoke("channel:on", index, on),
  setShowPreacherName: (on) => ipcRenderer.invoke("preacher:show-name", on),
  setSourceStyle: (key, style) => ipcRenderer.invoke("source-style:set", key, style),
  setPhoneDisplay: (connectionId, patch) => ipcRenderer.invoke("phone:display", connectionId, patch),
  links: (targets, spoken) => ipcRenderer.invoke("links", "", targets, spoken),
  start: (opts) => ipcRenderer.invoke("broadcast:start", opts),
  stop: () => ipcRenderer.invoke("broadcast:stop"),
  copy: (text) => ipcRenderer.invoke("copy", text),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  showSession: () => ipcRenderer.invoke("show-session"),
  onEvent: (callback) => {
    engineListener = (payload) => callback(payload);
    while (engineQueue.length) callback(engineQueue.shift());
    return () => {
      if (engineListener) engineListener = null;
    };
  },
});
