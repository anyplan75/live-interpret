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
      "한국어와 영어, 그리고 첫 입력은 기본 1시간 10,000원입니다.",
      "한국어와 영어가 아닌 언어는 시간당 2,000원입니다.",
      "첫 입력 다음의 채널이나 휴대폰은 시간당 3,000원입니다. 휴대폰이 연결될 때 10,000원을 빼지 않습니다.",
      "1시간마다 그 시간당 요금이 빠집니다. 1시간을 다 쓰지 않으면 쓰지 않은 만큼 충전금으로 돌아갑니다.",
      `50분, 영어만: ${formatKrw(english)}.`,
      `60분, 영어와 중국어: ${formatKrw(chinese)}.`,
      `90분, 영어만: ${formatKrw(ninety)}.`,
      "방송 화면은 남은 충전금, 이번 방송 차감, 남은 시간을 보여 줍니다.",
      "쓰지 않은 충전금은 계정에 남고 다음에 다시 씁니다.",
      "이 화면은 교회 요금과 API 원가를 함께 보여 줍니다. 교회 방송 앱은 API 원가를 보여 주지 않습니다.",
    ].join("\n");
  }

  return {
    USD_KRW,
    SERMON_MINUTES,
    HOUR_BASE_KRW,
    EXTRA_LANG_HOUR_KRW,
    EXTRA_INPUT_HOUR_KRW,
    EXTRA_CHANNEL_KRW,
    extraChannelIndexes,
    extraInputCount,
    channelFeePlan,
    hourlyRateKrw,
    unusedRefundKrw,
    clearedPrepaid,
    HOUR_SECONDS,
    HALF_SECONDS,
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
    paidLanguageSet,
    languageKey,
    normalizePrepaid,
    choosePrepaid,
    firebasePrepaid,
    formatClock,
    prepaidLabel,
    addedLanguages,
    planBroadcastStart,
    consumePrepaid,
    openHalfBlock,
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
