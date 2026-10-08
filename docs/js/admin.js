const banner = document.getElementById("banner");
const listEl = document.getElementById("churchList");
const detail = document.getElementById("detail");
const linksEl = document.getElementById("links");
const sessionsEl = document.getElementById("sessions");
const textsEl = document.getElementById("texts");
let churches = [];
let currentId = "";
let textUnsub = null;
let signedIn = false;
let creatingAdmin = false;

function requireAdmin() {
  if (!signedIn) throw new Error("로그인이 필요합니다.");
}

function showError(err) {
  const raw = err && err.message ? err.message : String(err || "");
  banner.textContent = LI.catalog.redactSecrets(raw);
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
  requireAdmin();
  LI.db.clearChurch();
  const index = await LI.db.get("churchIndex");
  churches = !index || typeof index !== "object" ? [] : Object.entries(index)
    .filter(([id, row]) => LI.catalog.isChurchId(id) && row)
    .map(([id, row]) => ({
      id,
      name: row.name || id,
      createdAt: row.createdAt || 0,
      active: LI.catalog.churchIsActive(row),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  listEl.innerHTML = "";
  if (!churches.length) {
    listEl.innerHTML = '<p class="hint">아직 교회가 없습니다.</p>';
    return;
  }
  churches.forEach((church) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = church.id;
    button.className = `church-item${church.id === currentId ? " on" : ""}${church.active ? "" : " off"}`;
    const name = document.createElement("span");
    name.textContent = church.name;
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = church.active ? "활성" : "비활성";
    button.append(name, state);
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
  note.textContent = `방송실 앱은 「${church.name}」 계정으로 로그인합니다. 다른 교회는 고르지 않습니다. 아래는 언어별 성도 자막과 OBS 주소입니다.`;
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
  requireAdmin();
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
    if (node.classList) node.classList.toggle("on", node.dataset && node.dataset.id === id);
  });
  const [glossary, sessionIndex, model, account, preachers] = await Promise.all([
    LI.db.get(`churches/${id}/glossary`),
    LI.db.get(`churches/${id}/sessionIndex`),
    LI.db.get(`churches/${id}/model`),
    LI.db.get(`churches/${id}/account`),
    LI.db.get(`churches/${id}/preachers`),
  ]);
  document.getElementById("glossary").value = typeof glossary === "string" && glossary.trim()
    ? glossary
    : LI.catalog.defaultGlossary(church ? church.name : id);
  const activeValue = await LI.db.get(`churches/${id}/active`);
  const active = LI.catalog.churchIsActive(activeValue);
  if (church && church.active !== active) {
    church.active = active;
    await LI.db.update(`churchIndex/${id}`, { active });
    await loadChurches();
  } else if (church) {
    church.active = active;
  }
  renderActiveControl(active);
  fillModel(model);
  renderAccount(account);
  renderPreachers(preachers);
  renderSessions(id, sessionIndex);
  const url = new URL(location.href);
  url.searchParams.set("church", id);
  history.replaceState(null, "", url);
}

function fillModel(model) {
  const select = document.getElementById("churchModel");
  select.innerHTML = "";
  LI.catalog.models.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    select.append(option);
  });
  select.value = LI.catalog.isModelId(model) ? model : LI.catalog.defaultModel;
}

function renderAccount(account) {
  const email = account && typeof account.email === "string" ? account.email : "";
  const uid = account && typeof account.uid === "string" ? account.uid : "";
  document.getElementById("accountEmail").textContent = email
    ? `로그인 이메일: ${email}`
    : "아직 연결된 교회 계정이 없습니다.";
  document.getElementById("accountEmail").dataset.uid = uid;
  document.getElementById("accountEmail").dataset.email = email;
  document.getElementById("currentPassword").value = "";
  document.getElementById("newEmail").value = "";
  document.getElementById("newPassword").value = "";
}

