const signInCard = document.getElementById("signInCard");
const desk = document.getElementById("desk");
const operator = document.getElementById("operator");
const signInMsg = document.getElementById("signInMsg");
const notice = document.getElementById("notice");
const inputs = document.getElementById("inputs");
let languages = [];
let chosen = new Set();
let spoken = "ko";
let latest = null;
let operatorAccounts = [];

function say(text) {
  signInMsg.textContent = text || "";
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

function paintLanguages() {
  const box = document.getElementById("langs");
  const nextKey = `${spoken}|${[...chosen].sort().join(",")}|${languages.map((lang) => lang.code).join(",")}`;
  if (nextKey === languageKey && box.childElementCount) return;
  languageKey = nextKey;
  box.innerHTML = "";
  languages.filter((lang) => lang.code !== spoken).forEach((lang) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = chosen.has(lang.code);
    input.addEventListener("change", async () => {
      if (input.checked) chosen.add(lang.code);
      else chosen.delete(lang.code);
      try {
        await window.desk.command({ spoken, targets: [...chosen] });
      } catch (err) {
        notice.textContent = err && err.message ? err.message : "언어를 바꾸지 못했습니다.";
      }
    });
    label.append(input, document.createTextNode(` ${lang.flag || ""} ${lang.name}`));
    box.append(label);
  });
}

let inputKey = "";

function paintInputs(status) {
  const rows = status && Array.isArray(status.inputs) ? status.inputs : [];
  const nextKey = rows.map((row) => `${row.key}|${row.title}|${row.connected}|${row.joining}|${row.code}|${row.live}|${row.name}|${row.showName !== false}`).join(";");
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
    card.className = "card";
    const title = document.createElement("p");
    const state = row.connected ? "연결됨" : (row.joining ? "연결중" : "아직 연결되지 않았습니다");
    title.textContent = `${row.title} ${state}${row.code ? ` · 연결 번호 ${row.code}` : ""}`;
    const name = document.createElement("input");
    name.value = row.name || "";
    name.maxLength = 40;
    name.placeholder = "이름";
    const live = document.createElement("button");
    live.type = "button";
    live.textContent = row.live === false ? "꺼짐" : "켜짐";
    live.className = row.live === false ? "ghost" : "";
    const show = document.createElement("label");
    show.className = "check";
    const showBox = document.createElement("input");
    showBox.type = "checkbox";
    showBox.checked = row.showName !== false;
    showBox.setAttribute("aria-label", `${row.title || "입력"} 이름을 자막에 표시`);
    show.append(showBox, document.createTextNode(" 이 이름을 자막에 표시"));
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
        await window.desk.command({ inputs: next });
      } catch (err) {
        notice.textContent = err && err.message ? err.message : "입력을 바꾸지 못했습니다.";
      }
    };
    name.addEventListener("change", () => save({ name: name.value }));
    live.addEventListener("click", () => save({ live: row.live === false }));
    showBox.addEventListener("change", () => save({ showName: showBox.checked }));
    card.append(title, name, show, live, bar);
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
  paintInputs(latest);
}

async function openDesk(email) {
  signInCard.hidden = true;
  operator.hidden = true;
  desk.hidden = false;
  document.getElementById("costHead").hidden = false;
  document.getElementById("accountLine").textContent = email || "계정";
  const catalog = await window.desk.catalog();
  languages = catalog.languages || [];
  spoken = "ko";
  chosen = new Set(catalog.defaultTargets || []);
  paintLanguages();
  showStatus(await window.desk.status());
}

async function openOperator() {
  signInCard.hidden = true;
  desk.hidden = true;
  operator.hidden = false;
  const period = await window.desk.testPeriod();
  document.getElementById("testPeriod").checked = !!(period && period.on);
  const listed = await window.desk.operatorList();
  operatorAccounts = listed && Array.isArray(listed.accounts) ? listed.accounts : [];
  const box = document.getElementById("operatorRows");
  box.innerHTML = "";
  operatorAccounts.forEach((account) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ghost";
    row.textContent = `${account.name} · 남은 잔액 ${account.balanceLabel} · ${account.timeLabel} · ${account.recentLabel}`;
    row.addEventListener("click", () => {
      operatorAccounts.forEach((item) => { item.picked = item.id === account.id; });
      box.querySelectorAll("button").forEach((button) => { button.className = "ghost"; });
      row.className = "";
    });
    box.append(row);
  });
}

document.getElementById("signIn").addEventListener("click", async () => {
  say("");
  try {
    const session = await window.desk.signIn(
      document.getElementById("email").value,
      document.getElementById("password").value,
    );
    if (session && session.operator) await openOperator();
    else await openDesk(session && session.email);
  } catch (err) {
    say(err && err.message ? err.message : "다시 로그인해 주세요.");
  }
});

async function signOut() {
  await window.desk.signOut();
  desk.hidden = true;
  operator.hidden = true;
  signInCard.hidden = false;
  document.getElementById("costHead").hidden = true;
}

document.getElementById("signOut").addEventListener("click", () => signOut().catch((err) => {
  notice.textContent = err && err.message ? err.message : "다시 시도해 주세요.";
}));
document.getElementById("operatorSignOut").addEventListener("click", () => signOut().catch(() => {}));

document.getElementById("start").addEventListener("click", async () => {
  try {
    await window.desk.command({ running: true, spoken, targets: [...chosen] });
  } catch (err) {
    notice.textContent = err && err.message ? err.message : "시작하지 못했습니다.";
  }
});

document.getElementById("stop").addEventListener("click", async () => {
  try {
    await window.desk.command({ running: false });
  } catch (err) {
    notice.textContent = err && err.message ? err.message : "종료하지 못했습니다.";
  }
});

document.getElementById("showName").addEventListener("change", async (event) => {
  try {
    await window.desk.command({ showName: event.target.checked });
  } catch (err) {
    notice.textContent = err && err.message ? err.message : "이름 표시를 바꾸지 못했습니다.";
  }
});

document.getElementById("testPeriod").addEventListener("change", async (event) => {
  const box = document.getElementById("testPeriodMsg");
  try {
    await window.desk.setTestPeriod(event.target.checked);
    box.textContent = event.target.checked ? "테스트 기간에는 충전금이 줄지 않습니다." : "테스트 기간을 껐습니다.";
  } catch (err) {
    box.textContent = err && err.message ? err.message : "다시 시도해 주세요.";
  }
});

document.getElementById("operatorCredit").addEventListener("click", async () => {
  const msg = document.getElementById("operatorMsg");
  const picked = operatorAccounts.find((account) => account.picked);
  if (!picked) {
    msg.textContent = "계정을 골라 주세요.";
    return;
  }
  try {
    await window.desk.operatorCredit(picked.id, document.getElementById("operatorAmount").value);
    msg.textContent = "선불 잔액을 더했습니다.";
    await openOperator();
  } catch (err) {
    msg.textContent = err && err.message ? err.message : "다시 시도해 주세요.";
  }
});

window.desk.onStatus((status) => {
  if (!desk.hidden) showStatus(status);
});

window.desk.authStatus().then(async (session) => {
  if (!session || !session.signedIn) return;
  if (session.operator) await openOperator();
  else await openDesk(session.email);
}).catch(() => {});
