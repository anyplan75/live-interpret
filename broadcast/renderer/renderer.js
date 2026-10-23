const statusEl = document.getElementById("status");
const sensitivityEl = document.getElementById("sensitivity");
const deviceEl = document.getElementById("device");
const channelsEl = document.getElementById("channels");
const langsEl = document.getElementById("langs");
const folderHint = document.getElementById("folderHint");
const audioHint = document.getElementById("audioHint");
const liveEl = document.getElementById("live");
const koStackEl = document.getElementById("koStack");
const cardsEl = document.getElementById("cards");
const logEl = document.getElementById("log");
const langCount = document.getElementById("langCount");
const { missingSetup, preacherToSelect } = window.SetupReady;
const preacherEl = document.getElementById("preacher");
const spokenEl = document.getElementById("spoken");
const heardTitleEl = document.getElementById("heardTitle");

const state = {
  catalog: null,
  settings: {},
  church: null,
  preachers: [],
  devices: [],
  audio: null,
  running: false,
  signedIn: false,
  operator: false,
  lines: {},
  targets: [],
  spoken: "ko",
  channels: [],
  style: null,
};

const pendingPhoneSpoken = new Map();
const pendingPhoneDisplay = new Map();

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `pill${kind ? ` ${kind}` : ""}`;
}

const hearing = window.Hearing.createHearing(document, liveEl, koStackEl);

function visibleError(value) {
  const text = typeof UserText !== "undefined" && UserText.userText ? UserText.userText(value) : String(value && value.message ? value.message : value || "");
  return text.replace(/sk-[A-Za-z0-9_-]{4,}/g, "[redacted]");
}

function log(text, level) {
  const line = document.createElement("div");
  if (level === "error") line.className = "err";
  line.textContent = visibleError(text);
  logEl.prepend(line);
  while (logEl.childNodes.length > 80) logEl.removeChild(logEl.lastChild);
}

function selectedTargets() {
  return [...langsEl.querySelectorAll("input:checked")].map((input) => input.value);
}

function styleOutputLanguages() {
  const codes = new Set(state.targets || []);
  return (state.catalog && state.catalog.languages || []).filter((lang) => lang.code !== "ko" && codes.has(lang.code));
}

function knownSpoken(code) {
  const found = (state.catalog && state.catalog.languages || []).find((lang) => lang.code === code);
  return found ? found.code : "ko";
}

function spokenName(code) {
  const found = (state.catalog && state.catalog.languages || []).find((lang) => lang.code === code);
  return found ? found.name : "한국어";
}

function spokenTitle(code) {
  if (code === "zh-CN") return "중국어";
  if (code === "zh-TW") return "중국어(번체)";
  return spokenName(code);
}

function heardLanguageLabel() {
  const on = activeChannelRows();
  const codes = on.length ? on.map((row) => row.spoken) : [state.spoken];
  const names = [];
  codes.forEach((code) => {
    const label = spokenTitle(code);
    if (label && !names.includes(label)) names.push(label);
  });
  return names.join(" · ") || "한국어";
}

function activeChannelRows() {
  return (state.channels || []).map((row, index) => ({ ...row, index })).filter((row) => {
    if (!row.on) return false;
    if (row.source === "phone" && row.connected === false) return false;
    return true;
  });
}

function channelTitle(row) {
  if (row && row.name) return row.name;
  return `채널 ${row.index + 1}`;
}

function renderHeardTitle() {
  if (!heardTitleEl) return;
  const on = activeChannelRows();
  if (on.length === 1 && on[0].name) {
    heardTitleEl.textContent = `지금 듣는 ${on[0].name} · ${spokenTitle(on[0].spoken)}`;
    return;
  }
  if (on.length <= 1) {
    const code = on.length ? on[0].spoken : state.spoken;
    heardTitleEl.textContent = `지금 듣는 ${spokenTitle(code)}`;
    return;
  }
  heardTitleEl.textContent = `지금 듣는 ${on.map((row) => `${channelTitle(row)} ${spokenTitle(row.spoken)}`).join(" · ")}`;
}

function billingSpoken() {
  const on = activeChannelRows();
  return on.length ? on.map((row) => row.spoken) : [state.spoken || "ko"];
}

function extraChannelIndexes() {
  const on = (state.channels || []).filter((row) => row && row.on).length;
  return Math.max(0, on - 1);
}

function ensureChannels(count) {
  const saved = Array.isArray(state.settings && state.settings.channels) ? state.settings.channels : [];
  const current = Array.isArray(state.channels) ? state.channels : [];
  const phones = current.filter((row) => row && row.source === "phone");
  const devices = current.filter((row) => !row || row.source !== "phone");
  const rows = [];
  const n = Math.max(0, Number(count) || 0);
  for (let i = 0; i < n; i += 1) {
    const prev = devices[i] || saved[i] || {};
    if (prev.source === "phone") continue;
    const fallback = i === 0 && state.settings ? state.settings.spoken : "ko";
    const spoken = knownSpoken(prev.spoken || fallback);
    const on = prev.on != null ? !!prev.on : i === 0;
    rows.push({
      spoken,
      on,
      source: "device",
      name: String(prev.name || "").trim(),
      showName: prev.showName !== false,
      phoneId: "",
      connected: true,
    });
  }
  state.channels = rows.concat(phones);
  if (rows[0]) state.spoken = rows[0].spoken;
}

function renderSpoken(code) {
  state.spoken = knownSpoken(code);
  if (!spokenEl || !state.catalog) {
    renderHeardTitle();
    return;
  }
  spokenEl.innerHTML = "";
  state.catalog.languages.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = `${lang.flag} ${lang.name}`;
    spokenEl.append(option);
  });
  spokenEl.value = state.spoken;
  paintSpokenFace(spokenEl);
  renderHeardTitle();
}

function selectedPreacherId() {
  return preacherEl.value || "";
}

function sessionKindValue() {
  const el = document.getElementById("sessionKind");
  return el ? el.value : "";
}

function currentSetup() {
  return {
    folder: (state.settings && state.settings.folder) || "",
    folderReady: !!(state.settings && state.settings.folderReady),
    preacherId: selectedPreacherId(),
    sessionKind: sessionKindValue(),
    targets: selectedTargets(),
    deviceKey: deviceEl.value || "",
  };
}

function openSettings() {
  const panel = document.getElementById("settingsPanel");
  if (panel) panel.hidden = false;
  paintSetupGaps();
}

function closeSettings() {
  if (missingSetup(currentSetup()).length) return;
  const panel = document.getElementById("settingsPanel");
  if (panel) panel.hidden = true;
  persist({ setupClosed: true }).catch((err) => log(visibleError(err), "error"));
}

function paintFolderHint() {
  if (!folderHint || !state.settings) return;
  if (state.settings.folder && state.settings.folderReady !== true) {
    folderHint.textContent = "고른 폴더에 기록을 만들 수 없습니다. 폴더 선택을 다시 눌러 주세요.";
  } else if (state.settings.folder) {
    folderHint.textContent = state.settings.folder;
  }
  paintGlances();
}

function paintSetupGaps() {
  const gaps = missingSetup(currentSetup());
  const list = document.getElementById("setupGaps");
  const summary = document.getElementById("setupSummary");
  const closeBtn = document.getElementById("closeSettings");
  if (list) {
    list.innerHTML = "";
    gaps.forEach((gap) => {
      const item = document.createElement("li");
      item.textContent = gap;
      list.append(item);
    });
    list.hidden = gaps.length === 0;
  }
  if (summary) {
    summary.textContent = gaps.length
      ? `시작 전에 맞춰 주세요: ${gaps.join(", ")}`
      : "저장 폴더에 기록을 만들 수 있습니다. 시작할 수 있습니다.";
  }
  if (closeBtn) closeBtn.textContent = gaps.length ? "닫기" : "준비완료";
  if (gaps.length) {
    const panel = document.getElementById("settingsPanel");
    if (panel) panel.hidden = false;
  }
}

async function persist(patch) {
  const next = { ...(patch || {}) };
  if (Array.isArray(next.channels)) {
    next.channels = next.channels
      .filter((row) => !row || row.source !== "phone")
      .map((row) => ({ spoken: row.spoken, on: !!row.on }));
  }
  state.settings = await window.broadcast.saveSettings(next);
}

