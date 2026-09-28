const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const catalog = require("./lib/catalog");
const { Engine } = require("./lib/engine");
const firebase = require("./lib/firebase");
const secrets = require("./lib/secrets");
const googleAuth = require("./lib/google-auth");

app.setName("live-interpret");

let win = null;
let engine = null;
let quitting = false;
let idToken = "";
let tokenExpiresAt = 0;

function userDir() {
  return app.getPath("userData");
}

async function ensureAuth() {
  const session = secrets.readSession(userDir());
  if (!session) {
    idToken = "";
    firebase.setIdToken("");
    return "";
  }
  if (idToken && Date.now() < tokenExpiresAt - 60000) {
    firebase.setIdToken(idToken);
    return idToken;
  }
  try {
    const next = await googleAuth.refresh(session.refreshToken);
    idToken = next.idToken;
    tokenExpiresAt = Date.now() + next.expiresIn * 1000;
    secrets.writeSession(userDir(), {
      refreshToken: next.refreshToken,
      email: session.email,
      localId: next.localId || session.localId,
    });
    firebase.setIdToken(idToken);
    return idToken;
  } catch (err) {
    idToken = "";
    firebase.setIdToken("");
    secrets.clearSession(userDir());
    throw err;
  }
}

async function resolveKey() {
  const local = secrets.readKey(userDir());
  if (local) return local;
  const token = await ensureAuth();
  if (!token) return "";
  const remote = await firebase.getPlatformKey();
  if (remote) secrets.writeKey(userDir(), remote);
  return remote || "";
}

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    if (Object.prototype.hasOwnProperty.call(saved, "apiKey")) {
      delete saved.apiKey;
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify(saved, null, 2));
    }
    return saved;
  } catch (_) {
    return {};
  }
}

function writeSettings(next) {
  const merged = { ...readSettings(), ...(next || {}) };
  delete merged.apiKey;
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
  ipcMain.handle("auth:status", async () => {
    let signedIn = false;
    let email = "";
    const saved = secrets.readSession(userDir());
    if (saved) {
      email = saved.email;
      try {
        signedIn = Boolean(await ensureAuth());
      } catch (err) {
        signedIn = false;
        email = "";
      }
    }
    return {
      signedIn,
      email,
      keyReady: Boolean(secrets.readKey(userDir())),
    };
  });
  ipcMain.handle("auth:signIn", async (_event, email, password) => {
    if (!catalog.validAdminEmail(email) || !catalog.validAdminPassword(password)) {
      throw new Error("이메일과 비밀번호를 확인해 주세요. 비밀번호는 6자 이상입니다.");
    }
    const session = await googleAuth.signIn(String(email).trim(), password);
    idToken = session.idToken;
    tokenExpiresAt = Date.now() + session.expiresIn * 1000;
    firebase.setIdToken(idToken);
    secrets.writeSession(userDir(), {
      refreshToken: session.refreshToken,
      email: session.email,
      localId: session.localId,
    });
    let keyReady = Boolean(secrets.readKey(userDir()));
    try {
      const remote = await firebase.getPlatformKey();
      if (remote) {
        secrets.writeKey(userDir(), remote);
        keyReady = true;
      }
    } catch (_) {
      /* 키가 아직 없으면 로그인만 유지합니다 */
    }
    return { signedIn: true, email: session.email, keyReady };
  });
  ipcMain.handle("churches:list", async () => {
    const token = await ensureAuth();
    if (!token) return [];
    return firebase.listChurches();
  });
  ipcMain.handle("platform:keyStatus", async () => {
    if (secrets.readKey(userDir())) return { configured: true };
    try {
      const token = await ensureAuth();
      if (!token) return { configured: false };
      const key = await firebase.getPlatformKey();
      if (key) {
        secrets.writeKey(userDir(), key);
        return { configured: true };
      }
    } catch (_) {
      return { configured: false };
    }
    return { configured: false };
  });
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
    const token = await ensureAuth();
    if (!token) throw new Error("로그인이 필요합니다.");
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
  ipcMain.handle("broadcast:start", async (_event, opts) => {
    const token = await ensureAuth();
    if (!token) throw new Error("로그인이 필요합니다.");
    const apiKey = await resolveKey();
    return engine.start({ ...(opts || {}), apiKey });
  });
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
