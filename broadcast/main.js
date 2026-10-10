const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const catalog = require("./lib/catalog");
const { Engine } = require("./lib/engine");
const firebase = require("./lib/firebase");
const secrets = require("./lib/secrets");
const googleAuth = require("./lib/google-auth");
const bulletinLib = require("./lib/bulletin");
const consent = require("./lib/consent");
const updater = require("./lib/updater");

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

function resolveKey() {
  return secrets.readKey(userDir());
}

async function cachePlatformKey() {
  try {
    const remote = await firebase.getPlatformKey();
    if (remote) secrets.writeKey(userDir(), remote);
  } catch (_) { /* 규칙을 아직 안 바꿨으면 이 PC에 있는 키를 씁니다 */ }
  return resolveKey();
}

function bulletinDir(churchId) {
  return path.join(userDir(), "bulletins", churchId);
}

function stageSummary(churchId) {
  const dir = bulletinDir(churchId);
  const manifestPath = path.join(dir, "manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest || typeof manifest.path !== "string" || !fs.existsSync(manifest.path)) return null;
    return {
      path: manifest.path,
      fileName: manifest.fileName || path.basename(manifest.path),
      extracted: bulletinLib.readStagedExtraction(dir),
    };
  } catch (_) {
    return null;
  }
}

function publicChurch(church) {
  return {
    id: church.id,
    name: church.name,
    active: !!church.active,
    email: church.accountEmail || "",
  };
}