function renderLangs(selected) {
  const set = new Set(selected);
  const targets = state.catalog.languages.filter((lang) => lang.code !== "ko");
  langsEl.innerHTML = "";
  targets.forEach((lang) => {
    const label = document.createElement("label");
    label.className = `lang${set.has(lang.code) ? " on" : ""}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = lang.code;
    input.checked = set.has(lang.code);
    const text = document.createElement("span");
    const name = document.createElement("span");
    name.textContent = `${lang.flag} ${lang.name}`;
    const small = document.createElement("small");
    small.textContent = lang.nameEn;
    text.append(name, small);
    label.append(input, text);
    input.addEventListener("change", () => onTargetsChanged());
    langsEl.append(label);
  });
  return onTargetsChanged();
}

function restoreLangChecks(selected) {
  const set = new Set(selected);
  langsEl.querySelectorAll("input").forEach((input) => {
    input.checked = set.has(input.value);
  });
  langsEl.querySelectorAll(".lang").forEach((label) => {
    label.classList.toggle("on", label.querySelector("input").checked);
  });
}

async function onTargetsChanged(sync = true) {
  const previous = state.targets.slice();
  state.targets = selectedTargets();
  langCount.textContent = `번역 ${state.targets.length}개 · 지금 듣는 ${heardLanguageLabel()}`;
  langsEl.querySelectorAll(".lang").forEach((label) => {
    label.classList.toggle("on", label.querySelector("input").checked);
  });
  await persist({ targets: state.targets, spoken: state.spoken });
  if (sync && state.church) {
    try {
      const applied = await window.broadcast.setTargets(state.targets, state.spoken);
      if (Array.isArray(applied)) state.targets = applied;
    } catch (err) {
      log(visibleError(err), "error");
      state.targets = previous;
      restoreLangChecks(previous);
      langCount.textContent = `번역 ${state.targets.length}개 · 지금 듣는 ${heardLanguageLabel()}`;
      await persist({ targets: state.targets, spoken: state.spoken });
    }
  }
  if (state.style) fillStyle(state.style);
  await renderLinks();
  paintGlances();
  paintSetupGaps();
}

function renderDevices() {
  const previous = deviceEl.value || (state.settings.audio && state.settings.audio.deviceKey) || "";
  deviceEl.innerHTML = "";
  const groups = new Map();
  state.devices.forEach((device) => {
    if (!groups.has(device.apiLabel)) groups.set(device.apiLabel, []);
    groups.get(device.apiLabel).push(device);
  });
  if (!state.devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "입력 장치 없음";
    deviceEl.append(option);
    return;
  }
  groups.forEach((devices, label) => {
    const group = document.createElement("optgroup");
    group.label = label;
    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.key;
      option.textContent = `${device.name} · ${device.inputChannels}채널${device.isDefault ? " · 기본" : ""}`;
      group.append(option);
    });
    deviceEl.append(group);
  });
  if ([...deviceEl.options].some((option) => option.value === previous)) deviceEl.value = previous;
}

function fillSpokenSelect(select, code) {
  select.innerHTML = "";
  ((state.catalog && state.catalog.languages) || []).forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = `${lang.flag} ${lang.name}`;
    select.append(option);
  });
  select.value = knownSpoken(code);
  paintSpokenFace(select);
}

function paintSpokenFace(select) {
  if (!select || !select.closest) return;
  const slot = select.closest(".spoken-slot");
  const face = slot && slot.querySelector(".spoken-face");
  if (face) face.textContent = spokenTitle(select.value || "ko");
}

function placePhoneCardBeforeInput() {
  const phone = document.getElementById("phoneJoinCard");
  const input = document.getElementById("inputCard");
  if (!phone || !input || !phone.parentNode) return;
  if (phone.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING) {
    phone.parentNode.insertBefore(phone, input);
  }
}

function deviceChannelCount() {
  if (state.audio && state.audio.deviceChannels) return state.audio.deviceChannels;
  return state.channels.filter((row) => row.source !== "phone").length;
}

function sensitivityLabel(value) {
  if (value === "high") return "감도 높음";
  if (value === "low") return "감도 낮음";
  return "감도 보통";
}

function nameShownText(shown) {
  return shown === false ? "이름 숨김" : "이름 표시";
}

function lecturerStyle() {
  return {
    traits: document.getElementById("traits") ? document.getElementById("traits").value : "",
    corrections: document.getElementById("corrections") ? document.getElementById("corrections").value : "",
    terms: document.getElementById("terms") ? document.getElementById("terms").value : "",
    sensitivity: sensitivityEl ? sensitivityEl.value : "normal",
  };
}

function styleKey(row, index) {
  if (row && row.source === "phone") return row.connectionId ? `phone:${row.connectionId}` : "";
  return `device:${index}`;
}

function styleFor(row, index) {
  if (!row || row.source !== "phone") return lecturerStyle();
  const all = state.settings && state.settings.sourceStyles;
  const saved = all && all[styleKey(row, index)];
  if (saved) return { ...saved };
  return { traits: "", corrections: "", terms: "", sensitivity: sensitivityEl ? sensitivityEl.value : "normal" };
}

function speechSummary(style) {
  const bits = [sensitivityLabel(style && style.sensitivity)];
  if (style && String(style.traits || "").trim()) bits.push("말투 있음");
  if (style && String(style.corrections || "").trim()) bits.push("교정 있음");
  if (style && String(style.terms || "").trim()) bits.push("용어 있음");
  return bits.join(" · ");
}

function cleanStyle(style) {
  const src = style || {};
  return {
    traits: String(src.traits || "").slice(0, 800),
    corrections: String(src.corrections || "").slice(0, 2000),
    terms: String(src.terms || "").slice(0, 2000),
    sensitivity: src.sensitivity === "high" || src.sensitivity === "low" ? src.sensitivity : "normal",
  };
}

function rememberStyle(key, style) {
  if (!key) return;
  const next = cleanStyle(style);
  const all = { ...((state.settings && state.settings.sourceStyles) || {}), [key]: next };
  persist({ sourceStyles: all, sensitivity: sensitivityEl ? sensitivityEl.value : next.sensitivity }).catch((err) => log(visibleError(err), "error"));
  if (state.running && window.broadcast.setSourceStyle) {
    window.broadcast.setSourceStyle(key, next).catch((err) => log(visibleError(err), "error"));
  }
}

function paintGlances() {
  const kind = document.getElementById("kindGlance");
  if (kind) kind.textContent = sessionKindValue() || "선택 안 함";
  const bulletin = document.getElementById("bulletinGlance");
  const bulletinMsg = document.getElementById("bulletinMsg");
  if (bulletin) bulletin.textContent = bulletinMsg && bulletinMsg.textContent && bulletinMsg.textContent.indexOf("없습니다") < 0 ? "올렸습니다" : "없음";
  const preacher = document.getElementById("preacherGlance");
  if (preacher) {
    const typed = document.getElementById("preacherName") && document.getElementById("preacherName").value.trim();
    const picked = preacherEl && preacherEl.selectedOptions && preacherEl.selectedOptions[0] ? preacherEl.selectedOptions[0].textContent : "";
    const name = typed || (picked && picked.indexOf("없") < 0 && picked !== "강연자 선택" ? picked : "선택 안 함");
    preacher.textContent = `${name} · ${nameShownText(preacherNameShown())}`;
  }
  const speech = document.getElementById("speechGlance");
  if (speech) speech.textContent = speechSummary(lecturerStyle());
  const lang = document.getElementById("langGlance");
  if (lang) {
    const names = selectedTargets().map((code) => spokenTitle(code)).filter(Boolean);
    lang.textContent = names.length ? names.join(" · ") : "번역 없음";
  }
  const phone = document.getElementById("phoneGlance");
  if (phone) phone.textContent = phoneGlanceText();
  const input = document.getElementById("inputGlance");
  if (input) {
    const devices = (state.channels || []).map((row, index) => ({ row, index })).filter((item) => !item.row || item.row.source !== "phone");
    input.textContent = devices.length
      ? devices.map((item) => `채널 ${item.index + 1}${item.row.on ? " 켜짐" : " 꺼짐"} · ${spokenTitle(item.row.spoken)} · ${nameShownText(preacherNameShown())}`).join(" · ")
      : "채널 없음";
  }
  const folder = document.getElementById("folderGlance");
  if (folder) {
    const saved = state.settings && state.settings.folder ? String(state.settings.folder) : "";
    const leaf = saved.split("/").filter(Boolean).slice(-1)[0];
    folder.textContent = leaf || "선택 안 함";
  }
  const style = document.getElementById("styleGlance");
  if (style) {
    const layout = document.getElementById("layout");
    const align = document.getElementById("align");
    const layoutName = { bottom: "아래", top: "위", left: "왼쪽", right: "오른쪽" };
    const alignName = { left: "왼쪽", center: "가운데", right: "오른쪽" };
    style.textContent = `${layoutName[layout && layout.value] || "아래"} · ${alignName[align && align.value] || "가운데"}`;
  }
}

function phoneGlanceText() {
  const desks = state.phoneJoin && Array.isArray(state.phoneJoin.channels) ? state.phoneJoin.channels : [];
  if (!desks.length) return "휴대폰 수 0";
  const parts = desks.map((desk, index) => {
    const view = deskView(desk);
    if (phoneJoined(view)) return phoneRowText(index + 1, view);
    return `휴대폰${index + 1} 꺼짐`;
  });
  return [`휴대폰 수 ${desks.length}`, ...parts].join(" · ");
}

function appendSpokenControl(parent, select) {
  const label = document.createElement("label");
  label.className = "spoken-label";
  const kicker = document.createElement("span");
  kicker.className = "spoken-kicker";
  kicker.textContent = "말하는 언어";
  const slot = document.createElement("span");
  slot.className = "spoken-slot";
  const face = document.createElement("span");
  face.className = "spoken-face";
  face.textContent = spokenTitle(select.value || "ko");
  select.classList.add("spoken-full");
  select.addEventListener("change", () => paintSpokenFace(select));
  slot.append(face, select);
  label.append(kicker, slot);
  parent.append(label);
}

function captionChecked(row, index) {
  if (row && row.showName === false) return false;
  if (index === 0 && !String(row && row.name || "").trim()) return preacherNameShown();
  return !row || row.showName !== false;
}

function appendCaptionNameField(parent, index, row) {
  const label = document.createElement("label");
  label.className = "caption-name";
  label.textContent = "이름";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 40;
  input.className = "caption-name-input";
  const typed = String(row && row.name || "").trim();
  input.value = typed || (index === 0 ? preacherDisplayName() : "");
  input.setAttribute("aria-label", `채널 ${index + 1} 이름`);
  input.addEventListener("change", () => {
    let next = input.value.trim();
    if (index === 0 && next === preacherDisplayName()) next = "";
    applyChannelCaption(index, { name: next });
  });
  label.append(input);
  parent.append(label);
}

function appendCaptionNameSwitch(parent, index, row) {
  const label = document.createElement("label");
  label.className = "check name-switch";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "channel-name-switch";
  box.checked = captionChecked(row, index);
  box.setAttribute("aria-label", `채널 ${index + 1} 이름을 자막에 표시`);
  box.addEventListener("change", () => {
    const shown = box.checked;
    if (index === 0 && !String(row && row.name || "").trim()) {
      if (state.channels[index]) state.channels[index].showName = shown;
      setPreacherNameShown(shown);
      persist({ channels: state.channels }).catch((err) => log(visibleError(err), "error"));
      return;
    }
    applyChannelCaption(index, { showName: shown });
  });
  label.append(box, document.createTextNode(" 이 이름을 자막에 표시"));
  parent.append(label);
}

async function applyChannelCaption(index, patch) {
  const row = state.channels[index];
  if (!row || row.source === "phone") return;
  if (Object.prototype.hasOwnProperty.call(patch, "name")) row.name = String(patch.name || "").trim().slice(0, 40);
  if (Object.prototype.hasOwnProperty.call(patch, "showName")) row.showName = patch.showName !== false;
  paintGlances();
  await persist({ channels: state.channels });
  renderChannels(deviceChannelCount());
  if (!state.running) return;
  try {
    await window.broadcast.setChannelCaption(index, { name: row.name || "", showName: row.showName !== false });
  } catch (err) {
    log(visibleError(err), "error");
  }
}

async function setPreacherNameShown(on) {
  const shown = on !== false;
  const box = document.getElementById("showPreacherName");
  if (box) box.checked = shown;
  paintGlances();
  await persist({ showPreacherName: shown });
  renderChannels(deviceChannelCount());
  if (!state.running) return;
  try { await window.broadcast.setShowPreacherName(shown); }
  catch (err) { log(visibleError(err), "error"); }
}

function appendSpeechStyle(parent, row, index) {
  const key = styleKey(row, index);
  const current = styleFor(row, index);
  const details = document.createElement("details");
  details.className = "fold-inner";
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "fold-title";
  title.textContent = "말투와 교정";
  const value = document.createElement("span");
  value.className = "fold-value";
  value.textContent = speechSummary(current);
  summary.append(title, value);
  details.append(summary);
  ["traits", "corrections", "terms"].forEach((field) => {
    const label = document.createElement("label");
    label.textContent = field === "traits" ? "말투" : field === "corrections" ? "교정" : "용어";
    const area = document.createElement("textarea");
    area.dataset.styleKey = key;
    area.dataset.styleField = field;
    area.value = current[field] || "";
    area.addEventListener("change", () => {
      const next = styleFor(row, index);
      next[field] = area.value;
      if (!row || row.source !== "phone") {
        const canon = document.getElementById(field);
        if (canon) canon.value = area.value;
      }
      value.textContent = speechSummary(next);
      rememberStyle(key, next);
      paintGlances();
    });
    label.append(area);
    details.append(label);
  });
  const senseLabel = document.createElement("label");
  senseLabel.textContent = "인식 감도";
  const sense = document.createElement("select");
  sense.dataset.styleKey = key;
  sense.dataset.styleField = "sensitivity";
  [["high", "감도 높음"], ["normal", "감도 보통"], ["low", "감도 낮음"]].forEach(([code, text]) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = text;
    sense.append(option);
  });
  sense.value = current.sensitivity === "high" || current.sensitivity === "low" ? current.sensitivity : "normal";
  sense.addEventListener("change", () => {
    const next = styleFor(row, index);
    next.sensitivity = sense.value;
    if (!row || row.source !== "phone") {
      if (sensitivityEl) sensitivityEl.value = sense.value;
    }
    value.textContent = speechSummary(next);
    rememberStyle(key, next);
    paintGlances();
  });
  senseLabel.append(sense);
  details.append(senseLabel);
  parent.append(details);
}

function renderChannels(count) {
  const total = Number.isInteger(count) ? count : deviceChannelCount();
  ensureChannels(total);
  channelsEl.innerHTML = "";
  state.channels.forEach((row, i) => {
    if (row && row.source === "phone") return;
    const wrap = document.createElement("div");
    wrap.className = `channel${row.on ? " on" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `채널 ${i + 1}${row.on ? " 켜짐" : " 꺼짐"}`;
    button.addEventListener("click", () => toggleChannel(i));
    const meter = document.createElement("div");
    meter.className = "meter";
    const bar = document.createElement("span");
    bar.dataset.channel = String(i);
    meter.append(bar);
    const select = document.createElement("select");
    select.className = "channel-spoken spoken-full";
    select.dataset.channel = String(i);
    select.setAttribute("aria-label", `채널 ${i + 1} 말하는 언어`);
    if (i === 0) select.id = "spoken";
    fillSpokenSelect(select, row.spoken);
    select.addEventListener("change", () => onChannelSpoken(i, select.value));
    const head = document.createElement("div");
    head.className = "channel-head";
    head.append(button, meter);
    wrap.append(head);
    appendSpokenControl(wrap, select);
    appendCaptionNameField(wrap, i, row);
    appendCaptionNameSwitch(wrap, i, row);
    appendSpeechStyle(wrap, row, i);
    channelsEl.append(wrap);
  });
  renderHeardTitle();
  paintGlances();
  renderPhoneLevels();
}

function deskChannelIndex(desk) {
  const rows = state.channels || [];
  const hits = [];
  rows.forEach((row, index) => {
    if (!row || row.source !== "phone" || !desk) return;
    const sameSlot = !!(desk.connectionId && row.connectionId === desk.connectionId);
    const samePhone = !!(desk.phoneId && row.phoneId === desk.phoneId);
    const sameName = !!(desk.name && row.name === desk.name);
    if (sameSlot || samePhone || sameName) hits.push(index);
  });
  const live = hits.find((index) => rows[index].connected !== false);
  if (live != null) return live;
  if (hits.length) return hits[hits.length - 1];
  if (desk && Number.isInteger(desk.channelIndex) && desk.channelIndex >= 0) return desk.channelIndex;
  return -1;
}

function phoneJoined(info) {
  return !!(info && info.connected !== false && String(info.name || "").trim() && (info.connected === true || info.phoneId || info.source === "phone"));
}

function phoneRowText(slot, info) {
  const who = String(info && info.name || "").trim();
  if (!phoneJoined(info)) return `휴대폰${slot}`;
  return `휴대폰${slot} ${who} 켜짐`;
}

function phoneStatusText(slot, info) {
  if (phoneJoined(info)) return phoneRowText(slot, info);
  const own = info && info.loginError;
  const shared = state.phoneJoin && state.phoneJoin.loginError;
  return own || shared || "아직 연결되지 않았습니다";
}

function appendPhoneLive(parent, slot, view) {
  const box = document.createElement("div");
  box.className = "phone-live";
  const label = document.createElement("p");
  label.className = "phone-level-name";
  const joined = phoneJoined(view);
  label.textContent = phoneStatusText(slot, view);
  if (!joined && label.textContent !== "아직 연결되지 않았습니다") label.classList.add("phone-error");
  const meter = document.createElement("div");
  meter.className = "meter";
  meter.setAttribute("aria-label", `휴대폰${slot} 소리 크기`);
  const bar = document.createElement("span");
  const channelIndex = joined ? deskChannelIndex(view) : -1;
  if (channelIndex >= 0) {
    bar.dataset.phoneLevel = String(channelIndex);
    const saved = levelWidths.get(String(channelIndex));
    if (saved) bar.style.width = saved;
  }
  meter.append(bar);
  box.append(label, meter);
  if (joined && view && view.loginError) {
    const err = document.createElement("p");
    err.className = "phone-error";
    err.textContent = view.loginError;
    box.append(err);
  }
  parent.append(box);
}

function deskView(desk) {
  const view = { ...(desk || {}) };
  const index = deskChannelIndex(desk);
  const row = index >= 0 ? state.channels[index] : null;
  if (!row || row.source !== "phone") return view;
  if (!view.name) view.name = row.name || "";
  if (!view.phoneId) view.phoneId = row.phoneId || "";
  if (row.connected === false) view.connected = false;
  else if (row.name) view.connected = true;
  if (row.name) view.name = row.name;
  if (row.showName != null) view.showName = row.showName !== false;
  if (!(Number.isInteger(view.channelIndex) && view.channelIndex >= 0)) view.channelIndex = index;
  return view;
}

function phoneSlotForRow(row) {
  const desks = state.phoneJoin && Array.isArray(state.phoneJoin.channels) ? state.phoneJoin.channels : [];
  if (row && row.connectionId) {
    const found = desks.findIndex((desk) => desk && desk.connectionId === row.connectionId);
    if (found >= 0) return found + 1;
  }
  const phones = (state.channels || []).filter((item) => item && item.source === "phone");
  const index = phones.indexOf(row);
  return index >= 0 ? index + 1 : 1;
}

function liveMicName(row, index) {
  const typed = String(row && row.name || "").trim();
  if (typed) return typed;
  if (row && row.source === "phone") return "";
  if (index === 0) return preacherDisplayName();
  return "";
}

function renderPhoneLevels() {
  const root = document.getElementById("phoneLevels");
  if (!root) return;
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.liveSense && root.contains(active)
    ? active.dataset.liveSense
    : "";
  root.innerHTML = "";
  const items = [];
  (state.channels || []).forEach((row, index) => {
    if (!row || row.on === false) return;
    if (row.source === "phone" && !phoneJoined(row)) return;
    const slot = row.source === "phone" ? phoneSlotForRow(row) : 0;
    items.push({
      key: styleKey(row, index) || `device:${index}`,
      label: row.source === "phone" ? `휴대폰${slot}` : `채널 ${index + 1}`,
      name: liveMicName(row, index),
      levelKey: String(index),
      phone: row.source === "phone",
      row,
      index,
    });
  });
  root.hidden = items.length === 0;
  items.forEach((item) => {
    const line = document.createElement("div");
    line.className = "live-mic";
    const label = document.createElement("span");
    label.className = "live-mic-label";
    label.textContent = item.label;
    const name = document.createElement("span");
    name.className = "live-mic-name";
    name.textContent = item.name || item.label;
    const meter = document.createElement("div");
    meter.className = "meter";
    meter.setAttribute("aria-label", `${item.label} 소리 크기`);
    const bar = document.createElement("span");
    if (item.phone) bar.dataset.phoneLevel = item.levelKey;
    else bar.dataset.channel = item.levelKey;
    const saved = levelWidths.get(item.levelKey);
    if (saved) bar.style.width = saved;
    meter.append(bar);
    const sense = document.createElement("select");
    sense.dataset.liveSense = item.key;
    sense.setAttribute("aria-label", `${item.label} 감도`);
    [["high", "감도 높음"], ["normal", "감도 보통"], ["low", "감도 낮음"]].forEach(([code, text]) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = text;
      sense.append(option);
    });
    const current = styleFor(item.row, item.index);
    sense.value = current.sensitivity === "high" || current.sensitivity === "low" ? current.sensitivity : "normal";
    sense.addEventListener("change", () => {
      const next = styleFor(item.row, item.index);
      next.sensitivity = sense.value;
      if (!item.phone && sensitivityEl) sensitivityEl.value = sense.value;
      rememberStyle(item.key, next);
      paintGlances();
    });
    line.append(label, name, meter, sense);
    root.append(line);
  });
  if (keep) {
    const again = root.querySelector(`[data-live-sense="${CSS.escape(keep)}"]`);
    if (again) again.focus();
  }
}

