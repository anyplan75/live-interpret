require("../broadcast/lib/load-env");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const catalog = require("../broadcast/lib/catalog");
const firebase = require("../broadcast/lib/firebase");
const secrets = require("../broadcast/lib/secrets");
const googleAuth = require("../broadcast/lib/google-auth");
const operator = require("../broadcast/lib/operator");
const consent = require("../broadcast/lib/consent");
const roomSync = require("../broadcast/lib/room-sync");
const { userText } = require("../broadcast/lib/user-text");
const { pickSessionDir } = require("./session-dir");

app.setName("live-interpret-settings");
const sharedDir = pickSessionDir({
  argv: process.argv,
  env: process.env,
  appData: app.getPath("appData"),
  home: app.getPath("home"),
});
if (sharedDir) app.setPath("userData", sharedDir);
app.commandLine.appendSwitch("disable-renderer-backgrounding");

let win = null;
let idToken = "";
let tokenExpiresAt = 0;
let stopStatus = null;

function userDir() {
  return app.getPath("userData");
}

function sendStatus(status) {
  if (win && !win.isDestroyed()) win.webContents.send("room-status", status);
}

async function ensureAuth() {
  const session = secrets.readSession(userDir());
  if (!session) {
    idToken = "";
    firebase.setIdToken("");
    return "";
  }
  if (idToken && tokenExpiresAt - Date.now() > 60 * 1000) return idToken;
  const next = await googleAuth.refresh(session.refreshToken);
  idToken = next.idToken;
  tokenExpiresAt = Date.now() + next.expiresIn * 1000;
  firebase.setIdToken(idToken);
  secrets.writeSession(userDir(), {
    refreshToken: next.refreshToken || session.refreshToken,
    email: session.email,
    localId: session.localId,
  });
  return idToken;
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

function watchStatus(churchId) {
  if (stopStatus) stopStatus();
  stopStatus = firebase.listen(`churches/${churchId}/room/status`, (value) => {
    sendStatus(roomSync.publicStatus(value));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 760,
    minHeight: 640,
    backgroundColor: "#0f1419",
    title: "통역 설정",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.on("closed", () => { win = null; });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function registerIpc() {
  ipcMain.handle("catalog", () => ({
    languages: catalog.languages.map((lang) => ({
      code: lang.code,
      name: lang.name,
      flag: lang.flag,
    })),
    defaultTargets: catalog.defaultSelectedTargets(),
  }));
  ipcMain.handle("auth:status", async () => {
    const saved = secrets.readSession(userDir());
    if (!saved) return { signedIn: false, operator: false, email: "" };
    try {
      await ensureAuth();
      if (operator.isOperatorEmail(saved.email)) {
        const adminUid = await firebase.get("admin/uid");
        if (!operator.isOperatorAccount(saved, typeof adminUid === "string" ? adminUid : "")) {
          throw new Error("이 계정은 운영 화면을 열 수 없습니다.");
        }
        return { signedIn: true, operator: true, email: saved.email };
      }
      const church = await requireChurch();
      watchStatus(church.id);
      return {
        signedIn: true,
        operator: false,
        email: saved.email,
        church: { id: church.id, name: church.name || "" },
      };
    } catch (err) {
      return { signedIn: false, operator: false, email: "", church: null, message: userText(err) };
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
        return { signedIn: true, operator: true, email: session.email, church: null };
      }
      const church = await requireChurch();
      watchStatus(church.id);
      return {
        signedIn: true,
        operator: false,
        email: session.email,
        church: { id: church.id, name: church.name || "" },
      };
    } catch (err) {
      idToken = "";
      tokenExpiresAt = 0;
      firebase.setIdToken("");
      secrets.clearSession(userDir());
      throw new Error(userText(err));
    }
  });
  ipcMain.handle("auth:signOut", async () => {
    if (stopStatus) stopStatus();
    stopStatus = null;
    idToken = "";
    tokenExpiresAt = 0;
    firebase.setIdToken("");
    secrets.clearSession(userDir());
    return { signedIn: false };
  });
  ipcMain.handle("room:status", async () => {
    const church = await requireChurch();
    watchStatus(church.id);
    return roomSync.publicStatus(await firebase.get(`churches/${church.id}/room/status`));
  });
  ipcMain.handle("room:command", async (_event, patch) => {
    const church = await requireChurch();
    const current = await firebase.get(`churches/${church.id}/room/desired`);
    const next = roomSync.withRev(current, patch || {});
    await firebase.set(`churches/${church.id}/room/desired`, next);
    return next;
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
    const amount = Math.round(Number(String(amountKrw).replace(/[^0-9]/g, "")) || 0);
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
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.whenReady().then(async () => {
    let agreed = false;
    try { agreed = await consent.askConsent(dialog); } catch (_) { agreed = false; }
    if (!agreed) {
      app.quit();
      return;
    }
    registerIpc();
    createWindow();
  });
}
