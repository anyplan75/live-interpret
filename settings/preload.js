const { contextBridge, ipcRenderer } = require("electron");
const { userText } = require("../broadcast/lib/user-text");

function ask(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    throw new Error(userText(err));
  });
}

contextBridge.exposeInMainWorld("desk", {
  authStatus: () => ask("auth:status"),
  signIn: (email, password) => ask("auth:signIn", email, password),
  signOut: () => ask("auth:signOut"),
  catalog: () => ask("catalog"),
  status: () => ask("room:status"),
  command: (patch) => ask("room:command", patch),
  operatorList: () => ask("operator:list"),
  operatorCredit: (accountId, amountKrw) => ask("operator:credit", accountId, amountKrw),
  testPeriod: () => ask("operator:testPeriod"),
  setTestPeriod: (on) => ask("operator:setTestPeriod", on),
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("room-status", listener);
    return () => ipcRenderer.removeListener("room-status", listener);
  },
});
