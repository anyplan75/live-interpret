const { firebase, underRoot, isChurchId, isPreacherId, churchIsActive, isPlatformKey, isModelId, redactSecrets, platformKeyRel, defaultModel } = require("./catalog");
const { netFetch } = require("./net-fetch");
const { isSessionFolder: folderOk } = require("./paths");

let idToken = "";

function setIdToken(token) {
  idToken = typeof token === "string" ? token : "";
}

function withAuth(url) {
  if (!idToken) return url;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}auth=${encodeURIComponent(idToken)}`;
}

function assertChurch(id) {
  if (!isChurchId(id)) throw new Error("교회 아이디가 올바르지 않습니다.");
}

function assertFolder(folder) {
  if (!folderOk(folder)) throw new Error("세션 폴더 이름이 올바르지 않습니다.");
}

async function request(method, rel, body) {
  const full = underRoot(rel);
  const url = withAuth(`${firebase.databaseURL.replace(/\/$/, "")}/${full}.json`);
  const res = await netFetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firebase ${res.status}: ${redactSecrets(text).slice(0, 180)}`);
  if (!text || text === "null") return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function get(rel) {
  return request("GET", rel);
}

function set(rel, value) {
  return request("PUT", rel, value);
}

function update(rel, value) {
  return request("PATCH", rel, value);
}

function remove(rel) {
  return request("DELETE", rel);
}

function rowsFromIndex(index) {
  if (!index || typeof index !== "object") return [];
  return Object.entries(index)
    .filter(([id, row]) => isChurchId(id) && row && typeof row === "object")
    .map(([id, row]) => ({
      id,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : id,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
      active: churchIsActive(row),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function activeChurchesFromIndex(index) {
  return rowsFromIndex(index).filter((row) => row.active);
}

async function listChurches() {
  const index = await get("churchIndex");
  const known = rowsFromIndex(index);
  if (known.length) return known.filter((row) => row.active);
  const shallowUrl = withAuth(`${firebase.databaseURL.replace(/\/$/, "")}/${underRoot("churches")}.json?shallow=true`);
  const res = await netFetch(shallowUrl);
  const text = await res.text();
  if (!res.ok) throw new Error(`Firebase ${res.status}: ${redactSecrets(text).slice(0, 180)}`);
  const keys = text && text !== "null" ? JSON.parse(text) : null;
  if (!keys || typeof keys !== "object") return [];
  const churches = [];
  for (const id of Object.keys(keys)) {
    if (!isChurchId(id)) continue;
    const name = await get(`churches/${id}/name`);
    const createdAt = await get(`churches/${id}/createdAt`);
    const active = await get(`churches/${id}/active`);
    if (!churchIsActive(active)) continue;
    churches.push({
      id,
      name: typeof name === "string" && name.trim() ? name.trim() : id,
      createdAt: typeof createdAt === "number" ? createdAt : 0,
      active: true,
    });
  }
  churches.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return churches;
}

async function getPlatformKey() {
  const value = await get(platformKeyRel);
  if (!isPlatformKey(value)) return "";
  return value.trim();
}

async function getAccountLink(uid) {
  if (typeof uid !== "string" || !/^[A-Za-z0-9]{6,128}$/.test(uid)) return null;
  const row = await get(`accounts/${uid}`);
  if (!row || typeof row !== "object" || !isChurchId(row.churchId)) return null;
  return { churchId: row.churchId };
}

async function getChurch(id) {
  assertChurch(id);
  const [name, glossary, createdAt, active, model, account] = await Promise.all([
    get(`churches/${id}/name`),
    get(`churches/${id}/glossary`),
    get(`churches/${id}/createdAt`),
    get(`churches/${id}/active`),
    get(`churches/${id}/model`),
    get(`churches/${id}/account`),
  ]);
  if (typeof name !== "string" || !name.trim()) return null;
  const accountUid = account && typeof account.uid === "string" ? account.uid : "";
  const accountEmail = account && typeof account.email === "string" ? account.email : "";
  return {
    id,
    name: name.trim(),
    createdAt: createdAt || 0,
    glossary: typeof glossary === "string" ? glossary : "",
    model: isModelId(model) ? model : defaultModel,
    accountUid,
    accountEmail,
    active: churchIsActive(active),
  };
}

function preacherRows(raw) {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw)
    .filter(([id, row]) => isPreacherId(id) && row && typeof row === "object")
    .map(([id, row]) => ({
      id,
      name: typeof row.name === "string" ? row.name.trim() : id,
      traits: typeof row.traits === "string" ? row.traits : "",
      corrections: typeof row.corrections === "string" ? row.corrections : "",
      terms: typeof row.terms === "string" ? row.terms : "",
      sermonCount: typeof row.sermonCount === "number" ? row.sermonCount : 0,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

async function listPreachers(churchId) {
  assertChurch(churchId);
  return preacherRows(await get(`churches/${churchId}/preachers`));
}

async function savePreacher(churchId, preacherId, profile) {
  assertChurch(churchId);
  if (!isPreacherId(preacherId)) throw new Error("설교자 아이디가 올바르지 않습니다.");
  const name = profile && typeof profile.name === "string" ? profile.name.trim() : "";
  if (!name) throw new Error("설교자 이름이 없습니다.");
  const next = {
    name,
    traits: profile.traits || "",
    corrections: profile.corrections || "",
    terms: profile.terms || "",
    sermonCount: Number(profile.sermonCount) || 0,
    createdAt: Number(profile.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
  await set(`churches/${churchId}/preachers/${preacherId}`, next);
  return { id: preacherId, ...next };
}

async function saveBulletin(churchId, folder, record) {
  assertChurch(churchId);
  assertFolder(folder);
  await set(`churches/${churchId}/sessions/${folder}/bulletin`, record);
}

async function setSessionText(churchId, folder, lang, text) {
  assertChurch(churchId);
  assertFolder(folder);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang)) throw new Error("언어 코드가 올바르지 않습니다.");
  await set(`churches/${churchId}/sessions/${folder}/texts/${lang}`, text);
}

async function appendSessionSentence(churchId, folder, lang, id, text) {
  assertChurch(churchId);
  assertFolder(folder);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang)) throw new Error("언어 코드가 올바르지 않습니다.");
  await set(`churches/${churchId}/sessions/${folder}/sentences/${lang}/${id}`, text);
}

async function setSessionMeta(churchId, folder, meta) {
  assertChurch(churchId);
  assertFolder(folder);
  await set(`churches/${churchId}/sessionIndex/${folder}`, meta);
}

module.exports = {
  setIdToken,
  withAuth,
  get,
  set,
  update,
  remove,
  listChurches,
  activeChurchesFromIndex,
  getPlatformKey,
  getAccountLink,
  getChurch,
  listPreachers,
  savePreacher,
  saveBulletin,
  setSessionText,
  appendSessionSentence,
  setSessionMeta,
};
