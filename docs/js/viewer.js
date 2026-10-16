/**
 * OBS 오버레이와 성도 자막.
 * 문장 id 가 같으면 같은 줄을 고치고, 임시 인식은 흐리게 표시합니다.
 */
window.LI = window.LI || {};

LI.viewer = (() => {
  function queryLang(fallback = "en") {
    const lang = new URLSearchParams(location.search).get("lang") || fallback;
    return LI.catalog.langByCode[lang] ? lang : fallback;
  }

  function hexToRgba(hex, opacity) {
    const parts = rgbFromHex(hex);
    return `rgba(${parts.r}, ${parts.g}, ${parts.b}, ${opacity})`;
  }

  function rgbFromHex(hex) {
    const h = String(hex || "#000000").replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return {
      r: Number.isFinite(r) ? r : 0,
      g: Number.isFinite(g) ? g : 0,
      b: Number.isFinite(b) ? b : 0,
    };
  }

  function useSubtitleFont(id, langCode) {
    const face = LI.catalog.subtitleFont(id, langCode);
    const head = document.head || document.documentElement;
    let link = document.querySelector("link[data-subtitle-font]");
    if (link && link.dataset.subtitleFont === face.id) return face.family;
    if (link) link.remove();
    if (/fonts\.(googleapis|gstatic)\.com/.test(face.href)) {
      ["https://fonts.googleapis.com", "https://fonts.gstatic.com"].forEach((origin) => {
        if (document.querySelector(`link[data-font-preconnect="${origin}"]`)) return;
        const pre = document.createElement("link");
        pre.rel = "preconnect";
        pre.href = origin;
        if (origin.includes("gstatic")) pre.crossOrigin = "anonymous";
        pre.dataset.fontPreconnect = origin;
        head.appendChild(pre);
      });
    }
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = face.href;
    link.dataset.subtitleFont = face.id;
    head.appendChild(link);
    return face.family;
  }

  function paintShade(container, hex, opacity) {
    const parts = rgbFromHex(hex);
    const alpha = Number(opacity);
    container.style.setProperty("--shade-r", String(parts.r));
    container.style.setProperty("--shade-g", String(parts.g));
    container.style.setProperty("--shade-b", String(parts.b));
    container.style.setProperty("--shade-a", String(Number.isFinite(alpha) ? alpha : 0.7));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function lineHtml(line) {
    const body = escapeHtml(line.text || "");
    if (!line.name) return body;
    return `<span class="speaker">${escapeHtml(line.name)}:</span> ${body}`;
  }

  function captionEntries(row) {
    if (LI.speakerLines && LI.speakerLines.entries) return LI.speakerLines.entries(row);
    if (!row) return [];
    const text = typeof row === "object" ? row.text : row;
    if (!String(text || "").trim()) return [];
    return [{
      id: typeof row === "object" ? row.id : 0,
      text: String(text || ""),
      name: "",
      isFinal: typeof row === "object" && row.isFinal !== undefined ? row.isFinal : true,
    }];
  }

  function upsertCaption(list, entry, maxLines) {
    const next = {
      id: entry.id,
      text: entry.text,
      name: entry.name || "",
      isFinal: entry.isFinal !== false,
    };
    const existing = list.findIndex((line) => line.id === next.id);
    if (existing !== -1) list[existing] = next;
    else {
      list.push(next);
      while (list.length > maxLines) list.shift();
    }
  }

  function activeLangCodesFromSettings(settings) {
    const fallback = ["ko", ...LI.catalog.defaultSelectedTargets()];
    if (!settings) return fallback;
    if (Array.isArray(settings.activeTargets) && settings.activeTargets.length) {
      const codes = settings.activeTargets.filter((code) => LI.catalog.langByCode[code]);
      return codes.length ? codes : fallback;
    }
    const active = LI.catalog.languages
      .filter((lang) => settings[lang.code] && settings[lang.code].show === true)
      .map((lang) => lang.code);
    return active.length ? active : fallback;
  }

  function fillLangSelect(selectEl, selected, allowedCodes) {
    let langs = LI.catalog.languages;
    if (Array.isArray(allowedCodes)) {
      const allow = new Set(allowedCodes);
      langs = LI.catalog.languages.filter((lang) => allow.has(lang.code));
    }
    if (!langs.length) langs = LI.catalog.languages.slice(0, 1);
    const preferred = langs.some((lang) => lang.code === selected) ? selected : langs[0].code;
    selectEl.innerHTML = langs
      .map((lang) => {
        const sel = lang.code === preferred ? " selected" : "";
        return `<option value="${lang.code}"${sel}>${lang.flag} ${lang.name} (${lang.nameEn})</option>`;
      })
      .join("");
    return preferred;
  }

  function startOverlay(opts) {
    const lang = opts.lang;
    const container = opts.container;
    const subtitle = opts.subtitle;
    let lastTime = 0;
    let subtitleLines = [];
    let maxLines = 3;
    const meta = LI.catalog.langByCode[lang];
    subtitle.textContent = meta ? meta.waiting : "Waiting...";
    subtitle.style.fontFamily = useSubtitleFont(undefined, lang);

    function applySettings(settings) {
      if (!settings) return;
      if (settings.global) {
        const layout = settings.global.layout || "bottom";
        container.className = `layout-${layout}`;
        maxLines = layout === "top" || layout === "bottom" ? 3 : 15;
        subtitle.style.textAlign = settings.global.align || "center";
        subtitle.style.color = settings.global.color || "#ffffff";
        const opacity = settings.global.bgOpacity !== undefined ? settings.global.bgOpacity : 0.7;
        paintShade(container, settings.global.bgColor || "#000000", opacity);
        subtitle.style.background = "transparent";
      }
      const langSetting = settings[lang];
      subtitle.style.fontFamily = useSubtitleFont(langSetting && langSetting.font, lang);
      if (langSetting) {
        container.style.display = langSetting.show === false ? "none" : "flex";
        if (langSetting.fontSize) subtitle.style.fontSize = `${langSetting.fontSize}px`;
        if (langSetting.letterSpacing !== undefined) {
          subtitle.style.letterSpacing = `${langSetting.letterSpacing}px`;
        }
      }
    }

    function applySubtitles(subtitles) {
      if (!subtitles || subtitles._timestamp === lastTime) return;
      lastTime = subtitles._timestamp;
      const row = subtitles[lang];
      if (!row) return;
      const incoming = captionEntries(row);
      if (!incoming.length) return;
      incoming.forEach((entry) => upsertCaption(subtitleLines, entry, maxLines));
      subtitle.innerHTML = subtitleLines
        .map((line) => {
          const cls = line.isFinal === false ? "line interim" : "line";
          return `<span class="${cls}">${lineHtml(line)}</span>`;
        })
        .join("");
    }

    let unsubSettings = null;
    let unsubSubs = null;
    let stopped = false;
    function stop() {
      stopped = true;
      if (unsubSettings) unsubSettings();
      if (unsubSubs) unsubSubs();
      unsubSettings = null;
      unsubSubs = null;
      subtitleLines = [];
      lastTime = 0;
    }

    LI.db.init().then(() => {
      if (stopped) return;
      unsubSettings = LI.db.onValue("settings", applySettings);
      unsubSubs = LI.db.onValue("subtitles", applySubtitles);
    }).catch((err) => {
      subtitle.textContent = LI.catalog.redactSecrets(err.message || "연결 실패");
    });
    return { stop };
  }

  function startPrompter(opts) {
    const langSelect = opts.langSelect;
    const scriptBox = opts.scriptBox;
    const maxLines = opts.maxLines || 50;
    let lastTime = 0;
    let lines = [];
    let currentLang = langSelect.value;
    let latestPayload = null;

    function clearScreen(message) {
      lines = [];
      scriptBox.innerHTML = `<p class="waiting">${escapeHtml(message)}</p>`;
    }

    function renderLines() {
      scriptBox.innerHTML = lines
        .map((line) => {
          const cls = line.isFinal === false ? "interim" : "";
          return `<p class="${cls}">${lineHtml(line)}</p>`;
        })
        .join("");
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }

    function ingestLatestForLang(force = false) {
      if (!latestPayload) return false;
      const row = latestPayload[currentLang];
      if (!row) return false;
      const incoming = captionEntries(row);
      if (!incoming.length) return false;
      if (force) {
        lines = incoming.map((entry) => ({
          id: entry.id,
          text: entry.text,
          name: entry.name || "",
          isFinal: entry.isFinal !== false,
        }));
        renderLines();
        return true;
      }
      incoming.forEach((entry) => upsertCaption(lines, entry, maxLines));
      renderLines();
      return true;
    }

    function onLangChange() {
      currentLang = langSelect.value;
      if (ingestLatestForLang(true)) {
        lastTime = latestPayload ? latestPayload._timestamp : 0;
      } else {
        lastTime = 0;
        clearScreen("언어가 변경되었습니다. 다음 문장을 기다리는 중입니다...");
      }
    }
    langSelect.addEventListener("change", onLangChange);

    function applySubtitles(subtitles) {
      if (!subtitles) return;
      latestPayload = subtitles;
      if (subtitles._timestamp === lastTime) return;
      lastTime = subtitles._timestamp;
      ingestLatestForLang(false);
    }

    let unsub = null;
    let stopped = false;
    function stop() {
      stopped = true;
      langSelect.removeEventListener("change", onLangChange);
      if (unsub) unsub();
      unsub = null;
      lines = [];
      latestPayload = null;
      lastTime = 0;
    }

    LI.db.init().then(() => {
      if (stopped) return;
      unsub = LI.db.onValue("subtitles", applySubtitles);
    }).catch((err) => {
      clearScreen(LI.catalog.redactSecrets(err.message || "연결에 실패했습니다."));
    });

    return { clearScreen, stop };
  }

  return {
    queryLang,
    useSubtitleFont,
    startOverlay,
    startPrompter,
    fillLangSelect,
    activeLangCodesFromSettings,
    escapeHtml,
    hexToRgba,
  };
})();