async function requireChurch() {
  const token = await ensureAuth();
  if (!token) throw new Error("로그인이 필요합니다.");
  const session = secrets.readSession(userDir());
  if (!session || !session.localId) throw new Error("교회 로그인 정보가 없습니다. 다시 로그인해 주세요.");
  const link = await firebase.getAccountLink(session.localId);
  if (!link) throw new Error("이 계정에 연결된 교회가 없습니다. 방송 앱은 교회 계정으로 로그인합니다.");
  const church = await firebase.getChurch(link.churchId);
  if (!church || church.accountUid !== session.localId) {
    throw new Error("교회 계정이 이 교회와 맞지 않습니다.");
  }
  return church;
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
  delete merged.model;
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
  win.webContents.once("did-finish-load", () => {
    updater.startAutoUpdate({
      app,
      log: (level, text) => send({ type: "log", level, text }),
    });
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function registerIpc() {
  ipcMain.handle("settings:get", () => {
    const saved = readSettings();
    if (!Array.isArray(saved.targets) || !saved.targets.length) {
      saved.targets = catalog.defaultSelectedTargets();
    }
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
    pagesBase: catalog.pagesBase,
    defaultTargets: catalog.defaultSelectedTargets(),
  }));
  ipcMain.handle("auth:status", async () => {
    const saved = secrets.readSession(userDir());
    if (!saved) return { signedIn: false, email: "", church: null, keyReady: Boolean(resolveKey()) };
    try {
      const church = await requireChurch();
      return {
        signedIn: true,
        email: saved.email,
        church: publicChurch(church),
        keyReady: Boolean(await cachePlatformKey()),
      };
    } catch (err) {
      const message = err && err.message ? err.message : "";
      if (/연결된 교회|교회 계정|다시 로그인/.test(message)) {
        idToken = "";
        tokenExpiresAt = 0;
        firebase.setIdToken("");
        secrets.clearSession(userDir());
      }
      return { signedIn: false, email: "", church: null, keyReady: Boolean(resolveKey()) };
    }
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
    try {
      const church = await requireChurch();
      return {
        signedIn: true,
        email: session.email,
        church: publicChurch(church),
        keyReady: Boolean(await cachePlatformKey()),
      };
    } catch (err) {
      idToken = "";
      tokenExpiresAt = 0;
      firebase.setIdToken("");
      secrets.clearSession(userDir());
      throw err;
    }
  });
  ipcMain.handle("auth:signOut", async () => {
    if (engine && engine.running) throw new Error("방송을 종료한 다음 로그아웃해 주세요.");
    idToken = "";
    tokenExpiresAt = 0;
    firebase.setIdToken("");
    secrets.clearSession(userDir());
    return { signedIn: false };
  });
  ipcMain.handle("church:current", async () => {
    const church = await requireChurch();
    const settings = await firebase.get(`churches/${church.id}/live/settings`);
    const staged = stageSummary(church.id);
    let balanceKrw = 0;
    try {
      balanceKrw = (await engine.previewCharge(church.id, [])).balanceKrw;
    } catch (_) {
      balanceKrw = 0;
    }
    return {
      church: publicChurch(church),
      style: catalog.styleFromSettings(settings),
      preachers: await firebase.listPreachers(church.id),
      bulletin: staged ? { fileName: staged.fileName, extracted: staged.extracted } : null,
      keyReady: Boolean(await cachePlatformKey()),
      balanceKrw,
    };
  });
  ipcMain.handle("billing:preview", async (_event, targets) => {
    const church = await requireChurch();
    return engine.previewCharge(church.id, targets);
  });
  ipcMain.handle("style:set", async (_event, style) => {
    const church = await requireChurch();
    return engine.saveStyle(church.id, style || {});
  });
  ipcMain.handle("preachers:save", async (_event, payload) => {
    const church = await requireChurch();
    const name = payload && typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) throw new Error("설교자 이름을 입력해 주세요.");
    const id = payload && catalog.isPreacherId(payload.id) ? payload.id : catalog.makePreacherId(name);
    const existing = (await firebase.listPreachers(church.id)).find((item) => item.id === id);
    return firebase.savePreacher(church.id, id, {
      name,
      traits: payload && typeof payload.traits === "string" ? payload.traits : "",
      corrections: payload && typeof payload.corrections === "string" ? payload.corrections : "",
      terms: payload && typeof payload.terms === "string" ? payload.terms : "",
      pausePoints: existing ? existing.pausePoints : "",
      accuracy: existing ? existing.accuracy : "",
      naturalness: existing ? existing.naturalness : "",
      sermonCount: existing ? existing.sermonCount : 0,
      createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
    });
  });
  ipcMain.handle("bulletin:pick", async () => {
    const church = await requireChurch();
    const picked = await dialog.showOpenDialog(win, {
      title: "이번 예배 주보 사진",
      properties: ["openFile"],
      filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const dir = bulletinDir(church.id);
    const stored = bulletinLib.stageBulletin(dir, picked.filePaths[0]);
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
      path: stored.absolutePath,
      fileName: stored.fileName,
    }));
    const key = await cachePlatformKey();
    if (!key) {
      return {
        fileName: stored.fileName,
        extracted: null,
        error: "이 컴퓨터에 번역 키가 없어 주보를 아직 분석하지 못했습니다. 사진은 이 PC에 저장했습니다.",
      };
    }
    try {
      const extracted = await bulletinLib.analyzeBulletinImage({
        apiKey: key,
        model: church.model,
        imagePath: stored.absolutePath,
      });
      bulletinLib.writeExtractionFile(dir, stored.fileName, extracted);
      return { fileName: stored.fileName, extracted };
    } catch (err) {
      return { fileName: stored.fileName, extracted: null, error: catalog.redactSecrets(err.message || String(err)) };
    }
  });
  ipcMain.handle("platform:keyStatus", async () => ({ configured: Boolean(resolveKey()) }));
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
  ipcMain.handle("targets:set", async (_event, _churchId, targets) => {
    const church = await requireChurch();
    return engine.setTargets(church.id, targets);
  });
  ipcMain.handle("links", async (_event, _churchId, targets) => {
    const church = await requireChurch();
    const codes = ["ko", ...(targets || []).filter((code) => code !== "ko" && catalog.langByCode[code])];
    return {
      home: catalog.homeLink(catalog.pagesBase, church.id),
      items: catalog.buildLinks(catalog.pagesBase, church.id, codes),
    };
  });
  ipcMain.handle("broadcast:start", async (_event, opts) => {
    const church = await requireChurch();
    const staged = stageSummary(church.id);
    const requested = opts && opts.preacherId;
    const started = await engine.start({
      ...(opts || {}),
      apiKey: await cachePlatformKey(),
      churchId: church.id,
      preacherId: requested,
      bulletinPath: staged ? staged.path : "",
      bulletinExtracted: staged ? staged.extracted : null,
    });
    return {
      folderName: started.folderName,
      dir: started.dir,
      targets: started.targets,
    };
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
  app.whenReady().then(async () => {
    let agreed = false;
    try {
      agreed = await consent.askConsent(dialog);
    } catch (_) {
      agreed = false;
    }
    if (!agreed) {
      quitting = true;
      app.quit();
      return;
    }
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
