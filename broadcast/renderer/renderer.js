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
  lines: {},
  targets: [],
  spoken: "ko",
  channels: [],
  style: null,
};

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `pill${kind ? ` ${kind}` : ""}`;
}

const hearing = window.Hearing.createHearing(document, liveEl, koStackEl);

function log(text, level) {
  const line = document.createElement("div");
  if (level === "error") line.className = "err";
  line.textContent = String(text || "").replace(/sk-[A-Za-z0-9_-]{4,}/g, "[redacted]");
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

function activeChannelRows() {
  return (state.channels || []).map((row, index) => ({ ...row, index })).filter((row) => row.on);
}

function channelTitle(row) {
  if (row && row.name) return row.name;
  return `채널 ${row.index + 1}`;
}

function renderHeardTitle() {
  if (!heardTitleEl) return;
  const on = activeChannelRows();
  if (on.length === 1 && on[0].name) {
    heardTitleEl.textContent = `지금 듣는 ${on[0].name} · ${spokenName(on[0].spoken)}`;
    return;
  }
  if (on.length <= 1) {
    const code = on.length ? on[0].spoken : state.spoken;
    heardTitleEl.textContent = `지금 듣는 ${spokenName(code)}`;
    return;
  }
  heardTitleEl.textContent = `지금 듣는 ${on.map((row) => `${channelTitle(row)} ${spokenName(row.spoken)}`).join(" · ")}`;
}

function billingSpoken() {
  const on = activeChannelRows();
  return on.length ? on.map((row) => row.spoken) : [state.spoken || "ko"];
}

function extraChannelIndexes() {
  return (state.channels || []).map((row, index) => (row.on ? index : -1)).filter((index) => index > 0);
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
    rows.push({ spoken, on, source: "device", name: "", phoneId: "", connected: true });
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
  persist({ setupClosed: true }).catch((err) => log(err.message || String(err), "error"));
}

function paintFolderHint() {
  if (!folderHint || !state.settings) return;
  if (state.settings.folder && state.settings.folderReady !== true) {
    folderHint.textContent = "고른 폴더에 기록을 만들 수 없습니다. 폴더 선택을 다시 눌러 주세요.";
    return;
  }
  if (state.settings.folder) folderHint.textContent = state.settings.folder;
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
  langCount.textContent = `번역 ${state.targets.length}개 · 지금 듣는 ${spokenName(state.spoken)}`;
  langsEl.querySelectorAll(".lang").forEach((label) => {
    label.classList.toggle("on", label.querySelector("input").checked);
  });
  await persist({ targets: state.targets, spoken: state.spoken });
  if (sync && state.church) {
    try {
      const applied = await window.broadcast.setTargets(state.targets, state.spoken);
      if (Array.isArray(applied)) state.targets = applied;
    } catch (err) {
      log(err.message || String(err), "error");
      state.targets = previous;
      restoreLangChecks(previous);
      langCount.textContent = `번역 ${state.targets.length}개 · 지금 듣는 ${spokenName(state.spoken)}`;
      await persist({ targets: state.targets, spoken: state.spoken });
    }
  }
  if (state.style) fillStyle(state.style);
  await renderLinks();
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
}

function deviceChannelCount() {
  if (state.audio && state.audio.deviceChannels) return state.audio.deviceChannels;
  return state.channels.filter((row) => row.source !== "phone").length;
}

function renderChannels(count) {
  const total = Number.isInteger(count) ? count : deviceChannelCount();
  ensureChannels(total);
  channelsEl.innerHTML = "";
  state.channels.forEach((row, i) => {
    const wrap = document.createElement("div");
    wrap.className = `channel${row.on ? " on" : ""}${row.source === "phone" ? " phone" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    if (row.source === "phone") {
      const mark = row.connected === false ? "끊김" : (row.on ? "켜짐" : "꺼짐");
      button.textContent = `${row.name} · ${spokenName(row.spoken)} · ${mark}`;
    } else {
      button.textContent = `채널 ${i + 1}${row.on ? " 켜짐" : " 꺼짐"}`;
    }
    button.addEventListener("click", () => toggleChannel(i));
    const meter = document.createElement("div");
    meter.className = "meter";
    const bar = document.createElement("span");
    bar.dataset.channel = String(i);
    meter.append(bar);
    const select = document.createElement("select");
    select.className = "channel-spoken";
    select.dataset.channel = String(i);
    select.setAttribute("aria-label", row.source === "phone" ? `${row.name} 말하는 언어` : `채널 ${i + 1} 말하는 언어`);
    if (i === 0) select.id = "spoken";
    fillSpokenSelect(select, row.spoken);
    select.addEventListener("change", () => onChannelSpoken(i, select.value));
    wrap.append(button, meter, select);
    channelsEl.append(wrap);
  });
  renderHeardTitle();
}

function deskChannelIndex(desk) {
  const rows = state.channels || [];
  if (desk && desk.connectionId) {
    const found = rows.findIndex((row) => row && row.source === "phone" && row.connectionId === desk.connectionId);
    if (found >= 0) return found;
  }
  if (desk && Number.isInteger(desk.channelIndex) && desk.channelIndex >= 0) {
    const row = rows[desk.channelIndex];
    if (row && row.source === "phone") return desk.channelIndex;
  }
  return -1;
}

function renderPhoneDesks() {
  const root = document.getElementById("phoneDesks");
  if (!root) return;
  const info = state.phoneJoin || {};
  const desks = Array.isArray(info.channels) ? info.channels : [];
  const countEl = document.getElementById("phoneCount");
  if (countEl && document.activeElement !== countEl) countEl.value = String(desks.length);
  root.innerHTML = "";
  if (!desks.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "휴대폰 수를 고르면 각 휴대폰의 암호가 나옵니다.";
    root.append(empty);
    return;
  }
  desks.forEach((desk, index) => {
    const wrap = document.createElement("div");
    wrap.className = "phone-desk";
    const title = document.createElement("h3");
    title.textContent = `휴대폰 ${index + 1}`;
    const idLabel = document.createElement("label");
    idLabel.textContent = "암호";
    const idInput = document.createElement("input");
    idInput.className = "join-code";
    idInput.type = "text";
    idInput.readOnly = true;
    idInput.autocomplete = "off";
    idInput.value = desk.connectionId || "";
    idInput.setAttribute("aria-label", `휴대폰 ${index + 1} 암호`);
    const status = document.createElement("p");
    status.className = "hint";
    if (desk.connected && desk.name) status.textContent = `${desk.name} 연결됨`;
    else if (desk.name) status.textContent = `${desk.name} · 끊김`;
    else status.textContent = "이름과 이 암호로 로그인하면 연결됩니다.";
    const channelIndex = deskChannelIndex(desk);
    const select = document.createElement("select");
    select.className = "channel-spoken";
    select.setAttribute("aria-label", `휴대폰 ${index + 1} 말하는 언어`);
    const spokenCode = channelIndex >= 0 && state.channels[channelIndex] ? state.channels[channelIndex].spoken : (desk.spoken || "ko");
    fillSpokenSelect(select, spokenCode || "ko");
    select.disabled = channelIndex < 0;
    if (channelIndex >= 0) {
      select.value = knownSpoken(state.channels[channelIndex].spoken);
      select.addEventListener("change", () => onChannelSpoken(channelIndex, select.value));
    }
    wrap.append(title, idLabel, idInput, status, select);
    root.append(wrap);
  });
}

function showPhoneJoin(info) {
  state.phoneJoin = info || {};
  renderPhoneDesks();
}

function mapChannel(row) {
  return {
    spoken: knownSpoken(row && row.spoken),
    on: !!(row && row.on),
    source: row && row.source === "phone" ? "phone" : "device",
    name: row && row.source === "phone" ? (row.name || "") : "",
    phoneId: row && row.source === "phone" ? (row.phoneId || "") : "",
    connectionId: row && row.source === "phone" ? (row.connectionId || "") : "",
    connected: !(row && row.source === "phone") || row.connected !== false,
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
    log(err.message || String(err), "error");
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
    log(err.message || String(err), "error");
    renderChannels(deviceChannelCount());
    renderPhoneDesks();
  }
}

function paintLevel(index, peak) {
  const bar = channelsEl.querySelector(`[data-channel="${index}"]`);
  if (!bar) return;
  const width = Math.max(0, Math.min(100, Math.round(peak * 140)));
  bar.style.width = `${width}%`;
}

function applyLevels(peaks) {
  peaks.forEach((peak, index) => paintLevel(index, peak));
}

function speakerCaption(name, text) {
  const body = String(text || "").trim();
  const who = String(name || "").trim();
  if (!body) return "";
  if (!who) return body;
  return `${who}: ${body}`;
}

async function renderLinks() {
  cardsEl.innerHTML = "";
  if (!state.church) return;
  let links;
  try {
    links = await window.broadcast.links(state.targets, state.spoken);
  } catch (err) {
    log(err.message || String(err), "error");
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
    return;
  }
  msg.textContent = error
    ? `${bulletin.fileName} 을 저장했습니다. ${error}`
    : `${bulletin.fileName} 을 이 컴퓨터에 저장했습니다.`;
  const text = bulletinSummary(bulletin.extracted);
  pre.hidden = !text;
  pre.textContent = text;
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
      ? "이 시간이 끝날 때까지 추가 요금은 없습니다."
      : "이어서 쓸 수 있는 시간입니다. 끄면 타이머가 멈추고, 이 시간이 끝날 때까지 추가 요금은 없습니다.";
    return;
  }
  node.textContent = "남은 시간 없음";
  hint.textContent = "방송을 켜 둔 시간만 줄어듭니다. 끄면 남은 시간이 이 교회에 남습니다.";
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
  if (preview.noExtraCharge) {
    price.textContent = `${preview.label || `남은 시간 ${formatClock(preview.remainingSeconds)}`}. 이번 시작은 추가 요금이 없습니다.`;
  } else if (preview.mode === "extra") {
    const added = (preview.addedLanguages || []).map(languageLabel).join(", ");
    price.textContent = `추가 언어 ${added}: ${formatKrw(preview.extraFeeKrw)} (언어당 5,000원, 이번 남은 시간에 한 번). 남은 시간은 그대로입니다.`;
  } else {
    price.textContent = `첫 시간 요금: ${formatKrw(preview.firstHourKrw)}. 영어는 기본 요금에 포함됩니다.`;
  }
  if (preview.channelFeeKrw) {
    price.textContent += ` 추가 채널: ${formatKrw(preview.channelFeeKrw)} (채널당 ${formatKrw(preview.channelFeeEachKrw || 10000)}, 한 번).`;
  }
  if (preview.blockedChannels && preview.blockedChannels.length) {
    const names = preview.blockedChannels.map((index) => `채널 ${index + 1}`).join(", ");
    price.textContent += ` ${names}은 충전금이 부족해 시작하지 않습니다. 채널 1은 그대로 방송됩니다.`;
  }
  document.getElementById("confirmOvertime").textContent = preview.overtimeText;
  document.getElementById("confirmBalance").textContent = `남은 충전금: ${formatKrw(preview.balanceKrw)}`;
  const short = document.getElementById("confirmShort");
  short.hidden = !preview.short;
  if (preview.short && preview.mode === "extra") {
    short.textContent = `충전금이 부족합니다. 추가 언어 요금 ${formatKrw(preview.extraFeeKrw)}이 필요하지만 남은 충전금은 ${formatKrw(preview.balanceKrw)}입니다.`;
  } else if (preview.short) {
    short.textContent = `충전금이 부족합니다. 첫 시간에 ${formatKrw(preview.firstHourKrw)}이 필요하지만 남은 충전금은 ${formatKrw(preview.balanceKrw)}입니다.`;
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
  document.getElementById("churchLine").textContent = `${church.name} 계정으로 로그인했습니다.`;
  document.getElementById("churchHint").textContent = church.active
    ? "이 교회만 방송합니다. 모델, 용어집, 활성화, 키는 관리 페이지에 있습니다."
    : "이 교회는 비활성 상태입니다. 관리 페이지에서 활성화하기 전에는 방송을 시작할 수 없습니다.";
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
    log(err.message || String(err), "error");
    setStatus("장치 오류", "err");
  }
}

function setSignedIn(auth) {
  state.signedIn = !!(auth && auth.signedIn);
  document.getElementById("signInCard").hidden = state.signedIn;
  document.getElementById("studio").hidden = !state.signedIn;
  if (!state.signedIn) {
    state.church = null;
    document.getElementById("churchLine").textContent = "교회 계정으로 로그인하면 그 교회만 열립니다.";
  }
}

async function refreshKeyHint() {
  const hint = document.getElementById("keyHint");
  if (!state.signedIn) {
    hint.textContent = "번역 키는 관리 페이지에 있습니다. 교회 계정은 그 키를 읽지 않습니다.";
    return;
  }
  try {
    const status = await window.broadcast.keyStatus();
    hint.textContent = status && status.configured
      ? "이 컴퓨터에 저장된 키로 인식, 번역, 진행자료 분석을 합니다."
      : "관리 페이지에서 OpenAI 키를 먼저 저장해 주세요.";
  } catch (err) {
    hint.textContent = "키 상태를 확인하지 못했습니다.";
    log(err.message || String(err), "error");
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
      log(err.message || String(err), "error");
    }
  }
  if (state.church) {
    try { await window.broadcast.setTargets(state.targets, state.spoken); }
    catch (err) { log(err.message || String(err), "error"); }
  }
  await renderLinks();
}

async function boot() {
  state.catalog = await window.broadcast.catalog();
  state.settings = await window.broadcast.getSettings();
  sensitivityEl.value = state.settings.sensitivity || "normal";
  const kind = document.getElementById("sessionKind");
  if (kind && state.settings.sessionKind) kind.value = state.settings.sessionKind;
  paintFolderHint();
  renderSpoken(state.settings.spoken);
  await renderLangs(state.settings.targets || state.catalog.defaultTargets);
  const auth = await window.broadcast.authStatus();
  setSignedIn(auth);
  await refreshKeyHint();
  if (state.signedIn) {
    if (auth.church) showChurch(auth.church);
    await loadChurch();
  }
  await reloadDevices();
  try { showPhoneJoin(await window.broadcast.phoneJoin()); }
  catch (err) { log(err.message || String(err), "error"); }
  const savedCount = Number(state.settings.phoneCount);
  if (Number.isInteger(savedCount) && savedCount > 0) {
    try { showPhoneJoin(await window.broadcast.setPhoneCount(savedCount)); }
    catch (err) { log(err.message || String(err), "error"); }
  }
  paintSetupGaps();
  if (!(state.settings && state.settings.setupClosed)) openSettings();
  window.broadcast.onEvent((event) => {
    if (event.type === "levels") applyLevels(event.peaks || []);
    if (event.type === "level") paintLevel(event.channel, event.peak || 0);
    if (event.type === "phone-join") showPhoneJoin(event.info);
    if (event.type === "phones") applyPhoneRoster(event.channels);
    if (event.type === "live") hearing.live(channelPrefix(event.channel, event.text, event.name));
    if (event.type === "heard") hearing.heard(event.id, channelPrefix(event.channel, event.text, event.name));
    if (event.type === "line" && event.lang) {
      const caption = speakerCaption(event.name, event.text);
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
        hearing.corrected(event.heardId, event.raw, event.text);
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
    if (auth.church) showChurch(auth.church);
    await refreshKeyHint();
    await loadChurch();
    log(`${auth.church ? auth.church.name : "교회"} 계정으로 로그인했습니다.`);
  } catch (err) {
    msg.textContent = err.message || String(err);
  }
});

document.getElementById("signOut").addEventListener("click", async () => {
  try {
    await window.broadcast.signOut();
    setSignedIn({ signedIn: false });
    cardsEl.innerHTML = "";
  } catch (err) {
    log(err.message || String(err), "error");
  }
});

document.getElementById("saveStyle").addEventListener("click", async () => {
  try {
    state.style = await window.broadcast.saveStyle(readStyle());
    fillStyle(state.style);
    document.getElementById("styleMsg").textContent = "자막 위치와 글자를 저장했습니다.";
  } catch (err) {
    document.getElementById("styleMsg").textContent = err.message || String(err);
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
    log(err.message || String(err), "error");
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
    msg.textContent = err.message || String(err);
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
    msg.textContent = err.message || String(err);
  }
});

function channelPrefix(index, text, name) {
  const value = String(text || "");
  if (!value) return value;
  const row = Number.isInteger(index) ? state.channels[index] : null;
  const who = String(name || (row && row.name) || "").trim();
  if (who) return `${who}: ${value}`;
  if (!Number.isInteger(index) || activeChannelRows().length < 2) return value;
  return `채널 ${index + 1} ${value}`;
}

document.getElementById("openSettings").addEventListener("click", () => openSettings());
document.getElementById("closeSettings").addEventListener("click", () => closeSettings());
document.getElementById("sessionKind").addEventListener("change", async () => {
  await persist({ sessionKind: sessionKindValue() });
  paintSetupGaps();
});
document.getElementById("phoneCount").addEventListener("change", async () => {
  const input = document.getElementById("phoneCount");
  const count = Number(input.value);
  const msg = document.getElementById("phoneCountMsg");
  try {
    showPhoneJoin(await window.broadcast.setPhoneCount(count));
    await persist({ phoneCount: count });
    if (msg) msg.textContent = count === 0 ? "휴대폰 없이 시작합니다." : "각 휴대폰에 이름과 암호를 알려 주세요.";
  } catch (err) {
    if (msg) msg.textContent = err.message || String(err);
    log(err.message || String(err), "error");
  }
});
document.getElementById("reloadDevices").addEventListener("click", reloadDevices);
deviceEl.addEventListener("change", chooseDevice);
sensitivityEl.addEventListener("change", () => persist({ sensitivity: sensitivityEl.value }));
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
async function beginBroadcast() {
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
    folder: state.settings.folder,
    targets: selectedTargets(),
    spoken: state.spoken,
    channels: state.channels,
    preacherId: selectedPreacherId(),
    sessionKind: sessionKindValue(),
    deviceKey: deviceEl.value,
    channel: state.audio ? state.audio.deviceChannel : 0,
  });
  if (started && Array.isArray(started.channels) && started.channels.length) {
    state.channels = started.channels.map(mapChannel);
    if (state.channels[0]) state.spoken = state.channels[0].spoken;
    const deviceCount = state.channels.filter((row) => row.source !== "phone").length;
    renderChannels(deviceCount);
  }
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
    log(err.message || String(err), "error");
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
    try { state.settings = await window.broadcast.getSettings(); } catch (_) { /* 설정 갱신 실패는 시작 오류 아래에 둡니다 */ }
    paintFolderHint();
    paintSetupGaps();
    log(err.message || String(err), "error");
    setStatus("시작 실패", "err");
  }
});
document.getElementById("stop").addEventListener("click", async () => {
  try {
    await window.broadcast.stop();
    const current = await window.broadcast.currentChurch();
    state.preachers = current.preachers || state.preachers;
    renderPreachers();
  } catch (err) {
    log(err.message || String(err), "error");
  }
});
document.getElementById("showSession").addEventListener("click", () => window.broadcast.showSession());

boot().catch((err) => {
  log(err.message || String(err), "error");
  setStatus("오류", "err");
});
