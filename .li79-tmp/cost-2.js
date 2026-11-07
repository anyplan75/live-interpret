    };
    if (source.testPeriod === true) {
      return {
        ...base,
        ok: true,
        short: false,
        running: true,
        charged: 0,
        refundKrw: 0,
        balance,
        balanceAfterRefund: balance,
        remainingSeconds: HOUR_SECONDS,
        amountKrw: 0,
        chargeKrw: 0,
        testPeriod: true,
        note: "테스트 기간",
        prepaid: {
          remainingSeconds: HOUR_SECONDS,
          languages,
          kind: "hour",
          amountKrw: 0,
          extraCount: extraLanguageCount(languages),
          extraInputs: extras,
          languageKey: languageKey(languages),
        },
      };
    }
    if (afterRefund < hour) {
      if (keep || refundKrw <= 0) {
        return {
          ...base,
          ok: false,
          short: true,
          running: false,
          charged: 0,
          refundKrw: 0,
          balance,
          balanceAfterRefund: balance,
          remainingSeconds: prepaid ? prepaid.remainingSeconds : 0,
          amountKrw: prepaid ? prepaid.amountKrw : 0,
          prepaid: prepaid ? { ...prepaid } : null,
        };
      }
      return {
        ...base,
        ok: false,
        short: true,
        running: false,
        charged: 0,
        refundKrw,
        balance: afterRefund,
        balanceAfterRefund: afterRefund,
        remainingSeconds: 0,
        amountKrw: 0,
        prepaid: clearedPrepaid(prepaid),
        note: "쓰지 않은 시간",
      };
    }
    return {
      ...base,
      ok: true,
      short: false,
      running: true,
      charged: hour,
      refundKrw,
      balance: afterRefund - hour,
      balanceAfterRefund: afterRefund,
      remainingSeconds: HOUR_SECONDS,
      amountKrw: hour,
      prepaid: next,
    };
  }

  function consumePrepaid(prepaid, elapsedSeconds) {
    const block = normalizePrepaid(prepaid);
    if (!block) return { remainingSeconds: 0, expired: true, prepaid: null };
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    const left = Math.max(0, Math.round(block.remainingSeconds - elapsed));
    if (left <= 0) return { remainingSeconds: 0, expired: true, prepaid: null };
    return {
      remainingSeconds: left,
      expired: false,
      prepaid: { ...block, remainingSeconds: left },
    };
  }

  function openHalfBlock(input) {
    // 이름은 예전 API를 유지하고, 실제 묶음은 1시간입니다.
    const source = input || {};
    const languages = paidLanguageSet(source.languages);
    const extras = extraInputCount(source.extraInputs != null ? source.extraInputs : source.channels);
    const balance = Math.round(Number(source.balance) || 0);
    const hour = hourlyRateKrw(languages, extras);
    const half = halfBlockKrw(languages, extras);
    if (source.testPeriod === true) {
      return {
        ok: true,
        short: false,
        running: true,
        charged: 0,
        chargeKrw: 0,
        balance,
        languages,
        remainingSeconds: HOUR_SECONDS,
        kind: "hour",
        amountKrw: 0,
        halfKrw: half,
        firstHourKrw: hour,
        testPeriod: true,
        prepaid: {
          remainingSeconds: HOUR_SECONDS,
          languages,
          kind: "hour",
          amountKrw: 0,
          extraCount: extraLanguageCount(languages),
          extraInputs: extras,
          languageKey: languageKey(languages),
        },
        note: "테스트 기간",
      };
    }
    const step = applyCharge(balance, hour);
    if (!step.ok) {
      return {
        ok: false,
        short: true,
        running: false,
        charged: 0,
        chargeKrw: hour,
        balance,
        languages,
        remainingSeconds: 0,
        kind: "hour",
        amountKrw: 0,
        halfKrw: half,
        firstHourKrw: hour,
        prepaid: null,
        note: "추가 1시간",
      };
    }
    const prepaid = {
      remainingSeconds: HOUR_SECONDS,
      languages,
      kind: "hour",
      amountKrw: step.deducted,
      extraCount: extraLanguageCount(languages),
      extraInputs: extras,
      languageKey: languageKey(languages),
    };
    return {
      ok: true,
      short: false,
      running: true,
      charged: step.deducted,
      chargeKrw: hour,
      balance: step.balance,
      languages,
      extraInputs: extras,
      remainingSeconds: HOUR_SECONDS,
      kind: "hour",
      amountKrw: step.deducted,
      halfKrw: half,
      firstHourKrw: hour,
      prepaid,
      note: "추가 1시간",
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
