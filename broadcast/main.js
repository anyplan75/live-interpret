const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const catalog = require("./lib/catalog");
const { Engine } = require("./lib/engine");

app.setName("live-interpret");

let win = null;
let engine = null;
let quitting = false;

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch (_) {
    return {};
  }
}

function writeSettings(next) {
  const merged = { ...readSettings(), ...next };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2));
  return merged;
}

function send(payload) {
  if (win && !win.isDestroyed()) win.webContents.send("engine", payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#0f1419",
    title: "실시간 통역 송출",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function registerIpc() {
  ipcMain.handle("settings:get", () => {
    const saved = readSettings();
    if (!Array.isArray(saved.targets) || !saved.targets.length) {
      saved.targets = catalog.defaultSelectedTargets();
    }
    if (!saved.model) saved.model = catalog.defaultModel;
    if (!saved.sensitivity) saved.sensitivity = "normal";
    return saved;
  });
  ipcMain.handle("settings:set", (_event, patch) => writeSettings(patch || {}));
  ipcMain.handle("catalog", () => ({
    languages: catalog.languages.map((lang) => ({
      code: lang.code,
      name: lang.name,
      nameEn: lang.nameEn,
      flag: lang.flag,
      defaultSelected: !!lang.defaultSelected,
    })),
    models: catalog.models,
    defaultModel: catalog.defaultModel,
    pagesBase: catalog.pagesBase,
    defaultTargets: catalog.defaultSelectedTargets(),
  }));
  ipcMain.handle("churches:list", () => require("./lib/firebase").listChurches());
  ipcMain.handle("devices:list", () => {
    try {
      return engine.listDevices();
    } catch (err) {
      return { devices: [], notes: [err.message || String(err)] };
    }
  });
  ipcMain.handle("dialog:folder", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "설교 텍스트를 저장할 폴더",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return "";
    return result.filePaths[0];
  });
  ipcMain.handle("audio:monitor", (_event, deviceKey, channel) => engine.monitor(deviceKey, channel));
  ipcMain.handle("audio:channel", (_event, index) => engine.setChannel(index));
  ipcMain.handle("targets:set", async (_event, churchId, targets) => {
    if (churchId && !catalog.isChurchId(churchId)) throw new Error("교회가 올바르지 않습니다.");
    if (!churchId) return engine.setTargets("", targets);
    return engine.setTargets(churchId, targets);
  });
  ipcMain.handle("links", (_event, churchId, targets) => {
    if (!catalog.isChurchId(churchId)) throw new Error("교회가 올바르지 않습니다.");
    const codes = ["ko", ...(targets || []).filter((code) => code !== "ko" && catalog.langByCode[code])];
    return {
      home: catalog.homeLink(catalog.pagesBase, churchId),
      admin: catalog.adminLink(catalog.pagesBase, churchId),
      items: catalog.buildLinks(catalog.pagesBase, churchId, codes),
    };
  });
  ipcMain.handle("broadcast:start", (_event, opts) => engine.start(opts || {}));
  ipcMain.handle("broadcast:stop", () => engine.stop());
  ipcMain.handle("copy", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });
  ipcMain.handle("open-external", (_event, url) => {
    if (typeof url === "string" && /^https:\/\/[^\s]+$/.test(url)) return shell.openExternal(url);
    return false;
  });
  ipcMain.handle("show-session", () => {
    if (engine.sessionDir && fs.existsSync(engine.sessionDir)) {
      shell.showItemInFolder(engine.sessionDir);
      return engine.sessionDir;
    }
    return "";
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    engine = new Engine(send);
    registerIpc();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting || !engine) return;
    if (engine.running) {
      event.preventDefault();
      engine.stop().finally(() => {
        engine.capture.stop();
        quitting = true;
        app.quit();
      });
      return;
    }
    engine.capture.stop();
  });
}
