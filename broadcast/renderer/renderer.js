const statusEl = document.getElementById("status");
const churchEl = document.getElementById("church");
const modelEl = document.getElementById("model");
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

const state = {
  catalog: null,
  settings: {},
  churches: [],
  devices: [],
  audio: null,
  running: false,
  signedIn: false,
  lines: {},
  targets: [],
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

function currentChurchId() {
  return churchEl.value || "";
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
    text.innerHTML = "";
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
  if (sync && currentChurchId()) {
    try {
      await window.broadcast.setTargets(currentChurchId(), state.targets);
    } catch (err) {
      log(err.message || String(err), "error");
    }
  }
  await renderLinks();
}

function renderChurches() {
  const previous = churchEl.value || state.settings.churchId || "";
  churchEl.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = state.churches.length ? "교회 선택" : "등록된 교회 없음";
  churchEl.append(empty);
  state.churches.forEach((church) => {
    const option = document.createElement("option");
    option.value = church.id;
    option.textContent = church.name;
    churchEl.append(option);
  });
  if ([...churchEl.options].some((option) => option.value === previous)) churchEl.value = previous;
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
  const churchId = currentChurchId();
  if (!churchId) return;
  let links;
  try {
    links = await window.broadcast.links(churchId, state.targets);
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
  document.getElementById("start").disabled = running;
  document.getElementById("stop").disabled = !running;
  document.getElementById("showSession").disabled = !state.settings.sessionDir && !running;
  churchEl.disabled = running;
  deviceEl.disabled = running;
  document.getElementById("pickFolder").disabled = running;
  setStatus(running ? "방송 중" : (state.audio ? "장치 듣는 중" : "대기"), running ? "on" : "");
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
  if (state.signedIn && auth.email) {
    document.getElementById("signInMsg").textContent = "";
  }
}

async function afterSignIn() {
  setSignedIn({ signedIn: true });
  await refreshKeyHint();
  await reloadChurches();
}

async function boot() {
  state.catalog = await window.broadcast.catalog();
  state.settings = await window.broadcast.getSettings();
  sensitivityEl.value = state.settings.sensitivity || "normal";
  modelEl.innerHTML = "";
  state.catalog.models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    modelEl.append(option);
  });
  modelEl.value = state.settings.model || state.catalog.defaultModel;
  if (state.settings.folder) folderHint.textContent = state.settings.folder;
  await renderLangs(state.settings.targets || state.catalog.defaultTargets);
  const auth = await window.broadcast.authStatus();
  setSignedIn(auth);
  await refreshKeyHint();
  if (state.signedIn) await reloadChurches();
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

async function refreshKeyHint() {
  const hint = document.getElementById("keyHint");
  if (!state.signedIn) {
    hint.textContent = "한 번 로그인하면 번역 키를 이 컴퓨터에 저장하고 다시 묻지 않습니다.";
    return;
  }
  try {
    const status = await window.broadcast.keyStatus();
    hint.textContent = status && status.configured
      ? "이 컴퓨터에 저장된 키로 번역합니다."
      : "관리 페이지에서 OpenAI 키를 먼저 저장해 주세요.";
  } catch (err) {
    hint.textContent = "키 상태를 확인하지 못했습니다.";
    log(err.message || String(err), "error");
  }
}

async function reloadChurches() {
  if (!state.signedIn) {
    state.churches = [];
    renderChurches();
    document.getElementById("churchHint").textContent = "로그인하면 활성화된 교회가 나옵니다.";
    return;
  }
  try {
    state.churches = await window.broadcast.listChurches();
    renderChurches();
    document.getElementById("churchHint").textContent = state.churches.length
      ? "활성화된 교회만 나옵니다. 성도·OBS 링크는 오른쪽 카드에 표시됩니다."
      : "활성화된 교회가 없습니다. 관리 페이지에서 교회를 추가하거나 활성화해 주세요.";
    if (currentChurchId()) {
      try { await window.broadcast.setTargets(currentChurchId(), state.targets); }
      catch (err) { log(err.message || String(err), "error"); }
    }
    await renderLinks();
  } catch (err) {
    log(err.message || String(err), "error");
  }
}

async function reloadDevices() {
  const result = await window.broadcast.listDevices();
  state.devices = result.devices || [];
  renderDevices();
  (result.notes || []).forEach((note) => log(note, "info"));
  if (deviceEl.value) await chooseDevice();
}

document.getElementById("adminSignIn").addEventListener("click", async () => {
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  const msg = document.getElementById("signInMsg");
  msg.textContent = "";
  try {
    const auth = await window.broadcast.signIn(email, password);
    document.getElementById("adminPassword").value = "";
    setSignedIn(auth);
    msg.textContent = "";
    await afterSignIn();
    log("로그인했습니다. 번역 키는 이 컴퓨터에만 저장됩니다.");
  } catch (err) {
    msg.textContent = err.message || String(err);
  }
});
document.getElementById("reloadChurches").addEventListener("click", reloadChurches);
document.getElementById("reloadDevices").addEventListener("click", reloadDevices);
churchEl.addEventListener("change", async () => {
  await persist({ churchId: currentChurchId() });
  state.lines = {};
  await renderLinks();
  if (currentChurchId()) {
    try { await window.broadcast.setTargets(currentChurchId(), state.targets); }
    catch (err) { log(err.message || String(err), "error"); }
  }
});
deviceEl.addEventListener("change", chooseDevice);
modelEl.addEventListener("change", () => persist({ model: modelEl.value }));
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
      model: modelEl.value,
      sensitivity: sensitivityEl.value,
      churchId: currentChurchId(),
      folder: state.settings.folder,
      targets: selectedTargets(),
    });
    state.lines = {};
    await window.broadcast.start({
      model: modelEl.value,
      sensitivity: sensitivityEl.value,
      churchId: currentChurchId(),
      folder: state.settings.folder,
      targets: selectedTargets(),
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
  } catch (err) {
    log(err.message || String(err), "error");
  }
});
document.getElementById("showSession").addEventListener("click", () => window.broadcast.showSession());

boot().catch((err) => {
  log(err.message || String(err), "error");
  setStatus("오류", "err");
});
