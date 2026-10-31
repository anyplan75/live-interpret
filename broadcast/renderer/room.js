const signInCard = document.getElementById("signInCard");
const studio = document.getElementById("studio");
const signInMsg = document.getElementById("signInMsg");
const meters = document.getElementById("meters");
const desks = document.getElementById("phoneDesks");
const deviceEl = document.getElementById("device");
const levels = new Map();
let lastChannels = [];

function personText(err) {
  const raw = err && err.message ? err.message : err;
  if (typeof UserText !== "undefined" && UserText.userText) return UserText.userText(raw);
  const text = String(raw || "").trim();
  if (!text || /firebase|permission denied|401|error:|https?:|at\s+\S/i.test(text)) {
    return "다시 시도해 주세요.";
  }
  return text.slice(0, 180);
}

function say(text) {
  signInMsg.textContent = text || "";
}

function note(text) {
  document.getElementById("phoneMsg").textContent = text || "";
}

function openStudio(email, church) {
  signInCard.hidden = true;
  studio.hidden = false;
  const place = church && church.name ? String(church.name).trim() : "";
  document.getElementById("placeLine").textContent = place || "계정";
  document.getElementById("accountLine").textContent = email
    ? `${email} 로 연결했습니다.`
    : "계정으로 연결했습니다.";
}

async function restoreDevice() {
  const saved = await window.broadcast.getSettings();
  if (saved && saved.folderReady) document.getElementById("folderLine").textContent = "기록 폴더를 골랐습니다.";
  if (!saved || !saved.deviceKey) return;
  const match = [...deviceEl.options].some((option) => option.value === saved.deviceKey);
  if (!match) return;
  deviceEl.value = saved.deviceKey;
  await window.broadcast.monitor(saved.deviceKey, 0);
}

async function loadDevices() {
  const listed = await window.broadcast.listDevices();
  const current = deviceEl.value;
  deviceEl.innerHTML = "";
  (listed.devices || []).forEach((device) => {
    const option = document.createElement("option");
    option.value = device.key;
    option.textContent = device.name || device.key;
    option.dataset.channels = String(device.channels || 1);
    deviceEl.append(option);
  });
  if (current && [...deviceEl.options].some((option) => option.value === current)) deviceEl.value = current;
  if (!deviceEl.options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "마이크가 없습니다";
    deviceEl.append(option);
  }
}

function paintMeters(channels) {
  const rows = (channels || []).filter((row) => row.source !== "phone");
  meters.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "마이크를 고르면 소리 막대가 나옵니다.";
    meters.append(empty);
    return;
  }
  rows.forEach((row) => {
    const wrap = document.createElement("div");
    wrap.className = "phone-level";
    const title = document.createElement("p");
    title.textContent = row.name ? `채널 ${row.index + 1} ${row.name}` : `채널 ${row.index + 1}`;
    const bar = document.createElement("div");
    bar.className = "meter";
    const fill = document.createElement("span");
    const peak = levels.get(row.index) || 0;
    fill.style.width = meterWidth(peak);
    bar.append(fill);
    wrap.append(title, bar);
    meters.append(wrap);
  });
}

function paintDesks(info) {
  desks.innerHTML = "";
  const channels = info && Array.isArray(info.channels) ? info.channels : [];
  if (!channels.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "설정 사이트에서 휴대폰 대수를 정하면 여기에 연결 번호와 QR이 나옵니다.";
    desks.append(empty);
    note(info && info.note ? info.note : "");
    return;
  }
  channels.forEach((desk, index) => {
    const card = document.createElement("article");
    card.className = "phone-desk";
    const title = document.createElement("h3");
    title.textContent = desk.connected
      ? `휴대폰 ${index + 1} 연결됨`
      : (desk.joining ? `휴대폰 ${index + 1} 연결중` : `휴대폰 ${index + 1} 아직 연결되지 않았습니다`);
    const code = document.createElement("p");
    code.textContent = desk.connectionId ? `연결 번호 ${desk.connectionId}` : "연결 번호 준비 중";
    card.append(title, code);
    if (desk.qrDataUrl) {
      const image = document.createElement("img");
      image.alt = "휴대폰이 스캔할 QR";
      image.src = desk.qrDataUrl;
      card.append(image);
    }
    if (desk.joinUrl) {
      const url = document.createElement("p");
      url.className = "hint";
      url.textContent = `웹 마이크 ${desk.joinUrl}`;
      card.append(url);
    }
    const bar = document.createElement("div");
    bar.className = "meter";
    const fill = document.createElement("span");
    fill.style.width = "0%";
    fill.dataset.phoneLevel = desk.connectionId || "";
    bar.append(fill);
    card.append(bar);
    desks.append(card);
  });
  note(info && info.note ? info.note : "");
}

