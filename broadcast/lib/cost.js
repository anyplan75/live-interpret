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
  const HOUR_BASE_KRW = 10000;
  const EXTRA_LANG_HOUR_KRW = 2000;
  const EXTRA_INPUT_HOUR_KRW = 3000;
  const EXTRA_CHANNEL_KRW = EXTRA_INPUT_HOUR_KRW;
  const HOUR_SECONDS = 3600;
  const HALF_SECONDS = 1800;
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

  function extraChannelIndexes(indexes) {
    const seen = new Set();
    const out = [];
    (Array.isArray(indexes) ? indexes : []).forEach((raw) => {
      const index = Number(raw);
      if (!Number.isInteger(index) || index <= 0 || seen.has(index)) return;
      seen.add(index);
      out.push(index);
    });
    out.sort((a, b) => a - b);
    return out;
  }

  function extraInputCount(value) {
    if (Array.isArray(value)) return extraChannelIndexes(value).length;
    const n = Math.round(Number(value) || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(24, n);
  }

  function channelFeePlan(input) {
    const balance = Math.round(Number(input && input.balance) || 0);
    const requested = extraChannelIndexes(input && input.channels);
    return {
      started: requested.slice(),
      blocked: [],
      charged: 0,
      balance,
      feeKrw: 0,
    };
  }

  function hourlyRateKrw(languages, extraInputs) {
    return HOUR_BASE_KRW
      + EXTRA_LANG_HOUR_KRW * extraLanguageCount(languages)
      + EXTRA_INPUT_HOUR_KRW * extraInputCount(extraInputs);
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
    if (!Number.isFinite(m) || m <= 0) return 0;
    return Math.ceil(m / 60);
  }

  function hourlyKrw(minutes, languages, extraInputs) {
    return Math.round(hourlyRateKrw(languages, extraInputs) * hourUnits(minutes));
  }

  function packageKrw(opts) {
    const minutes = opts && opts.minutes != null ? opts.minutes : 0;
    return hourlyKrw(minutes, opts && opts.languages);
  }

  function halfBlockKrw(languages, extraInputs) {
    return Math.round(hourlyRateKrw(languages, extraInputs) / 2);
  }

  function overtimeBlocks(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 60) return 0;
    return Math.ceil(m / 60) - 1;
  }

  function overtimeText() {
    return "시작은 다음 1시간 요금이 충전금에 있을 때만 됩니다. 1시간이 끝나면 같은 시간당 요금으로 다음 1시간이 빠집니다. 1시간을 다 쓰지 않고 끄면 쓰지 않은 만큼 충전금으로 돌아갑니다.";
  }

  function blockSpanSeconds(kind) {
    return kind === "hour" ? HOUR_SECONDS : HALF_SECONDS;
  }

  function unusedRefundKrw(block) {
    if (!block || typeof block !== "object") return 0;
    const amount = Math.round(Number(block.amountKrw) || 0);
    const span = blockSpanSeconds(block.kind === "hour" ? "hour" : "half");
    const left = Math.max(0, Math.min(span, Math.round(Number(block.remainingSeconds) || 0)));
    if (amount <= 0 || left <= 0) return 0;
    return Math.min(amount, Math.round((amount * left) / span));
  }

  function applyCharge(balance, amount) {
    const current = Math.round(Number(balance) || 0);
    const charge = Math.round(Number(amount) || 0);
    if (charge <= 0 || current < charge) {
      return { ok: false, short: charge > 0, balance: current, deducted: 0 };
    }
