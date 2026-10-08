const statusEl = document.getElementById("status");
const sensitivityEl = document.getElementById("sensitivity");
const deviceEl = document.getElementById("device");
const channelsEl = document.getElementById("channels");
const langsEl = document.getElementById("langs");
const folderHint = document.getElementById("folderHint");
const audioHint = document.getElementById("audioHint");
const liveEl = document.getElementById("live");
const cardsEl = document.getElementById("cards");
const logEl = document.getElementById("log");
const langCount = document.getElementById("langCount");
const preacherEl = document.getElementById("preacher");

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
  style: null,
};

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `pill${kind ? ` ${kind}` : ""}`;
}

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

function selectedPreacherId() {
  return preacherEl.value || "";
}

async function persist(patch) {
  state.settings = await window.broadcast.saveSettings(patch);
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

async function onTargetsChanged(sync = true) {
  state.targets = selectedTargets();
  langCount.textContent = `번역 ${state.targets.length}개 + 한국어`;
  langsEl.querySelectorAll(".lang").forEach((label) => {
    label.classList.toggle("on", label.querySelector("input").checked);
  });
  await persist({ targets: state.targets });
  if (sync && state.church) {
    try {
      await window.broadcast.setTargets(state.targets);
    } catch (err) {
      log(err.message || String(err), "error");
    }
  }
  await renderLinks();
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

function renderChannels(count, selected) {
  channelsEl.innerHTML = "";
  const total = count || 0;
  for (let i = 0; i < total; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `channel${i === selected ? " on" : ""}`;
    const name = document.createElement("span");
    name.textContent = `채널 ${i + 1}`;
    const meter = document.createElement("div");
    meter.className = "meter";
    const bar = document.createElement("span");
    bar.dataset.channel = String(i);
    meter.append(bar);
    button.append(name, meter);
    button.addEventListener("click", async () => {
      try {
        state.audio = await window.broadcast.setChannel(i);
        renderChannels(state.audio.deviceChannels, state.audio.deviceChannel);
        await persist({ audio: { ...(state.settings.audio || {}), channel: i } });
        audioHint.textContent = state.audio.mode === "single"
          ? `채널 ${i + 1}만 열었습니다. 인식도 이 채널만 사용합니다.`
          : `${state.audio.apiLabel} · ${state.audio.openedChannels}채널을 열었습니다. 인식은 채널 ${state.audio.deviceChannel + 1}만 사용합니다.`;
      } catch (err) {
        log(err.message || String(err), "error");
      }
    });
    channelsEl.append(button);
  }
}

function applyLevels(peaks) {
  peaks.forEach((peak, index) => {
    const bar = channelsEl.querySelector(`[data-channel="${index}"]`);
    if (!bar) return;
    const width = Math.max(0, Math.min(100, Math.round(peak * 140)));
    bar.style.width = `${width}%`;
  });
}

async function renderLinks() {
  cardsEl.innerHTML = "";
  if (!state.church) return;
  let links;
  try {
    links = await window.broadcast.links(state.targets);
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
    card.append(header, text, linkRow("성도", item.listen), linkRow("OBS", item.overlay));
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
  state.catalog.languages.forEach((lang) => {
    const font = (value.fonts && value.fonts[lang.code]) || {};
    const row = document.createElement("div");
    row.className = "font-row";
    const name = document.createElement("span");
    name.textContent = `${lang.flag} ${lang.name}`;
    const controls = document.createElement("span");
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
    controls.append(sizeLabel, size, spaceLabel, space);
    row.append(name, controls);
    rows.append(row);
  });
}

function readStyle() {
  const fonts = {};
  state.catalog.languages.forEach((lang) => {
    fonts[lang.code] = {
      fontSize: document.querySelector(`[data-size="${lang.code}"]`).value,
      letterSpacing: document.querySelector(`[data-space="${lang.code}"]`).value,
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
  if (extracted.sermonTitle) lines.push(`설교: ${extracted.sermonTitle}`);
  if (extracted.preacherName) lines.push(`설교자: ${extracted.preacherName}`);
  if (extracted.extractedText) lines.push(extracted.extractedText);
  return lines.join("\n");
}

function showBulletin(bulletin, error) {
  const msg = document.getElementById("bulletinMsg");
  const pre = document.getElementById("bulletinText");
  if (!bulletin) {
    msg.textContent = "아직 올린 주보가 없습니다.";
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
  const previous = preacherEl.value || state.settings.preacherId || "";
  preacherEl.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = state.preachers.length ? "설교자 선택" : "등록된 설교자 없음";
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

async function chooseDevice() {
  const key = deviceEl.value;
  if (!key) return;
  try {
    const channel = state.settings.audio && state.settings.audio.deviceKey === key
      ? state.settings.audio.channel || 0
      : 0;
    state.audio = await window.broadcast.monitor(key, channel);
    renderChannels(state.audio.deviceChannels, state.audio.deviceChannel);
    audioHint.textContent = `${state.audio.apiLabel} · ${state.audio.deviceName} · ${state.audio.sampleRate}Hz. 레벨이 움직이는 채널을 고르세요.`;
    await persist({ audio: { deviceKey: key, channel: state.audio.deviceChannel } });
    if (!state.running) setStatus("장치 듣는 중", "");
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
      ? "이 컴퓨터에 저장된 키로 인식, 번역, 주보 분석을 합니다."
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
  if (state.church) {
    try { await window.broadcast.setTargets(state.targets); }
    catch (err) { log(err.message || String(err), "error"); }
  }
  await renderLinks();
}

async function boot() {
  state.catalog = await window.broadcast.catalog();
  state.settings = await window.broadcast.getSettings();
  sensitivityEl.value = state.settings.sensitivity || "normal";
  if (state.settings.folder) folderHint.textContent = state.settings.folder;
  await renderLangs(state.settings.targets || state.catalog.defaultTargets);
  const auth = await window.broadcast.authStatus();
  setSignedIn(auth);
  await refreshKeyHint();
  if (state.signedIn) {
    if (auth.church) showChurch(auth.church);
    await loadChurch();
  }
  await reloadDevices();
  window.broadcast.onEvent((event) => {
    if (event.type === "levels") applyLevels(event.peaks || []);
    if (event.type === "live") liveEl.textContent = event.text || "대기 중...";
    if (event.type === "line" && event.lang) {
      state.lines[event.lang] = event.text || "";
      const card = cardsEl.querySelector(`[data-lang="${event.lang}"] .text`);
      if (card) card.textContent = event.text || "대기 중...";
    }
    if (event.type === "log") log(event.text, event.level);
    if (event.type === "audio" && event.audio) {
      state.audio = event.audio;
      renderChannels(event.audio.deviceChannels, event.audio.deviceChannel);
    }
    if (event.type === "session") {
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
  if (deviceEl.value) await chooseDevice();
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
    log(bulletin.error || "주보 사진을 저장했습니다.");
  } catch (err) {
    log(err.message || String(err), "error");
  }
});

preacherEl.addEventListener("change", async () => {
  const current = state.preachers.find((item) => item.id === preacherEl.value) || null;
  fillPreacherForm(current);
  await persist({ preacherId: preacherEl.value });
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
    msg.textContent = "설교자를 등록했습니다.";
  } catch (err) {
    msg.textContent = err.message || String(err);
  }
});

document.getElementById("savePreacher").addEventListener("click", async () => {
  const msg = document.getElementById("preacherMsg");
  msg.textContent = "";
  if (!preacherEl.value) {
    msg.textContent = "저장할 설교자를 선택해 주세요. 새 설교자는 등록 버튼으로 만듭니다.";
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
    msg.textContent = "설교자 프로필을 저장했습니다.";
  } catch (err) {
    msg.textContent = err.message || String(err);
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
  if (!folder) return;
  folderHint.textContent = folder;
  await persist({ folder });
});
document.getElementById("start").addEventListener("click", async () => {
  try {
    await persist({
      sensitivity: sensitivityEl.value,
      folder: state.settings.folder,
      targets: selectedTargets(),
      preacherId: selectedPreacherId(),
    });
    state.lines = {};
    await window.broadcast.start({
      sensitivity: sensitivityEl.value,
      folder: state.settings.folder,
      targets: selectedTargets(),
      preacherId: selectedPreacherId(),
      deviceKey: deviceEl.value,
      channel: state.audio ? state.audio.deviceChannel : 0,
    });
    log("방송을 시작했습니다. 언어별 텍스트만 저장합니다.");
  } catch (err) {
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