function renderPreachers(raw) {
  const box = document.getElementById("preachers");
  box.innerHTML = "";
  const rows = !raw || typeof raw !== "object" ? [] : Object.values(raw).filter((row) => row && row.name);
  if (!rows.length) {
    box.innerHTML = '<p class="hint">아직 등록된 설교자가 없습니다.</p>';
    return;
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "ko")).forEach((row) => {
    const card = document.createElement("div");
    card.className = "link-box";
    card.style.display = "block";
    const title = document.createElement("strong");
    title.textContent = `${row.name} · 설교 ${row.sermonCount || 0}회`;
    const body = document.createElement("pre");
    body.className = "transcript";
    body.textContent = [
      row.traits ? `말투\n${row.traits}` : "",
      row.corrections ? `교정\n${row.corrections}` : "",
      row.terms ? `용어\n${row.terms}` : "",
    ].filter(Boolean).join("\n\n") || "아직 쌓인 프로필이 없습니다.";
    card.append(title, body);
    box.append(card);
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

async function watchTexts(id, folder, meta) {
  if (textUnsub) textUnsub();
  textUnsub = null;
  textsEl.innerHTML = `<h3>${formatFolder(folder)}</h3>`;
  
  const langs = (meta && meta.languages) || ["ko", ...LI.catalog.languages.map(l => l.code)];
  const activeLangs = langs.filter(lang => lang === "ko" || LI.catalog.langByCode[lang]);
  
  if (!activeLangs.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "아직 저장된 문장이 없습니다.";
    textsEl.append(empty);
    return;
  }

  const blocks = {};
  activeLangs.forEach((lang) => {
    const metaLang = LI.catalog.langByCode[lang];
    const block = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = metaLang ? `${metaLang.flag} ${metaLang.name}` : lang;
    const pre = document.createElement("pre");
    pre.className = "transcript";
    pre.textContent = "불러오는 중...";
    const download = document.createElement("button");
    download.type = "button";
    download.className = "ghost";
    download.textContent = `${lang}.txt 받기`;
    download.addEventListener("click", () => downloadText(`${folder}_${lang}.txt`, pre.textContent));
    block.append(title, pre, download);
    textsEl.append(block);
    blocks[lang] = pre;
  });

  const bulletin = await LI.db.get(`churches/${id}/sessions/${folder}/bulletin`);
  if (bulletin && typeof bulletin === "object") {
    const info = document.createElement("pre");
    info.className = "transcript";
    const hymns = Array.isArray(bulletin.hymnNumbers) ? bulletin.hymnNumbers.join(", ") : "";
    const songs = Array.isArray(bulletin.songTitles) ? bulletin.songTitles.join(", ") : "";
    info.textContent = [
      bulletin.imageRef ? `주보 파일: ${bulletin.imageRef}` : "",
      hymns ? `찬송 번호: ${hymns}` : "",
      songs ? `곡: ${songs}` : "",
      bulletin.scripture ? `성경: ${bulletin.scripture}` : "",
      bulletin.sermonTitle ? `설교: ${bulletin.sermonTitle}` : "",
      bulletin.preacherName ? `설교자: ${bulletin.preacherName}` : "",
      bulletin.extractedText || "",
    ].filter(Boolean).join("\n");
    textsEl.append(info);
  }
  const texts = await LI.db.get(`churches/${id}/sessions/${folder}/texts`);
  activeLangs.forEach(lang => {
    if (texts && texts[lang]) {
      blocks[lang].textContent = String(texts[lang]);
    } else {
      blocks[lang].textContent = "";
    }
  });

  const isEnded = meta && meta.endedAt;
  if (!isEnded) {
    const unsubs = activeLangs.map(lang => {
      return LI.db.onChildAdded(`churches/${id}/sessions/${folder}/sentences/${lang}`, (key, text) => {
        if (!text) return;
        const current = blocks[lang].textContent;
        blocks[lang].textContent = current ? `${current}\n${text}` : text;
      });
    });
    textUnsub = () => unsubs.forEach(u => u());
  }
}

function renderActiveControl(active) {
  const button = document.getElementById("toggleActive");
  const state = document.getElementById("activeState");
  button.textContent = active ? "비활성화" : "활성화";
  button.classList.toggle("ghost", active);
  state.textContent = active
    ? "활성 · 이 교회 계정으로 방송할 수 있습니다."
    : "비활성 · 방송은 막히고, 성도 자막과 OBS는 실시간으로 열리지 않습니다.";
}

async function refreshKeyStatus() {
  requireAdmin();
  LI.db.clearChurch();
  const value = await LI.db.get(LI.catalog.platformKeyRel);
  const saved = LI.catalog.isPlatformKey(value);
  document.getElementById("keyMsg").textContent = saved
    ? "플랫폼 키가 저장되어 있습니다. 방송 앱이 이 키로 번역하고, 화면에는 키를 보이지 않습니다."
    : "아직 저장된 키가 없습니다.";
}

function downloadText(filename, text) {
  const blob = new Blob([text || ""], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.getElementById("saveKey").addEventListener("click", async () => {
  if (!signedIn) return;
  const input = document.getElementById("apiKey");
  const key = input.value.trim();
  if (!LI.catalog.isPlatformKey(key)) {
    document.getElementById("keyMsg").textContent = "키 형식이 올바르지 않습니다.";
    return;
  }
  try {
    LI.db.clearChurch();
    await LI.db.set(LI.catalog.platformKeyRel, key);
    input.value = "";
    document.getElementById("keyMsg").textContent = "키를 저장했습니다. 방송 앱이 이 키로 번역합니다.";
  } catch (err) {
    showError(err);
  }
});

document.getElementById("toggleActive").addEventListener("click", async () => {
  if (!signedIn || !currentId) return;
  const row = churches.find((item) => item.id === currentId);
  const next = !(row && row.active);
  try {
    await LI.db.set(`churches/${currentId}/active`, next);
    await LI.db.update(`churchIndex/${currentId}`, { active: next });
    if (row) row.active = next;
    renderActiveControl(next);
    await loadChurches();
  } catch (err) {
    showError(err);
  }
});

document.getElementById("addChurch").addEventListener("click", async () => {
  if (!signedIn) return;
  const name = document.getElementById("churchName").value.trim();
  const email = document.getElementById("churchEmail").value.trim();
  const password = document.getElementById("churchPassword").value;
  const confirm = document.getElementById("churchPassword2").value;
  const msg = document.getElementById("addMsg");
  msg.textContent = "";
  if (!name) {
    msg.textContent = "교회 이름을 입력해 주세요.";
    return;
  }
  if (!LI.catalog.validAdminEmail(email) || !LI.catalog.validAdminPassword(password)) {
    msg.textContent = "이메일과 비밀번호를 확인해 주세요. 비밀번호는 6자 이상입니다.";
    return;
  }
  if (password !== confirm) {
    msg.textContent = "비밀번호가 서로 다릅니다.";
    return;
  }
  const id = LI.catalog.makeChurchId(name);
  const identity = LI.identity.createClient({ apiKey: LI.catalog.firebase.apiKey });
  let created = null;
  try {
    created = await identity.signUp(email, password);
    const createdAt = Date.now();
    const glossary = LI.catalog.defaultGlossary(name);
    await LI.db.set(`churches/${id}/name`, name);
    await LI.db.set(`churches/${id}/createdAt`, createdAt);
    await LI.db.set(`churches/${id}/active`, true);
    await LI.db.set(`churches/${id}/glossary`, glossary);
    await LI.db.set(`churches/${id}/model`, LI.catalog.defaultModel);
    await LI.db.set(`churches/${id}/account`, { uid: created.localId, email: created.email });
    await LI.db.set(`churches/${id}/live/settings`, LI.catalog.defaultLiveSettings());
    await LI.db.set(`churchIndex/${id}`, { name, createdAt, active: true });
    await LI.db.set(`accounts/${created.localId}`, { churchId: id });
    document.getElementById("churchName").value = "";
    document.getElementById("churchEmail").value = "";
    document.getElementById("churchPassword").value = "";
    document.getElementById("churchPassword2").value = "";
    await loadChurches();
    await openChurch(id);
    msg.textContent = "교회와 로그인 계정을 만들었습니다. 관리자 로그인은 그대로입니다.";
  } catch (err) {
    if (created && created.idToken) {
      try { await identity.deleteAccount(created.idToken); } catch (_) { /* 이미 지운 계정은 무시합니다 */ }
      const leftovers = [
        `churches/${id}/name`,
        `churches/${id}/createdAt`,
        `churches/${id}/active`,
        `churches/${id}/glossary`,
        `churches/${id}/model`,
        `churches/${id}/account`,
        `churches/${id}/live/settings`,
        `churchIndex/${id}`,
        `accounts/${created.localId}`,
      ];
      for (const rel of leftovers) {
        try { await LI.db.set(rel, null); } catch (_) { /* 아직 없는 값은 무시합니다 */ }
      }
    }
    msg.textContent = LI.catalog.authErrorMessage(err);
  }
});

document.getElementById("saveModel").addEventListener("click", async () => {
  if (!signedIn || !currentId) return;
  const model = document.getElementById("churchModel").value;
  if (!LI.catalog.isModelId(model)) return;
  try {
    await LI.db.set(`churches/${currentId}/model`, model);
    document.getElementById("saveMsg").textContent = "모델을 저장했습니다.";
  } catch (err) {
    showError(err);
  }
});

document.getElementById("saveAccount").addEventListener("click", async () => {
  if (!signedIn || !currentId) return;
  const holder = document.getElementById("accountEmail");
  const currentEmail = holder.dataset.email || "";
  const uid = holder.dataset.uid || "";
  const currentPassword = document.getElementById("currentPassword").value;
  const newEmail = document.getElementById("newEmail").value.trim();
  const newPassword = document.getElementById("newPassword").value;
  if (!currentEmail || !uid) {
    document.getElementById("saveMsg").textContent = "연결된 교회 계정이 없습니다.";
    return;
  }
  if (!currentPassword) {
    document.getElementById("saveMsg").textContent = "현재 비밀번호를 입력해 주세요.";
    return;
  }
  if (!newEmail && !newPassword) {
    document.getElementById("saveMsg").textContent = "새 이메일 또는 새 비밀번호를 입력해 주세요.";
    return;
  }
  if (newEmail && !LI.catalog.validAdminEmail(newEmail)) {
    document.getElementById("saveMsg").textContent = "새 이메일 형식을 확인해 주세요.";
    return;
  }
  if (newPassword && !LI.catalog.validAdminPassword(newPassword)) {
    document.getElementById("saveMsg").textContent = "새 비밀번호는 6자 이상입니다.";
    return;
  }
  const identity = LI.identity.createClient({ apiKey: LI.catalog.firebase.apiKey });
  try {
    const signed = await identity.signIn(currentEmail, currentPassword);
    const patch = {};
    if (newEmail && newEmail !== currentEmail) patch.email = newEmail;
    if (newPassword) patch.password = newPassword;
    const updated = await identity.updateAccount(signed.idToken, patch);
    const email = updated.email || newEmail || currentEmail;
    await LI.db.set(`churches/${currentId}/account`, { uid, email });
    renderAccount({ uid, email });
    document.getElementById("saveMsg").textContent = "교회 계정을 저장했습니다. 관리자 로그인은 그대로입니다.";
  } catch (err) {
    document.getElementById("saveMsg").textContent = LI.catalog.authErrorMessage(err);
  }
});

document.getElementById("saveGlossary").addEventListener("click", async () => {
  if (!signedIn || !currentId) return;
  const name = document.getElementById("editName").value.trim();
  if (!name) return;
  try {
    await LI.db.set(`churches/${currentId}/name`, name);
    await LI.db.set(`churches/${currentId}/glossary`, document.getElementById("glossary").value);
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

function showGate(mode) {
  signedIn = false;
  creatingAdmin = mode === "create";
  document.getElementById("adminApp").hidden = true;
  document.getElementById("gate").hidden = false;
  document.getElementById("confirmWrap").hidden = !creatingAdmin;
  document.getElementById("gateTitle").textContent = creatingAdmin ? "관리자 계정 만들기" : "관리자 로그인";
  document.getElementById("gateSubmit").textContent = creatingAdmin ? "계정 만들기" : "로그인";
  document.getElementById("password").autocomplete = creatingAdmin ? "new-password" : "current-password";
  document.getElementById("gateHint").textContent = creatingAdmin
    ? "처음 한 번만 이메일과 비밀번호를 정합니다. 계정이 생긴 뒤에는 새 가입은 되지 않습니다."
    : "등록된 관리자 계정으로 로그인합니다.";
}

function showApp(email) {
  signedIn = true;
  document.getElementById("gate").hidden = true;
  document.getElementById("adminApp").hidden = false;
  document.getElementById("password").value = "";
  document.getElementById("confirm").value = "";
  const sub = document.querySelector(".brand .sub");
  if (sub && email) sub.textContent = `${email} 전체 관리자입니다. 교회 계정, 키, 모델, 용어집, 자막 기록을 관리합니다.`;
}

async function enterApp(user) {
  if (signedIn) return;
  showApp(user.email || "");
  await refreshKeyStatus();
  await loadChurches();
  const requested = LI.catalog.churchIdFromQuery(location.search);
  if (requested) await openChurch(requested);
}

document.getElementById("gateSubmit").addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const confirm = document.getElementById("confirm").value;
  const msg = document.getElementById("gateMsg");
  msg.textContent = "";
  if (creatingAdmin && password !== confirm) {
    msg.textContent = "비밀번호가 서로 다릅니다.";
    return;
  }
  try {
    const user = creatingAdmin
      ? await LI.auth.signUp(email, password)
      : await LI.auth.signIn(email, password);
    document.getElementById("password").value = "";
    document.getElementById("confirm").value = "";
    await enterApp(user);
  } catch (err) {
    msg.textContent = LI.catalog.authErrorMessage(err);
  }
});

document.getElementById("signOut").addEventListener("click", async () => {
  if (textUnsub) textUnsub();
  textUnsub = null;
  currentId = "";
  churches = [];
  try {
    await LI.auth.signOut();
  } catch (err) {
    showError(err);
  }
});

LI.db.clearChurch();
LI.db.init()
  .then(() => LI.auth.status())
  .then((state) => {
    showGate(state.hasAdmin ? "login" : "create");
    LI.auth.onUser(async (user) => {
      if (LI.auth.isBusy()) return;
      if (!user) {
        const next = await LI.auth.status().catch(() => ({ hasAdmin: true }));
        showGate(next.hasAdmin ? "login" : "create");
        return;
      }
      try {
        const uid = await LI.auth.existingUid();
        if (!LI.catalog.isCurrentAdmin(uid, user.uid)) {
          await LI.auth.signOut();
          document.getElementById("gateMsg").textContent = "이 계정은 관리자가 아닙니다.";
          return;
        }
        if (!signedIn) await enterApp(user);
      } catch (err) {
        showError(err);
      }
    });
  })
  .catch(showError);