function webMicAddress() {
  const given = state.phoneJoin && state.phoneJoin.webMicUrl;
  const url = String(given || "https://anyplan75.github.io/live-interpret/lecture/");
  return url.split("?")[0];
}

function appendPhoneJoinCode(parent, connectionId) {
  const number = document.createElement("p");
  number.className = "phone-connection";
  const label = document.createElement("span");
  label.textContent = "연결 번호";
  const code = document.createElement("strong");
  code.className = "join-code";
  code.textContent = connectionId || "";
  number.append(label, code);
  const web = document.createElement("p");
  web.className = "hint phone-web";
  web.textContent = `웹 마이크 ${webMicAddress()}`;
  parent.append(number, web);
}

function renderPhoneCodes() {
  const root = document.getElementById("phoneCodes");
  if (!root) return;
  const desks = state.phoneJoin && Array.isArray(state.phoneJoin.channels) ? state.phoneJoin.channels : [];
  root.innerHTML = "";
  root.hidden = desks.length === 0;
  if (!desks.length) return;
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "브라우저에서 웹 마이크 주소를 열고, 그 칸의 연결 번호를 입력하세요.";
  root.append(hint);
  desks.forEach((desk, index) => {
    const card = document.createElement("div");
    card.className = "phone-code-line";
    const title = document.createElement("p");
    title.className = "phone-level-name";
    title.textContent = `휴대폰 ${index + 1}`;
    card.append(title);
    appendPhoneJoinCode(card, desk && desk.connectionId);
    root.append(card);
  });
}

