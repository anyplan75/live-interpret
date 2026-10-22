require("./lib/load-env");
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
const { PhoneJoin, pcmFromSignal } = require("./lib/phone-join");
const { useFolder, releaseFolder } = require("./lib/folder-access");
const operator = require("./lib/operator");

app.setName("live-interpret");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion");

let win = null;
let phoneWin = null;
let engine = null;
let phoneJoin = null;
let phoneTimer = null;
let phoneReady = false;
const phoneQueue = [];
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
  if (!session || !session.localId) throw new Error("로그인 정보가 없습니다. 다시 로그인해 주세요.");
  const link = await firebase.getAccountLink(session.localId);
  if (!link) throw new Error("이 계정에 연결된 방송 계정이 없습니다. 등록된 계정으로 로그인해 주세요.");
  const church = await firebase.getChurch(link.churchId);
  if (!church || church.accountUid !== session.localId) {
    throw new Error("로그인한 계정이 이 방송과 맞지 않습니다. 다시 로그인해 주세요.");
  }
  return church;
}

async function operatorGate() {
  const token = await ensureAuth();
  if (!token) throw new Error("로그인이 필요합니다.");
  const session = secrets.readSession(userDir());
  const adminUid = await firebase.get("admin/uid");
  if (!operator.isOperatorAccount(session, typeof adminUid === "string" ? adminUid : "")) {
    throw new Error("이 계정은 운영 화면을 열 수 없습니다.");
  }
  return session;
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

function writeSettings(next, options) {
  const internal = !!(options && options.internal);
  const patch = { ...(next || {}) };
  delete patch.apiKey;
  delete patch.model;
  delete patch.folderReady;
  if (!internal) delete patch.folderBookmark;
  const merged = { ...readSettings(), ...patch };
  delete merged.apiKey;
  delete merged.model;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2));
  return merged;
}

function openSavedFolder(saved) {
  return useFolder({
    folder: saved && saved.folder,
    bookmark: saved && saved.folderBookmark,
    mas: process.mas === true,
    startAccess(bookmark) {
      return app.startAccessingSecurityScopedResource(bookmark);
    },
  });
}

function presentSettings(saved) {
  const source = saved && typeof saved === "object" ? saved : {};
  const copy = { ...source };
  delete copy.folderBookmark;
  delete copy.apiKey;
  copy.folderReady = openSavedFolder(source);
  return copy;
}

function readLocalPrepaid(churchId) {
  const saved = readSettings();
  const all = saved.prepaidByChurch;
  if (!churchId || !all || typeof all !== "object") return null;
  return all[churchId] || null;
}

