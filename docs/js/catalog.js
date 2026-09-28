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
    databaseURL: "https://overlay-lab-default-rtdb.asia-southeast1.firebasedatabase.app",
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

  function targetLangCodes() {
    return languages.map((lang) => lang.code).filter((code) => code !== "ko");
  }

  function defaultSelectedTargets() {
    return languages
      .filter((lang) => lang.code !== "ko" && lang.defaultSelected)
      .map((lang) => lang.code);
  }

  function isChurchId(id) {
    if (typeof id !== "string") return false;
    if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(id)) return false;
    if (BANNED_SEGMENTS.has(id.toLowerCase())) return false;
    return true;
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

  function keywordsFromGlossary(glossary, churchName) {
    const out = [];
    const push = (value) => {
      const text = String(value || "")
        .replace(/[<>\r\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || text.length > 40 || out.includes(text)) return;
      out.push(text);
    };
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

  function sttPrompt(churchName) {
    const name = String(churchName || "교회")
      .replace(/[<>\r\n]/g, " ")
      .trim();
    return `한국 교회 예배입니다. 설교, 기도, 찬송, 광고를 한국어로 받아씁니다. 교회 이름은 ${name}입니다.`;
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
    defaultLiveSettings,
    buildLinks,
    homeLink,
    adminLink,
    platformKeyRel,
    churchIsActive,
    isPlatformKey,
    redactSecrets,
  };
});
