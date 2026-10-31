require("./lib/load-env");
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require("electron");
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
const roomSync = require("./lib/room-sync");
const setupReady = require("./lib/setup-ready");
const orgServices = require("../docs/js/org-services");
const cost = require("./lib/cost");
const { userText } = require("./lib/user-text");

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

function bulletinStatusLabel(churchId) {
  const staged = stageSummary(churchId);
  if (!staged) return "아직 올린 진행자료가 없습니다.";
  const extracted = staged.extracted;
  if (!extracted) return `${staged.fileName} 사진을 저장했습니다.`;
  const bits = [];
  if (Array.isArray(extracted.songTitles) && extracted.songTitles.length) {
    bits.push(extracted.songTitles.slice(0, 3).join(", "));
  }
  if (extracted.preacherName) bits.push(extracted.preacherName);
  if (extracted.scripture) bits.push(extracted.scripture);
  return bits.length ? `${staged.fileName}: ${bits.join(" · ")}`.slice(0, 120) : `${staged.fileName} 분석을 마쳤습니다.`;
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

const peaks = new Map();
const hearingBoard = { live: "", heard: [], cards: [] };
const hearingLogs = [];
let publishRoom = () => {};

function clipHearing(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function rememberHearing(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.type === "live") {
    hearingBoard.live = clipHearing(payload.text, 280);
    return;
  }
  if (payload.type === "heard") {
    const body = clipHearing(payload.text, 280);
    if (!body) return;
    const id = clipHearing(payload.id, 24) || String(hearingBoard.heard.length + 1);
    if (!hearingBoard.heard.some((item) => item.id === id)) {
      hearingBoard.heard.push({ id, body, fixes: [] });
      if (hearingBoard.heard.length > 8) hearingBoard.heard.shift();
    }
    hearingBoard.live = "";
    return;
  }
  if (payload.type === "line") {
    const body = clipHearing(payload.text, 280);
    const raw = clipHearing(payload.raw, 280);
    const spoken = engine && engine.spoken ? engine.spoken : "ko";
    if (!payload.lang || payload.lang === spoken) {
      if (body && raw && body !== raw) {
        const id = clipHearing(payload.heardId, 24);
        let row = hearingBoard.heard.find((item) => item.id === id);
        if (!row) {
          row = { id: id || `h${hearingBoard.heard.length + 1}`, body: raw || body, fixes: [] };
          hearingBoard.heard.push(row);
          if (hearingBoard.heard.length > 8) hearingBoard.heard.shift();
        }
        if (!row.fixes.includes(body)) {
          row.fixes.push(body);
          if (row.fixes.length > 3) row.fixes.shift();
        }
      }
      return;
    }
    if (body) {
      const lang = String(payload.lang).slice(0, 12);
      hearingBoard.cards.push({ lang, body });
      if (hearingBoard.cards.length > 8) hearingBoard.cards.shift();
    }
    return;
  }
  if (payload.type === "log") {
    const body = userText(payload.text || "").slice(0, 180);
    if (!body || /firebase|permission denied|error:/i.test(body)) return;
    hearingLogs.push({ level: payload.level === "error" ? "error" : "info", body });
    if (hearingLogs.length > 12) hearingLogs.shift();
  }
}

function clearHearing() {
  hearingBoard.live = "";
  hearingBoard.heard = [];
  hearingBoard.cards = [];
}

function openSettingsApp() {
  const page = "https://anyplan75.github.io/live-interpret/desk/";
  const session = secrets.readSession(userDir());
  const refresh = session && typeof session.refreshToken === "string" ? session.refreshToken : "";
  let target = page;
  if (refresh) {
    const hash = new URLSearchParams();
    hash.set("r", refresh);
    if (session.email) hash.set("e", session.email);
    if (session.localId) hash.set("u", session.localId);
    target = `${page}#${hash.toString()}`;
  }
  shell.openExternal(target).catch(() => {});
}

function send(payload) {
  rememberHearing(payload);
  if (payload && payload.type === "level" && Number.isInteger(payload.channel)) {
    peaks.set(payload.channel, Number(payload.peak) || 0);
  }
  if (payload && payload.type === "levels" && Array.isArray(payload.peaks)) {
    payload.peaks.forEach((peak, index) => peaks.set(index, Number(peak) || 0));
  }
  if (win && !win.isDestroyed()) win.webContents.send("engine", payload);
  try { publishRoom(); } catch (_) { /* 상태 기록은 다음 변화에서 다시 보냅니다 */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 400,
    minHeight: 480,
    backgroundColor: "#0f1419",
    title: "방송실",
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
  const template = [
    {
      label: "방송실",
      submenu: [
        { label: "설정 사이트 열기", click: () => openSettingsApp() },
        { type: "separator" },
        { role: "quit", label: "종료" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  win.loadFile(path.join(__dirname, "renderer", "room.html"));
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
  let appliedRev = 0;
  let roomChurchId = "";
  let stopDesired = null;
  let statusTimer = null;
  let lastNotice = "";
  let noticeUntil = 0;
  let applying = false;
  let cachedBalance = null;
  let balanceAt = 0;

  function note(text) {
    lastNotice = userText(text).slice(0, 180);
    noticeUntil = Date.now() + 12000;
    publishRoom();
  }

  function roomInputs() {
    const channels = engine.publicChannels();
    const info = phoneJoin ? phoneJoin.info() : { channels: [] };
    const seen = new Set();
    const inputs = [];
    const joinUrl = (connectionId) => {
      try {
        if (!phoneJoin || !phoneJoin.token) return "";
        return orgServices.lectureSlotUrl(catalog.pagesBase, connectionId, phoneJoin.token);
      } catch (_) {
        return "";
      }
    };
    channels.forEach((row) => {
      if (row.source === "phone" && row.connectionId) {
        const key = `p:${row.connectionId}`;
        seen.add(key);
        inputs.push({
          key,
          kind: "phone",
          title: row.name || "휴대폰",
          name: row.name || "",
          level: peaks.get(row.index) || 0,
          live: row.captionLive !== false,
          connected: !!row.connected,
          joining: false,
          showName: row.showName !== false,
          joinUrl: joinUrl(row.connectionId),
        });
        return;
      }
      inputs.push({
        key: `c:${row.index}`,
        kind: "mic",
        title: `채널 ${row.index + 1}`,
        name: row.name || "",
        level: peaks.get(row.index) || 0,
        live: row.captionLive !== false,
        connected: true,
        showName: row.showName !== false,
        joinUrl: "",
      });
    });
    (info.channels || []).forEach((desk, index) => {
      if (!desk.connectionId) return;
      const key = `p:${desk.connectionId}`;
      if (seen.has(key)) return;
      inputs.push({
        key,
        kind: "phone",
        title: `휴대폰 ${index + 1}`,
        name: desk.name || "",
        level: 0,
        live: true,
        connected: !!desk.connected,
        joining: !!desk.joining,
        showName: desk.showName !== false,
        joinUrl: joinUrl(desk.connectionId),
      });
    });
    return inputs;
  }

  async function publishStatus() {
    if (!roomChurchId || !engine) return;
    if (!(engine.sessionCharge && engine.sessionCharge.balance != null) && Date.now() - balanceAt > 5000) {
      try {
        cachedBalance = await engine.readBalance(roomChurchId);
        balanceAt = Date.now();
      } catch (_) { /* 잔액은 다음 기록에서 다시 읽습니다 */ }
    }
    if (engine.sessionCharge && engine.sessionCharge.balance != null) cachedBalance = engine.sessionCharge.balance;
    const remaining = engine.remainingNow();
    const charged = engine.sessionCharge ? engine.sessionCharge.charged : 0;
    const saved = readSettings();
    const publicKind = ["강의", "연설", "행사"].includes(saved.sessionKind) ? saved.sessionKind : "";
    const deviceKey = (engine.device && engine.device.key) || saved.deviceKey || "";
    const gaps = setupReady.missingSetup({
      folder: saved.folder || "",
      folderReady: openSavedFolder(saved),
      preacherId: saved.preacherId || "",
      sessionKind: publicKind,
      targets: engine.outputs || [],
      deviceKey,
    });
    const speech = saved.deskSpeech && typeof saved.deskSpeech === "object" ? saved.deskSpeech : {};
    const status = roomSync.publicStatus({
      updatedAt: Date.now(),
      online: true,
      running: !!engine.running,
      balanceLabel: cachedBalance == null ? "0원" : cost.formatKrw(cachedBalance),
      remainingLabel: remaining > 0 ? cost.prepaidLabel(remaining) : "남은 시간 없음",
      sessionLabel: `이번 ${cost.formatKrw(charged || 0)}`,
      notice: Date.now() < noticeUntil ? lastNotice : "",
      showName: engine.showPreacherName !== false,
      spoken: engine.spoken || "ko",
      targets: engine.outputs || [],
      inputs: roomInputs(),
      folderReady: !gaps.includes("저장 폴더"),
      folderLabel: saved.folder ? path.basename(saved.folder) : "",
      deviceReady: !gaps.includes("입력 장치"),
      gaps,
      sensitivity: saved.sensitivity || engine.sessionSensitivity || "normal",
      sessionKind: publicKind,
      phoneCount: phoneJoin ? phoneJoin.phoneCount : (Number(saved.phoneCount) || 0),
      preacherName: engine.preacherName || saved.preacherName || "",
      speech: {
        traits: speech.traits || "",
        fixes: speech.corrections || "",
        terms: speech.terms || "",
      },
      bulletinLabel: bulletinStatusLabel(roomChurchId),
      board: hearingBoard,
      logs: hearingLogs,
    });
    try {
      await firebase.set(`churches/${roomChurchId}/room/status`, status);
    } catch (_) { /* 다음 상태 기록에서 다시 보냅니다 */ }
  }

  publishRoom = () => {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      publishStatus().catch(() => {});
    }, 400);
  };

  async function applyInput(action) {
    if (action.key.startsWith("c:")) {
      const index = Number(action.key.slice(2));
      const rows = engine.publicChannels();
      if (!rows[index] || rows[index].source === "phone") return;
      try {
        engine.setChannelCaption(index, { name: action.name, showName: action.showName });
        if ((rows[index].captionLive !== false) !== action.live) engine.setInputLive(index, action.live);
      } catch (_) { /* 아직 없는 마이크 칸은 방송실에서 장치를 고른 뒤에 적용합니다 */ }
      return;
    }
    const connectionId = action.key.slice(2);
    if (phoneJoin) phoneJoin.setDisplay(connectionId, { name: action.name, showName: action.showName });
    const row = engine.publicChannels().find((item) => item.connectionId === connectionId);
    if (!row) return;
    try {
      if (action.name) engine.setPhoneDisplay(connectionId, { name: action.name, showName: action.showName });
    } catch (_) { /* 자막 칸이 없으면 연결 기록만 바꿉니다 */ }
    if ((row.captionLive !== false) !== action.live) {
      try { engine.setInputLive(row.index, action.live); } catch (_) { /* 꺼진 칸은 다음에 다시 맞춥니다 */ }
    }
  }

  function applyDeskStyle(action) {
    const saved = readSettings();
    const prev = saved.deskSpeech && typeof saved.deskSpeech === "object" ? saved.deskSpeech : {};
    const sensitivity = action.sensitivity === "high" || action.sensitivity === "low"
      ? action.sensitivity
      : (saved.sensitivity || "normal");
    const style = {
      traits: action.type === "speech" ? String(action.traits || "") : String(prev.traits || ""),
      corrections: action.type === "speech" ? String(action.fixes || "") : String(prev.corrections || ""),
      terms: action.type === "speech" ? String(action.terms || "") : String(prev.terms || ""),
      sensitivity,
    };
    engine.sessionSensitivity = sensitivity;
    const keys = new Set(["device:0"]);
    (engine.publicChannels ? engine.publicChannels() : []).forEach((row, index) => {
      if (row && row.source === "phone" && row.connectionId) keys.add(`phone:${row.connectionId}`);
      else keys.add(`device:${index}`);
    });
    keys.forEach((key) => engine.applySourceStyle(key, style));
    writeSettings({
      sensitivity,
      deskSpeech: { traits: style.traits, corrections: style.corrections, terms: style.terms },
    });
  }

  function applyPreacherName(name) {
    const next = String(name || "").trim().slice(0, 40);
    engine.preacherName = next;
    engine.setShowPreacherName(engine.showPreacherName !== false);
    writeSettings({ preacherName: next });
  }

  async function applySheet(action) {
    const church = await requireChurch();
    const dir = bulletinDir(church.id);
    fs.mkdirSync(dir, { recursive: true });
    const incoming = path.join(dir, "incoming.jpg");
    fs.writeFileSync(incoming, Buffer.from(action.image, "base64"));
    let stored = null;
    try {
      stored = bulletinLib.stageBulletin(dir, incoming);
    } catch (_) {
      note("진행자료 사진을 올리지 못했습니다.");
      return;
    } finally {
      try { fs.rmSync(incoming, { force: true }); } catch (_) { /* 임시 사진은 없어도 됩니다 */ }
    }
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
      path: stored.absolutePath,
      fileName: stored.fileName,
    }));
    const key = await cachePlatformKey();
    if (!key) {
      note("진행자료 사진을 저장했습니다. 이 컴퓨터에 번역 키가 없어 분석은 나중에 합니다.");
      return;
    }
    try {
      const extracted = await bulletinLib.analyzeBulletinImage({
        apiKey: key,
        model: church.model,
        imagePath: stored.absolutePath,
      });
      bulletinLib.writeExtractionFile(dir, stored.fileName, extracted);
      note("진행자료 분석을 마쳤습니다.");
    } catch (_) {
      note("진행자료 사진은 저장했습니다. 분석은 다시 시도해 주세요.");
    }
  }

  async function applyPhoneCount(count) {
    await ensureAuth();
    if (!phoneJoin) throw new Error("휴대폰 연결을 아직 준비하지 못했습니다.");
    const next = Math.max(0, Math.min(8, Math.round(Number(count) || 0)));
    if (phoneJoin.countChosen && phoneJoin.phoneCount === next) {
      writeSettings({ phoneCount: next });
      return phoneJoin.info();
    }
    if (!/^[a-f0-9]{32}$/.test(phoneJoin.token || "")) await phoneJoin.start();
    if (!/^[a-f0-9]{32}$/.test(phoneJoin.token || "")) {
      throw new Error("휴대폰 연결을 아직 준비하지 못했습니다.");
    }
    let changed;
    try {
      changed = phoneJoin.setPhoneCount(next);
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
    } catch (_) {
      changed.added.forEach((connectionId) => phoneJoin.dropDesk(connectionId));
      send({ type: "phone-join", info: phoneJoin.info() });
      throw new Error("휴대폰 QR을 만들지 못했습니다. 다시 시도해 주세요.");
    }
    await phoneJoin.refreshQrs();
    writeSettings({ phoneCount: next });
    send({ type: "phone-join", info: phoneJoin.info() });
    return phoneJoin.info();
  }

  async function applyDesired(raw) {
    if (applying || !roomChurchId) return;
    const plan = roomSync.actionsFor(appliedRev, raw);
    if (!plan.actions.length) return;
    applying = true;
    try {
      for (const action of plan.actions) {
        if (action.type === "showName") engine.setShowPreacherName(action.on);
        else if (action.type === "languages") await engine.setTargets(roomChurchId, action.targets, action.spoken);
        else if (action.type === "kind" && action.sessionKind) writeSettings({ sessionKind: action.sessionKind });
        else if (action.type === "sensitivity" || action.type === "speech") applyDeskStyle(action);
        else if (action.type === "phones") await applyPhoneCount(action.phoneCount);
        else if (action.type === "preacher") applyPreacherName(action.name);
        else if (action.type === "sheet") await applySheet(action);
        else if (action.type === "input") await applyInput(action);
        else if (action.type === "running" && action.on && !engine.running) {
          await beginBroadcast({
            sessionKind: action.sessionKind,
            spoken: action.spoken,
            targets: action.targets,
            sensitivity: action.sensitivity,
            preacherName: action.preacherName,
          });
        } else if (action.type === "running" && !action.on && engine.running) await endBroadcast();
      }
      appliedRev = plan.rev;
    } catch (err) {
      note(err);
    } finally {
      applying = false;
      publishRoom();
    }
  }

  function watchRoom(churchId) {
    if (!churchId) return;
    if (churchId === roomChurchId && stopDesired) return;
    if (stopDesired) stopDesired();
    roomChurchId = churchId;
    appliedRev = 0;
    stopDesired = firebase.listen(`churches/${churchId}/room/desired`, (value) => {
      applyDesired(value).catch((err) => note(err));
    });
    publishRoom();
  }

  function leaveRoom() {
    if (stopDesired) stopDesired();
    stopDesired = null;
    roomChurchId = "";
    appliedRev = 0;
  }

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
        return { signedIn: false, operator: false, email: "", church: null, keyReady: false };
      }
      const church = await requireChurch();
      watchRoom(church.id);
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
        throw new Error("계정 사용은 설정 앱에서 합니다.");
      }
      const church = await requireChurch();
      watchRoom(church.id);
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
    leaveRoom();
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
    if (amount <= 0) throw new Error("충전할 금액을 적으세요");
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
  ipcMain.handle("operator:testPeriod", async () => {
    await operatorGate();
    return { on: (await firebase.get("billing/testPeriod")) === true };
  });
  ipcMain.handle("operator:setTestPeriod", async (_event, on) => {
    await operatorGate();
    const next = on === true;
    await firebase.set("billing/testPeriod", next);
    return { on: next };
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
  ipcMain.handle("phone:set-count", async (_event, count) => applyPhoneCount(count));
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
  ipcMain.handle("app:open-settings", () => {
    openSettingsApp();
    return true;
  });
  ipcMain.handle("audio:monitor", (_event, deviceKey, channel) => {
    const snap = engine.monitor(deviceKey, channel);
    const key = engine.device && engine.device.key ? engine.device.key : String(deviceKey || "");
    if (key) writeSettings({ deviceKey: key });
    return snap;
  });
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
  ipcMain.handle("source-style:set", (_event, key, style) => engine.applySourceStyle(key, style));
  ipcMain.handle("channel:caption", (_event, index, patch) => engine.setChannelCaption(index, patch || {}));
  ipcMain.handle("phone:display", (_event, connectionId, patch) => {
    const shown = engine.setPhoneDisplay(connectionId, patch || {});
    if (phoneJoin) phoneJoin.setDisplay(connectionId, shown);
    return shown;
  });
  ipcMain.handle("channel:on", async (_event, index, on) => {
    const church = await requireChurch();
    return engine.setChannelOn(church.id, index, on);
  });
  ipcMain.handle("input:live", (_event, index, on) => engine.setInputLive(index, on));
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
  async function beginBroadcast(opts) {
    const church = await requireChurch();
    const saved = readSettings();
    if (!openSavedFolder(saved)) {
      throw new Error("저장 폴더를 다시 선택해 주세요. 고른 폴더에 기록을 만들 수 없습니다.");
    }
    const staged = stageSummary(church.id);
    const spoken = catalog.spokenLanguage((opts && opts.spoken) || engine.spoken || saved.spoken || "ko");
    const targets = Array.isArray(opts && opts.targets) && opts.targets.length
      ? opts.targets
      : (Array.isArray(engine.outputs) && engine.outputs.length ? engine.outputs : (saved.targets || []));
    let preacherId = (opts && opts.preacherId) || saved.preacherId || "";
    if (!catalog.isPreacherId(preacherId)) {
      const preachers = await firebase.listPreachers(church.id);
      preacherId = preachers[0] && preachers[0].id ? preachers[0].id : "";
    }
    if (!catalog.isPreacherId(preacherId)) {
      throw new Error("등록된 이름이 없습니다. 관리 페이지에서 이름을 먼저 등록해 주세요.");
    }
    const kinds = ["강의", "연설", "행사"];
    const sessionKind = kinds.includes(opts && opts.sessionKind)
      ? opts.sessionKind
      : (kinds.includes(saved.sessionKind) ? saved.sessionKind : "강의");
    const deskSpeech = saved.deskSpeech && typeof saved.deskSpeech === "object" ? saved.deskSpeech : {};
    if (!engine.capture.opened) {
      const key = (opts && opts.deviceKey) || saved.deviceKey || "";
      if (key) engine.monitor(key, Number(opts && opts.channel) || 0);
    }
    const started = await engine.start({
      ...(opts || {}),
      folder: saved.folder,
      apiKey: await cachePlatformKey(),
      churchId: church.id,
      preacherId,
      sessionKind,
      spoken,
      targets,
      deviceKey: (opts && opts.deviceKey) || saved.deviceKey || (engine.device && engine.device.key) || "",
      sensitivity: (opts && opts.sensitivity) || saved.sensitivity || "normal",
      speechStyle: {
        traits: deskSpeech.traits || "",
        corrections: deskSpeech.corrections || "",
        terms: deskSpeech.terms || "",
        sensitivity: (opts && opts.sensitivity) || saved.sensitivity || "normal",
      },
      showPreacherName: engine.showPreacherName !== false,
      channels: engine.publicChannels(),
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
    if (opts && opts.preacherName) {
      engine.preacherName = String(opts.preacherName).slice(0, 40);
      engine.setShowPreacherName(engine.showPreacherName !== false);
    }
    clearHearing();
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
  }

  async function endBroadcast() {
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
  }

  ipcMain.handle("broadcast:start", (_event, opts) => beginBroadcast(opts));
  ipcMain.handle("broadcast:stop", () => endBroadcast());
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
      onLine: (phoneId, text) => engine.hearPhoneLine(phoneId, text),
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
