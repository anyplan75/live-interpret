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

  function quote(input) {
    const audioSeconds = Number(input && input.audioSeconds) || 0;
    const chars = cleanChars(input && input.chars);
    const model = input && input.model;
    const recognitionUsd = audioSeconds / 60 * CAPTION_USD_PER_MIN;
    const translationUsd = sumChars(chars) / CHARS_PER_MINUTE * TRANSLATION_INCREMENT_USD_PER_MIN;
    const churchUsd = recognitionUsd + translationUsd;
    const api = apiBreakdown(audioSeconds, chars, model);
    return {
      audioSeconds,
      chars,
      recognitionUsd,
      translationUsd,
      churchUsd,
      churchKrw: Math.round(churchUsd * USD_KRW),
      apiUsd: api.totalUsd,
      apiKrw: Math.round(api.totalUsd * USD_KRW),
      api,
      model: api.model,
    };
  }

  function usageRecord(input, now) {
    const priced = quote(input || {});
    return {
      audioSeconds: Math.round(priced.audioSeconds * 1000) / 1000,
      chars: priced.chars,
      churchKrw: priced.churchKrw,
      apiKrw: priced.apiKrw,
      updatedAt: now || Date.now(),
    };
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
    const languages = opts && opts.languages != null ? opts.languages : 1;
    const charsPerMinute = opts && opts.charsPerMinute != null ? opts.charsPerMinute : CHARS_PER_MINUTE;
    const model = opts && opts.model ? opts.model : "gpt-4o-mini";
    const names = ["en", "ja", "zh-CN", "vi", "th", "id", "ne", "tl", "es", "fr", "de", "ru", "pt", "hi", "ar", "mn"];
    const chars = {};
    const per = Math.round(minutes * charsPerMinute);
    for (let i = 0; i < languages; i += 1) chars[names[i] || `l${i}`] = per;
    const priced = quote({ audioSeconds: minutes * 60, chars, model });
    return {
      minutes,
      languages,
      charsPerMinute,
      charsPerLanguage: per,
      ...priced,
    };
  }

  function rateCardText() {
    const one = estimateSermon({ minutes: SERMON_MINUTES, languages: 1 });
    const two = estimateSermon({ minutes: SERMON_MINUTES, languages: 2 });
    const added = two.churchKrw - one.churchKrw;
    return [
      "교회 요금은 고정입니다. 교회 앱에서는 단가를 바꿀 수 없습니다.",
      `환율: 1달러 = ${USD_KRW}원 (2026-10-09 서울 외환시장 15:30 기준가).`,
      "음성 인식은 목표 언어가 늘어도 한 번입니다. Maestra 실시간 자막 분당 $39÷360.",
      "번역은 목표 언어마다 글자 수입니다. Maestra 실시간 번역 분당 $79÷180에서 자막 단가를 뺀 금액이고, 말하는 속도는 분당 750자입니다.",
      `${SERMON_MINUTES}분 설교, 언어 1개: ${formatKrw(one.churchKrw)}.`,
      `같은 ${SERMON_MINUTES}분에 언어가 하나 더 있으면 ${formatKrw(two.churchKrw)}입니다. 늘어나는 금액은 ${formatKrw(added)}이고 인식 요금은 그대로입니다.`,
      "이 화면은 교회 요금과 API 원가를 함께 보여 줍니다. 교회 방송 앱은 교회 요금만 보여 줍니다.",
    ].join("\n");
  }

  return {
    USD_KRW,
    SERMON_MINUTES,
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