async function refreshPhones() {
  paintDesks(await window.broadcast.phoneJoin());
}

function meterWidth(peak) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(peak) || 0) * 140)));
  return `${pct}%`;
}

function ensureMicMeters(count) {
  if (meters.querySelectorAll(".meter span").length >= count) return;
  const rows = [];
  for (let index = 0; index < count; index += 1) rows.push({ index, source: "device", name: "" });
  paintMeters(rows);
}

function paintMicPeaks(peaks) {
  if (!Array.isArray(peaks) || !peaks.length) return;
  ensureMicMeters(peaks.length);
  peaks.forEach((peak, index) => {
    levels.set(index, Number(peak) || 0);
    const fill = meters.querySelectorAll(".meter span")[index];
    if (fill) fill.style.width = meterWidth(peak);
  });
}

window.broadcast.onEvent((event) => {
  if (!event || typeof event !== "object") return;
  if (event.type === "levels") paintMicPeaks(event.peaks);
  if (event.type === "level" && Number.isInteger(event.channel)) {
    levels.set(event.channel, Number(event.peak) || 0);
    const micFill = meters.querySelectorAll(".meter span")[event.channel];
    if (micFill) micFill.style.width = meterWidth(event.peak);
    const phone = lastChannels.find((row) => row.index === event.channel && row.connectionId);
    if (phone) {
      const fill = desks.querySelector(`[data-phone-level="${phone.connectionId}"]`);
      if (fill) fill.style.width = meterWidth(event.peak);
    }
  }
  if (event.type === "phones" && event.channels) {
    lastChannels = event.channels;
    paintMeters(event.channels);
  }
  if (event.type === "phone-join") paintDesks(event.info || {});
});

document.getElementById("signIn").addEventListener("click", async () => {
  say("");
  try {
    const session = await window.broadcast.signIn(
      document.getElementById("email").value,
      document.getElementById("password").value,
    );
    if (session && session.operator) {
      say("계정 사용은 설정 사이트에서 합니다.");
      return;
    }
    openStudio(session && session.email, session && session.church);
    await loadDevices();
    await restoreDevice();
    await refreshPhones();
  } catch (err) {
    say(personText(err));
  }
});

document.getElementById("signOut").addEventListener("click", async () => {
  try {
    await window.broadcast.signOut();
  } catch (err) {
    note(personText(err));
    return;
  }
  studio.hidden = true;
  signInCard.hidden = false;
  document.getElementById("placeLine").textContent = "계정";
  document.getElementById("accountLine").textContent = "";
});

document.getElementById("pickFolder").addEventListener("click", async () => {
  try {
    const folder = await window.broadcast.pickFolder();
    document.getElementById("folderLine").textContent = folder ? "기록 폴더를 골랐습니다." : "폴더를 아직 고르지 않았습니다.";
  } catch (err) {
    note(personText(err));
  }
});

document.getElementById("openSettings").addEventListener("click", () => {
  window.broadcast.openSettings().catch(() => {
    note("설정 사이트를 열지 못했습니다. 다시 시도해 주세요.");
  });
});

document.getElementById("reloadDevices").addEventListener("click", () => loadDevices().catch(() => {}));

deviceEl.addEventListener("change", async () => {
  const option = deviceEl.selectedOptions[0];
  if (!option || !option.value) return;
  const count = Math.max(1, Number(option.dataset.channels) || 1);
  try {
    await window.broadcast.monitor(option.value, 0);
    const rows = [];
    for (let index = 0; index < count; index += 1) rows.push({ index, source: "device", name: "" });
    paintMeters(rows);
  } catch (err) {
    note(personText(err) || "마이크를 열지 못했습니다.");
  }
});

window.broadcast.authStatus().then(async (session) => {
  if (!session || !session.signedIn || session.operator) return;
  openStudio(session.email, session.church);
  await loadDevices();
  await restoreDevice();
  await refreshPhones();
}).catch(() => {});
