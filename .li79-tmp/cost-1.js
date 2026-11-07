    const half = halfBlockKrw(languages, extras);
    const result = applyCharge(input && input.balance, first);
    const session = {
      ok: result.ok,
      running: result.ok,
      short: !result.ok,
      charged: result.deducted,
      balance: result.balance,
      languages,
      extraInputs: extras,
      firstHourKrw: hourlyRateKrw(languages, extras),
      halfKrw: half,
      overtimeDone: 0,
    };
    return session;
  }

  function accrue(session, minutes) {
    const current = session && typeof session === "object" ? session : {};
    const languages = languageList(current.languages);
    const extras = extraInputCount(current.extraInputs);
    const hour = Number.isFinite(Number(current.firstHourKrw)) ? Math.round(Number(current.firstHourKrw)) : hourlyRateKrw(languages, extras);
    const half = Number.isFinite(Number(current.halfKrw)) ? Math.round(Number(current.halfKrw)) : halfBlockKrw(languages, extras);
    const needed = overtimeBlocks(minutes);
    let balance = Math.round(Number(current.balance) || 0);
    let charged = Math.round(Number(current.charged) || 0);
    let done = Math.round(Number(current.overtimeDone) || 0);
    let short = false;
    if (current.running === false || current.ok === false) {
      return {
        ...current,
        ok: false,
        running: false,
        short: true,
        charged,
        balance,
        languages,
        halfKrw: half,
        firstHourKrw: hour,
        overtimeDone: done,
      };
    }
    while (done < needed) {
      const step = applyCharge(balance, hour);
      if (!step.ok) {
        short = true;
        break;
      }
      balance = step.balance;
      charged += step.deducted;
      done += 1;
    }
    return {
      ...current,
      ok: !short,
      running: true,
      short,
      charged,
      balance,
      languages,
      halfKrw: half,
      overtimeDone: done,
    };
  }

  function paidLanguageSet(languages) {
    const seen = new Set();
    const out = [];
    languageList(languages).forEach((code) => {
      const clean = String(code).trim();
      const key = clean.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    });
    return out;
  }

  function languageKey(languages) {
    return paidLanguageSet(languages)
      .slice()
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .join(",");
  }

  function languagesFromKey(key) {
    return paidLanguageSet(String(key || "").split(","));
  }

  function languagesFromPrepaid(raw) {
    if (!raw || typeof raw !== "object") return [];
    if (typeof raw.languageKey === "string" && raw.languageKey.trim()) return languagesFromKey(raw.languageKey);
    if (Array.isArray(raw.languages)) return paidLanguageSet(raw.languages);
    if (raw.languages && typeof raw.languages === "object") {
      return paidLanguageSet(Object.keys(raw.languages).filter((code) => raw.languages[code]));
    }
    return [];
  }

  function normalizePrepaid(raw) {
    if (!raw || typeof raw !== "object") return null;
    const remaining = Math.round(Number(raw.remainingSeconds) || 0);
    const languages = languagesFromPrepaid(raw);
    const kind = raw.kind === "half" ? "half" : (raw.kind === "hour" ? "hour" : "");
    const amountKrw = Math.round(Number(raw.amountKrw) || 0);
    if (remaining <= 0 || !languages.length || !kind || amountKrw < 0) return null;
    return {
      remainingSeconds: remaining,
      languages,
      kind,
      amountKrw,
      extraCount: extraLanguageCount(languages),
      extraInputs: extraInputCount(raw.extraInputs),
      languageKey: languageKey(languages),
      updatedAt: Math.round(Number(raw.updatedAt) || 0),
    };
  }

  function choosePrepaid(remote, local) {
    const cloud = normalizePrepaid(remote);
    const disk = normalizePrepaid(local);
    if (!cloud) return disk;
    if (!disk) return cloud;
    return (cloud.updatedAt || 0) >= (disk.updatedAt || 0) ? cloud : disk;
  }

  function firebasePrepaid(block, now) {
    const current = block && typeof block === "object" ? block : {};
    const languages = languagesFromPrepaid(current);
    const kind = current.kind === "half" ? "half" : "hour";
    return {
      remainingSeconds: Math.max(0, Math.round(Number(current.remainingSeconds) || 0)),
      languageKey: languageKey(languages),
      kind,
      amountKrw: Math.max(0, Math.round(Number(current.amountKrw) || 0)),
      extraCount: extraLanguageCount(languages),
      extraInputs: extraInputCount(current.extraInputs),
      updatedAt: now == null ? Date.now() : now,
    };
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  function prepaidLabel(seconds) {
    return `남은 시간 ${formatClock(seconds)}`;
  }

  function addedLanguages(paidLanguages, selected) {
    const paid = new Set(paidLanguageSet(paidLanguages).map((code) => code.toLowerCase()));
    return paidLanguageSet(selected).filter((code) => !isBaseLanguage(code) && !paid.has(code.toLowerCase()));
  }

  function clearedPrepaid(block) {
    const current = normalizePrepaid(block);
    if (!current) return null;
    return {
      remainingSeconds: 0,
      languages: current.languages.slice(),
      kind: current.kind,
      amountKrw: 0,
      extraCount: current.extraCount,
      extraInputs: extraInputCount(current.extraInputs),
      languageKey: current.languageKey,
      updatedAt: current.updatedAt,
    };
  }

  function planBroadcastStart(input) {
    const source = input || {};
    const languages = paidLanguageSet(source.languages);
    const extras = extraInputCount(source.extraInputs != null ? source.extraInputs : source.channels);
    const balance = Math.round(Number(source.balance) || 0);
    const prepaid = normalizePrepaid(source.prepaid);
    const overtime = overtimeText();
    const hour = hourlyRateKrw(languages, extras);
    const half = halfBlockKrw(languages, extras);
    const refundKrw = prepaid ? unusedRefundKrw(prepaid) : 0;
    const afterRefund = balance + refundKrw;
    const keep = !!source.keepBlockOnShort;
    const next = {
      remainingSeconds: HOUR_SECONDS,
      languages,
      kind: "hour",
      amountKrw: hour,
      extraCount: extraLanguageCount(languages),
      extraInputs: extras,
      languageKey: languageKey(languages),
    };
    const base = {
      mode: "hour",
      languages,
      paidLanguages: languages,
      extraInputs: extras,
      firstHourKrw: hour,
      halfKrw: half,
      chargeKrw: hour,
      extraFeeKrw: 0,
      addedLanguages: [],
      resumed: false,
      noExtraCharge: false,
      overtimeText: overtime,
      note: "1시간",
      kind: "hour",
