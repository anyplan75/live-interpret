#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
require("../broadcast/lib/load-env");
const { firebase, underRoot, redactSecrets } = require("../broadcast/lib/catalog");

const REPO_ROOT = path.join(__dirname, "..");
const DEFAULT_DATABASE_URL = firebase.databaseURL;
const ROOT = firebase.rootPath;

const MIRROR_RELS = Object.freeze([
  "admin/uid",
  "accounts",
  "churchIndex",
  "deposits",
  "churches",
]);

const OMITTED = Object.freeze([
  "platform/openaiKey",
  "phoneLinks",
  "churches/*/live/subtitles",
]);

const SECRET_KEYS = new Set([
  "openaiKey",
  "password",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "accessToken",
  "access_token",
  "apiKey",
  "api_key",
  "secret",
  "token",
]);

function seoulDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function assertOutsideRepo(dir, repoRoot = REPO_ROOT) {
  const resolved = path.resolve(dir);
  const root = path.resolve(repoRoot);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    throw new Error("보관 폴더는 live-interpret 저장소 밖이어야 합니다.");
  }
}

function archiveDirFromEnv(env = process.env, home = os.homedir(), repoRoot = REPO_ROOT) {
  const given = String(env.LIVE_INTERPRET_ARCHIVE_DIR || "").trim();
  const dir = given
    ? path.resolve(given)
    : path.join(home, "Documents", "live-interpret-private-archive");
  assertOutsideRepo(dir, repoRoot);
  return dir;
}

function databaseUrlFromEnv(env = process.env) {
  const given = String(env.LIVE_INTERPRET_FIREBASE_DATABASE_URL || "").trim();
  const raw = (given || DEFAULT_DATABASE_URL).replace(/\/$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error("LIVE_INTERPRET_FIREBASE_DATABASE_URL 이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:") throw new Error("Firebase 주소는 https 여야 합니다.");
  if (url.username || url.password || url.search) {
    throw new Error("Firebase 주소에 인증 정보를 넣지 않습니다.");
  }
  return url.origin;
}

function redactKnown(text, secrets) {
  let out = redactSecrets(text);
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = stripSecrets(child);
  }
  return out;
}

function sanitizeRecords(records) {
  const source = records && typeof records === "object" && !Array.isArray(records) ? records : {};
  const copy = stripSecrets(source);
  delete copy.phoneLinks;
  delete copy["platform/openaiKey"];
  if (copy.platform && typeof copy.platform === "object") {
    delete copy.platform.openaiKey;
    if (!Object.keys(copy.platform).length) delete copy.platform;
  }
  if (copy.churches && typeof copy.churches === "object") {
    for (const church of Object.values(copy.churches)) {
      if (church && church.live && typeof church.live === "object") delete church.live.subtitles;
    }
  }
  return copy;
}

function replicaDocument({ records, databaseURL, exportedAt = new Date() }) {
  const at = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  const calendarDate = seoulDate(at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) throw new Error("날짜가 올바르지 않습니다.");
  return {
    exportedAt: at.toISOString(),
    calendarDate,
    timezone: "Asia/Seoul",
    source: {
      databaseURL,
      rootPath: ROOT,
    },
    omitted: OMITTED.slice(),
    records: sanitizeRecords(records),
  };
}

function archiveFiles(dir, calendarDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) throw new Error("날짜가 올바르지 않습니다.");
  const folder = path.join(dir, "firebase");
  return {
    folder,
    dated: path.join(folder, `${calendarDate}.json`),
    latest: path.join(folder, "latest.json"),
  };
}

function recordRequestUrl(databaseURL, rel, token) {
  const full = underRoot(rel);
  const url = new URL(`${String(databaseURL).replace(/\/$/, "")}/${full}.json`);
  if (token) url.searchParams.set("auth", token);
  return url;
}

