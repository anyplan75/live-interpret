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
    const h = String(hex || "#000000").replace("#", "");
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

    function applySettings(settings) {
      if (!settings) return;
      if (settings.global) {
        const layout = settings.global.layout || "bottom";
        container.className = `layout-${layout}`;
        maxLines = layout === "top" || layout === "bottom" ? 3 : 15;
        subtitle.style.textAlign = settings.global.align || "center";
        subtitle.style.color = settings.global.color || "#ffffff";
        const opacity = settings.global.bgOpacity !== undefined ? settings.global.bgOpacity : 0.7;
        subtitle.style.backgroundColor = hexToRgba(settings.global.bgColor || "#000000", opacity);
      }
      const langSetting = settings[lang];
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
      const text = typeof row === "object" ? row.text : row;
      const msgId = typeof row === "object" ? row.id : lastTime;
      const isFinal = typeof row === "object" && row.isFinal !== undefined ? row.isFinal : true;
      const existingIndex = subtitleLines.findIndex((line) => line.id === msgId);
      if (existingIndex !== -1) {
        subtitleLines[existingIndex].text = text;
        subtitleLines[existingIndex].isFinal = isFinal;
      } else {
        subtitleLines.push({ id: msgId, text, isFinal });
        while (subtitleLines.length > maxLines) subtitleLines.shift();
      }
      subtitle.innerHTML = subtitleLines
        .map((line) => {
          if (line.isFinal === false) return `<span class="interim">${escapeHtml(line.text)}</span>`;
          return escapeHtml(line.text);
        })
        .join("<br>");
    }

    LI.db.init().then(() => {
      LI.db.onValue("settings", applySettings);
      LI.db.onValue("subtitles", applySubtitles);
    }).catch((err) => {
      subtitle.textContent = err.message || "연결 실패";
    });
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
          return `<p class="${cls}">${escapeHtml(line.text)}</p>`;
        })
        .join("");
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }

    function ingestLatestForLang(force = false) {
      if (!latestPayload) return false;
      const row = latestPayload[currentLang];
      if (!row) return false;
      const text = typeof row === "object" ? row.text : row;
      const msgId = typeof row === "object" ? row.id : latestPayload._timestamp;
      const isFinal = typeof row === "object" && row.isFinal !== undefined ? row.isFinal : true;
      if (force) {
        lines = [{ id: msgId, text, isFinal }];
        renderLines();
        return true;
      }
      const existingIndex = lines.findIndex((line) => line.id === msgId);
      if (existingIndex !== -1) {
        lines[existingIndex].text = text;
        lines[existingIndex].isFinal = isFinal;
      } else {
        lines.push({ id: msgId, text, isFinal });
        if (lines.length > maxLines) lines.shift();
      }
      renderLines();
      return true;
    }

    langSelect.addEventListener("change", () => {
      currentLang = langSelect.value;
      if (ingestLatestForLang(true)) {
        lastTime = latestPayload ? latestPayload._timestamp : 0;
      } else {
        lastTime = 0;
        clearScreen("언어가 변경되었습니다. 다음 문장을 기다리는 중입니다...");
      }
    });

    function applySubtitles(subtitles) {
      if (!subtitles) return;
      latestPayload = subtitles;
      if (subtitles._timestamp === lastTime) return;
      lastTime = subtitles._timestamp;
      ingestLatestForLang(false);
    }

    LI.db.init().then(() => {
      LI.db.onValue("subtitles", applySubtitles);
    }).catch((err) => {
      clearScreen(err.message || "연결에 실패했습니다.");
    });

    return { clearScreen };
  }

  return {
    queryLang,
    startOverlay,
    startPrompter,
    fillLangSelect,
    activeLangCodesFromSettings,
    escapeHtml,
    hexToRgba,
  };
})();
