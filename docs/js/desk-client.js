/**
 * 웹 통역 설정.
 * 방송실이 올린 room/status 를 보고, room/desired 에 시작·언어·이름·감도·말투를 적습니다.
 * 로그인 열쇠는 주소에 남기지 않고 이 탭 저장소에만 둡니다.
 */
(function () {
  const SESSION_KEY = "liDeskSession";
  const OPERATOR_EMAIL = "anyplan@me.com";
  const signInCard = document.getElementById("signInCard");
  const desk = document.getElementById("desk");
  const operator = document.getElementById("operator");
  const signInMsg = document.getElementById("signInMsg");
  const notice = document.getElementById("notice");
  const inputs = document.getElementById("inputs");
  let languages = [];
  let chosen = new Set();
  let watched = new Set();
  let prevChosen = new Set();
  let startArmed = false;
  let spoken = "ko";
  let latest = null;
  let operatorAccounts = [];
  let session = null;
  let idToken = "";
  let tokenExpiresAt = 0;
  let churchId = "";
  let stopWatch = null;

  function say(text) {
    signInMsg.textContent = text || "";
  }

  function personText(err) {
    let text = err && err.message ? String(err.message) : "다시 시도해 주세요.";
    text = text.replace(/auth=[^&\s]+/gi, "").replace(/refresh_token=[^&\s]+/gi, "").trim();
    if (!text || /firebase|permission denied|401|error:|https?:/i.test(text)) {
      return "다시 시도해 주세요.";
    }
    return text.slice(0, 180);
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed.refreshToken !== "string" || !parsed.refreshToken) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeSession(next) {
    session = next;
    try {
      if (!next) sessionStorage.removeItem(SESSION_KEY);
      else sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        refreshToken: next.refreshToken,
        email: next.email || "",
        localId: next.localId || "",
      }));
    } catch (_) { /* 저장이 막혀도 이번 탭의 로그인은 유지합니다 */ }
  }

  function dbUrl(rel) {
    const path = LI.catalog.underRoot(rel);
    return `${LI.catalog.firebase.databaseURL.replace(/\/$/, "")}/${path}.json`;
  }

  function authed(url) {
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}auth=${encodeURIComponent(idToken)}`;
  }

  async function readJson(res) {
    const text = await res.text();
    if (!text || text === "null") return null;
    return JSON.parse(text);
  }

  async function dbGet(rel) {
    const res = await fetch(authed(dbUrl(rel)), { cache: "no-store" });
    if (!res.ok) throw new Error("다시 시도해 주세요.");
    return readJson(res);
  }

  async function dbPut(rel, value) {
    const res = await fetch(authed(dbUrl(rel)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      cache: "no-store",
    });
    if (!res.ok) throw new Error("다시 시도해 주세요.");
  }

  async function dbPatch(rel, value) {
    const res = await fetch(authed(dbUrl(rel)), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      cache: "no-store",
    });
    if (!res.ok) throw new Error("다시 시도해 주세요.");
  }

  async function refreshToken() {
    const key = LI.catalog.firebase.apiKey;
    if (!session || !session.refreshToken || !key) throw new Error("다시 로그인해 주세요.");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await readJson(res);
    if (!res.ok || !data || !data.id_token) throw new Error("다시 로그인해 주세요.");
    idToken = data.id_token;
    tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    writeSession({
      refreshToken: data.refresh_token || session.refreshToken,
      email: session.email || "",
      localId: data.user_id || session.localId || "",
    });
    return idToken;
  }

  async function ensureToken() {
    if (idToken && tokenExpiresAt - Date.now() > 60 * 1000) return idToken;
    return refreshToken();
  }

  async function signInPassword(email, password) {
    const key = LI.catalog.firebase.apiKey;
    if (!key) throw new Error("다시 로그인해 주세요.");
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const data = await readJson(res);
    if (!res.ok || !data || !data.idToken || !data.refreshToken) {
      throw new Error("이메일과 비밀번호를 확인해 주세요. 비밀번호는 6자 이상입니다.");
    }
    idToken = data.idToken;
    tokenExpiresAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
    writeSession({
      refreshToken: data.refreshToken,
      email: data.email || email,
      localId: data.localId || "",
    });
  }

  function isOperatorEmail(email) {
    return String(email || "").trim().toLowerCase() === OPERATOR_EMAIL;
  }

  async function requireChurch() {
    await ensureToken();
    if (!session || !session.localId) throw new Error("로그인 정보가 없습니다. 다시 로그인해 주세요.");
    const link = await dbGet(`accounts/${session.localId}`);
    if (!link || !LI.catalog.isChurchId(link.churchId)) {
      throw new Error("이 계정에 연결된 방송 계정이 없습니다. 등록된 계정으로 로그인해 주세요.");
    }
    const account = await dbGet(`churches/${link.churchId}/account`);
    if (!account || account.uid !== session.localId) {
      throw new Error("로그인한 계정이 이 방송과 맞지 않습니다. 다시 로그인해 주세요.");
    }
    churchId = link.churchId;
    return churchId;
  }

  function watchStatus() {
    if (stopWatch) stopWatch();
    let stopped = false;
    let source = null;
    let current = null;
    let timer = null;
    const open = async () => {
      if (stopped) return;
      try { await ensureToken(); } catch (_) {
        timer = setTimeout(open, 1500);
        return;
      }
      source = new EventSource(authed(dbUrl(`churches/${churchId}/room/status`)));
      const onEvent = (event) => {
        let payload = null;
        try { payload = JSON.parse(event.data); } catch (err) { return; }
        current = LI.roomSync.applyStreamEvent(current, event.type, payload);
        if (!desk.hidden) showStatus(LI.roomSync.publicStatus(current));
      };
      source.addEventListener("put", onEvent);
      source.addEventListener("patch", onEvent);
      source.onerror = () => {
        try { source.close(); } catch (err) { /* 끊긴 줄은 다시 엽니다 */ }
        if (!stopped) timer = setTimeout(open, 1500);
      };
    };
    open();
    stopWatch = () => {
      stopped = true;
      clearTimeout(timer);
      if (source) source.close();
    };
  }

  async function command(patch) {
    await ensureToken();
    const current = await dbGet(`churches/${churchId}/room/desired`);
    const next = LI.roomSync.withRev(current, patch || {});
    await dbPut(`churches/${churchId}/room/desired`, next);
    return next;
  }

  function paintMoney(status) {
    const row = status || {};
    const ready = row.updatedAt > 0;
    document.getElementById("balanceCost").textContent = ready ? (row.balanceLabel || "0원") : "불러오는 중";
    document.getElementById("sessionCost").textContent = ready ? (row.sessionLabel || "이번 0원") : "불러오는 중";
    document.getElementById("prepaidTime").textContent = ready ? (row.remainingLabel || "남은 시간 없음") : "불러오는 중";
    notice.textContent = row.notice || "";
    document.getElementById("offline").hidden = row.online !== false && row.updatedAt > 0;
    const show = document.getElementById("showName");
    if (document.activeElement !== show) show.checked = row.showName !== false;
  }

  let languageKey = "";
  let watchKey = "";

  function syncWatchedToChosen() {
    const next = new Set();
    chosen.forEach((code) => {
      if (watched.has(code) || !prevChosen.has(code) || watched.size === 0) next.add(code);
    });
    if (!next.size) chosen.forEach((code) => next.add(code));
    watched = next;
    prevChosen = new Set(chosen);
  }

  function paintWatchLangs() {
    const box = document.getElementById("watchLangs");
    if (!box) return;
    const codes = [...chosen].sort();
    const nextKey = codes.join(",");
    if (nextKey === watchKey && box.childElementCount) {
      box.querySelectorAll("button.chip").forEach((btn) => {
        btn.classList.toggle("on", watched.has(btn.dataset.code));
        btn.hidden = !chosen.has(btn.dataset.code);
      });
      return;
    }
    watchKey = nextKey;
    box.innerHTML = "";
    if (!codes.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "아래에 번역할 언어를 먼저 고르세요.";
      box.append(empty);
      return;
    }
    codes.forEach((code) => {
      const lang = languages.find((row) => row.code === code);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = watched.has(code) ? "chip on" : "chip";
      btn.dataset.code = code;
      btn.textContent = lang ? `${lang.flag || ""} ${lang.name}`.trim() : code;
      btn.addEventListener("click", () => {
        if (watched.has(code) && watched.size <= 1) return;
        if (watched.has(code)) watched.delete(code);
        else watched.add(code);
        btn.classList.toggle("on", watched.has(code));
        applyWatchFilter();
      });
      box.append(btn);
    });
  }

  function applyWatchFilter() {
    const box = document.getElementById("cards");
    if (!box) return;
    box.querySelectorAll(".card[data-lang]").forEach((card) => {
      card.hidden = !watched.has(card.dataset.lang);
    });
  }

  function paintLanguages() {
    const box = document.getElementById("langs");
    const nextKey = `${spoken}|${[...chosen].sort().join(",")}|${languages.map((lang) => lang.code).join(",")}`;
    if (nextKey === languageKey && box.childElementCount) {
      box.querySelectorAll("button.chip").forEach((btn) => {
        btn.classList.toggle("on", chosen.has(btn.dataset.code));
      });
      syncWatchedToChosen();
      paintWatchLangs();
      return;
    }
    languageKey = nextKey;
    box.innerHTML = "";
    languages.filter((lang) => lang.code !== spoken).forEach((lang) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = chosen.has(lang.code) ? "chip on" : "chip";
      btn.dataset.code = lang.code;
      btn.textContent = `${lang.flag || ""} ${lang.name}`.trim();
      btn.addEventListener("click", async () => {
        if (chosen.has(lang.code)) chosen.delete(lang.code);
        else chosen.add(lang.code);
        btn.classList.toggle("on", chosen.has(lang.code));
        syncWatchedToChosen();
        paintWatchLangs();
        applyWatchFilter();
        try {
          await command({ spoken, targets: [...chosen] });
        } catch (err) {
          notice.textContent = personText(err);
        }
      });
      box.append(btn);
    });
    syncWatchedToChosen();
    paintWatchLangs();
  }

  function paintStartButton(running, gaps) {
    const start = document.getElementById("start");
    const hint = document.getElementById("confirmHint");
    if (!start) return;
    if (running) {
      startArmed = false;
      start.textContent = "시작";
      start.classList.remove("confirm-ready");
      start.disabled = true;
      start.setAttribute("aria-label", "시작");
      if (hint) hint.hidden = true;
      return;
    }
    if (startArmed) {
      // 같은 단추 글자만 「시작확인」으로 바꿉니다. 다시 누르면 방송이 시작됩니다.
      start.textContent = "시작확인";
      start.classList.add("confirm-ready");
      start.setAttribute("aria-label", "confirmStart");
      start.disabled = Array.isArray(gaps) && gaps.length > 0;
      if (hint) {
        const row = latest || {};
        const spokenName = langLabel(row.spoken || spoken);
        const targets = (row.targets || [...chosen]).map(langLabel).join(", ") || "번역 없음";
        const blocked = Array.isArray(gaps) && gaps.length > 0;
        hint.hidden = false;
        hint.textContent = blocked
          ? `아직 준비되지 않았습니다: ${(gaps || []).join(", ")}. 입력 장치와 기록 폴더는 방송실 앱에서 맞춥니다.`
          : `말하는 언어 ${spokenName}. 번역 ${targets}. 남은 충전금 ${row.balanceLabel || "0원"}. ${row.remainingLabel || "남은 시간 없음"}. 다시 누르면 시작합니다.`;
      }
    } else {
      start.textContent = "시작";
      start.classList.remove("confirm-ready");
      start.setAttribute("aria-label", "시작");
      start.disabled = false;
      if (hint) hint.hidden = true;
    }
  }

  function markChoice(box, attr, value) {
    if (!box) return;
    box.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("on", btn.getAttribute(attr) === value);
    });
  }

  function paintPhoneCount(count) {
    const box = document.getElementById("phoneCount");
    if (!box) return;
    if (!box.childElementCount) {
      for (let n = 0; n <= 8; n += 1) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.count = String(n);
        btn.textContent = String(n);
        btn.addEventListener("click", () => {
          markChoice(box, "data-count", String(n));
          sendPatch({ phoneCount: n });
        });
        box.append(btn);
      }
    }
    markChoice(box, "data-count", String(count || 0));
  }

  let inputKey = "";
  let heardKey = "";
  let cardKey = "";
  let logKey = "";
  let gapKey = "";

  function fieldIdle(id) {
    const el = document.getElementById(id);
    return !el || document.activeElement !== el;
  }

  function choiceValue(box, attr, fallback) {
    const on = box && box.querySelector("button.on");
    if (!on) return fallback;
    return on.getAttribute(attr);
  }

  function langLabel(code) {
    const row = languages.find((lang) => lang.code === code);
    return row ? row.name : code;
  }

  function paintOps(status) {
    const row = status || {};
    const onAir = document.getElementById("onAir");
    const running = row.running === true;
    onAir.hidden = !running;
    document.getElementById("stop").disabled = !running;
    const focus = document.activeElement;
    if (!focus || !focus.closest || !focus.closest("#sessionKind")) {
      markChoice(document.getElementById("sessionKind"), "data-kind", row.sessionKind || "");
    }
    const name = document.getElementById("preacherName");
    if (fieldIdle("preacherName")) name.value = row.preacherName || "";
    if (!focus || !focus.closest || !focus.closest("#sensitivity")) {
      markChoice(document.getElementById("sensitivity"), "data-sense", row.sensitivity || "normal");
    }
    const speech = row.speech || {};
    if (fieldIdle("traits")) document.getElementById("traits").value = speech.traits || "";
    if (fieldIdle("fixes")) document.getElementById("fixes").value = speech.fixes || "";
    if (fieldIdle("terms")) document.getElementById("terms").value = speech.terms || "";
    if (!focus || !focus.closest || !focus.closest("#phoneCount")) {
      paintPhoneCount(row.phoneCount || 0);
    }
    const folder = document.getElementById("folderLine");
    folder.textContent = row.folderReady
      ? `기록 폴더가 준비되었습니다.${row.folderLabel ? ` ${row.folderLabel}` : ""}`
      : "기록 폴더는 방송실 앱에서 고릅니다. 폴더가 준비되기 전에는 시작할 수 없습니다.";
    const gaps = Array.isArray(row.gaps) ? row.gaps : [];
    const nextGaps = gaps.join("|");
    if (nextGaps !== gapKey) {
      gapKey = nextGaps;
      const list = document.getElementById("setupGaps");
      list.innerHTML = "";
      gaps.forEach((gap) => {
        const item = document.createElement("li");
        item.textContent = gap === "입력 장치" ? "입력 장치 (방송실에서 고름)" : gap;
        list.append(item);
      });
      list.hidden = gaps.length === 0;
    }
    document.getElementById("bulletinMsg").textContent = row.bulletinLabel || "아직 올린 진행자료가 없습니다.";
    paintStartButton(running, gaps);
  }

  function paintBoard(status) {
    const board = status && status.board ? status.board : { live: "", heard: [], cards: [] };
    document.getElementById("live").textContent = board.live || "대기 중...";
    const heard = Array.isArray(board.heard) ? board.heard : [];
    const nextHeard = JSON.stringify(heard);
    if (nextHeard !== heardKey) {
      heardKey = nextHeard;
      const stack = document.getElementById("koStack");
      stack.innerHTML = "";
      heard.forEach((item) => {
        const block = document.createElement("article");
        block.className = "ko-line";
        const line = document.createElement("p");
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "듣는 말";
        line.append(tag, document.createTextNode(item.body || ""));
        block.append(line);
        (item.fixes || []).forEach((fix) => {
          const corrected = document.createElement("p");
          corrected.className = "corrected";
          const fixTag = document.createElement("span");
          fixTag.className = "tag";
          fixTag.textContent = "교정";
          corrected.append(fixTag, document.createTextNode(fix));
          block.append(corrected);
        });
        stack.append(block);
      });
      stack.scrollTop = stack.scrollHeight;
    }
    const cards = Array.isArray(board.cards) ? board.cards : [];
    const nextCards = JSON.stringify(cards);
    if (nextCards !== cardKey) {
      cardKey = nextCards;
      const box = document.getElementById("cards");
      box.innerHTML = "";
      cards.forEach((item) => {
        const card = document.createElement("article");
        card.className = "card";
        card.dataset.lang = item.lang || "";
        card.hidden = watched.size > 0 && !watched.has(item.lang);
        const title = document.createElement("p");
        title.textContent = langLabel(item.lang);
        const body = document.createElement("p");
        body.textContent = item.body || "";
        card.append(title, body);
        box.append(card);
      });
    } else {
      applyWatchFilter();
    }
    const logs = status && Array.isArray(status.logs) ? status.logs : [];
    const nextLogs = JSON.stringify(logs);
    if (nextLogs !== logKey) {
      logKey = nextLogs;
      const log = document.getElementById("log");
      log.innerHTML = "";
      logs.forEach((item) => {
        const line = document.createElement("p");
        const body = item.body || "";
        if (item.level === "error") {
          line.className = "error";
          line.textContent = personText({ message: body || "다시 시도해 주세요." });
        } else {
          line.textContent = body;
        }
        log.append(line);
      });
    }
  }

  function paintInputs(status) {
    const rows = status && Array.isArray(status.inputs) ? status.inputs : [];
    const nextKey = rows.map((row) => `${row.key}|${row.title}|${row.connected}|${row.joining}|${row.code}|${row.live}|${row.name}`).join(";");
    if (nextKey === inputKey && inputs.childElementCount) {
      rows.forEach((row) => {
        const fill = inputs.querySelector(`[data-level="${row.key}"]`);
        if (fill) fill.style.width = `${Math.round((row.level || 0) * 100)}%`;
      });
      return;
    }
    inputKey = nextKey;
    inputs.innerHTML = "";
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "방송실에 마이크나 휴대폰이 아직 없습니다.";
      inputs.append(empty);
      return;
    }
    rows.forEach((row) => {
      const card = document.createElement("article");
      card.className = "tile";
      const head = document.createElement("div");
      head.className = "tile-head";
      const title = document.createElement("p");
      title.className = "tile-title";
      const state = row.connected ? "연결됨" : (row.joining ? "연결중" : "미연결");
      const stateClass = row.connected ? "state-on" : (row.joining ? "state-wait" : "state-off");
      const stateEl = document.createElement("span");
      stateEl.className = stateClass;
      stateEl.textContent = state;
      title.append(
        document.createTextNode(`${row.title}${row.name ? ` · ${row.name}` : ""}${row.code ? ` · ${row.code}` : ""} · `),
        stateEl,
      );
      head.append(title);
      const controls = document.createElement("div");
      controls.className = "tile-controls";
      const name = document.createElement("input");
      name.value = row.name || "";
      name.maxLength = 40;
      name.placeholder = "이름";
      const live = document.createElement("button");
      live.type = "button";
      live.textContent = row.live === false ? "꺼짐" : "켜짐";
      live.className = row.live === false ? "ghost" : "";
      controls.append(name, live);
      const bar = document.createElement("div");
      bar.className = "meter";
      const fill = document.createElement("span");
      fill.dataset.level = row.key;
      fill.style.width = `${Math.round((row.level || 0) * 100)}%`;
      bar.append(fill);
      const save = async (patch) => {
        const next = (latest && latest.inputs ? latest.inputs : []).map((item) => (
          item.key === row.key ? { ...item, ...patch } : item
        ));
        try {
          latest = { ...(latest || {}), inputs: next };
          await command({ inputs: next });
        } catch (err) {
          notice.textContent = personText(err);
        }
      };
      name.addEventListener("change", () => save({ name: name.value }));
      live.addEventListener("click", () => save({ live: row.live === false }));
      card.append(head, controls, bar);
      inputs.append(card);
    });
  }

  function showStatus(status) {
    latest = status || latest;
    if (!latest) return;
    if (Array.isArray(latest.targets)) chosen = new Set(latest.targets);
    if (latest.spoken) spoken = latest.spoken;
    paintMoney(latest);
    paintLanguages();
    paintOps(latest);
    paintBoard(latest);
    paintInputs(latest);
  }

  function openDesk(email) {
    signInCard.hidden = true;
    operator.hidden = true;
    desk.hidden = false;
    document.getElementById("costHead").hidden = false;
    document.getElementById("opsBar").hidden = false;
    document.getElementById("accountLine").textContent = email || "계정";
    languages = (LI.catalog.languages || []).map((lang) => ({
      code: lang.code,
      name: lang.name,
      flag: lang.flag,
    }));
    spoken = "ko";
    chosen = new Set(LI.catalog.defaultSelectedTargets());
    watched = new Set(chosen);
    startArmed = false;
    paintLanguages();
    paintStartButton(false, []);
    watchStatus();
    ensureToken().then(() => dbGet(`churches/${churchId}/room/status`)).then((value) => {
      showStatus(LI.roomSync.publicStatus(value));
    }).catch((err) => {
      notice.textContent = personText(err);
    });
  }

  function stamp(at) {
    const when = new Date(at);
    const pad = (n) => String(n).padStart(2, "0");
    return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  }

  function recentUse(usage, sessionIndex) {
    const rows = [];
    if (usage && typeof usage === "object") rows.push(usage);
    if (sessionIndex && typeof sessionIndex === "object") rows.push(...Object.values(sessionIndex));
    let picked = null;
    let pickedAt = 0;
    rows.forEach((row) => {
      if (!row || typeof row !== "object") return;
      const at = Math.max(
        Math.round(Number(row.endedAt) || 0),
        Math.round(Number(row.startedAt) || 0),
        Math.round(Number(row.updatedAt) || 0),
      );
      if (!at || at < pickedAt) return;
      picked = row;
      pickedAt = at;
    });
    if (!picked) return "최근 사용 없음";
    const parts = [stamp(pickedAt)];
    if (Number(picked.audioSeconds) > 0) parts.push(LI.cost.formatClock(picked.audioSeconds));
    if (Number(picked.churchKrw)) parts.push(LI.cost.formatKrw(picked.churchKrw));
    return parts.join(" · ");
  }

  async function openOperator() {
    signInCard.hidden = true;
    desk.hidden = true;
    operator.hidden = false;
    document.getElementById("costHead").hidden = true;
    document.getElementById("opsBar").hidden = true;
    const period = await dbGet("billing/testPeriod");
    document.getElementById("testPeriod").checked = period === true;
    const index = await dbGet("churchIndex");
    const entries = index && typeof index === "object" ? Object.entries(index) : [];
    operatorAccounts = [];
    for (const [id, row] of entries) {
      if (!LI.catalog.isChurchId(id) || !row || typeof row !== "object") continue;
      const [billing, usage, sessionIndex] = await Promise.all([
        dbGet(`churches/${id}/billing`),
        dbGet(`churches/${id}/live/usage`),
        dbGet(`churches/${id}/sessionIndex`),
      ]);
      const balanceKrw = Math.round(Number(billing && billing.balance) || 0);
      const prepaid = LI.cost.normalizePrepaid(billing && billing.prepaid);
      const remainingSeconds = prepaid ? prepaid.remainingSeconds : 0;
      operatorAccounts.push({
        id,
        name: row.name && String(row.name).trim() ? String(row.name).trim() : id,
        balanceLabel: LI.cost.formatKrw(balanceKrw),
        timeLabel: remainingSeconds > 0 ? LI.cost.prepaidLabel(remainingSeconds) : "남은 시간 없음",
        recentLabel: recentUse(usage, sessionIndex),
        picked: false,
      });
    }
    operatorAccounts.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const box = document.getElementById("operatorRows");
    box.innerHTML = "";
    operatorAccounts.forEach((account) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost";
      button.textContent = `${account.name} · 남은 잔액 ${account.balanceLabel} · ${account.timeLabel} · ${account.recentLabel}`;
      button.addEventListener("click", () => {
        operatorAccounts.forEach((item) => { item.picked = item.id === account.id; });
        box.querySelectorAll("button").forEach((item) => { item.className = "ghost"; });
        button.className = "";
      });
      box.append(button);
    });
  }

  async function enter() {
    if (isOperatorEmail(session.email)) {
      const adminUid = await dbGet("admin/uid");
      if (session.localId !== adminUid) throw new Error("이 계정은 운영 화면을 열 수 없습니다.");
      await openOperator();
      return;
    }
    await requireChurch();
    openDesk(session.email);
  }

  async function signOut() {
    if (stopWatch) stopWatch();
    stopWatch = null;
    idToken = "";
    tokenExpiresAt = 0;
    churchId = "";
    startArmed = false;
    writeSession(null);
    desk.hidden = true;
    operator.hidden = true;
    signInCard.hidden = false;
    document.getElementById("costHead").hidden = true;
    document.getElementById("opsBar").hidden = true;
  }

  document.getElementById("signIn").addEventListener("click", async () => {
    say("");
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    if (!LI.catalog.validAdminEmail(email) || !LI.catalog.validAdminPassword(password)) {
      say("이메일과 비밀번호를 확인해 주세요. 비밀번호는 6자 이상입니다.");
      return;
    }
    try {
      await signInPassword(String(email).trim(), password);
      await enter();
    } catch (err) {
      await signOut();
      say(personText(err));
    }
  });

  document.getElementById("signOut").addEventListener("click", () => signOut().catch(() => {}));
  document.getElementById("operatorSignOut").addEventListener("click", () => signOut().catch(() => {}));

  function speechPatch() {
    return {
      sensitivity: choiceValue(document.getElementById("sensitivity"), "data-sense", "normal"),
      speech: {
        traits: document.getElementById("traits").value,
        fixes: document.getElementById("fixes").value,
        terms: document.getElementById("terms").value,
      },
    };
  }

  async function sendPatch(patch) {
    try {
      await command(patch);
    } catch (err) {
      notice.textContent = personText(err);
    }
  }

  document.getElementById("start").addEventListener("click", () => {
    const gaps = latest && Array.isArray(latest.gaps) ? latest.gaps : [];
    if (!startArmed) {
      startArmed = true;
      paintStartButton(false, gaps);
      return;
    }
    if (gaps.length > 0) {
      paintStartButton(false, gaps);
      return;
    }
    // confirmStart: 같은 단추를 한 번 더 누르면 방송을 시작합니다.
    sendPatch({
      running: true,
      spoken,
      targets: [...chosen],
      sessionKind: choiceValue(document.getElementById("sessionKind"), "data-kind", ""),
      preacherName: document.getElementById("preacherName").value,
      ...speechPatch(),
    });
  });

  document.getElementById("stop").addEventListener("click", async () => {
    if (startArmed && !(latest && latest.running)) {
      startArmed = false;
      paintStartButton(false, latest && Array.isArray(latest.gaps) ? latest.gaps : []);
      return;
    }
    try {
      await command({ running: false });
    } catch (err) {
      notice.textContent = personText(err);
    }
  });

  document.getElementById("showName").addEventListener("change", (event) => {
    sendPatch({ showName: event.target.checked });
  });

  document.getElementById("sessionKind").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-kind]");
    if (!btn) return;
    markChoice(document.getElementById("sessionKind"), "data-kind", btn.getAttribute("data-kind") || "");
    sendPatch({ sessionKind: btn.getAttribute("data-kind") || "" });
  });

  document.getElementById("preacherName").addEventListener("change", (event) => {
    sendPatch({ preacherName: event.target.value });
  });

  document.getElementById("sensitivity").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-sense]");
    if (!btn) return;
    markChoice(document.getElementById("sensitivity"), "data-sense", btn.getAttribute("data-sense") || "normal");
    sendPatch(speechPatch());
  });

  ["traits", "fixes", "terms"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => sendPatch(speechPatch()));
  });

  paintPhoneCount(0);

  document.getElementById("pickBulletin").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const msg = document.getElementById("bulletinMsg");
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.62));
      if (!blob) throw new Error("진행자료 사진을 올리지 못했습니다.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      const image = btoa(binary);
      if (image.length > 160000) throw new Error("진행자료 사진이 너무 큽니다. 더 작은 사진을 올려 주세요.");
      msg.textContent = "진행자료를 방송실로 보내는 중입니다.";
      await command({ sheet: { name: "진행자료", image } });
    } catch (err) {
      msg.textContent = personText(err);
    }
  });

  document.getElementById("testPeriod").addEventListener("change", async (event) => {
    const box = document.getElementById("testPeriodMsg");
    try {
      await ensureToken();
      await dbPut("billing/testPeriod", event.target.checked === true);
      box.textContent = event.target.checked ? "테스트 기간에는 충전금이 줄지 않습니다." : "테스트 기간을 껐습니다.";
    } catch (err) {
      box.textContent = personText(err);
    }
  });

  document.getElementById("operatorCredit").addEventListener("click", async () => {
    const msg = document.getElementById("operatorMsg");
    const picked = operatorAccounts.find((account) => account.picked);
    if (!picked) {
      msg.textContent = "계정을 골라 주세요.";
      return;
    }
    const amount = Math.round(Number(String(document.getElementById("operatorAmount").value).replace(/[^0-9]/g, "")) || 0);
    if (amount <= 0) {
      msg.textContent = "충전할 금액을 적으세요";
      return;
    }
    try {
      await ensureToken();
      const billing = (await dbGet(`churches/${picked.id}/billing`)) || {};
      const credit = LI.cost.applyCredit({
        balance: billing.balance,
        amount,
        churchId: picked.id,
        who: session.localId || "",
        note: "선불 잔액",
        at: Date.now(),
        type: "manual",
      });
      if (!credit.ok) throw new Error("선불 잔액을 더하지 못했습니다.");
      const row = { ...credit.entry };
      delete row.id;
      await dbPatch(`churches/${picked.id}/billing`, {
        balance: credit.balance,
        lastEntryId: credit.entry.id,
        [`ledger/${credit.entry.id}`]: row,
      });
      msg.textContent = "선불 잔액을 더했습니다.";
      await openOperator();
    } catch (err) {
      msg.textContent = personText(err);
    }
  });

  session = readSession();
  if (session && session.refreshToken) {
    ensureToken().then(() => enter()).catch(async (err) => {
      await signOut();
      say(personText(err));
    });
  }
})();