async function exchangeRefreshToken(apiKey, refreshToken, fetchImpl, secrets) {
  const url = new URL("https://securetoken.googleapis.com/v1/token");
  url.searchParams.set("key", apiKey);
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch (_) {
    throw new Error("로그인 갱신 연결에 실패했습니다.");
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`로그인 갱신 ${res.status}: ${redactKnown(text, secrets).slice(0, 180)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new Error("로그인 갱신 응답을 읽지 못했습니다.");
  }
  if (!parsed || typeof parsed.id_token !== "string" || !parsed.id_token) {
    throw new Error("갱신 응답에 ID 토큰이 없습니다.");
  }
  return parsed.id_token;
}

async function resolveIdToken(env, fetchImpl) {
  const direct = String(env.LIVE_INTERPRET_FIREBASE_ID_TOKEN || "").trim();
  const refresh = String(env.LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN || "").trim();
  const apiKey = String(env.FIREBASE_API_KEY || "").trim();
  const secrets = [direct, refresh, apiKey];
  if (refresh || apiKey) {
    if (!refresh || !apiKey) {
      throw new Error("LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN 과 FIREBASE_API_KEY 는 함께 필요합니다.");
    }
    return {
      idToken: await exchangeRefreshToken(apiKey, refresh, fetchImpl, secrets),
      secrets,
    };
  }
  if (!direct) throw new Error("LIVE_INTERPRET_FIREBASE_ID_TOKEN 또는 갱신 토큰 환경 변수가 없습니다.");
  return { idToken: direct, secrets };
}

async function fetchRecord(databaseURL, rel, token, fetchImpl, secrets) {
  const url = recordRequestUrl(databaseURL, rel, token);
  let res;
  try {
    res = await fetchImpl(url, { method: "GET" });
  } catch (_) {
    throw new Error(`Firebase 연결 실패: ${rel}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Firebase ${res.status} ${rel}: ${redactKnown(text, secrets).slice(0, 180)}`);
  }
  if (!text || text === "null") return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`Firebase 응답을 읽지 못했습니다: ${rel}`);
  }
}

function assertReplicaHasNoSecrets(text, secrets) {
  for (const secret of secrets) {
    if (secret && text.includes(secret)) {
      throw new Error("복제 파일에 인증 값이 들어가 쓰기를 멈췄습니다.");
    }
  }
}

function writeReplica(files, text) {
  fs.mkdirSync(path.dirname(files.folder), { recursive: true });
  fs.mkdirSync(files.folder, { recursive: true });
  try {
    fs.chmodSync(path.dirname(files.folder), 0o700);
    fs.chmodSync(files.folder, 0o700);
  } catch (_) {
    /* 권한을 바꾸지 못하는 디스크에서는 파일 모드만 맞춥니다. */
  }
  fs.writeFileSync(files.dated, text, { mode: 0o600 });
  fs.writeFileSync(files.latest, text, { mode: 0o600 });
  fs.chmodSync(files.dated, 0o600);
  fs.chmodSync(files.latest, 0o600);
}

async function exportMirror({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  write = true,
  home = os.homedir(),
  repoRoot = REPO_ROOT,
} = {}) {
  const databaseURL = databaseUrlFromEnv(env);
  const dir = archiveDirFromEnv(env, home, repoRoot);
  const { idToken, secrets } = await resolveIdToken(env, fetchImpl);
  const records = {};
  for (const rel of MIRROR_RELS) {
    records[rel] = await fetchRecord(databaseURL, rel, idToken, fetchImpl, secrets);
  }
  const doc = replicaDocument({ records, databaseURL, exportedAt: now });
  const files = archiveFiles(dir, doc.calendarDate);
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  assertReplicaHasNoSecrets(text, secrets);
  if (write) writeReplica(files, text);
  return { doc, files, text };
}

async function main() {
  const { doc, files } = await exportMirror();
  console.log(files.dated);
  console.log(files.latest);
  console.log(doc.calendarDate);
}

module.exports = {
  MIRROR_RELS,
  OMITTED,
  ROOT,
  DEFAULT_DATABASE_URL,
  REPO_ROOT,
  seoulDate,
  assertOutsideRepo,
  archiveDirFromEnv,
  databaseUrlFromEnv,
  stripSecrets,
  sanitizeRecords,
  replicaDocument,
  archiveFiles,
  recordRequestUrl,
  redactKnown,
  resolveIdToken,
  exportMirror,
};

if (require.main === module) {
  main().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    console.error(redactSecrets(message));
    process.exit(1);
  });
}
