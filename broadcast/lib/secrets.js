const fs = require("fs");
const path = require("path");
const { isPlatformKey } = require("./catalog");

const KEY_NAME = "openai-key";
const SESSION_NAME = "admin-session.json";

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(path.dirname(file), 0o700);
  fs.chmodSync(file, 0o600);
}

function readKey(dir) {
  try {
    const value = fs.readFileSync(path.join(dir, KEY_NAME), "utf8").trim();
    return isPlatformKey(value) ? value : "";
  } catch (_) {
    return "";
  }
}

function writeKey(dir, key) {
  const value = String(key || "").trim();
  if (!isPlatformKey(value)) throw new Error("키 형식이 올바르지 않습니다.");
  writePrivate(path.join(dir, KEY_NAME), value);
}

function readSession(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, SESSION_NAME), "utf8"));
    if (!data || typeof data.refreshToken !== "string" || !data.refreshToken) return null;
    return {
      refreshToken: data.refreshToken,
      email: typeof data.email === "string" ? data.email : "",
      localId: typeof data.localId === "string" ? data.localId : "",
    };
  } catch (_) {
    return null;
  }
}

function writeSession(dir, session) {
  if (!session || typeof session.refreshToken !== "string" || !session.refreshToken) {
    throw new Error("로그인 세션이 올바르지 않습니다.");
  }
  writePrivate(path.join(dir, SESSION_NAME), JSON.stringify({
    refreshToken: session.refreshToken,
    email: session.email || "",
    localId: session.localId || "",
  }));
}

function clearSession(dir) {
  fs.rmSync(path.join(dir, SESSION_NAME), { force: true });
}

module.exports = {
  KEY_NAME,
  SESSION_NAME,
  readKey,
  writeKey,
  readSession,
  writeSession,
  clearSession,
};
