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

