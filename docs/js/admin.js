const banner = document.getElementById("banner");
const listEl = document.getElementById("churchList");
const detail = document.getElementById("detail");
const linksEl = document.getElementById("links");
const sessionsEl = document.getElementById("sessions");
const textsEl = document.getElementById("texts");
let churches = [];
let currentId = "";
let textUnsub = null;

function showError(err) {
  banner.textContent = err && err.message ? err.message : String(err || "");
}

function pageBase() {
  if (location.hostname.endsWith("github.io")) {
    return location.origin + location.pathname.replace(/\/[^/]*$/, "");
  }
  return LI.catalog.pagesBase;
}

function copyButton(url) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost";
  button.textContent = "복사";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {
      const input = button.previousElementSibling;
      input.select();
      document.execCommand("copy");
    }
    button.textContent = "복사됨";
    setTimeout(() => { button.textContent = "복사"; }, 1000);
  });
  return button;
}

function linkRow(label, url) {
  const row = document.createElement("div");
  row.className = "link-box";
  const name = document.createElement("strong");
  name.textContent = label;
  const input = document.createElement("input");
  input.readOnly = true;
  input.value = url;
  row.append(name, input, copyButton(url));
  return row;
}

function formatFolder(name) {
  const match = String(name || "").match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return name;
  return `${match[1]} ${match[2]}:${match[3]}:${match[4]}`;
}

async function loadChurches() {
  LI.db.clearChurch();
  const index = await LI.db.get("churchIndex");
  churches = !index || typeof index !== "object" ? [] : Object.entries(index)
    .filter(([id, row]) => LI.catalog.isChurchId(id) && row)
    .map(([id, row]) => ({ id, name: row.name || id, createdAt: row.createdAt || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  listEl.innerHTML = "";
  if (!churches.length) {
    listEl.innerHTML = '<p class="hint">아직 교회가 없습니다.</p>';
    return;
  }
  churches.forEach((church) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `church-item${church.id === currentId ? " on" : ""}`;
    button.textContent = church.name;
    button.addEventListener("click", () => openChurch(church.id));
    listEl.append(button);
  });
}

function renderLinks(church) {
  const base = pageBase();
  linksEl.innerHTML = "";
  linksEl.append(
    linkRow("성도 홈", LI.catalog.homeLink(base, church.id)),
    linkRow("관리", LI.catalog.adminLink(base, church.id))
  );
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = `방송실에서는 송출 앱을 열고 「${church.name}」을 선택합니다. 아래는 언어별 성도 자막과 OBS 주소입니다.`;
  linksEl.append(note);
  const picker = document.createElement("select");
  LI.catalog.languages.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = `${lang.flag} ${lang.name}`;
    picker.append(option);
  });
  const holder = document.createElement("div");
  const draw = () => {
    holder.innerHTML = "";
    const [item] = LI.catalog.buildLinks(base, church.id, [picker.value]);
    holder.append(linkRow("성도 자막", item.listen), linkRow("OBS", item.overlay));
  };
  picker.addEventListener("change", draw);
  linksEl.append(picker, holder);
  draw();
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    const local = document.createElement("p");
    local.className = "hint";
    local.textContent = `이 컴퓨터 미리보기: ${location.origin}/index.html?church=${encodeURIComponent(church.id)}`;
    linksEl.append(local);
  }
}

async function openChurch(id) {
  currentId = id;
  if (textUnsub) textUnsub();
  textUnsub = null;
  textsEl.innerHTML = "";
  const church = churches.find((item) => item.id === id);
  detail.hidden = false;
  document.getElementById("detailTitle").textContent = church ? church.name : id;
  document.getElementById("editName").value = church ? church.name : id;
  renderLinks(church || { id, name: id });
  [...listEl.children].forEach((node) => {
    if (node.classList) node.classList.toggle("on", node.textContent === (church && church.name));
  });
  const [glossary, settings, sessionIndex] = await Promise.all([
    LI.db.get(`churches/${id}/glossary`),
    LI.db.get(`churches/${id}/live/settings`),
    LI.db.get(`churches/${id}/sessionIndex`),
  ]);
  document.getElementById("glossary").value = typeof glossary === "string" && glossary.trim()
    ? glossary
    : LI.catalog.defaultGlossary(church ? church.name : id);
  fillStyle(settings);
  renderSessions(id, sessionIndex);
  const url = new URL(location.href);
  url.searchParams.set("church", id);
  history.replaceState(null, "", url);
}

function fillStyle(settings) {
  const global = (settings && settings.global) || {};
  document.getElementById("layout").value = global.layout || "bottom";
  document.getElementById("align").value = global.align || "center";
  document.getElementById("color").value = global.color || "#ffffff";
  document.getElementById("bgColor").value = global.bgColor || "#000000";
  document.getElementById("opacity").value = global.bgOpacity !== undefined ? global.bgOpacity : 0.7;
  const rows = document.getElementById("fontRows");
  rows.innerHTML = "";
  LI.catalog.languages.forEach((lang) => {
    const prev = (settings && settings[lang.code]) || {};
    const row = document.createElement("div");
    row.className = "lang-row";
    row.innerHTML = `<span>${lang.flag} ${lang.name}</span><span>크기 <input data-size="${lang.code}" type="number" value="${prev.fontSize || lang.defaultSize}" style="width:76px;"> 자간 <input data-space="${lang.code}" type="number" step="0.5" value="${prev.letterSpacing !== undefined ? prev.letterSpacing : lang.defaultSpacing}" style="width:76px;"></span>`;
    rows.append(row);
  });
}