function writeLocalPrepaid(churchId, block) {
  const saved = readSettings();
  const all = { ...(saved.prepaidByChurch && typeof saved.prepaidByChurch === "object" ? saved.prepaidByChurch : {}) };
  if (!block) delete all[churchId];
  else all[churchId] = block;
  writeSettings({ prepaidByChurch: all });
  return block;
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
    title: "실시간 통역시스템",
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
  win.on("closed", () => {
    win = null;
    if (phoneWin && !phoneWin.isDestroyed()) phoneWin.destroy();
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function sendPhone(msg) {
  if (!phoneReady || !phoneWin || phoneWin.isDestroyed()) {
    phoneQueue.push(msg);
    return;
  }
  phoneWin.webContents.send("phone-signal", msg);
}

function flushPhone() {
  phoneReady = true;
  if (!phoneWin || phoneWin.isDestroyed()) return;
  while (phoneQueue.length) phoneWin.webContents.send("phone-signal", phoneQueue.shift());
}

function createPhoneWindow() {
  phoneWin = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: 320,
    height: 240,
    webPreferences: {
      preload: path.join(__dirname, "phone", "answer-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  phoneWin.webContents.setBackgroundThrottling(false);
  phoneWin.setOpacity(0);
  phoneWin.setIgnoreMouseEvents(true);
  phoneWin.showInactive();
  phoneWin.loadFile(path.join(__dirname, "phone", "answer.html"));
}

function registerIpc() {
  ipcMain.handle("settings:get", () => {
    const saved = readSettings();
    if (!Array.isArray(saved.targets) || !saved.targets.length) {
      saved.targets = catalog.defaultSelectedTargets();
    }
    if (!saved.sensitivity) saved.sensitivity = "normal";
    saved.spoken = catalog.spokenLanguage(saved.spoken);
    return presentSettings(saved);
  });
  ipcMain.handle("settings:set", (_event, patch) => presentSettings(writeSettings(patch || {})));
  ipcMain.handle("catalog", () => ({
    languages: catalog.languages.map((lang) => ({
      code: lang.code,
      name: lang.name,
      nameEn: lang.nameEn,
      flag: lang.flag,
      defaultSelected: !!lang.defaultSelected,
      defaultFont: catalog.subtitleFontId(undefined, lang.code),
    })),
    subtitleFonts: catalog.subtitleFonts.map((face) => ({ id: face.id, label: face.label })),
    pagesBase: catalog.pagesBase,
    defaultTargets: catalog.defaultSelectedTargets(),
  }));
  ipcMain.handle("auth:status", async () => {
    const saved = secrets.readSession(userDir());
    if (!saved) return { signedIn: false, operator: false, email: "", church: null, keyReady: Boolean(resolveKey()) };
    try {
      if (operator.isOperatorEmail(saved.email)) {
        await ensureAuth();
        const adminUid = await firebase.get("admin/uid");
        if (!operator.isOperatorAccount(secrets.readSession(userDir()), typeof adminUid === "string" ? adminUid : "")) {
          idToken = "";
          tokenExpiresAt = 0;
          firebase.setIdToken("");
          secrets.clearSession(userDir());
          return { signedIn: false, operator: false, email: "", church: null, keyReady: Boolean(resolveKey()) };
        }
        return {
          signedIn: true,
          operator: true,
          email: saved.email,
          church: null,
          keyReady: false,
        };
      }
      const church = await requireChurch();
      return {
        signedIn: true,
        operator: false,
        email: saved.email,
        church: publicChurch(church),
        keyReady: Boolean(await cachePlatformKey()),
      };
    } catch (err) {
      const message = err && err.message ? err.message : "";
      if (/다시 로그인|연결된 방송 계정|맞지 않습니다/.test(message)) {
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
      if (operator.isOperatorEmail(session.email)) {
        const adminUid = await firebase.get("admin/uid");
        if (!operator.isOperatorAccount(session, typeof adminUid === "string" ? adminUid : "")) {
          throw new Error("이 계정은 운영 화면을 열 수 없습니다.");
        }
        return {
          signedIn: true,
          operator: true,
          email: session.email,
          church: null,
          keyReady: false,
        };
      }
      const church = await requireChurch();
      return {
        signedIn: true,
        operator: false,
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
  ipcMain.handle("operator:list", async () => {
    await operatorGate();
    const index = await firebase.get("churchIndex");
    const entries = index && typeof index === "object" ? Object.entries(index) : [];
    const accounts = [];
    for (const [id, row] of entries) {
      if (!catalog.isChurchId(id) || !row || typeof row !== "object") continue;
      const [billing, usage, sessionIndex] = await Promise.all([
        firebase.get(`churches/${id}/billing`),
        firebase.get(`churches/${id}/live/usage`),
        firebase.get(`churches/${id}/sessionIndex`),
      ]);
      accounts.push(operator.accountRow(id, row, billing, usage, sessionIndex));
    }
    accounts.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return { accounts };
  });
  ipcMain.handle("operator:credit", async (_event, accountId, amountKrw) => {
    const session = await operatorGate();
    if (!catalog.isChurchId(accountId)) throw new Error("계정을 골라 주세요.");
    const amount = Math.round(Number(amountKrw) || 0);
    if (amount <= 0) throw new Error("더할 금액을 입력해 주세요.");
    const index = await firebase.get("churchIndex");
    if (!index || typeof index !== "object" || !index[accountId]) throw new Error("계정을 찾지 못했습니다.");
    const billing = (await firebase.get(`churches/${accountId}/billing`)) || {};
    const update = operator.creditUpdate({
      balance: billing.balance,
      amount,
      accountId,
      who: session.localId,
      now: Date.now(),
    });
    if (!update.ok) throw new Error("선불 잔액을 더하지 못했습니다.");
    await firebase.update(`churches/${accountId}/billing`, update.patch);
    return { balanceKrw: update.balance, balanceLabel: update.balanceLabel };
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
  ipcMain.handle("billing:preview", async (_event, targets, spoken, extraChannels) => {
    const church = await requireChurch();
    return engine.previewCharge(church.id, targets, spoken, extraChannels);
  });
  ipcMain.handle("style:set", async (_event, style) => {
    const church = await requireChurch();
    return engine.saveStyle(church.id, style || {});
  });
  ipcMain.handle("preachers:save", async (_event, payload) => {
    const church = await requireChurch();
    const name = payload && typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) throw new Error("강연자 이름을 입력해 주세요.");
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
      title: "진행자료 사진",
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
        error: "이 컴퓨터에 번역 키가 없어 진행자료를 아직 분석하지 못했습니다. 사진은 이 PC에 저장했습니다.",
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
  ipcMain.handle("phone:set-count", async (_event, count) => {
    await ensureAuth();
    if (!phoneJoin) throw new Error("휴대폰 연결을 아직 준비하지 못했습니다.");
    if (!/^[a-f0-9]{32}$/.test(phoneJoin.token || "")) await phoneJoin.start();
    if (!/^[a-f0-9]{32}$/.test(phoneJoin.token || "")) {
      throw new Error("휴대폰 연결을 아직 준비하지 못했습니다.");
    }
    let changed;
    try {
      changed = phoneJoin.setPhoneCount(count);
    } catch (err) {
      send({ type: "phone-join", info: phoneJoin.info() });
      throw err;
    }
    try {
      for (const connectionId of changed.added) {
        await firebase.set(`lectureJoins/${connectionId}`, { token: phoneJoin.token });
      }
      for (const connectionId of changed.removed) {
        try { await firebase.remove(`lectureJoins/${connectionId}`); } catch (_) { /* 이미 없는 칸은 넘어갑니다 */ }
      }
    } catch (err) {
      changed.added.forEach((connectionId) => phoneJoin.dropDesk(connectionId));
      send({ type: "phone-join", info: phoneJoin.info() });
      throw new Error("휴대폰 QR을 만들지 못했습니다. 다시 시도해 주세요.");
    }
    await phoneJoin.refreshQrs();
    send({ type: "phone-join", info: phoneJoin.info() });
    return phoneJoin.info();
  });
  ipcMain.handle("phone:add-channel", async () => {
    if (!phoneJoin || !phoneJoin.sessionOpen) {
      throw new Error("방송을 시작한 뒤에 휴대폰 채널을 추가할 수 있습니다.");
    }
    const desk = phoneJoin.addDesk();
    try {
      await firebase.set(`lectureJoins/${desk.connectionId}`, { token: phoneJoin.token });
    } catch (err) {
      phoneJoin.dropDesk(desk.connectionId);
      send({ type: "phone-join", info: phoneJoin.info() });
      throw new Error("휴대폰 칸을 열지 못했습니다. 다시 시도해 주세요.");
    }
    await phoneJoin.refreshQrs();
    send({ type: "phone-join", info: phoneJoin.info() });
    return { connectionId: desk.connectionId };
  });
  ipcMain.handle("phone:info", () => (phoneJoin ? phoneJoin.info() : {
    url: "",
    qrDataUrl: "",
    host: "",
    ips: [],
    note: "송출 컴퓨터를 같은 Wi-Fi에 연결하면 참여 주소가 나옵니다.",
  }));
  ipcMain.on("phone-answer", (_event, msg) => {
    if (!phoneJoin || !msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      flushPhone();
      return;
    }
    if (msg.type === "answer") {
      phoneJoin.publishAnswer(msg.peerId, msg.sdp).catch((err) => {
        send({ type: "log", level: "error", text: err.message || String(err) });
      });
      return;
    }
    if (msg.type === "macIce") {
      phoneJoin.publishMacIce(msg).catch((err) => {
        send({ type: "log", level: "error", text: err.message || String(err) });
      });
      return;
    }
    if (msg.type === "text") phoneJoin.ingestText(msg.peerId, msg.text);
    else if (msg.type === "pcm") phoneJoin.ingestPcm(msg.peerId, pcmFromSignal(msg.pcm));
    else if (msg.type === "leave") phoneJoin.peerLeft(msg.peerId);
    else if (msg.type === "error" && msg.message) {
      if (msg.peerId) phoneJoin.forgetOffer(msg.peerId);
      send({ type: "log", level: "error", text: String(msg.message) });
    }
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
      title: "텍스트를 저장할 폴더",
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: true,
    });
    if (result.canceled || !result.filePaths[0]) return "";
    const folder = result.filePaths[0];
    const bookmark = Array.isArray(result.bookmarks) ? String(result.bookmarks[0] || "") : "";
    if (process.mas === true && !bookmark) return "";
    writeSettings({ folder, folderBookmark: bookmark }, { internal: true });
    if (!openSavedFolder(readSettings())) {
      writeSettings({ folder: "", folderBookmark: "" }, { internal: true });
      return "";
    }
    return folder;
  });
  ipcMain.handle("audio:monitor", (_event, deviceKey, channel) => engine.monitor(deviceKey, channel));
  ipcMain.handle("audio:channel", (_event, index) => engine.setChannel(index));
  ipcMain.handle("spoken:set", async (_event, spoken) => {
    const church = await requireChurch();
    return engine.setSpoken(church.id, spoken);
  });
  ipcMain.handle("channel:spoken", async (_event, index, spoken) => {
    const church = await requireChurch();
    return engine.setChannelSpoken(church.id, index, spoken);
  });
  ipcMain.handle("preacher:show-name", (_event, on) => engine.setShowPreacherName(on));
  ipcMain.handle("phone:display", (_event, connectionId, patch) => {
    const shown = engine.setPhoneDisplay(connectionId, patch || {});
    if (phoneJoin) phoneJoin.setDisplay(connectionId, shown);
    return shown;
  });
  ipcMain.handle("channel:on", async (_event, index, on) => {
    const church = await requireChurch();
    return engine.setChannelOn(church.id, index, on);
  });
  ipcMain.handle("targets:set", async (_event, _churchId, targets, spoken) => {
    const church = await requireChurch();
    return engine.setTargets(church.id, targets, spoken);
  });
  ipcMain.handle("links", async (_event, _churchId, targets, spoken) => {
    const church = await requireChurch();
    const source = catalog.spokenLanguage(spoken);
    const codes = [source, ...catalog.translationTargets(targets, source)];
    return {
      home: catalog.homeLink(catalog.pagesBase, church.id),
      items: catalog.buildLinks(catalog.pagesBase, church.id, codes),
    };
  });
  ipcMain.handle("broadcast:start", async (_event, opts) => {
    const church = await requireChurch();
    const saved = readSettings();
    if (!openSavedFolder(saved)) {
      throw new Error("저장 폴더를 다시 선택해 주세요. 고른 폴더에 기록을 만들 수 없습니다.");
    }
    const staged = stageSummary(church.id);
    const requested = opts && opts.preacherId;
    const started = await engine.start({
      ...(opts || {}),
      folder: saved.folder,
      apiKey: await cachePlatformKey(),
      churchId: church.id,
      preacherId: requested,
      bulletinPath: staged ? staged.path : "",
      bulletinExtracted: staged ? staged.extracted : null,
    });
    if (started && started.already) {
      if (phoneJoin) send({ type: "phone-join", info: phoneJoin.info() });
      return {
        already: true,
        folderName: started.folderName,
        dir: started.dir,
        targets: started.targets,
        channels: started.channels || [],
      };
    }
    if (phoneJoin) {
      let opened = [];
      try {
        const desk = await phoneJoin.openSession();
        opened = phoneJoin.desks.map((item) => item.connectionId).filter(Boolean);
        if (!opened.length && desk.connectionId) opened = [desk.connectionId];
        for (const connectionId of opened) {
          await firebase.set(`lectureJoins/${connectionId}`, { token: phoneJoin.token });
        }
        await phoneJoin.refreshQrs();
        send({ type: "phone-join", info: phoneJoin.info() });
      } catch (err) {
        const created = phoneJoin.closeSession();
        const ids = created.length ? created : opened;
        for (const connectionId of ids) {
          try { await firebase.remove(`lectureJoins/${connectionId}`); } catch (_) { /* 없는 번호는 지울 것이 없습니다 */ }
        }
        send({ type: "phone-join", info: phoneJoin.info() });
        try { await engine.stop(); } catch (_) { /* 시작이 취소되면 방송도 멈춥니다 */ }
        throw new Error("휴대폰 QR을 열지 못했습니다. 방송을 다시 시작해 주세요.");
      }
    }
    return {
      folderName: started.folderName,
      dir: started.dir,
      targets: started.targets,
      channels: started.channels || [],
    };
  });
  ipcMain.handle("broadcast:stop", async () => {
    const stopped = await engine.stop();
    const ids = phoneJoin ? phoneJoin.closeSession() : [];
    const fresh = phoneJoin && Array.isArray(phoneJoin.preparedAfterClose) ? phoneJoin.preparedAfterClose : [];
    if (phoneJoin) {
      await phoneJoin.refreshQrs();
      send({ type: "phone-join", info: phoneJoin.info() });
    }
    for (const connectionId of ids) {
      try { await firebase.remove(`lectureJoins/${connectionId}`); } catch (_) { /* 이미 지워진 번호는 무시합니다 */ }
    }
    for (const connectionId of fresh) {
      try { await firebase.set(`lectureJoins/${connectionId}`, { token: phoneJoin.token }); } catch (_) { /* 다음 시작 때 다시 엽니다 */ }
    }
    return stopped;
  });
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
    engine = new Engine(send, {
      readLocalPrepaid,
      writeLocalPrepaid,
    });
    phoneJoin = new PhoneJoin({
      onHello: (phone) => engine.acceptPhone(phone),
      onPcm: (phoneId, pcm) => engine.pushPhonePcm(phoneId, pcm),
      onLeave: (phoneId) => engine.markPhoneAway(phoneId),
      onChange: () => {
        if (!phoneJoin) return;
        send({ type: "phone-join", info: phoneJoin.info() });
      },
      onError: (err) => send({ type: "log", level: "error", text: err.message || String(err) }),
    });
    phoneJoin.attachLink({
      offer: (msg) => sendPhone({ type: "offer", peerId: msg.peerId, sdp: msg.sdp }),
      ice: (msg) => sendPhone({
        type: "phoneIce",
        peerId: msg.peerId,
        candidate: msg.candidate,
        sdpMid: msg.sdpMid,
        sdpMLineIndex: msg.sdpMLineIndex,
      }),
      send: (peerId, text) => sendPhone({ type: "send", peerId, text }),
      close: (peerId) => sendPhone({ type: "close", peerId }),
    });
    engine.bindPhoneLink((phoneId, listening) => phoneJoin.setListening(phoneId, listening));
    registerIpc();
    createWindow();
    createPhoneWindow();
    phoneJoin.start().then((info) => {
      send({ type: "phone-join", info });
      if (info.url) send({ type: "log", level: "info", text: `휴대폰 마이크 참여 주소: ${info.url}` });
      phoneTimer = setInterval(() => {
        if (!phoneJoin) return;
        phoneJoin.refresh().then((next) => {
          if (next && next.changed) send({ type: "phone-join", info: next });
        }).catch((err) => {
          send({ type: "log", level: "error", text: err.message || String(err) });
        });
      }, 15000);
    }).catch((err) => {
      send({ type: "log", level: "error", text: err.message || String(err) });
    });
  });
  app.on("window-all-closed", () => app.quit());
  function closePhones() {
    if (phoneTimer) {
      clearInterval(phoneTimer);
      phoneTimer = null;
    }
    phoneReady = false;
    phoneQueue.length = 0;
    if (phoneWin && !phoneWin.isDestroyed()) {
      const closingWindow = phoneWin;
      phoneWin = null;
      closingWindow.destroy();
    }
    if (!phoneJoin) return;
    const closing = phoneJoin;
    phoneJoin = null;
    closing.stop().catch(() => {});
  }

  app.on("before-quit", (event) => {
    closePhones();
    if (quitting || !engine) {
      releaseFolder();
      return;
    }
    if (engine.running) {
      event.preventDefault();
      engine.stop().finally(() => {
        engine.capture.stop();
        releaseFolder();
        quitting = true;
        app.quit();
      });
      return;
    }
    engine.capture.stop();
    releaseFolder();
  });
}
