const { contextBridge, ipcRenderer } = require("electron");
const { userText } = require("./lib/user-text");

function ask(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    throw new Error(userText(err));
  });
}

const engineQueue = [];
let engineListener = null;
ipcRenderer.on("engine", (_event, payload) => {
  if (engineListener) engineListener(payload);
  else engineQueue.push(payload);
});

contextBridge.exposeInMainWorld("broadcast", {
  getSettings: () => ask("settings:get"),
  saveSettings: (settings) => ask("settings:set", settings),
  catalog: () => ask("catalog"),
  keyStatus: () => ask("platform:keyStatus"),
  authStatus: () => ask("auth:status"),
  signIn: (email, password) => ask("auth:signIn", email, password),
  signOut: () => ask("auth:signOut"),
  operatorList: () => ask("operator:list"),
  operatorCredit: (accountId, amountKrw) => ask("operator:credit", accountId, amountKrw),
  testPeriod: () => ask("operator:testPeriod"),
  setTestPeriod: (on) => ask("operator:setTestPeriod", on),
  currentChurch: () => ask("church:current"),
  previewBilling: (targets, spoken, extraChannels) => ask("billing:preview", targets, spoken, extraChannels),
  saveStyle: (style) => ask("style:set", style),
  savePreacher: (preacher) => ask("preachers:save", preacher),
  pickBulletin: () => ask("bulletin:pick"),
  listDevices: () => ask("devices:list"),
  phoneJoin: () => ask("phone:info"),
  setPhoneCount: (count) => ask("phone:set-count", count),
  addPhoneChannel: () => ask("phone:add-channel"),
  pickFolder: () => ask("dialog:folder"),
  monitor: (deviceKey, channel) => ask("audio:monitor", deviceKey, channel),
  setChannel: (index) => ask("audio:channel", index),
  setTargets: (targets, spoken) => ask("targets:set", "", targets, spoken),
  setSpoken: (spoken) => ask("spoken:set", spoken),
  setChannelSpoken: (index, spoken) => ask("channel:spoken", index, spoken),
  setChannelOn: (index, on) => ask("channel:on", index, on),
  setShowPreacherName: (on) => ask("preacher:show-name", on),
  setSourceStyle: (key, style) => ask("source-style:set", key, style),
  setChannelCaption: (index, patch) => ask("channel:caption", index, patch),
  setPhoneDisplay: (connectionId, patch) => ask("phone:display", connectionId, patch),
  links: (targets, spoken) => ask("links", "", targets, spoken),
  start: (opts) => ask("broadcast:start", opts),
  stop: () => ask("broadcast:stop"),
  copy: (text) => ask("copy", text),
  openExternal: (url) => ask("open-external", url),
  showSession: () => ask("show-session"),
  onEvent: (callback) => {
    engineListener = (payload) => callback(payload);
    while (engineQueue.length) callback(engineQueue.shift());
    return () => {
      if (engineListener) engineListener = null;
    };
  },
});
