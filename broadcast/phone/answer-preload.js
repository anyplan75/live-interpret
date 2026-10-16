const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("phoneLink", {
  onSignal(callback) {
    ipcRenderer.on("phone-signal", (_event, payload) => callback(payload));
  },
  send(payload) {
    ipcRenderer.send("phone-answer", payload);
  },
});