function renderSessions(id, index) {
  sessionsEl.innerHTML = "";
  const rows = !index || typeof index !== "object" ? [] : Object.entries(index)
    .filter(([folder]) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(folder))
    .sort((a, b) => b[0].localeCompare(a[0]));
  if (!rows.length) {
    sessionsEl.innerHTML = '<p class="hint">아직 저장된 방송이 없습니다.</p>';
    return;
  }
  rows.forEach(([folder, meta]) => {
    const button = document.createElement("button");
    button.type = "button";
    const ended = meta && meta.endedAt ? "" : " · 진행 기록";
    button.textContent = `${formatFolder(folder)}${ended}`;
    button.addEventListener("click", () => watchTexts(id, folder, meta));
    sessionsEl.append(button);
  });
}

function watchTexts(id, folder, meta) {
  if (textUnsub) textUnsub();
  textsEl.innerHTML = `<h3>${formatFolder(folder)}</h3>`;
  textUnsub = LI.db.onValue(`churches/${id}/sessions/${folder}/texts`, (texts) => {
    const keepTitle = textsEl.querySelector("h3");
    textsEl.innerHTML = "";
    if (keepTitle) textsEl.append(keepTitle);
    const langs = texts && typeof texts === "object"
      ? Object.keys(texts)
      : ((meta && meta.languages) || []);
    if (!langs.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "아직 저장된 문장이 없습니다.";
      textsEl.append(empty);
      return;
    }
    langs.forEach((lang) => {
      const metaLang = LI.catalog.langByCode[lang];
      const block = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = metaLang ? `${metaLang.flag} ${metaLang.name}` : lang;
      const pre = document.createElement("pre");
      pre.className = "transcript";
      const body = texts && texts[lang] ? String(texts[lang]) : "";
      pre.textContent = body || "아직 없습니다.";
      const download = document.createElement("button");
      download.type = "button";
      download.className = "ghost";
      download.textContent = `${lang}.txt 받기`;
      download.addEventListener("click", () => downloadText(`${folder}_${lang}.txt`, body));
      block.append(title, pre, download);
      textsEl.append(block);
    });
  });
}

function downloadText(filename, text) {
  const blob = new Blob([text || ""], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.getElementById("addChurch").addEventListener("click", async () => {
  const name = document.getElementById("churchName").value.trim();
  if (!name) return;
  const id = LI.catalog.makeChurchId(name);
  try {
    await LI.db.set(`churches/${id}`, {
      name,
      createdAt: Date.now(),
      glossary: LI.catalog.defaultGlossary(name),
    });
    await LI.db.set(`churchIndex/${id}`, { name, createdAt: Date.now() });
    await LI.db.set(`churches/${id}/live/settings`, LI.catalog.defaultLiveSettings());
    document.getElementById("churchName").value = "";
    await loadChurches();
    await openChurch(id);
  } catch (err) {
    showError(err);
  }
});

document.getElementById("saveGlossary").addEventListener("click", async () => {
  if (!currentId) return;
  const name = document.getElementById("editName").value.trim();
  if (!name) return;
  try {
    await LI.db.update(`churches/${currentId}`, {
      glossary: document.getElementById("glossary").value,
      name,
    });
    await LI.db.update(`churchIndex/${currentId}`, { name });
    document.getElementById("saveMsg").textContent = "저장했습니다.";
    await loadChurches();
    document.getElementById("detailTitle").textContent = name;
  } catch (err) {
    showError(err);
  }
});

document.getElementById("resetGlossary").addEventListener("click", () => {
  const church = churches.find((item) => item.id === currentId);
  document.getElementById("glossary").value = LI.catalog.defaultGlossary(church ? church.name : "");
});

document.getElementById("saveStyle").addEventListener("click", async () => {
  if (!currentId) return;
  try {
    const existing = (await LI.db.get(`churches/${currentId}/live/settings`)) || {};
    const next = {
      ...existing,
      _timestamp: Date.now(),
      global: {
        layout: document.getElementById("layout").value,
        align: document.getElementById("align").value,
        color: document.getElementById("color").value,
        bgColor: document.getElementById("bgColor").value,
        bgOpacity: parseFloat(document.getElementById("opacity").value),
      },
    };
    LI.catalog.languages.forEach((lang) => {
      const prev = existing[lang.code] || {};
      next[lang.code] = {
        ...prev,
        fontSize: parseFloat(document.querySelector(`[data-size="${lang.code}"]`).value),
        letterSpacing: parseFloat(document.querySelector(`[data-space="${lang.code}"]`).value),
      };
    });
    await LI.db.set(`churches/${currentId}/live/settings`, next);
    document.getElementById("saveMsg").textContent = "자막 모양을 저장했습니다.";
  } catch (err) {
    showError(err);
  }
});

LI.db.clearChurch();
LI.db.init()
  .then(loadChurches)
  .then(() => {
    const requested = LI.catalog.churchIdFromQuery(location.search);
    if (requested) return openChurch(requested);
    return null;
  })
  .catch(showError);