function renderPhoneDesks() {
  placePhoneCardBeforeInput();
  const root = document.getElementById("phoneDesks");
  renderPhoneLevels();
  renderPhoneCodes();
  if (!root) return;
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.phoneEdit && root.contains(active)
    ? {
      kind: active.dataset.phoneEdit,
      id: active.dataset.connectionId || "",
      value: active.value,
      start: active.selectionStart,
      end: active.selectionEnd,
    }
    : null;
  const info = state.phoneJoin || {};
  const desks = Array.isArray(info.channels) ? info.channels : [];
  const countEl = document.getElementById("phoneCount");
  if (countEl && document.activeElement !== countEl) countEl.value = String(desks.length);
  root.innerHTML = "";
  if (!desks.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "휴대폰 수를 고르면 각 칸에 QR이 나옵니다.";
    root.append(empty);
    paintGlances();
    return;
  }
  desks.forEach((desk, index) => {
    const wrap = document.createElement("div");
    wrap.className = "phone-desk";
    const title = document.createElement("h3");
    title.textContent = `휴대폰 ${index + 1}`;
    const qr = document.createElement("img");
    qr.className = "phone-qr";
    qr.alt = `휴대폰 ${index + 1} QR`;
    if (desk.qrDataUrl) qr.src = desk.qrDataUrl;
    else qr.hidden = true;
    const qrHint = document.createElement("p");
    qrHint.className = "hint";
    qrHint.textContent = desk.qrDataUrl
      ? "휴대폰 앱으로 이 QR을 스캔하세요."
      : "QR을 준비하는 중입니다.";
    const view = deskView(desk);
    const channelIndex = deskChannelIndex(view);
    const select = document.createElement("select");
    select.className = "channel-spoken spoken-full";
    select.setAttribute("aria-label", `휴대폰 ${index + 1} 말하는 언어`);
    const pendingSpoken = desk.connectionId ? pendingPhoneSpoken.get(desk.connectionId) : "";
    const spokenCode = channelIndex >= 0 && state.channels[channelIndex]
      ? state.channels[channelIndex].spoken
      : (pendingSpoken || desk.spoken || "ko");
    fillSpokenSelect(select, spokenCode || "ko");
    select.addEventListener("change", () => {
      const chosen = knownSpoken(select.value);
      if (channelIndex >= 0) {
        onChannelSpoken(channelIndex, chosen);
        return;
      }
      if (desk.connectionId) pendingPhoneSpoken.set(desk.connectionId, chosen);
      desk.spoken = chosen;
      paintGlances();
    });
    wrap.append(title);
    appendPhoneJoinCode(wrap, desk.connectionId);
    const webHint = document.createElement("p");
    webHint.className = "hint";
    webHint.textContent = "브라우저에서 이 주소를 열고, 연결 번호를 입력하세요.";
    wrap.append(webHint);
    appendPhoneLive(wrap, index + 1, view);
    appendSpokenControl(wrap, select);
    appendPhoneNameEditor(wrap, index + 1, view);
    appendPhoneNameSwitch(wrap, index + 1, view);
    wrap.append(qr, qrHint);
    appendSpeechStyle(wrap, { ...view, source: "phone" }, index);
    root.append(wrap);
  });
  paintGlances();
  if (!keep || !keep.id) return;
  const next = root.querySelector(`[data-phone-edit="${keep.kind}"][data-connection-id="${keep.id}"]`);
  if (!next) return;
  if (keep.kind === "name") next.value = keep.value;
  next.focus();
  if (keep.kind === "name" && Number.isInteger(keep.start) && Number.isInteger(keep.end)) {
    try { next.setSelectionRange(keep.start, keep.end); } catch (_) { /* 숫자 칸은 선택 범위를 두지 않습니다 */ }
  }
}

function showPhoneJoin(info) {
  state.phoneJoin = info || {};
  const desks = Array.isArray(state.phoneJoin.channels) ? state.phoneJoin.channels : [];
  desks.forEach((desk) => {
    if (!desk || !desk.connectionId || !phoneJoined(desk)) return;
    const spoken = pendingPhoneSpoken.get(desk.connectionId);
    const index = deskChannelIndex(desk);
    if (spoken && index >= 0) {
      pendingPhoneSpoken.delete(desk.connectionId);
      onChannelSpoken(index, spoken);
    }
    const patch = pendingPhoneDisplay.get(desk.connectionId);
    if (patch && index >= 0) {
      pendingPhoneDisplay.delete(desk.connectionId);
      applyPhoneDisplay(desk.connectionId, patch);
    }
  });
  renderPhoneDesks();
}

function mapChannel(row) {
  return {
    spoken: knownSpoken(row && row.spoken),
    on: !!(row && row.on),
    source: row && row.source === "phone" ? "phone" : "device",
    name: row && row.name ? String(row.name) : "",
    phoneId: row && row.source === "phone" ? (row.phoneId || "") : "",
    connectionId: row && row.source === "phone" ? (row.connectionId || "") : "",
    connected: !(row && row.source === "phone") || row.connected !== false,
    signal: !!(row && row.source === "phone" && row.signal),
    showName: !(row && row.showName === false),
  };
}

function applyPhoneRoster(channels) {
  const mapped = (channels || []).map(mapChannel);
  if (state.running) {
    state.channels = mapped;
    const deviceCount = mapped.filter((row) => row.source !== "phone").length;
    renderChannels(deviceCount);
    renderPhoneDesks();
    return;
  }
  const deviceCount = state.audio && state.audio.deviceChannels
    ? state.audio.deviceChannels
    : state.channels.filter((row) => row.source !== "phone").length;
  ensureChannels(deviceCount);
  const previous = new Map(state.channels.filter((row) => row.source === "phone").map((row) => [row.phoneId, row]));
  const phones = mapped.filter((row) => row.source === "phone").map((row) => {
    const old = previous.get(row.phoneId);
    if (!old) return row;
    return { ...row, spoken: old.spoken, on: old.on };
  });
  state.channels = state.channels.filter((row) => row.source !== "phone").concat(phones);
  renderChannels(deviceCount);
  renderPhoneDesks();
}

async function toggleChannel(index) {
  const next = !state.channels[index].on;
  if (!state.running) {
    state.channels[index].on = next;
    if (!state.channels.some((row) => row.on)) state.channels[0].on = true;
    await persist({ channels: state.channels });
    renderChannels(deviceChannelCount());
    return;
  }
  try {
    const result = await window.broadcast.setChannelOn(index, next);
    state.channels[index].on = !!(result && result.on);
    await persist({ channels: state.channels });
    renderChannels(deviceChannelCount());
    if (result && result.blocked) log(result.message, "error");
  } catch (err) {
    log(visibleError(err), "error");
    renderChannels(deviceChannelCount());
  }
}

