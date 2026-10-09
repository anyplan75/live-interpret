/**
 * 언어 목록, 예배 용어집, Firebase 경로 가드, 링크.
 * 브라우저 스크립트와 Node require 둘 다 동작합니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.catalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function loadLanguages() {
    let raw;
    if (typeof LI_LANGUAGES !== "undefined") raw = LI_LANGUAGES;
    else if (typeof globalThis !== "undefined" && globalThis.LI_LANGUAGES) raw = globalThis.LI_LANGUAGES;
    else {
      const fs = require("fs");
      const vm = require("vm");
      const path = require("path");
      const sandbox = {};
      vm.createContext(sandbox);
      vm.runInContext(
        fs.readFileSync(path.join(__dirname, "languages.js"), "utf8"),
        sandbox
      );
      raw = sandbox.LI_LANGUAGES;
    }
    return JSON.parse(JSON.stringify(raw));
  }

  const languages = loadLanguages();
  const langByCode = Object.fromEntries(languages.map((lang) => [lang.code, lang]));

  const firebase = {
    apiKey: "AIzaSyDsYIaoKxRjNUUOnQvwyYLpPRvNy0WLRUM",
    authDomain: "live-interpret-db65e.firebaseapp.com",
    databaseURL: "https://live-interpret-db65e-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "live-interpret-db65e",
    storageBucket: "live-interpret-db65e.firebasestorage.app",
    messagingSenderId: "638772209952",
    appId: "1:638772209952:web:d56749b35c04b395904f45",
    rootPath: "live-interpret",
  };
  const pagesBase = "https://anyplan75.github.io/live-interpret";

  const timing = {
    livePushMinInterval: 250,
    silenceFlushMs: 3200,
    silenceForceFlushMs: 6500,
    minFlushChars: 8,
  };

  const defaultModel = "gpt-4o-mini";
  const models = [
    { id: "gpt-4o-mini", label: "gpt-4o-mini (빠름·저렴)" },
    { id: "gpt-4o", label: "gpt-4o (고품질)" },
  ];

  const BANNED_SEGMENTS = new Set(["cheil", "jifc"]);
  const platformKeyRel = "platform/openaiKey";
  const adminUidRel = "admin/uid";
  const accountsRel = "accounts";

  function targetLangCodes() {
    return languages.map((lang) => lang.code).filter((code) => code !== "ko");
  }

  function defaultSelectedTargets() {
    return languages
      .filter((lang) => lang.code !== "ko" && lang.defaultSelected)
      .map((lang) => lang.code);
  }

  function isRecordId(id) {
    if (typeof id !== "string") return false;
    if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(id)) return false;
    if (BANNED_SEGMENTS.has(id.toLowerCase())) return false;
    return true;
  }

  function isChurchId(id) {
    return isRecordId(id);
  }

  function isPreacherId(id) {
    return isRecordId(id);
  }

  function makeChurchId(name) {
    const slug = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[.#$[\]/]/g, "")
      .replace(/[^\p{L}\p{N}_-]/gu, "")
      .slice(0, 40);
    const rand = Math.random().toString(36).slice(2, 8);
    let id = `${slug || "church"}-${rand}`;
    if (!isChurchId(id)) id = `church-${rand}`;
    return id;
  }

  function makePreacherId(name) {
    const slug = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[.#$[\]/]/g, "")
      .replace(/[^\p{L}\p{N}_-]/gu, "")
      .slice(0, 40);
    const rand = Math.random().toString(36).slice(2, 8);
    let id = `${slug || "preacher"}-${rand}`;
    if (!isPreacherId(id)) id = `preacher-${rand}`;
    return id;
  }

  function churchIdFromQuery(search) {
    const id = new URLSearchParams(search || "").get("church") || "";
    return isChurchId(id) ? id : "";
  }

  function assertFirebasePath(input) {
    const clean = String(input || "").replace(/^\/+|\/+$/g, "");
    if (!clean) throw new Error("빈 Firebase 경로");
    const parts = clean.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("잘못된 Firebase 경로");
    }
    if (parts[0] !== firebase.rootPath) {
      throw new Error("live-interpret 이외의 Firebase 경로는 쓸 수 없습니다.");
    }
    if (parts.some((part) => BANNED_SEGMENTS.has(part.toLowerCase()))) {
      throw new Error("cheil 또는 jifc 경로는 쓸 수 없습니다.");
    }
    return clean;
  }

  function underRoot(rel) {
    let clean = String(rel || "").replace(/^\/+|\/+$/g, "");
    if (clean === firebase.rootPath || clean.startsWith(`${firebase.rootPath}/`)) {
      clean = clean.slice(firebase.rootPath.length).replace(/^\//, "");
    }
    if (!clean) throw new Error("빈 Firebase 경로");
    return assertFirebasePath(`${firebase.rootPath}/${clean}`);
  }

  function defaultGlossary(churchName) {
    const name = String(churchName || "이 교회").trim() || "이 교회";
    return [
      "[교회·예배 용어 — STT가 틀리기 쉬움. 아래처럼 교정]",
      `- ${name} (이 교회 이름. 비슷하게 들리면 이 이름으로 교정)`,
      "- 수요 기도회 (수여 기도회 X)",
      "- 항존직 (항종직 X), 권사회실 (건사회실·건사 회실 X)",
      "- 피택자, 입교, 세례, 봉헌, 교독, 축도, 아멘",
      "- 치유 (추위 X, 맥락이 병·회복일 때)",
      "- 이른비·늦은비 (이름비 X)",
      "- 열방 (열반 X, 선교·축도 맥락)",
      "- 여짜오되 (여짜오대 X)",
      "- 내일은 (미래는 X, 일정 안내 맥락)",
      "- 찬송/찬양 가사는 가능하면 널리 알려진 가사·운율에 맞게 복원",
      "- 성경 고유명사·구절 번호는 표준 표기 유지",
    ].join("\n");
  }

  function keywordsFromGlossary(glossary, churchName, extras) {
    const out = [];
    const push = (value) => {
      const text = String(value || "")
        .replace(/[<>\r\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || text.length > 40 || out.includes(text)) return;
      out.push(text);
    };
    (Array.isArray(extras) ? extras : []).forEach(push);
    push(churchName);
    String(glossary || "")
      .split("\n")
      .forEach((line) => {
        const match = line.match(/^-\s*([^(/（]+)/);
        if (match) push(match[1]);
      });
    ["아멘", "축도", "세례", "입교", "봉헌", "교독", "항존직", "수요 기도회"].forEach(push);
    return out.slice(0, 30);
  }

  function isGuidancePiece(text) {
    const folded = String(text || "").replace(/\s+/g, "");
    if (!folded) return false;
    if (folded.includes("한국교회예배")) return true;
    if (folded.includes("받아씁")) return true;
    if (folded.includes("설교,기도,찬송") || folded.includes("설교기도찬송")) return true;
    if (/^교회이름은.+입니다[.]?$/.test(folded)) return true;
    if (folded.length < 80 && (folded.includes("설교자:") || folded.includes("말투:"))) return true;
    if (folded.includes("말끊는위치")) return true;
    if (folded.includes("정확도교정")) return true;
    if (folded.includes("자연스러움교정")) return true;
    if (folded.includes("뒤쉼") && folded.includes("회")) return true;
    return false;
  }

  function stripGuidance(text) {
    let raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    raw = raw.replace(/\s*(?:말 끊는 위치|정확도 교정|자연스러움 교정)[\s\S]*$/, "").trim();
    const parts = raw.split(/(?<=[.?!])\s+/);
    return parts.filter((part) => !isGuidancePiece(part)).join(" ").trim();
  }

  function isGuidanceEcho(text) {
    const raw = String(text || "").trim();
    if (!raw) return false;
    return stripGuidance(raw) === "";
  }

  function sttPrompt(churchName, extra) {
    const name = String(churchName || "교회")
      .replace(/[<>\r\n]/g, " ")
      .trim();
    const base = `한국 교회 예배입니다. 설교, 기도, 찬송, 광고를 한국어로 받아씁니다. 교회 이름은 ${name}입니다.`;
    const more = String(extra || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(설교자:|용어:|찬송|찬양|성경:|설교 제목:|주보의 설교자:)/.test(line))
      .join("\n");
    const text = more ? `${base}\n${more}` : base;
    return text.length <= 1024 ? text : text.slice(0, 1024);
  }

  function isModelId(id) {
    return models.some((model) => model.id === id);
  }

  function clipLine(value, max) {
    const text = String(value || "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    return text.slice(0, max);
  }

  function sessionContextText(parts) {
    const bulletin = parts && parts.bulletin ? parts.bulletin : null;
    const preacher = parts && parts.preacher ? parts.preacher : null;
    const lines = [];
    if (preacher && preacher.name) lines.push(`설교자: ${clipLine(preacher.name, 80)}`);
    if (preacher && preacher.traits) lines.push(`말투: ${clipLine(preacher.traits, 400)}`);
    if (preacher && preacher.corrections) lines.push(`교정: ${clipLine(preacher.corrections, 500)}`);
    if (preacher && preacher.terms) lines.push(`용어: ${clipLine(preacher.terms, 500)}`);
    if (preacher && preacher.pausePoints) lines.push(`말 끊는 위치(문장이 이어짐): ${clipLine(preacher.pausePoints, 300)}`);
    if (preacher && preacher.accuracy) lines.push(`정확도 교정: ${clipLine(preacher.accuracy, 450)}`);
    if (preacher && preacher.naturalness) lines.push(`자연스러움 교정: ${clipLine(preacher.naturalness, 450)}`);
    if (bulletin) {
      const hymns = [].concat(bulletin.hymnNumbers || []).map((item) => clipLine(item, 40)).filter(Boolean);
      const songs = [].concat(bulletin.songTitles || []).map((item) => clipLine(item, 80)).filter(Boolean);
      if (hymns.length) lines.push(`찬송 번호: ${hymns.join(", ")}`);
      if (songs.length) lines.push(`찬양·찬송 제목: ${songs.join(", ")}`);
      if (bulletin.scripture) lines.push(`성경: ${clipLine(bulletin.scripture, 300)}`);
      if (bulletin.sermonTitle) lines.push(`설교 제목: ${clipLine(bulletin.sermonTitle, 200)}`);
      if (bulletin.preacherName) lines.push(`주보의 설교자: ${clipLine(bulletin.preacherName, 80)}`);
      if (bulletin.extractedText) lines.push(`주보 본문: ${clipLine(bulletin.extractedText, 800)}`);
    }
    return lines.join("\n").slice(0, 3600);
  }

  function contextKeywords(bulletin, preacher) {
    const words = [];
    if (bulletin) {
      [].concat(bulletin.songTitles || []).forEach((item) => words.push(item));
      [].concat(bulletin.hymnNumbers || []).forEach((item) => words.push(item));
      if (bulletin.sermonTitle) words.push(bulletin.sermonTitle);
      if (bulletin.preacherName) words.push(bulletin.preacherName);
      if (bulletin.scripture) words.push(bulletin.scripture);
    }
    if (preacher && preacher.name) words.push(preacher.name);
    if (preacher && preacher.terms) String(preacher.terms).split("\n").forEach((line) => words.push(line));
    if (preacher && preacher.accuracy) {
      String(preacher.accuracy).split("\n").forEach((line) => {
        const parts = line.split(/\s*(?:→|->)\s*/);
        const right = parts.length === 2 ? parts[1].replace(/\([^)]*\)\s*$/, "").replace(/["'“”]/g, "").trim() : "";
        if (right && right.length <= 20 && /[가-힣]/.test(right)) words.push(right);
      });
    }
    return words;
  }

  function sanitizeStyle(input) {
    const src = input && typeof input === "object" ? input : {};
    const layouts = new Set(["bottom", "top", "left", "right"]);
    const aligns = new Set(["left", "center", "right"]);
    const color = (value, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : fallback);
    const num = (value, fallback, min, max) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, parsed));
    };
    const fonts = {};
    languages.forEach((lang) => {
      const row = src.fonts && src.fonts[lang.code] ? src.fonts[lang.code] : {};
      fonts[lang.code] = {
        fontSize: num(row.fontSize, lang.defaultSize, 8, 240),
        letterSpacing: num(row.letterSpacing, lang.defaultSpacing, -20, 80),
      };
    });
    return {
      global: {
        layout: layouts.has(src.layout) ? src.layout : "bottom",
        align: aligns.has(src.align) ? src.align : "center",
        color: color(src.color, "#ffffff"),
        bgColor: color(src.bgColor, "#000000"),
        bgOpacity: num(src.bgOpacity, 0.7, 0, 1),
      },
      fonts,
    };
  }

  function styleFromSettings(settings) {
    const global = (settings && settings.global) || {};
    const fonts = {};
    languages.forEach((lang) => {
      const row = (settings && settings[lang.code]) || {};
      fonts[lang.code] = {
        fontSize: row.fontSize,
        letterSpacing: row.letterSpacing,
      };
    });
    return sanitizeStyle({
      layout: global.layout,
      align: global.align,
      color: global.color,
      bgColor: global.bgColor,
      bgOpacity: global.bgOpacity,
      fonts,
    });
  }

  function applyStyleToSettings(existing, style) {
    const clean = sanitizeStyle(style);
    const next = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : defaultLiveSettings();
    next._timestamp = Date.now();
    next.global = { ...(next.global || {}), ...clean.global };
    Object.entries(clean.fonts).forEach(([code, font]) => {
      next[code] = { ...(next[code] || {}), ...font };
    });
    return next;
  }

  function defaultLiveSettings() {
    const active = ["ko", ...defaultSelectedTargets()];
    const settings = {
      _timestamp: Date.now(),
      activeTargets: active,
      global: {
        layout: "bottom",
        align: "center",
        color: "#ffffff",
        bgColor: "#000000",
        bgOpacity: 0.7,
      },
    };
    languages.forEach((lang) => {
      settings[lang.code] = {
        show: active.includes(lang.code),
        fontSize: lang.defaultSize,
        letterSpacing: lang.defaultSpacing,
      };
    });
    return settings;
  }

  function buildLinks(base, churchId, codes) {
    const root = String(base || pagesBase).replace(/\/$/, "");
    const id = encodeURIComponent(churchId);
    const list = Array.isArray(codes) && codes.length ? codes : ["ko", ...defaultSelectedTargets()];
    return list.filter((code) => langByCode[code]).map((code) => {
      const meta = langByCode[code];
      const lang = encodeURIComponent(code);
      return {
        code,
        name: meta.name,
        nameEn: meta.nameEn,
        flag: meta.flag,
        listen: `${root}/listen.html?church=${id}&lang=${lang}`,
        overlay: `${root}/overlay.html?church=${id}&lang=${lang}`,
      };
    });
  }

  function homeLink(base, churchId) {
    const root = String(base || pagesBase).replace(/\/$/, "");
    return `${root}/index.html?church=${encodeURIComponent(churchId)}`;
  }

  function adminLink(base, churchId) {
    const root = String(base || pagesBase).replace(/\/$/, "");
    return `${root}/admin.html?church=${encodeURIComponent(churchId)}`;
  }

  function churchIsActive(value) {
    if (value === false) return false;
    if (value == null || value === true) return true;
    if (typeof value !== "object") return true;
    if (!Object.prototype.hasOwnProperty.call(value, "active")) return true;
    return value.active !== false;
  }

  function isPlatformKey(value) {
    return typeof value === "string" && /^sk-[A-Za-z0-9_-]{10,}$/.test(value.trim());
  }

  function redactSecrets(text) {
    return String(text == null ? "" : text).replace(/sk-[A-Za-z0-9_-]{4,}/g, "[redacted]");
  }

  function canClaimAdmin(existingUid) {
    return existingUid == null || existingUid === "";
  }

  function isCurrentAdmin(existingUid, uid) {
    return typeof existingUid === "string" && !!existingUid && existingUid === uid;
  }

  function validAdminEmail(email) {
    return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function validAdminPassword(password) {
    return typeof password === "string" && password.length >= 6 && password.length <= 200;
  }

  function authErrorMessage(err) {
    const code = err && err.code ? String(err.code) : "";
    const message = err && err.message ? String(err.message) : String(err || "");
    const text = redactSecrets(`${code} ${message}`);
    if (/unauthorized-domain/i.test(text)) {
      return "이 주소는 Firebase 로그인 허용 도메인에 없습니다. Authentication → Settings → Authorized domains 에 anyplan75.github.io 를 추가해 주세요.";
    }
    if (/configuration-not-found|CONFIGURATION_NOT_FOUND/i.test(text)) {
      return "Firebase 이메일 로그인이 아직 꺼져 있습니다. 콘솔에서 Authentication 을 켜 주세요.";
    }
    if (/operation-not-allowed/i.test(text)) {
      return "이메일 로그인이 꺼져 있습니다. 콘솔에서 이메일/비밀번호를 켜 주세요.";
    }
    if (/email-already-in-use/i.test(text)) {
      return "이미 등록된 이메일입니다. 로그인하세요.";
    }
    if (/weak-password|WEAK_PASSWORD|PASSWORD_DOES_NOT_MEET/i.test(text)) {
      return "비밀번호는 6자 이상이어야 합니다.";
    }
    if (/invalid-credential|wrong-password|user-not-found|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_LOGIN/i.test(text)) {
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    }
    if (/network-request-failed|Failed to fetch|NetworkError/i.test(text)) {
      return "네트워크에 연결하지 못했습니다.";
    }
    return redactSecrets(message || code || "로그인에 실패했습니다.");
  }

  return {
    languages,
    langByCode,
    firebase,
    pagesBase,
    timing,
    defaultModel,
    models,
    targetLangCodes,
    defaultSelectedTargets,
    isChurchId,
    makeChurchId,
    churchIdFromQuery,
    assertFirebasePath,
    underRoot,
    defaultGlossary,
    keywordsFromGlossary,
    sttPrompt,
    isGuidanceEcho,
    stripGuidance,
    defaultLiveSettings,
    buildLinks,
    homeLink,
    adminLink,
    platformKeyRel,
    adminUidRel,
    accountsRel,
    isPreacherId,
    makePreacherId,
    isModelId,
    sessionContextText,
    contextKeywords,
    sanitizeStyle,
    styleFromSettings,
    applyStyleToSettings,
    churchIsActive,
    isPlatformKey,
    redactSecrets,
    canClaimAdmin,
    isCurrentAdmin,
    validAdminEmail,
    validAdminPassword,
    authErrorMessage,
  };
});
