/**
 * 강연·회의와 대면 통역의 등록, 요금, 선불 차감.
 * 시간당 금액은 docs/js/cost.js 와 같고, 그 파일은 broadcast/lib/cost.js 와 같은 단가입니다.
 * 브라우저 스크립트와 Node require 둘 다 동작합니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.orgServices = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function costLib() {
    if (typeof module === "object" && module.exports) return require("./cost.js");
    if (!rootCost()) throw new Error("요금 계산이 없습니다.");
    return rootCost();
  }

  function rootCost() {
    const scope = typeof globalThis !== "undefined" ? globalThis : this;
    return scope.LI && scope.LI.cost;
  }

  function cleanName(value) {
    const text = String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return Array.from(text).slice(0, 40).join("");
  }

  function validToken(value) {
    return /^[a-f0-9]{32}$/.test(value || "");
  }

  const CONNECTION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function normalizeConnectionId(value) {
    const compact = String(value || "").toUpperCase().replace(/[\s-]/g, "");
    return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(compact) ? compact : "";
  }

  function validSessionPin(value) {
    return /^\d{4}$/.test(String(value || ""));
  }

  function makeConnectionId(bytes) {
    let source = bytes;
    if (!source) {
      const crypto = require("crypto");
      source = crypto.randomBytes(6);
    }
    let out = "";
    for (let i = 0; i < 6; i += 1) out += CONNECTION_ALPHABET[source[i] % CONNECTION_ALPHABET.length];
    return out;
  }

  function makeSessionPin(bytes) {
    let source = bytes;
    if (!source) {
      const crypto = require("crypto");
      source = crypto.randomBytes(2);
    }
    const number = ((source[0] << 8) | source[1]) % 10000;
    return String(number).padStart(4, "0");
  }

  function claimConnection(holderPeerId, peerId) {
    if (holderPeerId && holderPeerId !== peerId) {
      return {
        ok: false,
        holderPeerId,
        reason: "이 QR은 이미 다른 기기에서 연결되어 있습니다. 먼저 연결을 끊은 뒤에 다시 들어오세요.",
      };
    }
    return { ok: true, holderPeerId: peerId, reason: "" };
  }

  function releaseConnection(holderPeerId, peerId) {
    return holderPeerId === peerId ? "" : holderPeerId || "";
  }

  function publicBase(pagesBase) {
    const base = String(pagesBase || "").replace(/\/$/, "");
    let parsed;
    try {
      parsed = new URL(base);
    } catch (_) {
      throw new Error("참여 페이지 주소가 올바르지 않습니다.");
    }
    if (parsed.protocol !== "https:") throw new Error("참여 페이지는 https 여야 합니다.");
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)) {
      throw new Error("참여 페이지는 공인 https 주소여야 합니다.");
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  }

  function lectureAppUrl(pagesBase) {
    return `${publicBase(pagesBase)}/lecture/`;
  }

  /** 한 칸의 QR에 넣는 주소. c는 칸 번호, s는 신호 열쇠입니다. 비밀번호는 없습니다. */
  function lectureSlotUrl(pagesBase, connectionId, token) {
    const id = normalizeConnectionId(connectionId);
    if (!id) throw new Error("참여 칸이 올바르지 않습니다.");
    if (!validToken(token)) throw new Error("참여 토큰이 올바르지 않습니다.");
    return `${lectureAppUrl(pagesBase)}?c=${id}&s=${token}`;
  }

  function parseLectureSlot(value, pagesBase) {
    let parsed;
    try { parsed = new URL(String(value || "")); } catch (_) { return null; }
    if (parsed.protocol !== "https:") return null;
    let expected;
    try { expected = new URL(publicBase(pagesBase || "https://anyplan75.github.io/live-interpret")); }
    catch (_) { return null; }
    if (parsed.host !== expected.host) return null;
    const root = expected.pathname.replace(/\/$/, "");
    const path = parsed.pathname.replace(/\/$/, "");
    if (path !== `${root}/lecture` && path !== `${root}/phone-booth`) return null;
    const connectionId = normalizeConnectionId(parsed.searchParams.get("c"));
    const token = String(parsed.searchParams.get("s") || "");
    if (!connectionId || !validToken(token)) return null;
    return { connectionId, token };
  }

  function faceAppUrl(pagesBase) {
    return `${publicBase(pagesBase)}/face/`;
  }

  function faceJoinUrl(pagesBase, token) {
    if (!validToken(token)) throw new Error("참여 토큰이 올바르지 않습니다.");
    return `${faceAppUrl(pagesBase)}?s=${token}`;
  }

  function serviceNode(on, now, previous) {
    if (!on) return { registered: false, registeredAt: 0 };
    const prev = Math.round(Number(previous && previous.registeredAt) || 0);
    return { registered: true, registeredAt: prev > 0 ? prev : Math.round(Number(now) || Date.now()) };
  }

  function normalizeService(node) {
    if (!node || node.registered !== true) return { registered: false, registeredAt: 0 };
    return { registered: true, registeredAt: Math.round(Number(node.registeredAt) || 0) };
  }

  function orgSnapshot(church) {
    const raw = church && typeof church === "object" ? church : {};
    const services = raw.services && typeof raw.services === "object" ? raw.services : {};
    return {
      id: typeof raw.id === "string" ? raw.id : "",
      name: typeof raw.name === "string" ? raw.name.trim() : "",
      active: raw.active !== false,
      kind: raw.orgKind === "company" ? "company" : "church",
      lecture: normalizeService(services.lecture),
      face: normalizeService(services.face),
    };
  }

  function kindLabel(kind) {
    return kind === "company" ? "기업" : "계정";
  }

  function serviceLabel(service) {
    return service === "face" ? "대면 통역" : "강연·회의";
  }

  function canStartPaid(org, service) {
    if (service !== "lecture" && service !== "face") {
      return { ok: false, reason: "알 수 없는 통역입니다." };
    }
    const label = serviceLabel(service);
    if (!org || !org.id) {
      return { ok: false, reason: "등록된 계정으로 로그인해 주세요. 등록되지 않은 사람은 유료 통역을 시작할 수 없습니다." };
    }
    if (!org.active) {
      return { ok: false, reason: "이 계정은 멈춰 있어서 유료 통역을 시작할 수 없습니다." };
    }
    if (!org[service] || org[service].registered !== true) {
      return { ok: false, reason: `${label}이 등록되지 않았습니다. 등록되지 않은 계정은 유료 통역을 시작할 수 없습니다.` };
    }
    return { ok: true, reason: "" };
  }

  function guestJoin(token) {
    return { ok: validToken(token), paid: false };
  }

  function rateFor(service, languages) {
    const cost = costLib();
    const langs = cost.paidLanguageSet(languages && languages.length ? languages : ["ko", "en"]);
    const hourKrw = cost.packageKrw({ minutes: 60, languages: langs });
    const label = serviceLabel(service);
    return {
      service,
      languages: langs,
      hourKrw,
      baseKrw: cost.HOUR_BASE_KRW,
      extraLangKrw: cost.EXTRA_LANG_HOUR_KRW,
      halfKrw: cost.halfBlockKrw(langs),
      label: cost.formatKrw(hourKrw),
      text: `${label} 1시간은 ${cost.formatKrw(hourKrw)}입니다. 한국어와 영어가 기본 ${cost.formatKrw(cost.HOUR_BASE_KRW)}이고, 그 밖 언어는 시간당 ${cost.formatKrw(cost.EXTRA_LANG_HOUR_KRW)}입니다.`,
    };
  }

  function adminRateText() {
    const cost = costLib();
    const lecture = rateFor("lecture", ["ko", "en"]);
    return [
      "강연·회의와 대면 통역은 따로 등록합니다. 시간당 금액은 코드에 고정되어 있고, 이 화면에서 바꾸지 않습니다.",
      `강연·회의 1시간, 한국어와 영어: ${lecture.label}.`,
      `한국어와 영어가 아닌 언어는 강연·회의에서 시간당 ${cost.formatKrw(cost.EXTRA_LANG_HOUR_KRW)}이 더해집니다.`,
      `대면 통역은 한 사람 시간당 ${cost.formatKrw(FACE_PERSON_KRW)}입니다. 시작한 사람도 포함입니다. 2명은 시간당 ${cost.formatKrw(facePeopleKrw(2))}, 3명은 시간당 ${cost.formatKrw(facePeopleKrw(3))}입니다.`,
      "고객은 선불 잔액을 넣은 뒤 그 시간으로 씁니다.",
      cost.overtimeText(),
    ].join("\n");
  }

  function ledgerRow(entry) {
    const row = { ...entry };
    delete row.id;
    return row;
  }

  function chargePatch(input) {
    const cost = costLib();
    const source = input || {};
    const plan = cost.planBroadcastStart({
      balance: source.balance,
      languages: source.languages,
      prepaid: source.prepaid,
    });
    if (!plan.ok) return { ok: false, short: true, plan, patch: null, resumed: false };
    if (!plan.charged) return { ok: true, short: false, plan, patch: null, resumed: true, prepaid: plan.prepaid };
    const entry = cost.ledgerEntry({
      id: source.entryId,
      type: "charge",
      deltaKrw: -plan.charged,
      balanceAfter: plan.balance,
      at: source.now,
      who: source.who || "",
      note: source.note || "",
      churchId: source.churchId || "",
    });
    const stored = cost.firebasePrepaid(plan.prepaid, entry.at);
    return {
      ok: true,
      short: false,
      resumed: false,
      plan,
      entry,
      prepaid: stored,
      patch: {
        balance: plan.balance,
        lastEntryId: entry.id,
        [`ledger/${entry.id}`]: ledgerRow(entry),
        "prepaid/remainingSeconds": stored.remainingSeconds,
        "prepaid/languageKey": stored.languageKey,
        "prepaid/kind": stored.kind,
        "prepaid/amountKrw": stored.amountKrw,
        "prepaid/extraCount": stored.extraCount,
        "prepaid/updatedAt": stored.updatedAt,
      },
    };
  }

  function halfPatch(input) {
    const cost = costLib();
    const source = input || {};
    const opened = cost.openHalfBlock({ balance: source.balance, languages: source.languages });
    if (!opened.ok) return { ok: false, short: true, plan: opened, patch: null };
    const entry = cost.ledgerEntry({
      id: source.entryId,
      type: "charge",
      deltaKrw: -opened.charged,
      balanceAfter: opened.balance,
      at: source.now,
      who: source.who || "",
      note: source.note || "추가 30분",
      churchId: source.churchId || "",
    });
    const stored = cost.firebasePrepaid(opened.prepaid, entry.at);
    return {
      ok: true,
      short: false,
      plan: opened,
      entry,
      prepaid: stored,
      patch: {
        balance: opened.balance,
        lastEntryId: entry.id,
        [`ledger/${entry.id}`]: ledgerRow(entry),
        "prepaid/remainingSeconds": stored.remainingSeconds,
        "prepaid/languageKey": stored.languageKey,
        "prepaid/kind": stored.kind,
        "prepaid/amountKrw": stored.amountKrw,
        "prepaid/extraCount": stored.extraCount,
        "prepaid/updatedAt": stored.updatedAt,
      },
    };
  }

  function tickPatch(prepaid, elapsedSeconds, now) {
    const cost = costLib();
    const next = cost.consumePrepaid(prepaid, elapsedSeconds);
    if (!next.prepaid) return { expired: true, prepaid: null, patch: null };
    const stored = cost.firebasePrepaid(next.prepaid, now == null ? Date.now() : now);
    return {
      expired: false,
      prepaid: stored,
      patch: {
        "prepaid/remainingSeconds": stored.remainingSeconds,
        "prepaid/languageKey": stored.languageKey,
        "prepaid/kind": stored.kind,
        "prepaid/amountKrw": stored.amountKrw,
        "prepaid/extraCount": stored.extraCount,
        "prepaid/updatedAt": stored.updatedAt,
      },
    };
  }

  // 대면 통역만의 단가. 강연·회의 시간당 금액과는 따로다.
  // 한 사람 시간당 2,500원이고, 그 금액으로 시계는 1시간(3600초)이 줄어든다.
  const FACE_PERSON_KRW = 2500;
  const FACE_BLOCK_SECONDS = 3600;

  function facePeopleKrw(count) {
    const people = Math.max(0, Math.round(Number(count) || 0));
    return FACE_PERSON_KRW * people;
  }

  const FACE_MIN_PEOPLE = 2;
  const FACE_MAX_PEOPLE = 3;

  function facePartySize(count) {
    const people = Math.round(Number(count) || 0);
    if (people < FACE_MIN_PEOPLE || people > FACE_MAX_PEOPLE) {
      return {
        ok: false,
        people: 0,
        amount: 0,
        reason: "본인을 포함해 2명 또는 3명만 고를 수 있습니다. 3명을 넘길 수 없습니다.",
      };
    }
    return { ok: true, people, amount: facePeopleKrw(people), reason: "" };
  }

  function facePerson(input, knownLang) {
    const name = cleanName(input && input.name);
    const spoken = String((input && input.spoken) || "").trim();
    if (!name) return { ok: false, reason: "이름을 입력해 주세요." };
    const known = typeof knownLang === "function" ? knownLang(spoken) : !!spoken;
    if (!spoken || !known) return { ok: false, reason: "말하는 언어를 선택해 주세요." };
    return { ok: true, person: { name, spoken }, reason: "" };
  }

  function faceSetupReady(input) {
    const source = input || {};
    const size = facePartySize(source.people);
    if (!size.ok) return { ok: false, reason: size.reason, people: 0, amount: 0, mode: "", roster: [] };
    const mode = source.mode === "solo" ? "solo" : source.mode === "qr" ? "qr" : "";
    if (!mode) {
      return {
        ok: false,
        reason: "다른 사람 휴대폰으로 할지, 이 휴대폰만 쓸지 고르세요.",
        people: size.people,
        amount: size.amount,
        mode: "",
        roster: [],
      };
    }
    const knownLang = source.knownLang;
    const rows = mode === "qr"
      ? [source.host].concat(Array.isArray(source.guests) ? source.guests : [])
      : (Array.isArray(source.peopleList) ? source.peopleList : []);
    const needed = size.people;
    if (mode === "qr" && (!Array.isArray(source.guests) || source.guests.length !== needed - 1)) {
      return {
        ok: false,
        reason: `다른 사람 ${needed - 1}명이 각자 휴대폰에서 이름과 언어를 고를 때까지 기다립니다.`,
        people: size.people,
        amount: size.amount,
        mode,
        roster: [],
      };
    }
    if (mode === "solo" && rows.length !== needed) {
      return {
        ok: false,
        reason: "모든 사람의 이름과 언어를 이 휴대폰에서 고르세요.",
        people: size.people,
        amount: size.amount,
        mode,
        roster: [],
      };
    }
    const roster = [];
    for (let i = 0; i < rows.length; i += 1) {
      const ready = facePerson(rows[i], knownLang);
      if (!ready.ok) {
        return { ok: false, reason: ready.reason, people: size.people, amount: size.amount, mode, roster: [] };
      }
      roster.push({ ...ready.person, role: i === 0 ? "host" : "guest" });
    }
    if (new Set(roster.map((person) => person.spoken)).size < 2) {
      return {
        ok: false,
        reason: "서로 다른 언어가 있어야 통역을 시작합니다.",
        people: size.people,
        amount: size.amount,
        mode,
        roster: [],
      };
    }
    return { ok: true, reason: "", people: size.people, amount: size.amount, mode, roster };
  }

  function faceChargePatch(input) {
    const cost = costLib();
    const source = input || {};
    const people = Math.max(0, Math.round(Number(source.people) || 0));
    const amount = facePeopleKrw(people);
    const charged = cost.applyCharge(source.balance, amount);
    if (!charged.ok) {
      return { ok: false, short: true, amount, people, balance: charged.balance, patch: null };
    }
    const entry = cost.ledgerEntry({
      id: source.entryId,
      type: "charge",
      deltaKrw: -charged.deducted,
      balanceAfter: charged.balance,
      at: source.now,
      who: source.who || "",
      note: source.note || `대면 통역 ${people}명`,
      churchId: source.churchId || "",
    });
    return {
      ok: true,
      short: false,
      amount,
      people,
      balance: charged.balance,
      entry,
      remainingSeconds: FACE_BLOCK_SECONDS,
      patch: {
        balance: charged.balance,
        lastEntryId: entry.id,
        [`ledger/${entry.id}`]: ledgerRow(entry),
      },
    };
  }

  function faceRemainingSeconds(state, now) {
    const base = Math.max(0, Math.round(Number(state && state.remainingSeconds) || 0));
    if (!state || state.paused) return base;
    const anchor = Math.round(Number(state.anchor) || 0);
    if (!anchor) return base;
    const elapsed = Math.max(0, Math.floor((Math.round(Number(now) || Date.now()) - anchor) / 1000));
    return Math.max(0, base - elapsed);
  }

  function creditPatch(input) {
    const cost = costLib();
    const source = input || {};
    const credit = cost.applyCredit({
      balance: source.balance,
      amount: source.amount,
      churchId: source.churchId,
      who: source.who || "",
      note: source.note || "선불 잔액",
      at: source.now,
      type: "manual",
    });
    if (!credit.ok) return { ok: false, balance: credit.balance, patch: null };
    return {
      ok: true,
      balance: credit.balance,
      entry: credit.entry,
      patch: {
        balance: credit.balance,
        lastEntryId: credit.entry.id,
        [`ledger/${credit.entry.id}`]: ledgerRow(credit.entry),
      },
    };
  }

  function newOrgWrites(input) {
    const source = input || {};
    const id = source.id;
    const now = Math.round(Number(source.now) || Date.now());
    const kind = source.kind === "company" ? "company" : "church";
    const lecture = serviceNode(!!source.lecture, now, source.previous && source.previous.lecture);
    const face = serviceNode(!!source.face, now, source.previous && source.previous.face);
    const index = {
      name: source.name,
      createdAt: now,
      active: true,
      orgKind: kind,
      lecture: lecture.registered,
      face: face.registered,
    };
    if (source.region) index.region = source.region;
    const writes = {};
    writes[`churches/${id}/name`] = source.name;
    writes[`churches/${id}/createdAt`] = now;
    writes[`churches/${id}/active`] = true;
    writes[`churches/${id}/orgKind`] = kind;
    writes[`churches/${id}/glossary`] = source.glossary || "";
    writes[`churches/${id}/model`] = source.model;
    writes[`churches/${id}/account`] = { uid: source.uid, email: source.email };
    writes[`churches/${id}/live/settings`] = source.settings;
    writes[`churches/${id}/services/lecture`] = lecture;
    writes[`churches/${id}/services/face`] = face;
    writes[`accounts/${source.uid}`] = { churchId: id };
    writes[`churchIndex/${id}`] = index;
    if (source.region) writes[`churches/${id}/region`] = source.region;
    return writes;
  }

  function serviceWrites(input) {
    const source = input || {};
    const now = Math.round(Number(source.now) || Date.now());
    const kind = source.kind === "company" ? "company" : "church";
    const lecture = serviceNode(!!source.lecture, now, source.previous && source.previous.lecture);
    const face = serviceNode(!!source.face, now, source.previous && source.previous.face);
    return {
      kind,
      lecture,
      face,
      writes: {
        [`churches/${source.id}/orgKind`]: kind,
        [`churches/${source.id}/services/lecture`]: lecture,
        [`churches/${source.id}/services/face`]: face,
      },
      index: { orgKind: kind, lecture: lecture.registered, face: face.registered },
    };
  }

  function captionMessage(source, lang, text) {
    return {
      type: "caption",
      source: source === "guest" ? "guest" : "host",
      lang: String(lang || ""),
      text: String(text || "").trim(),
    };
  }

  return {
    cleanName,
    validToken,
    normalizeConnectionId,
    validSessionPin,
    makeConnectionId,
    makeSessionPin,
    claimConnection,
    releaseConnection,
    publicBase,
    lectureAppUrl,
    lectureSlotUrl,
    parseLectureSlot,
    faceAppUrl,
    faceJoinUrl,
    serviceNode,
    orgSnapshot,
    kindLabel,
    serviceLabel,
    canStartPaid,
    guestJoin,
    rateFor,
    adminRateText,
    chargePatch,
    halfPatch,
    tickPatch,
    FACE_PERSON_KRW,
    FACE_BLOCK_SECONDS,
    FACE_MIN_PEOPLE,
    FACE_MAX_PEOPLE,
    facePeopleKrw,
    facePartySize,
    faceSetupReady,
    faceChargePatch,
    faceRemainingSeconds,
    creditPatch,
    newOrgWrites,
    serviceWrites,
    captionMessage,
  };
});
