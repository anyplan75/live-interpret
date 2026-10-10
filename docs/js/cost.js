/**
 * 교회 요금과 OpenAI 원가.
 * 브라우저 스크립트와 Node require 둘 다 동작합니다.
 * 단가는 코드에 고정입니다. 교회 화면에서 바꾸지 않습니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.cost = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const USD_KRW = 1342.8;
  const SERMON_MINUTES = 40;
  const HOUR_BASE_KRW = 15000;
  const EXTRA_LANG_HOUR_KRW = 5000;
  const CHARS_PER_MINUTE = 750;
  const CAPTION_USD_PER_MIN = 39 / 360;
  const TRANSLATION_USD_PER_MIN = 79 / 180;
  const TRANSLATION_INCREMENT_USD_PER_MIN = TRANSLATION_USD_PER_MIN - CAPTION_USD_PER_MIN;
  const TRANSCRIBE_USD_PER_MIN = 0.017;
  const TOKENS_PER_CHAR = 1.5;
  const PROMPT_OVERHEAD_TOKENS = 1300;
  const CHARS_PER_REQUEST = 100;
  const BATCH_SIZE = 5;
  const MODEL_PRICES = {
    "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
    "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  };

  function formatKrw(value) {
    const n = Math.round(Number(value) || 0);
    const sign = n < 0 ? "-" : "";
    const body = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}${body}원`;
  }

  function cleanChars(chars) {
    const out = {};
    if (!chars || typeof chars !== "object") return out;
    Object.entries(chars).forEach(([lang, raw]) => {
      if (!/^[a-z]{2,3}(?:-[A-Za-z]{2})?$/.test(lang)) return;
      const count = Math.round(Number(raw) || 0);
      if (count > 0) out[lang] = count;
    });
    return out;
  }

  function sumChars(chars) {
    return Object.values(chars).reduce((sum, n) => sum + n, 0);
  }

  function apiBreakdown(audioSeconds, chars, model) {
    const prices = MODEL_PRICES[model] || MODEL_PRICES["gpt-4o-mini"];
    const usedModel = MODEL_PRICES[model] ? model : "gpt-4o-mini";
    const transcribeUsd = (Number(audioSeconds) || 0) / 60 * TRANSCRIBE_USD_PER_MIN;
    const langs = Object.values(chars);
    if (!langs.length) {
      return {
        model: usedModel,
        transcribeUsd,
        translationUsd: 0,
        totalUsd: transcribeUsd,
        inputTokens: 0,
        outputTokens: 0,
        requests: 0,
        batches: 0,
      };
    }
    const sourceChars = Math.max(...langs);
    const requests = sourceChars / CHARS_PER_REQUEST;
    const batches = Math.ceil(langs.length / BATCH_SIZE);
    const inputTokens = requests * PROMPT_OVERHEAD_TOKENS * batches + sourceChars * TOKENS_PER_CHAR * batches;
    const outputTokens = sumChars(chars) * TOKENS_PER_CHAR;
    const translationUsd = inputTokens * prices.inputPerMillion / 1e6
      + outputTokens * prices.outputPerMillion / 1e6;
    return {
      model: usedModel,
      transcribeUsd,
      translationUsd,
      totalUsd: transcribeUsd + translationUsd,
      inputTokens,
      outputTokens,
      requests,
      batches,
    };
  }

  const LANGUAGE_POOL = ["en", "zh-CN", "ja", "vi", "th", "id", "ne", "tl", "es", "fr", "de", "ru", "pt", "hi", "ar", "mn"];

  function languageList(languages) {
    if (Array.isArray(languages)) return languages.filter((code) => code);
    const count = Math.max(0, Math.round(Number(languages) || 0));
    const names = [];
    for (let i = 0; i < count; i += 1) names.push(LANGUAGE_POOL[i] || `l${i}`);
    return names;
  }

  function isBaseLanguage(code) {
    const lang = String(code || "").trim().toLowerCase();
    return !lang || lang === "ko" || lang === "en" || lang.startsWith("ko-") || lang.startsWith("en-");
  }

  function extraLanguageCount(languages) {
    const seen = new Set();
    languageList(languages).forEach((code) => {
      if (isBaseLanguage(code)) return;
      seen.add(String(code).trim().toLowerCase());
    });
    return seen.size;
  }

  function hourUnits(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m < 0) return 0;
    if (m <= 60) return 1;
    return 1 + Math.ceil((m - 60) / 30) * 0.5;
  }

  function hourlyKrw(minutes, languages) {
    return Math.round((HOUR_BASE_KRW + EXTRA_LANG_HOUR_KRW * extraLanguageCount(languages)) * hourUnits(minutes));
  }

  function packageKrw(opts) {
    const minutes = opts && opts.minutes != null ? opts.minutes : 0;
    return hourlyKrw(minutes, opts && opts.languages);
  }

  function halfBlockKrw(languages) {
    return 7500 + 2500 * extraLanguageCount(languages);
  }

  function overtimeBlocks(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 60) return 0;
    return Math.ceil((m - 60) / 30);
  }

  function overtimeText() {
    return "60분을 넘으면 30분마다 기본 7,500원과 추가 언어당 2,500원이 더 빠집니다.";
  }

  function applyCharge(balance, amount) {
    const current = Math.round(Number(balance) || 0);
    const charge = Math.round(Number(amount) || 0);
    if (charge <= 0 || current < charge) {
      return { ok: false, short: charge > 0, balance: current, deducted: 0 };
    }
    return { ok: true, short: false, balance: current - charge, deducted: charge };
  }

  function openBroadcast(input) {
    const languages = languageList(input && input.languages);
    const first = packageKrw({ minutes: 60, languages });
    const half = halfBlockKrw(languages);
    const result = applyCharge(input && input.balance, first);
    const session = {
      ok: result.ok,
      running: result.ok,
      short: !result.ok,
      charged: result.deducted,
      balance: result.balance,
      languages,
      firstHourKrw: first,
      halfKrw: half,
      overtimeDone: 0,
    };
    return session;
  }

  function accrue(session, minutes) {
    const current = session && typeof session === "object" ? session : {};
    const languages = languageList(current.languages);
    const half = Number.isFinite(Number(current.halfKrw)) ? Math.round(Number(current.halfKrw)) : halfBlockKrw(languages);
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
        overtimeDone: done,
      };
    }
    while (done < needed) {
      const step = applyCharge(balance, half);
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

  function ledgerId(now) {
    const stamp = now == null ? Date.now() : now;
    const salt = Math.random().toString(36).slice(2, 8);
    return `e${stamp}_${salt}`;
  }

  function sanitizeDepositId(id) {
    return String(id || "").replace(/[.#$[\]/]/g, "_").slice(0, 128);
  }

  function ledgerEntry(fields) {
    const source = fields || {};
    const delta = Math.round(Number(source.deltaKrw) || 0);
    const balanceAfter = Math.round(Number(source.balanceAfter) || 0);
    return {
      id: source.id || ledgerId(source.at),
      type: source.type || "charge",
      deltaKrw: delta,
      amountKrw: delta,
      balanceAfter,
      at: source.at == null ? Date.now() : source.at,
      who: source.who || "",
      note: source.note || "",
      depositId: source.depositId || "",
      churchId: source.churchId || "",
    };
  }

  function applyCredit(input) {
    const source = input || {};
    const credit = Math.round(Number(source.amount) || 0);
    const current = Math.round(Number(source.balance) || 0);
    if (credit <= 0) return { ok: false, balance: current, duplicate: false };
    const next = current + credit;
    const entry = ledgerEntry({
      id: source.id,
      type: source.type || "manual",
      deltaKrw: credit,
      balanceAfter: next,
      at: source.at,
      who: source.who,
      note: source.note,
      depositId: source.depositId,
      churchId: source.churchId,
    });
    return { ok: true, balance: next, entry, duplicate: false };
  }

  function billingState(state) {
    const current = state && typeof state === "object" ? state : {};
    return {
      balances: { ...(current.balances || {}) },
      deposits: { ...(current.deposits || {}) },
      ledger: Array.isArray(current.ledger) ? current.ledger.slice() : [],
    };
  }

  function prepareDeposit(state, body) {
    const source = body || {};
    const depositId = sanitizeDepositId(source.depositId);
    const churchId = String(source.churchId || "").trim();
    const amount = Math.round(Number(source.amountKrw) || 0);
    const snapshot = billingState(state);
    if (!depositId || !churchId || amount <= 0) {
      return { ok: false, duplicate: false, balance: Math.round(Number(snapshot.balances[churchId]) || 0), state: snapshot };
    }
    if (snapshot.deposits[depositId]) {
      return {
        ok: true,
        duplicate: true,
        balance: Math.round(Number(snapshot.balances[churchId]) || 0),
        state: snapshot,
      };
    }
    const credit = applyCredit({
      balance: snapshot.balances[churchId] || 0,
      amount,
      churchId,
      who: "webhook",
      note: "입금",
      depositId,
      at: source.paidAt == null ? Date.now() : source.paidAt,
      type: "deposit",
    });
    snapshot.balances[churchId] = credit.balance;
    snapshot.deposits[depositId] = { churchId, amountKrw: amount, at: credit.entry.at };
    snapshot.ledger.push(credit.entry);
    return { ok: true, duplicate: false, balance: credit.balance, entry: credit.entry, state: snapshot };
  }

  function quote(input) {
    const audioSeconds = Number(input && input.audioSeconds) || 0;
    const chars = cleanChars(input && input.chars);
    const model = input && input.model;
    const minutes = input && input.minutes != null ? Number(input.minutes) : audioSeconds / 60;
    const languages = input && input.languages != null ? input.languages : Object.keys(chars);
    const recognitionUsd = audioSeconds / 60 * CAPTION_USD_PER_MIN;
    const translationUsd = sumChars(chars) / CHARS_PER_MINUTE * TRANSLATION_INCREMENT_USD_PER_MIN;
    const churchKrw = hourlyKrw(minutes, languages);
    const api = apiBreakdown(audioSeconds, chars, model);
    return {
      audioSeconds,
      chars,
      minutes,
      languages: languageList(languages),
      extraLanguages: extraLanguageCount(languages),
      recognitionUsd,
      translationUsd,
      churchUsd: churchKrw / USD_KRW,
      churchKrw,
      apiUsd: api.totalUsd,
      apiKrw: Math.round(api.totalUsd * USD_KRW),
      api,
      model: api.model,
    };
  }

  function usageRecord(input, now) {
    const source = input || {};
    const priced = quote(source);
    const keepChurch = source.minutes == null && source.languages == null && Number.isFinite(Number(source.churchKrw));
    const record = {
      audioSeconds: Math.round(priced.audioSeconds * 1000) / 1000,
      churchKrw: keepChurch ? Math.round(Number(source.churchKrw)) : priced.churchKrw,
      apiKrw: priced.apiKrw,
      updatedAt: now || source.updatedAt || Date.now(),
    };
    if (priced.chars && Object.keys(priced.chars).length) record.chars = priced.chars;
    return record;
  }

  function present(raw) {
    if (!raw || typeof raw !== "object") {
      return { audioSeconds: 0, chars: {}, churchKrw: 0, apiKrw: 0 };
    }
    const churchKrw = Number.isFinite(Number(raw.churchKrw)) ? Math.round(Number(raw.churchKrw)) : 0;
    const apiKrw = Number.isFinite(Number(raw.apiKrw)) ? Math.round(Number(raw.apiKrw)) : 0;
    return {
      audioSeconds: Number(raw.audioSeconds) || 0,
      chars: raw.chars && typeof raw.chars === "object" ? raw.chars : {},
      churchKrw,
      apiKrw,
    };
  }

  function estimateSermon(opts) {
    const minutes = opts && opts.minutes != null ? opts.minutes : SERMON_MINUTES;
    const names = languageList(opts && opts.languages != null ? opts.languages : 1);
    const charsPerMinute = opts && opts.charsPerMinute != null ? opts.charsPerMinute : CHARS_PER_MINUTE;
    const model = opts && opts.model ? opts.model : "gpt-4o-mini";
    const chars = {};
    const per = Math.round(minutes * charsPerMinute);
    names.forEach((lang) => {
      if (isBaseLanguage(lang) && String(lang).toLowerCase() !== "en") return;
      chars[lang] = per;
    });
    const priced = quote({ audioSeconds: minutes * 60, chars, model, minutes, languages: names });
    return {
      minutes,
      languages: names,
      charsPerMinute,
      charsPerLanguage: per,
      ...priced,
    };
  }

  function rateCardText() {
    const english = packageKrw({ minutes: 50, languages: ["en"] });
    const chinese = packageKrw({ minutes: 60, languages: ["en", "zh-CN"] });
    const ninety = packageKrw({ minutes: 90, languages: ["en"] });
    return [
      "교회 요금은 시간 단위로 고정입니다. 교회 앱에서는 단가를 바꿀 수 없습니다.",
      "한국어 인식과 영어는 기본 1시간 15,000원입니다. 영어를 꺼도 5,000원을 더하지 않습니다.",
      "한국어와 영어가 아닌 목표 언어는 시간당 5,000원입니다.",
      "60분 이하는 1시간입니다. 61분부터 30분마다 기본 7,500원과 추가 언어당 2,500원이 더해집니다.",
      `50분, 영어만: ${formatKrw(english)}.`,
      `60분, 영어와 중국어: ${formatKrw(chinese)}.`,
      `90분, 영어만: ${formatKrw(ninety)}.`,
      "방송 화면은 남은 충전금과 이번 방송 차감을 보여 줍니다. 초마다 오르지 않습니다.",
      "이 화면은 교회 요금과 API 원가를 함께 보여 줍니다. 교회 방송 앱은 API 원가를 보여 주지 않습니다.",
    ].join("\n");
  }

  return {
    USD_KRW,
    SERMON_MINUTES,
    HOUR_BASE_KRW,
    EXTRA_LANG_HOUR_KRW,
    CHARS_PER_MINUTE,
    CAPTION_USD_PER_MIN,
    TRANSLATION_USD_PER_MIN,
    TRANSLATION_INCREMENT_USD_PER_MIN,
    TRANSCRIBE_USD_PER_MIN,
    TOKENS_PER_CHAR,
    PROMPT_OVERHEAD_TOKENS,
    CHARS_PER_REQUEST,
    BATCH_SIZE,
    MODEL_PRICES,
    formatKrw,
    packageKrw,
    hourUnits,
    extraLanguageCount,
    halfBlockKrw,
    overtimeBlocks,
    overtimeText,
    applyCharge,
    openBroadcast,
    accrue,
    applyCredit,
    prepareDeposit,
    ledgerEntry,
    ledgerId,
    sanitizeDepositId,
    quote,
    usageRecord,
    present,
    estimateSermon,
    rateCardText,
    audioSecondsFromPcm(byteLength, sampleRate) {
      const rate = sampleRate || 24000;
      if (!byteLength || byteLength < 0 || !rate) return 0;
      return byteLength / 2 / rate;
    },
  };
});
