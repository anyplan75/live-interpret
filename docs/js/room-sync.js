/**
 * 방송실과 웹 통역 설정이 같은 계정 기록을 주고받습니다.
 * 브라우저와 Node 둘 다 이 파일을 부릅니다.
 * 비밀번호와 자막 글은 넣지 않습니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.roomSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PHONE_KEY = /^p:[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
  const MIC_KEY = /^c:([0-9]|1[0-5])$/;
  const LANG = /^[a-z]{2,3}(?:-[A-Za-z]{2})?$/;

  function cleanName(value) {
    return String(value || "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function cleanLang(value, fallback) {
    const code = String(value || "");
    return LANG.test(code) ? code : fallback;
  }

  function cleanInput(item) {
    const key = String(item && item.key || "");
    if (!PHONE_KEY.test(key) && !MIC_KEY.test(key)) return null;
    return {
      key,
      live: !(item && item.live === false),
      name: cleanName(item && item.name),
      showName: !(item && item.showName === false),
    };
  }

  function cleanDesired(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const spoken = cleanLang(src.spoken, "ko");
    const targets = [];
    (Array.isArray(src.targets) ? src.targets : []).forEach((code) => {
      const lang = cleanLang(code, "");
      if (!lang || lang === spoken || targets.includes(lang) || targets.length >= 12) return;
      targets.push(lang);
    });
    const inputs = [];
    (Array.isArray(src.inputs) ? src.inputs : []).slice(0, 16).forEach((item) => {
      const row = cleanInput(item);
      if (row && !inputs.some((kept) => kept.key === row.key)) inputs.push(row);
    });
    return {
      rev: Math.max(0, Math.round(Number(src.rev) || 0)),
      running: src.running === true,
      spoken,
      targets,
      showName: src.showName !== false,
      inputs,
    };
  }

  function actionsFor(appliedRev, desired) {
    const next = cleanDesired(desired);
    const previous = Math.max(0, Math.round(Number(appliedRev) || 0));
    if (!next.rev || next.rev === previous) return { rev: previous, actions: [] };
    const actions = [
      { type: "showName", on: next.showName },
      { type: "languages", spoken: next.spoken, targets: next.targets.slice() },
      { type: "running", on: next.running },
    ];
    next.inputs.forEach((input) => actions.push({ type: "input", ...input }));
    return { rev: next.rev, actions };
  }

  function withRev(current, patch) {
    const base = cleanDesired(current);
    const extra = patch && typeof patch === "object" ? patch : {};
    return cleanDesired({
      ...base,
      ...extra,
      inputs: Object.prototype.hasOwnProperty.call(extra, "inputs") ? extra.inputs : base.inputs,
      rev: base.rev + 1,
    });
  }

  function roundLevel(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.round(Math.min(1, number) * 100) / 100;
  }

  function cleanStatusInput(item) {
    const row = cleanInput(item);
    if (!row) return null;
    const kind = item && item.kind === "phone" ? "phone" : "mic";
    const code = kind === "phone" ? row.key.slice(2) : "";
    const joinUrl = typeof (item && item.joinUrl) === "string" && /^https:\/\/[^\s]+$/.test(item.joinUrl)
      ? item.joinUrl.slice(0, 300)
      : "";
    return {
      ...row,
      kind,
      title: cleanName(item && item.title) || (kind === "phone" ? "휴대폰" : "마이크"),
      level: roundLevel(item && item.level),
      connected: !!(item && item.connected),
      joining: !!(item && item.joining) && !(item && item.connected),
      code,
      joinUrl,
    };
  }

  function publicStatus(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const spoken = cleanLang(src.spoken, "ko");
    const targets = [];
    (Array.isArray(src.targets) ? src.targets : []).forEach((code) => {
      const lang = cleanLang(code, "");
      if (lang && lang !== spoken && !targets.includes(lang) && targets.length < 12) targets.push(lang);
    });
    const inputs = [];
    (Array.isArray(src.inputs) ? src.inputs : []).slice(0, 16).forEach((item) => {
      const row = cleanStatusInput(item);
      if (row) inputs.push(row);
    });
    return {
      updatedAt: Math.max(0, Math.round(Number(src.updatedAt) || 0)),
      online: src.online !== false,
      running: src.running === true,
      balanceLabel: cleanName(src.balanceLabel) || "0원",
      remainingLabel: cleanName(src.remainingLabel) || "남은 시간 없음",
      sessionLabel: cleanName(src.sessionLabel) || "이번 0원",
      notice: cleanName(src.notice),
      showName: src.showName !== false,
      spoken,
      targets,
      inputs,
    };
  }

  function setAt(root, path, data, merge) {
    const parts = String(path || "/").split("/").filter(Boolean);
    if (!parts.length) {
      if (merge && root && data && typeof root === "object" && typeof data === "object" && !Array.isArray(root) && !Array.isArray(data)) {
        return { ...root, ...data };
      }
      return data;
    }
    const clone = Array.isArray(root) ? root.slice() : { ...(root && typeof root === "object" ? root : {}) };
    let cursor = clone;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      const prev = cursor[key];
      const next = prev && typeof prev === "object" ? (Array.isArray(prev) ? prev.slice() : { ...prev }) : {};
      cursor[key] = next;
      cursor = next;
    }
    const last = parts[parts.length - 1];
    const prev = cursor[last];
    if (merge && prev && data && typeof prev === "object" && typeof data === "object" && !Array.isArray(prev) && !Array.isArray(data)) {
      cursor[last] = { ...prev, ...data };
    } else cursor[last] = data;
    return clone;
  }

  function applyStreamEvent(current, eventName, payload) {
    const body = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!body || typeof body !== "object") return current;
    const merge = eventName === "patch";
    return setAt(current, body.path || "/", body.data, merge);
  }

  return {
    cleanDesired,
    actionsFor,
    withRev,
    publicStatus,
    applyStreamEvent,
  };
});