async function onChannelSpoken(index, code) {
  const previous = state.channels[index].spoken;
  state.channels[index].spoken = knownSpoken(code);
  if (index === 0) state.spoken = state.channels[index].spoken;
  renderHeardTitle();
  try {
    await persist({ channels: state.channels, spoken: state.spoken });
    if (state.running) await window.broadcast.setChannelSpoken(index, state.channels[index].spoken);
    renderChannels(deviceChannelCount());
    renderPhoneDesks();
  } catch (err) {
    state.channels[index].spoken = previous;
    if (index === 0) state.spoken = previous;
    renderHeardTitle();
    await persist({ channels: state.channels, spoken: state.spoken });
    log(visibleError(err), "error");
    renderChannels(deviceChannelCount());
    renderPhoneDesks();
  }
}

const levelWidths = new Map();

function paintLevel(index, peak) {
  const width = `${Math.max(0, Math.min(100, Math.round((Number(peak) || 0) * 140)))}%`;
  levelWidths.set(String(index), width);
  document.querySelectorAll(`[data-channel="${index}"], [data-phone-level="${index}"]`).forEach((bar) => {
    bar.style.width = width;
  });
}

function applyLevels(peaks) {
  peaks.forEach((peak, index) => paintLevel(index, peak));
}

function speakerCaption(name, text) {
  const body = String(text || "").trim();
  const who = String(name || "").trim();
  if (!body) return "";
  if (!who) return body;
  if (body.startsWith(`${who}:`) || body.startsWith(`${who}：`)) return body;
  return `${who}: ${body}`;
}

function heardKey(channel, id) {
  if (id == null || id === "") return "";
  return `${Number.isInteger(channel) ? channel : 0}:${id}`;
}

async function renderLinks() {
  cardsEl.innerHTML = "";
  if (!state.church) return;
  let links;
  try {
    links = await window.broadcast.links(state.targets, state.spoken);
  } catch (err) {
    log(visibleError(err), "error");
    return;
  }
  links.items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "lang-card";
    card.dataset.lang = item.code;
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = `${item.flag} ${item.name}`;
    header.append(title);
    const text = document.createElement("p");
    text.className = "text";
    text.textContent = state.lines[item.code] || "대기 중...";
    card.append(header, text, linkRow("자막", item.listen), linkRow("OBS", item.overlay));
    cardsEl.append(card);
  });
}

function linkRow(label, url) {
  const row = document.createElement("div");
  row.className = "link-line";
  const name = document.createElement("strong");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = url;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "ghost";
  copy.textContent = "복사";
  copy.addEventListener("click", async () => {
    await window.broadcast.copy(url);
    copy.textContent = "복사됨";
    setTimeout(() => { copy.textContent = "복사"; }, 1200);
  });
  const open = document.createElement("button");
  open.type = "button";
  open.className = "info";
  open.textContent = "열기";
  open.addEventListener("click", () => window.broadcast.openExternal(url));
  row.append(name, input, copy, open);
  return row;
}

function setRunning(running) {
  state.running = running;
  document.getElementById("start").disabled = running || !(state.church && state.church.active);
  document.getElementById("stop").disabled = !running;
  document.getElementById("showSession").disabled = !state.settings.sessionDir && !running;
  deviceEl.disabled = running;
  document.getElementById("pickFolder").disabled = running;
  document.getElementById("pickBulletin").disabled = running;
  preacherEl.disabled = running;
  setStatus(running ? "방송 중" : (state.audio ? "장치 듣는 중" : "대기"), running ? "on" : "");
}

function fillStyle(style) {
  const value = style || { global: {}, fonts: {} };
  state.style = value;
  document.getElementById("layout").value = value.global.layout || "bottom";
  document.getElementById("align").value = value.global.align || "center";
  document.getElementById("color").value = value.global.color || "#ffffff";
  document.getElementById("bgColor").value = value.global.bgColor || "#000000";
  document.getElementById("opacity").value = value.global.bgOpacity !== undefined ? value.global.bgOpacity : 0.7;
  const rows = document.getElementById("fontRows");
  rows.innerHTML = "";
  if (!styleOutputLanguages().length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "오늘 번역할 언어에서 번역 언어를 고르면 글꼴 설정이 나타납니다.";
    rows.append(empty);
    return;
  }
  styleOutputLanguages().forEach((lang) => {
    const font = (value.fonts && value.fonts[lang.code]) || {};
    const row = document.createElement("div");
    row.className = "font-row";
    const name = document.createElement("span");
    name.textContent = `${lang.flag} ${lang.name}`;
    const controls = document.createElement("span");
    controls.className = "font-controls";
    const fontLabel = document.createElement("span");
    fontLabel.textContent = "글꼴 ";
    const picker = document.createElement("select");
    picker.dataset.font = lang.code;
    const faces = state.catalog.subtitleFonts || [];
    faces.forEach((face) => {
      const option = document.createElement("option");
      option.value = face.id;
      option.textContent = face.label;
      picker.append(option);
    });
    const savedFont = font.font;
    picker.value = faces.some((face) => face.id === savedFont) ? savedFont : (lang.defaultFont || "inter");
    const sizeLabel = document.createElement("span");
    sizeLabel.textContent = "크기 ";
    const size = document.createElement("input");
    size.type = "number";
    size.dataset.size = lang.code;
    size.value = font.fontSize || lang.defaultSize || 48;
    const spaceLabel = document.createElement("span");
    spaceLabel.textContent = " 자간 ";
    const space = document.createElement("input");
    space.type = "number";
    space.step = "0.5";
    space.dataset.space = lang.code;
    space.value = font.letterSpacing !== undefined ? font.letterSpacing : 0;
    controls.append(fontLabel, picker, sizeLabel, size, spaceLabel, space);
    row.append(name, controls);
    rows.append(row);
  });
}

function readStyle() {
  const fonts = { ...(state.style && state.style.fonts ? state.style.fonts : {}) };
  styleOutputLanguages().forEach((lang) => {
    const picker = document.querySelector(`[data-font="${lang.code}"]`);
    const size = document.querySelector(`[data-size="${lang.code}"]`);
    const space = document.querySelector(`[data-space="${lang.code}"]`);
    if (!picker || !size || !space) return;
    fonts[lang.code] = {
      font: picker.value,
      fontSize: size.value,
      letterSpacing: space.value,
    };
  });
  return {
    layout: document.getElementById("layout").value,
    align: document.getElementById("align").value,
    color: document.getElementById("color").value,
    bgColor: document.getElementById("bgColor").value,
    bgOpacity: document.getElementById("opacity").value,
    fonts,
  };
}

function bulletinSummary(extracted) {
  if (!extracted) return "";
  const lines = [];
  if (extracted.hymnNumbers && extracted.hymnNumbers.length) lines.push(`찬송 번호: ${extracted.hymnNumbers.join(", ")}`);
  if (extracted.songTitles && extracted.songTitles.length) lines.push(`곡: ${extracted.songTitles.join(", ")}`);
  if (extracted.scripture) lines.push(`성경: ${extracted.scripture}`);
  if (extracted.sermonTitle) lines.push(`제목: ${extracted.sermonTitle}`);
  if (extracted.preacherName) lines.push(`강연자: ${extracted.preacherName}`);
  if (extracted.extractedText) lines.push(extracted.extractedText);
  return lines.join("\n");
}

function showBulletin(bulletin, error) {
  const msg = document.getElementById("bulletinMsg");
  const pre = document.getElementById("bulletinText");
  if (!bulletin) {
    msg.textContent = "아직 올린 진행자료가 없습니다.";
    pre.hidden = true;
    pre.textContent = "";
    paintGlances();
    return;
  }
  msg.textContent = error
    ? `${bulletin.fileName} 을 저장했습니다. ${error}`
    : `${bulletin.fileName} 을 이 컴퓨터에 저장했습니다.`;
  const text = bulletinSummary(bulletin.extracted);
  pre.hidden = !text;
  pre.textContent = text;
  paintGlances();
}

function fillPreacherForm(preacher) {
  document.getElementById("preacherName").value = preacher ? preacher.name : "";
  document.getElementById("traits").value = preacher ? preacher.traits || "" : "";
  document.getElementById("corrections").value = preacher ? preacher.corrections || "" : "";
  document.getElementById("terms").value = preacher ? preacher.terms || "" : "";
  const learned = preacher ? [
    ["말 끊는 위치", preacher.pausePoints],
    ["정확도 교정", preacher.accuracy],
    ["자연스러움 교정", preacher.naturalness],
  ].filter(([, value]) => value && String(value).trim()).map(([label, value]) => `${label}\n${String(value).trim()}`).join("\n\n") : "";
  document.getElementById("learned").textContent = learned || "아직 없습니다. 방송을 마치면 쌓입니다.";
  document.querySelectorAll('[data-style-key="device:0"]').forEach((mirror) => {
    const field = mirror.dataset.styleField;
    if (!field || document.activeElement === mirror) return;
    mirror.value = field === "sensitivity"
      ? (sensitivityEl ? sensitivityEl.value : "normal")
      : (document.getElementById(field) ? document.getElementById(field).value : "");
  });
  paintGlances();
}

function renderPreachers() {
  const previous = preacherToSelect(state.preachers, preacherEl.value || state.settings.preacherId || "");
  preacherEl.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = state.preachers.length ? "강연자 선택" : "등록된 강연자 없음";
  preacherEl.append(empty);
  state.preachers.forEach((preacher) => {
    const option = document.createElement("option");
    option.value = preacher.id;
    option.textContent = preacher.name;
    preacherEl.append(option);
  });
  if ([...preacherEl.options].some((option) => option.value === previous)) preacherEl.value = previous;
  const current = state.preachers.find((item) => item.id === preacherEl.value) || null;
  fillPreacherForm(current);
  paintSetupGaps();
}

function formatKrw(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? "-" : "";
  const body = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${body}원`;
}

function showChurchCost(value) {
  const node = document.getElementById("churchCost");
  if (node && value != null) node.textContent = formatKrw(value);
}

function showBalance(value) {
  const node = document.getElementById("balanceCost");
  if (node && value != null) node.textContent = formatKrw(value);
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function showPrepaid(info) {
  const node = document.getElementById("prepaidTime");
  const hint = document.getElementById("prepaidHint");
  if (!node || !hint) return;
  const seconds = Math.max(0, Math.round(Number(info && info.remainingSeconds) || 0));
  const running = !!(info && info.running);
  if (seconds > 0) {
    node.textContent = `남은 시간 ${formatClock(seconds)}`;
    hint.textContent = running
      ? "이 30분이 끝나기 전에 끄면, 쓰지 않은 만큼 충전금으로 돌아갑니다."
      : "쓰지 않은 시간은 충전금으로 돌아갑니다.";
    return;
  }
  node.textContent = "남은 시간 없음";
  hint.textContent = "시작하려면 다음 30분 요금이 충전금에 있어야 합니다. 30분을 다 쓰지 않고 끄면 쓰지 않은 만큼 충전금으로 돌아갑니다.";
}

function languageLabel(code) {
  const found = (state.catalog.languages || []).find((lang) => lang.code === code);
  return found && found.name ? found.name : code;
}

function paintConfirm(preview) {
  const labels = (preview.languages || []).map(languageLabel);
  document.getElementById("confirmLangs").textContent = labels.length
    ? `선택한 언어: ${labels.join(", ")}`
    : "선택한 언어: 없음";
  const price = document.getElementById("confirmPrice");
  const extras = Math.max(0, Math.round(Number(preview.extraInputs) || 0));
  price.textContent = preview.testPeriod
    ? "테스트 기간이라 충전금을 빼지 않습니다."
    : `다음 30분: ${formatKrw(preview.halfKrw || preview.chargeKrw)}. 시간당 ${formatKrw(preview.firstHourKrw)}. 한국어와 영어, 첫 입력이 포함됩니다.`;
  if (extras) price.textContent += ` 추가 입력 ${extras}개.`;
  document.getElementById("confirmOvertime").textContent = preview.overtimeText;
  document.getElementById("confirmBalance").textContent = `남은 충전금: ${formatKrw(preview.balanceKrw)}`;
  const short = document.getElementById("confirmShort");
  short.hidden = !preview.short;
  if (preview.short) {
    short.textContent = `충전금이 부족합니다. 다음 30분에 ${formatKrw(preview.chargeKrw)}이 필요하지만 남은 충전금은 ${formatKrw(preview.balanceKrw)}입니다.`;
  } else {
    short.textContent = "";
  }
  document.getElementById("confirmStart").disabled = !!preview.short;
  showBalance(preview.balanceKrw);
  if (!state.running) showPrepaid({ remainingSeconds: preview.remainingSeconds, running: false });
}

function showChurch(church) {
  state.church = church;
  document.getElementById("churchName").textContent = church.name;
  document.getElementById("churchLine").textContent = "이 계정으로 로그인했습니다.";
  document.getElementById("churchHint").textContent = church.active
    ? "이 계정만 방송합니다. 모델, 용어집, 활성화, 키는 관리 페이지에 있습니다."
    : "이 계정은 비활성 상태입니다. 관리 페이지에서 활성화하기 전에는 방송을 시작할 수 없습니다.";
  document.getElementById("start").disabled = !church.active || state.running;
}

function defaultInputDevice() {
  return state.devices.find((device) => device.isDefault) || state.devices[0] || null;
}

async function chooseDevice() {
  let key = deviceEl.value;
  if (!key) {
    const fallback = defaultInputDevice();
    if (!fallback) return;
    key = fallback.key;
    deviceEl.value = key;
  }
  try {
    const channel = state.settings.audio && state.settings.audio.deviceKey === key
      ? state.settings.audio.channel || 0
      : 0;
    state.audio = await window.broadcast.monitor(key, channel);
    if (state.audio && state.audio.deviceKey) deviceEl.value = state.audio.deviceKey;
    renderChannels(state.audio.deviceChannels);
    audioHint.textContent = `${state.audio.apiLabel} · ${state.audio.deviceName} · 입력 ${state.audio.deviceChannels}채널 · ${state.audio.sampleRate}Hz.`;
    await persist({ audio: { deviceKey: key, channel: state.audio.deviceChannel } });
    if (!state.running) setStatus("장치 듣는 중", "");
    paintSetupGaps();
  } catch (err) {
    log(visibleError(err), "error");
    setStatus("장치 오류", "err");
  }
}

function setSignedIn(auth) {
  state.signedIn = !!(auth && auth.signedIn);
  state.operator = !!(auth && auth.operator);
  document.getElementById("signInCard").hidden = state.signedIn;
  document.getElementById("studio").hidden = !state.signedIn || state.operator;
  const operatorEl = document.getElementById("operator");
  if (operatorEl) operatorEl.hidden = !state.operator;
  const heard = document.getElementById("heardSection");
  if (heard) heard.hidden = state.operator;
  const prepaid = document.getElementById("prepaidTime");
  if (prepaid) prepaid.hidden = state.operator;
  ["balanceCost", "churchCost"].forEach((id) => {
    const node = document.getElementById(id);
    const wrap = node && node.closest ? node.closest(".header-money") : null;
    if (wrap) wrap.hidden = state.operator;
  });
  if (!state.signedIn) {
    state.church = null;
    state.operator = false;
    if (operatorEl) operatorEl.hidden = true;
    if (heard) heard.hidden = false;
    if (prepaid) prepaid.hidden = false;
    document.getElementById("churchLine").textContent = "계정으로 로그인하면 그 계정만 열립니다.";
  } else if (state.operator) {
    document.getElementById("churchLine").textContent = "이 계정으로 로그인했습니다.";
  }
}

function paintOperator(accounts) {
  const board = document.getElementById("operatorList");
  const select = document.getElementById("operatorAccount");
  board.replaceChildren();
  select.replaceChildren();
  if (!accounts.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "등록된 계정이 없습니다.";
    board.appendChild(empty);
    return;
  }
  accounts.forEach((row) => {
    const card = document.createElement("article");
    card.className = "operator-account";
    const title = document.createElement("h3");
    title.textContent = row.name;
    const balance = document.createElement("p");
    balance.textContent = `남은 잔액 ${row.balanceLabel}`;
    const time = document.createElement("p");
    time.textContent = row.timeLabel;
    const recent = document.createElement("p");
    recent.className = "hint";
    recent.textContent = row.recentLabel === "최근 사용 없음" ? row.recentLabel : `최근 사용 ${row.recentLabel}`;
    card.append(title, balance, time, recent);
    board.appendChild(card);
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.name;
    select.appendChild(option);
  });
}

async function loadOperator() {
  const msg = document.getElementById("operatorMsg");
  const periodMsg = document.getElementById("testPeriodMsg");
  try {
    const result = await window.broadcast.operatorList();
    paintOperator(result && result.accounts ? result.accounts : []);
  } catch (err) {
    if (msg) msg.textContent = visibleError(err);
  }
  try {
    const period = await window.broadcast.testPeriod();
    const box = document.getElementById("testPeriod");
    if (box) box.checked = !!(period && period.on);
    if (periodMsg) periodMsg.textContent = period && period.on ? "테스트 기간이 켜져 있습니다." : "테스트 기간이 꺼져 있습니다.";
  } catch (err) {
    if (periodMsg) periodMsg.textContent = visibleError(err);
  }
}

document.getElementById("testPeriod").addEventListener("change", async (event) => {
  const box = event.target;
  const periodMsg = document.getElementById("testPeriodMsg");
  const on = !!box.checked;
  try {
    const period = await window.broadcast.setTestPeriod(on);
    box.checked = !!(period && period.on);
    if (periodMsg) periodMsg.textContent = period && period.on ? "테스트 기간이 켜져 있습니다." : "테스트 기간이 꺼져 있습니다.";
  } catch (err) {
    box.checked = !on;
    if (periodMsg) periodMsg.textContent = visibleError(err);
  }
});

async function refreshKeyHint() {
  const hint = document.getElementById("keyHint");
  if (!state.signedIn || state.operator) {
    hint.textContent = state.operator ? "" : "번역 키는 관리 페이지에 있습니다. 이 계정은 그 키를 읽지 않습니다.";
    return;
  }
  try {
    const status = await window.broadcast.keyStatus();
    hint.textContent = status && status.configured
      ? "이 컴퓨터에 저장된 키로 인식, 번역, 진행자료 분석을 합니다."
      : "관리 페이지에서 OpenAI 키를 먼저 저장해 주세요.";
  } catch (err) {
    hint.textContent = "키 상태를 확인하지 못했습니다.";
    log(visibleError(err), "error");
  }
}

async function loadChurch() {
  const current = await window.broadcast.currentChurch();
  showChurch(current.church);
  state.preachers = current.preachers || [];
  renderPreachers();
  fillStyle(current.style);
  showBulletin(current.bulletin);
  if (!state.running) {
    if (current.balanceKrw != null) showBalance(current.balanceKrw);
    try {
      const preview = await window.broadcast.previewBilling(state.targets, billingSpoken(), extraChannelIndexes());
      showBalance(preview.balanceKrw);
      showPrepaid({ remainingSeconds: preview.remainingSeconds, running: false });
    } catch (err) {
      log(visibleError(err), "error");
    }
  }
  if (state.church) {
    try { await window.broadcast.setTargets(state.targets, state.spoken); }
    catch (err) { log(visibleError(err), "error"); }
  }
  await renderLinks();
}

async function boot() {
  placePhoneCardBeforeInput();
  state.catalog = await window.broadcast.catalog();
  state.settings = await window.broadcast.getSettings();
  sensitivityEl.value = state.settings.sensitivity || "normal";
  const showName = document.getElementById("showPreacherName");
  if (showName) showName.checked = !(state.settings && state.settings.showPreacherName === false);
  const kind = document.getElementById("sessionKind");
  if (kind && state.settings.sessionKind) kind.value = state.settings.sessionKind;
  paintFolderHint();
  renderSpoken(state.settings.spoken);
  await renderLangs(state.settings.targets || state.catalog.defaultTargets);
  const auth = await window.broadcast.authStatus();
  setSignedIn(auth);
  await refreshKeyHint();
  if (state.operator) {
    await loadOperator();
    return;
  }
  if (state.signedIn) {
    if (auth.church) showChurch(auth.church);
    await loadChurch();
  }
  await reloadDevices();
  try { showPhoneJoin(await window.broadcast.phoneJoin()); }
  catch (err) { log(visibleError(err), "error"); }
  const savedCount = Number(state.settings.phoneCount);
  if (Number.isInteger(savedCount) && savedCount > 0) {
    try { showPhoneJoin(await window.broadcast.setPhoneCount(savedCount)); }
    catch (err) { log(visibleError(err), "error"); }
  }
  paintSetupGaps();
  if (!(state.settings && state.settings.setupClosed)) openSettings();
  window.broadcast.onEvent((event) => {
    if (event.type === "levels") applyLevels(event.peaks || []);
    if (event.type === "level") paintLevel(event.channel, event.peak || 0);
    if (event.type === "phone-join") showPhoneJoin(event.info);
    if (event.type === "phones") applyPhoneRoster(event.channels);
    if (event.type === "live") hearing.live(channelPrefix(event.channel, event.text, event.name));
    if (event.type === "heard") hearing.heard(heardKey(event.channel, event.id), channelPrefix(event.channel, event.text, event.name));
    if (event.type === "line" && event.lang) {
      const lineRow = Number.isInteger(event.channel) ? state.channels[event.channel] : null;
      const lineName = lineRow && lineRow.showName === false ? "" : (event.name || (lineRow && lineRow.name) || "");
      const caption = speakerCaption(lineName, event.text);
      if (!state.captions) state.captions = {};
      if (!state.captions[event.lang]) state.captions[event.lang] = new Map();
      const key = Number.isInteger(event.channel) ? event.channel : 0;
      if (!event.text) state.captions[event.lang].delete(key);
      else state.captions[event.lang].set(key, caption);
      const joined = [...state.captions[event.lang].values()].filter(Boolean).join("\n");
      state.lines[event.lang] = joined;
      const card = cardsEl.querySelector(`[data-lang="${event.lang}"] .text`);
      if (card) card.textContent = joined || "대기 중...";
      const row = Number.isInteger(event.channel) ? state.channels[event.channel] : null;
      const source = row ? row.spoken : state.spoken;
      if (event.lang === source && event.isFinal && event.text && event.text !== event.raw) {
        hearing.corrected(heardKey(event.channel, event.heardId), event.raw, event.text);
      }
    }
    if (event.type === "log") log(event.text, event.level);
    if (event.type === "audio" && event.audio) {
      state.audio = event.audio;
      renderChannels(event.audio.deviceChannels);
    }
    if (event.type === "cost") {
      showChurchCost(event.chargedKrw != null ? event.chargedKrw : event.churchKrw);
      if (event.balanceKrw != null) showBalance(event.balanceKrw);
    }
    if (event.type === "prepaid") showPrepaid(event);
    if (event.type === "session") {
      if (event.running) hearing.reset();
      if (event.churchKrw != null) showChurchCost(event.chargedKrw != null ? event.chargedKrw : event.churchKrw);
      if (event.balanceKrw != null) showBalance(event.balanceKrw);
      if (event.remainingSeconds != null) showPrepaid({ remainingSeconds: event.remainingSeconds, running: !!event.running });
      setRunning(!!event.running);
      if (event.dir) {
        folderHint.textContent = event.dir;
        state.settings.sessionDir = event.dir;
        document.getElementById("showSession").disabled = false;
      }
    }
  });
}

async function reloadDevices() {
  const result = await window.broadcast.listDevices();
  state.devices = result.devices || [];
  renderDevices();
  (result.notes || []).forEach((note) => log(note, "info"));
  const saved = state.settings.audio && state.settings.audio.deviceKey;
  if (saved && !state.devices.some((device) => device.key === saved)) {
    const fallback = defaultInputDevice();
    if (fallback) deviceEl.value = fallback.key;
  }
  if (deviceEl.value || state.devices.length) await chooseDevice();
}

document.getElementById("churchSignIn").addEventListener("click", async () => {
  const email = document.getElementById("churchEmail").value.trim();
  const password = document.getElementById("churchPassword").value;
  const msg = document.getElementById("signInMsg");
  msg.textContent = "";
  try {
    const auth = await window.broadcast.signIn(email, password);
    document.getElementById("churchPassword").value = "";
    setSignedIn(auth);
    if (auth.operator) {
      await loadOperator();
      log("이 계정으로 로그인했습니다.");
      return;
    }
    if (auth.church) showChurch(auth.church);
    await refreshKeyHint();
    await loadChurch();
    log("이 계정으로 로그인했습니다.");
  } catch (err) {
    msg.textContent = visibleError(err);
  }
});

async function signOut() {
  await window.broadcast.signOut();
  setSignedIn({ signedIn: false });
  cardsEl.innerHTML = "";
  paintOperator([]);
}

document.getElementById("signOut").addEventListener("click", async () => {
  try {
    await signOut();
  } catch (err) {
    log(visibleError(err), "error");
  }
});

document.getElementById("operatorSignOut").addEventListener("click", async () => {
  const msg = document.getElementById("operatorMsg");
  try {
    await signOut();
  } catch (err) {
    if (msg) msg.textContent = visibleError(err);
  }
});

document.getElementById("operatorCredit").addEventListener("click", async () => {
  const msg = document.getElementById("operatorMsg");
  msg.textContent = "";
  const accountId = document.getElementById("operatorAccount").value;
  const amount = Math.round(Number(document.getElementById("operatorAmount").value) || 0);
  if (!(amount > 0)) {
    msg.textContent = "충전할 금액을 적으세요";
    return;
  }
  try {
    const result = await window.broadcast.operatorCredit(accountId, amount);
    document.getElementById("operatorAmount").value = "";
    msg.textContent = `${amount.toLocaleString("ko-KR")}원을 더했습니다. 남은 잔액은 ${result.balanceLabel}입니다.`;
    await loadOperator();
  } catch (err) {
    msg.textContent = visibleError(err);
  }
});

document.getElementById("saveStyle").addEventListener("click", async () => {
  try {
    state.style = await window.broadcast.saveStyle(readStyle());
    fillStyle(state.style);
    document.getElementById("styleMsg").textContent = "자막 위치와 글자를 저장했습니다.";
  } catch (err) {
    document.getElementById("styleMsg").textContent = visibleError(err);
  }
});

document.getElementById("pickBulletin").addEventListener("click", async () => {
  try {
    const bulletin = await window.broadcast.pickBulletin();
    if (!bulletin) return;
    showBulletin(bulletin, bulletin.error);
    if (bulletin.extracted && bulletin.extracted.preacherName && !preacherEl.value) {
      const match = state.preachers.find((item) => item.name.replace(/\s+/g, "") === bulletin.extracted.preacherName.replace(/\s+/g, ""));
      if (match) {
        preacherEl.value = match.id;
        fillPreacherForm(match);
        await persist({ preacherId: match.id });
      }
    }
    log(bulletin.error || "진행자료를 저장했습니다.");
  } catch (err) {
    log(visibleError(err), "error");
  }
});

preacherEl.addEventListener("change", async () => {
  const current = state.preachers.find((item) => item.id === preacherEl.value) || null;
  fillPreacherForm(current);
  await persist({ preacherId: preacherEl.value });
  paintSetupGaps();
});

document.getElementById("addPreacher").addEventListener("click", async () => {
  const name = document.getElementById("preacherName").value.trim();
  const msg = document.getElementById("preacherMsg");
  msg.textContent = "";
  try {
    const saved = await window.broadcast.savePreacher({
      name,
      traits: document.getElementById("traits").value,
      corrections: document.getElementById("corrections").value,
      terms: document.getElementById("terms").value,
    });
    state.preachers.push(saved);
    state.preachers.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    preacherEl.value = saved.id;
    renderPreachers();
    preacherEl.value = saved.id;
    fillPreacherForm(saved);
    await persist({ preacherId: saved.id });
    msg.textContent = "강연자를 등록했습니다.";
  } catch (err) {
    msg.textContent = visibleError(err);
  }
});

document.getElementById("savePreacher").addEventListener("click", async () => {
  const msg = document.getElementById("preacherMsg");
  msg.textContent = "";
  if (!preacherEl.value) {
    msg.textContent = "저장할 강연자를 선택해 주세요. 새 강연자는 등록 버튼으로 만듭니다.";
    return;
  }
  try {
    const saved = await window.broadcast.savePreacher({
      id: preacherEl.value,
      name: document.getElementById("preacherName").value.trim(),
      traits: document.getElementById("traits").value,
      corrections: document.getElementById("corrections").value,
      terms: document.getElementById("terms").value,
    });
    state.preachers = state.preachers.map((item) => (item.id === saved.id ? saved : item));
    renderPreachers();
    preacherEl.value = saved.id;
    fillPreacherForm(saved);
    msg.textContent = "강연자 프로필을 저장했습니다.";
  } catch (err) {
    msg.textContent = visibleError(err);
  }
});

function preacherNameShown() {
  const box = document.getElementById("showPreacherName");
  return !(box && box.checked === false);
}

function preacherDisplayName() {
  const typed = document.getElementById("preacherName") && document.getElementById("preacherName").value.trim();
  if (typed) return typed;
  const picked = preacherEl && preacherEl.selectedOptions && preacherEl.selectedOptions[0]
    ? preacherEl.selectedOptions[0].textContent
    : "";
  if (picked && picked.indexOf("없") < 0 && picked !== "강연자 선택") return picked;
  return "";
}

function channelPrefix(index, text, name) {
  const value = String(text || "");
  if (!value) return value;
  const row = Number.isInteger(index) ? state.channels[index] : null;
  if (row && row.showName === false) return value;
  let who = String(name || (row && row.name) || "").trim();
  if (!who && index === 0 && (!row || row.source !== "phone") && preacherNameShown()) who = preacherDisplayName();
  if (who) return speakerCaption(who, value);
  if (!Number.isInteger(index) || activeChannelRows().length < 2) return value;
  return speakerCaption(`채널 ${index + 1}`, value);
}

function appendPhoneNameSwitch(parent, slot, view) {
  const joined = phoneJoined(view);
  const draft = !joined && view.connectionId ? pendingPhoneDisplay.get(view.connectionId) : null;
  const checkLabel = document.createElement("label");
  checkLabel.className = "check name-switch";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.dataset.phoneEdit = "show";
  box.dataset.connectionId = view.connectionId || "";
  box.checked = draft && draft.showName != null ? draft.showName !== false : view.showName !== false;
  box.setAttribute("aria-label", `휴대폰 ${slot} 이름을 자막에 표시`);
  box.addEventListener("change", () => {
    if (!view.connectionId) return;
    if (!phoneJoined(view)) {
      const prev = pendingPhoneDisplay.get(view.connectionId) || {};
      pendingPhoneDisplay.set(view.connectionId, { ...prev, showName: box.checked });
      return;
    }
    applyPhoneDisplay(view.connectionId, { showName: box.checked });
  });
  checkLabel.append(box, document.createTextNode(" 이 이름을 자막에 표시"));
  parent.append(checkLabel);
}

function appendPhoneNameEditor(parent, slot, view) {
  const joined = phoneJoined(view);
  const draft = !joined && view.connectionId ? pendingPhoneDisplay.get(view.connectionId) : null;
  const nameLabel = document.createElement("label");
  nameLabel.className = "caption-name";
  nameLabel.textContent = "이름";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 40;
  input.className = "phone-display-name";
  input.dataset.phoneEdit = "name";
  input.dataset.connectionId = view.connectionId || "";
  input.value = draft && draft.name != null ? draft.name : (view.name || "");
  input.setAttribute("aria-label", `휴대폰 ${slot} 자막 이름`);
  input.addEventListener("change", () => {
    if (!view.connectionId) return;
    if (!phoneJoined(view)) {
      const prev = pendingPhoneDisplay.get(view.connectionId) || {};
      pendingPhoneDisplay.set(view.connectionId, { ...prev, name: input.value });
      return;
    }
    applyPhoneDisplay(view.connectionId, { name: input.value });
  });
  parent.append(nameLabel, input);
}

async function applyPhoneDisplay(connectionId, patch) {
  try {
    const shown = await window.broadcast.setPhoneDisplay(connectionId, patch);
    const desks = state.phoneJoin && Array.isArray(state.phoneJoin.channels) ? state.phoneJoin.channels : [];
    const desk = desks.find((item) => item && item.connectionId === connectionId);
    if (desk && shown) {
      desk.name = shown.name;
      desk.showName = shown.showName !== false;
    }
    const row = (state.channels || []).find((item) => item && item.source === "phone" && item.connectionId === connectionId);
    if (row && shown) {
      row.name = shown.name;
      row.showName = shown.showName !== false;
    }
    renderPhoneDesks();
  } catch (err) {
    log(visibleError(err), "error");
    renderPhoneDesks();
  }
}

document.getElementById("showPreacherName").addEventListener("change", () => {
  setPreacherNameShown(document.getElementById("showPreacherName").checked);
});
document.getElementById("openSettings").addEventListener("click", () => openSettings());
document.getElementById("closeSettings").addEventListener("click", () => closeSettings());
document.getElementById("sessionKind").addEventListener("change", async () => {
  await persist({ sessionKind: sessionKindValue() });
  paintGlances();
  paintSetupGaps();
});
document.getElementById("phoneCount").addEventListener("change", async () => {
  const input = document.getElementById("phoneCount");
  const count = Number(input.value);
  const msg = document.getElementById("phoneCountMsg");
  try {
    showPhoneJoin(await window.broadcast.setPhoneCount(count));
    await persist({ phoneCount: count });
    if (msg) msg.textContent = count === 0 ? "휴대폰 없이 시작합니다." : "각 휴대폰 앱에서 그 칸의 QR을 스캔하세요.";
  } catch (err) {
    if (msg) msg.textContent = visibleError(err);
    log(visibleError(err), "error");
  }
});
document.getElementById("reloadDevices").addEventListener("click", reloadDevices);
deviceEl.addEventListener("change", chooseDevice);
sensitivityEl.addEventListener("change", () => {
  persist({ sensitivity: sensitivityEl.value }).catch((err) => log(visibleError(err), "error"));
  rememberStyle("device:0", lecturerStyle());
  paintGlances();
});
["traits", "corrections", "terms"].forEach((id) => {
  const field = document.getElementById(id);
  if (!field) return;
  field.addEventListener("change", () => {
    rememberStyle("device:0", lecturerStyle());
    paintGlances();
  });
});
["layout", "align"].forEach((id) => {
  const field = document.getElementById(id);
  if (!field) return;
  field.addEventListener("change", () => paintGlances());
});
document.getElementById("pickDefault").addEventListener("click", () => renderLangs(state.catalog.defaultTargets));
document.getElementById("pickAll").addEventListener("click", () => {
  renderLangs(state.catalog.languages.filter((lang) => lang.code !== "ko").map((lang) => lang.code));
});
document.getElementById("pickNone").addEventListener("click", () => renderLangs([]));
document.getElementById("pickFolder").addEventListener("click", async () => {
  const folder = await window.broadcast.pickFolder();
  state.settings = await window.broadcast.getSettings();
  if (folder && state.settings) state.settings.folder = folder;
  paintFolderHint();
  paintSetupGaps();
});
let startTask = null;

function adoptBroadcast(started) {
  if (started && Array.isArray(started.channels) && started.channels.length) {
    state.channels = started.channels.map(mapChannel);
    if (state.channels[0]) state.spoken = state.channels[0].spoken;
    const deviceCount = state.channels.filter((row) => row.source !== "phone").length;
    renderChannels(deviceCount);
    renderPhoneDesks();
  }
  setRunning(true);
}

async function beginBroadcast() {
  if (state.running) {
    setRunning(true);
    return;
  }
  if (startTask) return startTask;
  startTask = runBroadcastStart().finally(() => { startTask = null; });
  return startTask;
}

async function runBroadcastStart() {
  if (state.channels[0]) state.spoken = state.channels[0].spoken;
  renderHeardTitle();
  await persist({
    sensitivity: sensitivityEl.value,
    folder: state.settings.folder,
    targets: selectedTargets(),
    spoken: state.spoken,
    channels: state.channels,
    preacherId: selectedPreacherId(),
    sessionKind: sessionKindValue(),
  });
  state.lines = {};
  state.captions = {};
  const started = await window.broadcast.start({
    sensitivity: sensitivityEl.value,
    speechStyle: lecturerStyle(),
    sourceStyles: (state.settings && state.settings.sourceStyles) || {},
    folder: state.settings.folder,
    targets: selectedTargets(),
    spoken: state.spoken,
    channels: state.channels,
    preacherId: selectedPreacherId(),
    sessionKind: sessionKindValue(),
    deviceKey: deviceEl.value,
    channel: state.audio ? state.audio.deviceChannel : 0,
    showPreacherName: !(document.getElementById("showPreacherName") && document.getElementById("showPreacherName").checked === false),
  });
  adoptBroadcast(started);
  if (started && started.already) return;
  log("방송을 시작했습니다. 언어별 텍스트만 저장합니다.");
}

document.getElementById("start").addEventListener("click", async () => {
  try {
    const gaps = missingSetup(currentSetup());
    if (gaps.length) {
      openSettings();
      return;
    }
    const preview = await window.broadcast.previewBilling(selectedTargets(), billingSpoken(), extraChannelIndexes());
    paintConfirm(preview);
    document.getElementById("startConfirm").hidden = false;
  } catch (err) {
    try { state.settings = await window.broadcast.getSettings(); } catch (_) { /* 설정 갱신 실패는 시작 오류 아래에 둡니다 */ }
    paintFolderHint();
    paintSetupGaps();
    log(visibleError(err), "error");
    setStatus("시작 실패", "err");
  }
});
document.getElementById("confirmCancel").addEventListener("click", () => {
  document.getElementById("startConfirm").hidden = true;
  if (!state.running) setStatus("대기", "");
});
document.getElementById("confirmStart").addEventListener("click", async () => {
  try {
    const gaps = missingSetup(currentSetup());
    if (gaps.length) {
      openSettings();
      return;
    }
    const preview = await window.broadcast.previewBilling(selectedTargets(), billingSpoken(), extraChannelIndexes());
    paintConfirm(preview);
    if (preview.short) return;
    document.getElementById("startConfirm").hidden = true;
    await beginBroadcast();
  } catch (err) {
    const message = visibleError(err);
    if (message.includes("이미 방송 중입니다")) {
      setRunning(true);
      return;
    }
    try { state.settings = await window.broadcast.getSettings(); } catch (_) { /* 설정 갱신 실패는 시작 오류 아래에 둡니다 */ }
    paintFolderHint();
    paintSetupGaps();
    log(message, "error");
    if (!state.running) setStatus("시작 실패", "err");
  }
});
document.getElementById("stop").addEventListener("click", async () => {
  try {
    await window.broadcast.stop();
    const current = await window.broadcast.currentChurch();
    state.preachers = current.preachers || state.preachers;
    renderPreachers();
  } catch (err) {
    log(visibleError(err), "error");
  }
});
document.getElementById("showSession").addEventListener("click", () => window.broadcast.showSession());

boot().catch((err) => {
  log(visibleError(err), "error");
  setStatus("오류", "err");
});
