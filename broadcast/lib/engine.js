const {
  langByCode,
  defaultGlossary,
  defaultModel,
  isChurchId,
  isPreacherId,
  isModelId,
  redactSecrets,
  sessionContextText,
  contextKeywords,
  applyStyleToSettings,
  styleFromSettings,
  subtitleFontId,
  spokenLanguage,
  transcriptionLanguage,
  translationTargets,
} = require("./catalog");
const bulletin = require("./bulletin");
const preacherLib = require("./preacher");
const { listInputDevices, InputCapture } = require("./audio");
const { channelPeaks, resampleInt16, extractChannel } = require("./audio-util");
const { SpeechSession } = require("./stt");
const { Pipeline } = require("./pipeline");
const { UsageMeter } = require("./usage");
const cost = require("./cost");
const { createSubtitleBoard } = require("./subtitle-board");
const { cleanDisplayName, cleanPhoneId } = require("./phone-name");
const { createSessionWriter } = require("./files");
const firebase = require("./firebase");

function cleanTargets(targets) {
  return [...new Set((targets || []).filter((code) => code !== "ko" && langByCode[code]))];
}

/** 그 채널이 말하는 언어는 빼고, 한국어가 아니면 한국어 자막도 만듭니다. 요금 언어에는 한국어를 더하지 않습니다. */
function targetsForChannel(outputs, spoken) {
  const code = spokenLanguage(spoken);
  const targets = translationTargets(outputs, code);
  if (code !== "ko" && langByCode.ko && !targets.includes("ko")) targets.push("ko");
  return targets;
}

function channelRecognition(row, outputs, deviceName) {
  const spoken = spokenLanguage(row && row.spoken);
  const phone = !!(row && row.source === "phone");
  return {
    spoken,
    transcription: transcriptionLanguage(spoken),
    targets: targetsForChannel(outputs, spoken),
    speaker: phone
      ? (row.showName === false ? "" : cleanDisplayName(row.name))
      : cleanDisplayName(deviceName || ""),
  };
}

function deviceRow(row, index, fallbackSpoken) {
  const spoken = spokenLanguage(row && row.spoken ? row.spoken : (index === 0 ? fallbackSpoken : "ko"));
  const on = row && row.on != null ? !!row.on : index === 0;
  return { spoken, on, source: "device", name: "", phoneId: "", connected: true };
}

function cleanConnectionId(value) {
  const text = String(value || "").trim().toUpperCase();
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(text) ? text : "";
}

function phoneRow(row) {
  const name = cleanDisplayName(row && row.name);
  const phoneId = cleanPhoneId(row && row.phoneId);
  if (!name || !phoneId) return null;
  return {
    spoken: spokenLanguage(row.spoken || "ko"),
    on: !!row.on,
    source: "phone",
    name,
    phoneId,
    connectionId: cleanConnectionId(row.connectionId),
    connected: row.connected !== false,
    showName: row.showName !== false,
  };
}

function normalizeChannelRows(list, count, fallbackSpoken) {
  const n = Math.max(1, Number(count) || 1);
  const source = Array.isArray(list) ? list : [];
  const deviceSrc = [];
  const phoneSrc = [];
  source.forEach((row) => {
    if (row && row.source === "phone") phoneSrc.push(row);
    else deviceSrc.push(row);
  });
  const rows = [];
  for (let i = 0; i < n; i += 1) rows.push(deviceRow(deviceSrc[i], i, fallbackSpoken));
  phoneSrc.forEach((row) => {
    const phone = phoneRow(row);
    if (phone) rows.push(phone);
  });
  if (!rows.some((row) => row.on)) rows[0].on = true;
  return rows;
}

class Engine {
  constructor(emit, hooks) {
    const raw = emit || (() => {});
    this.emit = (payload) => {
      if (payload && typeof payload.text === "string") {
        raw({ ...payload, text: redactSecrets(payload.text) });
        return;
      }
      raw(payload);
    };
    this.capture = new InputCapture();
    this.devices = [];
    this.device = null;
    this.speech = null;
    this.pipeline = null;
    this.writer = null;
    this.church = null;
    this.targets = [];
    this.outputs = [];
    this.spoken = "ko";
    this.spokenChain = Promise.resolve();
    this.channelRows = [];
    this.channelSessions = new Map();
    this.paidChannels = new Set();
    this.phoneLink = null;
    this.phonePcmWait = new Map();
    this.subtitleBoard = null;
    this.sharedTexts = null;
    this.running = false;
    this.lastLevelAt = 0;
    this.sessionDir = "";
    this.folderName = "";
    this.sessionApiKey = "";
    this.sessionModel = defaultModel;
    this.preacherId = "";
    this.usage = null;
    this.usageChain = Promise.resolve();
    this.usageTimer = null;
    this.lastUsageWrite = 0;
    this.sessionCharge = null;
    this.prepaid = null;
    this.prepaidBudget = 0;
    this.prepaidAnchor = 0;
    this.prepaidLastSaved = 0;
    this.prepaidTimer = null;
    this.prepaidChain = Promise.resolve();
    this.inPrepaidTick = false;
    this.stopPromise = null;
    this.pendingStopReason = "";
    const extra = hooks || {};
    this.readLocalPrepaid = extra.readLocalPrepaid;
    this.writeLocalPrepaid = extra.writeLocalPrepaid;
  }

  async readBalance(churchId) {
    const raw = await firebase.get(`churches/${churchId}/billing/balance`);
    return Math.round(Number(raw) || 0);
  }

  async previewCharge(churchId, targets, spoken, extraChannels) {
    const languages = translationTargets(targets, spoken);
    const balance = await this.readBalance(churchId);
    const prepaid = await this.readPrepaid(churchId);
    const plan = cost.planBroadcastStart({ balance, languages, prepaid });
    const remaining = prepaid ? prepaid.remainingSeconds : 0;
    const balanceAfterHour = plan.short ? balance : (plan.charged > 0 ? plan.balance : balance);
    const channelPlan = plan.short
      ? { started: [], blocked: [], charged: 0, balance: balanceAfterHour, feeKrw: cost.EXTRA_CHANNEL_KRW }
      : cost.channelFeePlan({ balance: balanceAfterHour, channels: extraChannels, paid: [] });
    return {
      balance,
      balanceKrw: balance,
      firstHourKrw: plan.mode === "hour" ? plan.firstHourKrw : 0,
      halfKrw: plan.halfKrw,
      overtimeText: plan.overtimeText,
      short: !!plan.short,
      languages,
      mode: plan.mode,
      remainingSeconds: remaining,
      resumed: plan.resumed,
      noExtraCharge: plan.noExtraCharge,
      extraFeeKrw: plan.extraFeeKrw,
      addedLanguages: plan.addedLanguages,
      chargeKrw: plan.chargeKrw,
      paidLanguages: plan.paidLanguages,
      kind: prepaid ? prepaid.kind : "",
      label: remaining > 0 ? cost.prepaidLabel(remaining) : "",
      channelFeeKrw: channelPlan.charged,
      extraChannels: channelPlan.started,
      blockedChannels: channelPlan.blocked,
      channelFeeEachKrw: cost.EXTRA_CHANNEL_KRW,
    };
  }

  async readPrepaid(churchId) {
    let remote = null;
    let remoteOk = false;
    try {
      remote = await firebase.get(`churches/${churchId}/billing/prepaid`);
      remoteOk = true;
    } catch (_) {
      remote = null;
    }
    let local = null;
    try {
      if (this.readLocalPrepaid) local = await this.readLocalPrepaid(churchId);
    } catch (_) {
      local = null;
    }
    if (!remoteOk) return cost.normalizePrepaid(local);
    return cost.choosePrepaid(remote, local);
  }

  async writePrepaid(churchId, block) {
    const stored = cost.firebasePrepaid(block, Date.now());
    try {
      await firebase.set(`churches/${churchId}/billing/prepaid`, stored);
    } catch (err) {
      this.emit({ type: "log", level: "error", text: `남은 시간 저장 실패: ${err.message || err}` });
    }
    try {
      if (this.writeLocalPrepaid) await this.writeLocalPrepaid(churchId, stored);
    } catch (_) {
      /* 이 컴퓨터의 사본은 다음 저장에서 다시 씁니다 */
    }
    return stored;
  }

  async writeBilling(churchId, balance, entry, prepaid) {
    const row = { ...entry };
    delete row.id;
    const payload = {
      balance,
      lastEntryId: entry.id,
      [`ledger/${entry.id}`]: row,
    };
    let stored = null;
    if (prepaid) {
      stored = cost.firebasePrepaid(prepaid, entry.at);
      payload["prepaid/remainingSeconds"] = stored.remainingSeconds;
      payload["prepaid/languageKey"] = stored.languageKey;
      payload["prepaid/kind"] = stored.kind;
      payload["prepaid/amountKrw"] = stored.amountKrw;
      payload["prepaid/extraCount"] = stored.extraCount;
      payload["prepaid/updatedAt"] = stored.updatedAt;
    }
    await firebase.update(`churches/${churchId}/billing`, payload);
    if (stored && this.writeLocalPrepaid) {
      try { await this.writeLocalPrepaid(churchId, stored); } catch (_) { /* 로컬 사본은 다음 저장에서 맞춥니다 */ }
    }
    return stored;
  }

  shortStartMessage(plan) {
    if (plan && plan.mode === "extra") {
      return `충전금이 부족합니다. 추가 언어 요금 ${cost.formatKrw(plan.chargeKrw)}이 필요하지만 남은 충전금은 ${cost.formatKrw(plan.balance)}입니다.`;
    }
    const price = plan ? plan.firstHourKrw : 0;
    const balance = plan ? plan.balance : 0;
    return `충전금이 부족합니다. 첫 시간에 ${cost.formatKrw(price)}이 필요하지만 남은 충전금은 ${cost.formatKrw(balance)}입니다.`;
  }

  liveRemaining() {
    if (!this.prepaid) return 0;
    const elapsed = Math.floor((Date.now() - this.prepaidAnchor) / 1000);
    return Math.max(0, this.prepaidBudget - elapsed);
  }

  remainingNow() {
    if (!this.running) return this.prepaid ? this.prepaid.remainingSeconds : 0;
    return this.liveRemaining();
  }

  emitPrepaid() {
    const remaining = this.remainingNow();
    this.emit({
      type: "prepaid",
      remainingSeconds: remaining,
      running: !!this.running,
      label: remaining > 0 ? cost.prepaidLabel(remaining) : "남은 시간 0:00",
    });
  }

  armPrepaid(block) {
    this.prepaid = cost.normalizePrepaid(block);
    this.prepaidBudget = this.prepaid ? this.prepaid.remainingSeconds : 0;
    this.prepaidAnchor = Date.now();
    this.prepaidLastSaved = this.prepaidBudget;
    this.emitPrepaid();
  }

  startPrepaidTimer() {
    this.stopPrepaidTimer();
    this.prepaidTimer = setInterval(() => {
      this.enqueuePrepaid(() => this.tickPrepaid())
        .then(() => {
          if (!this.pendingStopReason || !this.running) return null;
          this.pendingStopReason = "";
          return this.stop();
        })
        .catch((err) => {
          this.emit({ type: "log", level: "error", text: `남은 시간 갱신 실패: ${err.message || err}` });
        });
    }, 1000);
  }

  stopPrepaidTimer() {
    if (this.prepaidTimer) {
      clearInterval(this.prepaidTimer);
      this.prepaidTimer = null;
    }
  }

  enqueuePrepaid(task) {
    const run = this.prepaidChain.then(() => task(), () => task());
    this.prepaidChain = run.then(() => {}, () => {});
    return run;
  }

  async tickPrepaid() {
    if (!this.running || !this.prepaid || !this.church) return;
    this.inPrepaidTick = true;
    try {
      const remaining = this.liveRemaining();
      if (remaining > 0) {
        this.prepaid = { ...this.prepaid, remainingSeconds: remaining };
        this.emitPrepaid();
        if (this.prepaidLastSaved - remaining >= 5) {
          await this.writePrepaid(this.church.id, this.prepaid);
          this.prepaidLastSaved = remaining;
        }
        return;
      }
      await this.chargeNextBlock();
    } finally {
      this.inPrepaidTick = false;
    }
  }

  async chargeNextBlock() {
    if (!this.running || !this.church || !this.prepaid || this.pendingStopReason) return;
    if (this.liveRemaining() > 0) return;
    const languages = this.prepaid.languages.slice();
    const balance = await this.readBalance(this.church.id);
    if (!this.running) return;
    const half = cost.openHalfBlock({ balance, languages });
    if (!half.ok) {
      this.prepaid = { ...this.prepaid, remainingSeconds: 0 };
      this.prepaidBudget = 0;
      this.prepaidAnchor = Date.now();
      await this.writePrepaid(this.church.id, this.prepaid);
      this.pendingStopReason = `충전금이 부족합니다. 다음 30분에 ${cost.formatKrw(half.chargeKrw)}이 필요하지만 남은 충전금은 ${cost.formatKrw(half.balance)}입니다. 방송을 종료합니다.`;
      this.emit({ type: "log", level: "error", text: this.pendingStopReason });
      this.emitPrepaid();
      return;
    }
    const at = Date.now();
    const entry = cost.ledgerEntry({
      id: cost.ledgerId(at),
      type: "charge",
      deltaKrw: -half.charged,
      balanceAfter: half.balance,
      at,
      who: this.church.accountUid || "",
      note: half.note,
      churchId: this.church.id,
    });
    const stored = await this.writeBilling(this.church.id, half.balance, entry, half.prepaid);
    this.sessionCharge = {
      ...(this.sessionCharge || {}),
      ok: true,
      running: !!this.running,
      short: false,
      charged: Math.round(Number(this.sessionCharge && this.sessionCharge.charged) || 0) + half.charged,
      balance: half.balance,
      halfKrw: half.halfKrw,
      languages,
    };
    if (!this.running) {
      this.prepaid = cost.normalizePrepaid(stored || half.prepaid);
      this.prepaidBudget = this.prepaid ? this.prepaid.remainingSeconds : 0;
      this.prepaidAnchor = Date.now();
      return;
    }
    this.armPrepaid(stored || half.prepaid);
    this.emitCharge(this.pricedUsage());
    this.emit({
      type: "log",
      level: "info",
      text: `다음 30분 ${cost.formatKrw(half.charged)}을 뺐습니다. 남은 시간 30:00부터 다시 셉니다.`,
    });
  }

  async freezePrepaid() {
    this.stopPrepaidTimer();
    if (!this.prepaid || !this.church) return;
    const remaining = this.liveRemaining();
    this.prepaid = { ...this.prepaid, remainingSeconds: remaining };
    this.prepaidBudget = remaining;
    this.prepaidAnchor = Date.now();
    await this.writePrepaid(this.church.id, this.prepaid);
    this.emitPrepaid();
  }

  async chargeOpening() {
    const languages = this.targets;
    const balance = await this.readBalance(this.church.id);
    const existing = await this.readPrepaid(this.church.id);
    const plan = cost.planBroadcastStart({ balance, languages, prepaid: existing });
    if (!plan.ok) {
      const err = new Error(this.shortStartMessage(plan));
      err.short = true;
      throw err;
    }
    let stored = plan.prepaid;
    if (plan.charged > 0) {
      const at = Date.now();
      const entry = cost.ledgerEntry({
        id: cost.ledgerId(at),
        type: "charge",
        deltaKrw: -plan.charged,
        balanceAfter: plan.balance,
        at,
        who: this.church.accountUid || "",
        note: plan.note,
        churchId: this.church.id,
      });
      stored = await this.writeBilling(this.church.id, plan.balance, entry, plan.prepaid);
    } else if (stored) {
      stored = await this.writePrepaid(this.church.id, stored);
    }
    this.sessionCharge = {
      ok: true,
      running: true,
      short: false,
      charged: plan.charged,
      balance: plan.balance,
      halfKrw: plan.halfKrw,
      languages: plan.paidLanguages,
    };
    this.armPrepaid(stored || plan.prepaid);
    if (plan.noExtraCharge) {
      this.emit({ type: "log", level: "info", text: `${cost.prepaidLabel(plan.remainingSeconds)}. 이번 시작은 추가 요금이 없습니다.` });
    } else if (plan.mode === "extra") {
      this.emit({ type: "log", level: "info", text: `추가 언어 요금 ${cost.formatKrw(plan.charged)}을 뺐습니다. 남은 시간은 그대로입니다.` });
    } else {
      this.emit({ type: "log", level: "info", text: `첫 시간 ${cost.formatKrw(plan.charged)}을 뺐습니다. ${cost.prepaidLabel(plan.remainingSeconds)}.` });
    }
    return plan;
  }

  pricedUsage(preset) {
    const base = preset || (this.usage ? this.usage.record(this.sessionModel) : null);
    if (!base) return null;
    const charged = this.sessionCharge ? this.sessionCharge.charged : base.churchKrw;
    return cost.usageRecord({
      audioSeconds: base.audioSeconds,
      chars: base.chars,
      model: this.sessionModel,
      churchKrw: charged,
      updatedAt: base.updatedAt,
    }, base.updatedAt);
  }

  emitCharge(record) {
    const charged = record ? record.churchKrw : (this.sessionCharge ? this.sessionCharge.charged : 0);
    this.emit({
      type: "cost",
      churchKrw: charged,
      chargedKrw: charged,
      balanceKrw: this.sessionCharge ? this.sessionCharge.balance : undefined,
      short: !!(this.sessionCharge && this.sessionCharge.short),
    });
  }

  listDevices() {
    const result = listInputDevices();
    this.devices = result.devices;
    return result;
  }

  pickInputDevice(deviceKey) {
    const listed = this.listDevices();
    const devices = listed.devices || [];
    if (!devices.length) return { device: null, switched: false, notes: listed.notes || [] };
    const key = String(deviceKey || "");
    const found = key ? devices.find((item) => item.key === key) : null;
    if (found) return { device: found, switched: false, notes: listed.notes || [] };
    const fallback = devices.find((item) => item.isDefault) || devices[0];
    return { device: fallback, switched: !!key, notes: listed.notes || [] };
  }

  _onAudioStreamError(message) {
    const text = String(message || "");
    if (!text || /no open stream to close/i.test(text)) return;
    if (/RtApiCore:/i.test(text) && /disconnected/i.test(text)) return;
    if (/stream device was disconnected/i.test(text)) return;
    this.emit({ type: "log", level: "error", text: message });
  }

  monitor(deviceKey, channel) {
    const picked = this.pickInputDevice(deviceKey);
    const device = picked.device;
    if (!device) throw new Error("입력 장치가 없습니다. 마이크를 연결한 뒤 장치를 새로고침해 주세요.");
    const snap = this.capture.start(device, {
      onPcm: (buffer, info) => this._onPcm(buffer, info),
      onError: (message) => this._onAudioStreamError(message),
    });
    this.device = device;
    if (picked.switched) {
      this.emit({ type: "log", level: "info", text: "이 컴퓨터의 기본 마이크로 바꿨습니다." });
    }
    if (channel != null && channel !== snap.deviceChannel) {
      const applied = this.capture.selectChannel(Number(channel) || 0);
      Object.assign(snap, applied);
    }
    this.emit({ type: "audio", audio: snap });
    return snap;
  }

  setChannel(index) {
    const applied = this.capture.selectChannel(index);
    this.emit({ type: "audio", audio: applied });
    return applied;
  }

  _onPcm(buffer, info) {
    const now = Date.now();
    if (now - this.lastLevelAt > 80) {
      this.lastLevelAt = now;
      let peaks = channelPeaks(buffer, info.nChannels);
      if (info.mode === "single") {
        const full = new Array(info.deviceChannels).fill(0);
        full[info.deviceChannel] = peaks[0] || 0;
        peaks = full;
      }
      this.emit({ type: "levels", peaks, deviceChannel: info.deviceChannel });
    }
    if (!this.channelSessions || !this.channelSessions.size) {
      if (!this.speech) return;
    }
    try {
      const rate = info.sampleRate || 48000;
      if (!this.channelSessions || !this.channelSessions.size) {
        const mono = info.mode === "single" ? buffer : extractChannel(buffer, info.nChannels, info.selected || 0);
        this.speech.push(resampleInt16(mono, rate, 24000));
        return;
      }
      if (info.mode === "single") {
        const session = this.channelSessions.get(info.deviceChannel);
        if (session && session.source !== "phone") session.speech.push(resampleInt16(buffer, rate, 24000));
        return;
      }
      this.channelSessions.forEach((session, index) => {
        if (!session || session.source === "phone" || index >= info.nChannels) return;
        const mono = extractChannel(buffer, info.nChannels, index);
        session.speech.push(resampleInt16(mono, rate, 24000));
      });
    } catch (err) {
      this.emit({ type: "log", level: "error", text: err.message || String(err) });
    }
  }

  async syncSettings(churchId, targets) {
    const sources = this.activeSpoken();
    const selected = translationTargets(targets, sources);
    const existing = (await firebase.get(`churches/${churchId}/live/settings`)) || {};
    const active = [...new Set([...sources, ...selected])];
    if (sources.some((code) => code !== "ko") && !active.includes("ko")) active.unshift("ko");
    const next = {
      _timestamp: Date.now(),
      spoken: sources[0] || "ko",
      activeTargets: active,
      global: existing.global || {
        layout: "bottom",
        align: "center",
        color: "#ffffff",
        bgColor: "#000000",
        bgOpacity: 0.7,
      },
    };
    Object.values(langByCode).forEach((lang) => {
      const prev = existing[lang.code] || {};
      next[lang.code] = {
        show: active.includes(lang.code),
        fontSize: prev.fontSize || lang.defaultSize,
        letterSpacing: prev.letterSpacing !== undefined ? prev.letterSpacing : lang.defaultSpacing,
        font: subtitleFontId(prev.font, lang.code),
      };
    });
    await firebase.set(`churches/${churchId}/live/settings`, next);
    return next;
  }

  async saveStyle(churchId, style) {
    if (!isChurchId(churchId)) throw new Error("계정이 올바르지 않습니다.");
    const existing = (await firebase.get(`churches/${churchId}/live/settings`)) || {};
    const next = applyStyleToSettings(existing, style);
    await firebase.set(`churches/${churchId}/live/settings`, next);
    return styleFromSettings(next);
  }

  async setTargets(churchId, targets, spoken) {
    if (spoken != null) this.spoken = spokenLanguage(spoken);
    const selected = cleanTargets(targets);
    const next = translationTargets(selected, this.activeSpoken());
    if (this.running && this.prepaid) {
      const added = cost.addedLanguages(this.prepaid.languages, next);
      if (added.length) {
        throw new Error("방송 중에는 아직 포함되지 않은 언어를 더할 수 없습니다. 방송을 끄면 남은 시간이 멈추고, 다시 시작할 때 추가 언어 요금을 확인합니다.");
      }
    }
    this.outputs = selected;
    this.targets = next;
    const assignTargets = (pipeline, spoken) => {
      if (!pipeline) return;
      pipeline.targets = targetsForChannel(selected, spoken || pipeline.sourceLang);
    };
    if (this.channelSessions && this.channelSessions.size) {
      this.channelSessions.forEach((session) => assignTargets(session.pipeline, session.spoken));
    } else {
      assignTargets(this.pipeline, this.spoken);
    }
    if (this.usage) this.usage.setLanguages(this.targets);
    if (churchId) await this.syncSettings(churchId, selected);
    if (this.running) this.flushUsage(true);
    return selected;
  }

  activeSpoken() {
    const rows = (this.channelRows || []).filter((row) => row.on);
    const codes = rows.map((row) => spokenLanguage(row.spoken));
    if (!codes.length) codes.push(spokenLanguage(this.spoken));
    return codes;
  }

  async setSpoken(churchId, spoken) {
    return this.setChannelSpoken(churchId, 0, spoken);
  }

  async setChannelSpoken(churchId, index, spoken) {
    const job = this.spokenChain.then(() => this.applyChannelSpoken(churchId, index, spoken));
    this.spokenChain = job.catch(() => {});
    return job;
  }

  async applyChannelSpoken(churchId, index, spoken) {
    const i = Number(index) || 0;
    const code = spokenLanguage(spoken);
    if (!this.channelRows) this.channelRows = [];
    while (this.channelRows.length <= i) this.channelRows.push({ spoken: "ko", on: i === 0 });
    const changed = this.channelRows[i].spoken !== code;
    this.channelRows[i].spoken = code;
    if (i === 0) this.spoken = code;
    const row = this.channelSessions && this.channelSessions.get(i);
    const pipeline = row ? row.pipeline : (i === 0 ? this.pipeline : null);
    const speech = row ? row.speech : (i === 0 ? this.speech : null);
    const ownTargets = targetsForChannel(this.outputs || [], code);
    if (pipeline && pipeline.setSourceLang) pipeline.setSourceLang(code, ownTargets);
    else if (pipeline) {
      pipeline.sourceLang = code;
      pipeline.targets = ownTargets;
    }
    if (row) row.spoken = code;
    if (speech && speech.setLanguage) await speech.setLanguage(code);
    if (churchId) await this.syncSettings(churchId, this.outputs || []);
    if (changed && this.running) {
      const name = langByCode[code] ? langByCode[code].name : code;
      const label = this.channelFeeLabel(i);
      this.emit({ type: "log", level: "info", text: `${label} 인식 언어를 ${name}로 바꿨습니다.` });
    }
    this.emitPhones();
    return code;
  }

  async chargeChannelFees(extraIndexes) {
    if (!this.paidChannels) this.paidChannels = new Set();
    const balance = this.sessionCharge ? this.sessionCharge.balance : await this.readBalance(this.church.id);
    const paid = [...this.paidChannels];
    const plan = cost.channelFeePlan({ balance, channels: extraIndexes, paid });
    const newly = plan.started.filter((index) => !this.paidChannels.has(index));
    if (plan.charged > 0 && newly.length) {
      const at = Date.now();
      const entry = cost.ledgerEntry({
        id: cost.ledgerId(at),
        type: "charge",
        deltaKrw: -plan.charged,
        balanceAfter: plan.balance,
        at,
        who: this.church.accountUid || "",
        note: `추가 채널 ${newly.map((index) => this.channelFeeLabel(index)).join(", ")}`,
        churchId: this.church.id,
      });
      await this.writeBilling(this.church.id, plan.balance, entry, null);
      this.sessionCharge.charged = Math.round(Number(this.sessionCharge.charged) || 0) + plan.charged;
      this.sessionCharge.balance = plan.balance;
      this.emitCharge(this.pricedUsage());
      this.emit({
        type: "log",
        level: "info",
        text: `추가 입력 ${newly.map((index) => this.channelFeeLabel(index)).join(", ")}에서 ${cost.formatKrw(plan.charged)}을 뺐습니다. 이 요금은 한 번만 빠집니다.`,
      });
    }
    plan.started.forEach((index) => this.paidChannels.add(index));
    return plan;
  }

  async setChannelOn(churchId, index, on) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) throw new Error("채널이 올바르지 않습니다.");
    if (!this.channelRows) this.channelRows = [];
    while (this.channelRows.length <= i) this.channelRows.push({ spoken: "ko", on: false });
    if (!on) {
      this.channelRows[i].on = false;
      if (this.running) await this.closeChannel(i);
      this.notifyPhone(i, false);
      this.emitPhones();
      if (churchId) await this.syncSettings(churchId, this.outputs || []);
      return { index: i, on: false, charged: 0 };
    }
    if (this.running && i > 0 && !(this.paidChannels && this.paidChannels.has(i))) {
      const plan = await this.chargeChannelFees([i]);
      if (plan.blocked.includes(i)) {
        this.channelRows[i].on = false;
        const message = `${this.channelFeeLabel(i)}은 충전금이 부족해 시작하지 못했습니다.`;
        this.emit({ type: "log", level: "error", text: message });
        this.emitPhones();
        return { index: i, on: false, blocked: true, message, balance: plan.balance };
      }
    }
    this.channelRows[i].on = true;
    if (this.running) await this.openChannel(i);
    this.notifyPhone(i, !!(this.running && this.channelSessions && this.channelSessions.has(i)));
    this.emitPhones();
    if (churchId) await this.syncSettings(churchId, this.outputs || []);
    return { index: i, on: true, charged: 0 };
  }

  channelBroadcastBits() {
    return {
      apiKey: this.sessionApiKey,
      model: this.sessionModel,
      glossary: this.sessionGlossary || "",
      sessionContext: this.sessionContext || "",
      extraKeywords: this.sessionKeywords || [],
      pauseTails: this.sessionPauseTails || [],
      sensitivity: this.sessionSensitivity || "normal",
    };
  }

  sourceStyleKey(row, index) {
    if (row && row.source === "phone" && row.connectionId) return `phone:${row.connectionId}`;
    return `device:${index}`;
  }

  cleanSourceStyle(style) {
    const src = style && typeof style === "object" ? style : {};
    return {
      traits: String(src.traits || "").slice(0, 800),
      corrections: String(src.corrections || "").slice(0, 2000),
      terms: String(src.terms || "").slice(0, 2000),
      sensitivity: src.sensitivity === "high" || src.sensitivity === "low" ? src.sensitivity : "normal",
    };
  }

  bitsForRow(row, index) {
    const base = this.channelBroadcastBits();
    const saved = this.sourceStyles && this.sourceStyles[this.sourceStyleKey(row, index)];
    if (!saved) return base;
    const style = this.cleanSourceStyle(saved);
    if (!(row && row.source === "phone")) {
      return { ...base, sensitivity: style.sensitivity || base.sensitivity };
    }
    const person = {
      name: row.name || "",
      traits: style.traits,
      corrections: style.corrections,
      terms: style.terms,
    };
    const glossary = [base.glossary, style.terms].map((part) => String(part || "").trim()).filter(Boolean).join("\n");
    const context = [base.sessionContext, sessionContextText({ preacher: person })].filter(Boolean).join("\n").slice(0, 3600);
    return { ...base, glossary, sessionContext: context, sensitivity: style.sensitivity || base.sensitivity };
  }

  applySourceStyle(key, style) {
    const id = String(key || "");
    if (!/^(device:\d+|phone:[A-Za-z0-9_-]{6,64})$/.test(id)) return { ok: false };
    if (!this.sourceStyles) this.sourceStyles = {};
    this.sourceStyles[id] = this.cleanSourceStyle(style);
    if (!this.channelRows || !this.channelSessions) return { ok: true };
    this.channelRows.forEach((row, index) => {
      if (this.sourceStyleKey(row, index) !== id) return;
      const session = this.channelSessions.get(index);
      if (!session) return;
      const bits = this.bitsForRow(row, index);
      session.speech.glossary = bits.glossary;
      session.speech.sessionContext = bits.sessionContext;
      session.speech.setSensitivity(bits.sensitivity);
      if (session.speech.ready && session.speech.sendSession) session.speech.sendSession();
      session.pipeline.glossary = bits.glossary;
      session.pipeline.sessionContext = bits.sessionContext;
    });
    return { ok: true };
  }

  async openChannel(index) {
    if (!this.channelSessions) this.channelSessions = new Map();
    if (!this.sharedTexts) this.sharedTexts = { texts: {}, chain: Promise.resolve() };
    if (this.channelSessions.has(index)) return this.channelSessions.get(index);
    const row = this.channelRows[index] || { spoken: "ko", on: true, source: "device" };
    const phone = row.source === "phone";
    const plan = channelRecognition(row, this.outputs || [], this.deviceSpeaker(row, index));
    const spoken = plan.spoken;
    const speaker = plan.speaker;
    const channelKey = phone ? `p${row.phoneId}` : `d${index}`;
    const targets = plan.targets;
    const bits = this.bitsForRow(row, index);
    const cloud = this.sessionCloud;
    const pipeline = new Pipeline({
      apiKey: bits.apiKey,
      model: bits.model,
      sourceLang: spoken,
      targets,
      speaker,
      channelKey,
      sentenceSeed: Date.now() + (index + 1) * 1000003,
      glossary: bits.glossary,
      sessionContext: bits.sessionContext,
      pauseTails: bits.pauseTails,
      files: this.writer,
      usage: this.usage,
      cloud,
      sharedTexts: this.sharedTexts,
      onLive: (text) => this.emit({ type: "live", channel: index, name: pipeline.speaker, text }),
      onHeard: (heard) => this.emit({ type: "heard", channel: index, name: pipeline.speaker, ...heard }),
      onLine: (line) => this.emit({ type: "line", channel: index, ...line, name: pipeline.speaker }),
      onLog: (text) => this.emit({ type: "log", level: "info", text }),
    });
    pipeline.startTicker();
    const speech = new SpeechSession({
      apiKey: bits.apiKey,
      churchName: this.church ? this.church.name : "",
      glossary: bits.glossary,
      sessionContext: bits.sessionContext,
      extraKeywords: bits.extraKeywords,
      sensitivity: bits.sensitivity,
      language: spoken,
      onInterim: (text) => pipeline.onInterim(text),
      onFinal: (text) => pipeline.onFinalChunk(text),
      onStatus: (text) => this.emit({ type: "log", level: "info", text }),
      onError: (text) => this.emit({ type: "log", level: "error", text }),
      onAudio: index === 0 ? (pcm) => {
        if (!this.usage || !pcm) return;
        this.usage.addPcm16(pcm.length, 24000);
        this.flushUsage(false);
      } : null,
    });
    await speech.start();
    const session = { speech, pipeline, spoken, index, source: phone ? "phone" : "device", name: speaker };
    this.channelSessions.set(index, session);
    if (!this.speech) {
      this.speech = speech;
      this.pipeline = pipeline;
    }
    return session;
  }

  async closeChannel(index) {
    const session = this.channelSessions.get(index);
    if (!session) return;
    this.channelSessions.delete(index);
    try { await session.speech.stop(); } catch (_) { /* 이미 끊긴 인식은 무시합니다 */ }
    try { await session.pipeline.stop(); } catch (_) { /* 아직 문장이 없으면 무시합니다 */ }
    if (this.speech === session.speech) {
      const next = this.channelSessions.values().next().value || null;
      this.speech = next ? next.speech : null;
      this.pipeline = next ? next.pipeline : null;
    }
  }

  async closeAllChannels() {
    const indexes = [...this.channelSessions.keys()];
    for (const index of indexes) await this.closeChannel(index);
    (this.channelRows || []).forEach((row, index) => {
      if (row && row.source === "phone") this.notifyPhone(index, false);
    });
  }

  bindPhoneLink(fn) {
    this.phoneLink = typeof fn === "function" ? fn : null;
  }

  deviceSlotCount() {
    if (this.device && Number(this.device.inputChannels) > 0) return this.device.inputChannels;
    return (this.channelRows || []).filter((row) => !row || row.source !== "phone").length;
  }

  ensureDeviceSlots() {
    const count = this.deviceSlotCount();
    const current = this.channelRows || [];
    const devices = current.filter((row) => !row || row.source !== "phone");
    const phones = current.filter((row) => row && row.source === "phone");
    const rows = [];
    for (let i = 0; i < count; i += 1) rows.push(deviceRow(devices[i], i, this.spoken || "ko"));
    phones.forEach((row) => {
      const phone = phoneRow(row);
      if (phone) rows.push(phone);
    });
    this.channelRows = rows;
  }

  publicChannels() {
    return (this.channelRows || []).map((row, index) => ({
      index,
      spoken: row.spoken || "ko",
      on: !!row.on,
      source: row.source === "phone" ? "phone" : "device",
      name: row.source === "phone" ? (row.name || "") : "",
      phoneId: row.source === "phone" ? (row.phoneId || "") : "",
      connectionId: row.source === "phone" ? (row.connectionId || "") : "",
      connected: row.source === "phone" ? row.connected !== false : true,
      signal: row.source === "phone" ? !!row.signal : false,
      showName: row.source === "phone" ? row.showName !== false : true,
    }));
  }

  emitPhones() {
    this.emit({ type: "phones", channels: this.publicChannels() });
  }

  channelFeeLabel(index) {
    const row = this.channelRows && this.channelRows[index];
    if (row && row.source === "phone" && row.name) return row.name;
    return `채널 ${index + 1}`;
  }

  notifyPhone(index, listening) {
    const row = this.channelRows && this.channelRows[index];
    if (!row || row.source !== "phone" || !row.phoneId || !this.phoneLink) return;
    try { this.phoneLink(row.phoneId, !!listening); } catch (_) { /* 휴대폰 상태 전달 실패는 다음 연결에서 다시 보냅니다 */ }
  }

  addPhone(phone) {
    const name = cleanDisplayName(phone && phone.name);
    const phoneId = cleanPhoneId(phone && phone.id);
    const spoken = String(phone && phone.spoken || "").trim();
    const connectionId = cleanConnectionId(phone && phone.connectionId);
    if (!name || !phoneId) throw new Error("이름을 입력해 주세요.");
    if (!langByCode[spoken]) throw new Error("말하는 언어를 선택해 주세요.");
    if (!this.channelRows) this.channelRows = [];
    this.ensureDeviceSlots();
    let index = this.channelRows.findIndex((row) => row && row.source === "phone" && row.phoneId === phoneId);
    if (index < 0 && connectionId) {
      index = this.channelRows.findIndex((row) => row && row.source === "phone" && row.connectionId === connectionId);
    }
    const samePerson = index >= 0 && this.channelRows[index].phoneId === phoneId;
    if (index < 0) {
      const phoneCount = this.channelRows.filter((row) => row && row.source === "phone").length;
      if (phoneCount >= 8) throw new Error("휴대폰 입력은 8개까지입니다.");
      index = this.channelRows.length;
      this.channelRows.push({
        spoken,
        on: false,
        source: "phone",
        name,
        phoneId,
        connectionId,
        connected: true,
        showName: true,
      });
    } else {
      this.channelRows[index].name = name;
      this.channelRows[index].showName = true;
      this.channelRows[index].phoneId = phoneId;
      this.channelRows[index].connectionId = connectionId || this.channelRows[index].connectionId || "";
      this.channelRows[index].connected = true;
      if (!samePerson) {
        this.channelRows[index].spoken = spoken;
        const switching = this.channelSessions && this.channelSessions.get(index);
        if (switching) this.applyChannelSpoken("", index, spoken).catch(() => {});
      }
      const session = this.channelSessions && this.channelSessions.get(index);
      if (session) {
        session.name = name;
        if (session.pipeline) session.pipeline.speaker = name;
      }
    }
    const row = this.channelRows[index];
    const listening = !!(this.running && row.on && this.channelSessions && this.channelSessions.has(index));
    this.notifyPhone(index, listening);
    this.emitPhones();
    const langName = langByCode[row.spoken] ? langByCode[row.spoken].name : row.spoken;
    this.emit({ type: "log", level: "info", text: `${name} 휴대폰이 ${langName}로 연결되었습니다.` });
    return { index, name, phoneId, spoken: row.spoken, on: !!row.on, listening };
  }

  /** 연결 표시만 하지 않고, 방송 중이면 휴대폰 마이크를 통역 입력으로 연다. */
  async acceptPhone(phone) {
    const added = this.addPhone(phone);
    if (!this.running) return { ...added, listening: false };
    try {
      const churchId = this.church && this.church.id ? this.church.id : "";
      const turned = await this.setChannelOn(churchId, added.index, true);
      if (!turned || turned.on !== true) {
        return {
          ...added,
          listening: false,
          loginError: (turned && turned.message) || "휴대폰 마이크를 입력으로 열지 못했습니다.",
        };
      }
    } catch (err) {
      if (this.channelRows[added.index]) this.channelRows[added.index].on = false;
      return { ...added, listening: false, loginError: err.message || "휴대폰 마이크를 입력으로 열지 못했습니다." };
    }
    this.flushPhonePcm(added.phoneId);
    return {
      index: added.index,
      name: added.name,
      phoneId: added.phoneId,
      spoken: added.spoken,
      on: true,
      listening: true,
    };
  }

  markPhoneAway(phoneId) {
    const index = (this.channelRows || []).findIndex((row) => row && row.source === "phone" && row.phoneId === phoneId);
    if (index < 0) return;
    this.channelRows[index].connected = false;
    this.channelRows[index].signal = false;
    if (this.phonePcmWait) this.phonePcmWait.delete(phoneId);
    if (this.phoneSignalTimers) {
      const timer = this.phoneSignalTimers.get(phoneId);
      if (timer) clearTimeout(timer);
      this.phoneSignalTimers.delete(phoneId);
    }
    this.emit({ type: "level", channel: index, peak: 0 });
    this.emitPhones();
    this.emit({ type: "log", level: "info", text: `${this.channelRows[index].name} 휴대폰 연결이 끊겼습니다.` });
  }

  queuePhonePcm(phoneId, pcm) {
    if (!this.phonePcmWait) this.phonePcmWait = new Map();
    const queued = this.phonePcmWait.get(phoneId) || [];
    queued.push(Buffer.from(pcm));
    let total = 0;
    queued.forEach((chunk) => { total += chunk.length; });
    const cap = 24000 * 2 * 2;
    while (total > cap && queued.length) total -= queued.shift().length;
    this.phonePcmWait.set(phoneId, queued);
  }

  flushPhonePcm(phoneId) {
    const queued = this.phonePcmWait && this.phonePcmWait.get(phoneId);
    if (!queued || !queued.length) return;
    const index = (this.channelRows || []).findIndex((row) => row && row.source === "phone" && row.phoneId === phoneId);
    const session = index >= 0 && this.channelSessions ? this.channelSessions.get(index) : null;
    if (!session || session.source !== "phone" || !session.speech) return;
    this.phonePcmWait.delete(phoneId);
    queued.forEach((chunk) => session.speech.push(chunk));
  }

  /** 연결만으로는 부족합니다. 실제 음성 표본이 들어와야 신호로 봅니다. */
  notePhoneSignal(index, peak) {
    const row = this.channelRows && this.channelRows[index];
    if (!row || row.source !== "phone") return;
    if (!(peak >= 0.02)) return;
    const phoneId = row.phoneId || String(index);
    if (!this.phoneSignalTimers) this.phoneSignalTimers = new Map();
    const previous = this.phoneSignalTimers.get(phoneId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      if (this.phoneSignalTimers) this.phoneSignalTimers.delete(phoneId);
      if (!row.signal) return;
      row.signal = false;
      this.emit({ type: "level", channel: index, peak: 0 });
      this.emitPhones();
    }, 1500);
    if (typeof timer.unref === "function") timer.unref();
    this.phoneSignalTimers.set(phoneId, timer);
    if (row.signal) return;
    row.signal = true;
    this.emitPhones();
  }

  pushPhonePcm(phoneId, pcm) {
    if (!pcm || !this.channelRows) return;
    const index = this.channelRows.findIndex((row) => row && row.source === "phone" && row.phoneId === phoneId);
    if (index < 0) return;
    let peak = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      const value = Math.abs(pcm.readInt16LE(i));
      if (value > peak) peak = value;
    }
    const level = peak / 32768;
    this.notePhoneSignal(index, level);
    const session = this.channelSessions && this.channelSessions.get(index);
    if (!session || session.source !== "phone" || !session.speech) {
      this.queuePhonePcm(phoneId, pcm);
      this.emit({ type: "level", channel: index, peak: level });
      return;
    }
    this.flushPhonePcm(phoneId);
    session.speech.push(pcm);
    const now = Date.now();
    if (session.lastLevelAt && now - session.lastLevelAt < 80) return;
    session.lastLevelAt = now;
    this.emit({ type: "level", channel: index, peak: level });
  }

  /** 진행자가 휴대폰 카드에서 자막 이름을 바꾸거나, 그 휴대폰 이름만 빼는 자리입니다. */
  setPhoneDisplay(connectionId, patch) {
    const id = cleanConnectionId(connectionId);
    if (!id) throw new Error("휴대폰을 찾지 못했습니다.");
    const index = (this.channelRows || []).findIndex((row) => row && row.source === "phone" && row.connectionId === id);
    if (index < 0) throw new Error("아직 들어온 휴대폰이 없습니다.");
    const row = this.channelRows[index];
    const next = patch || {};
    if (Object.prototype.hasOwnProperty.call(next, "name")) {
      const name = cleanDisplayName(next.name);
      if (!name) throw new Error("이름을 입력해 주세요.");
      row.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(next, "showName")) row.showName = next.showName !== false;
    else if (row.showName == null) row.showName = true;
    const speaker = row.showName === false ? "" : (row.name || "");
    const session = this.channelSessions && this.channelSessions.get(index);
    if (session) {
      session.name = speaker;
      if (session.pipeline) session.pipeline.speaker = speaker;
    }
    this.emitPhones();
    return {
      index,
      name: row.name || "",
      showName: row.showName !== false,
      connectionId: id,
      phoneId: row.phoneId || "",
    };
  }

  deviceSpeaker(row, index) {
    if (row && row.source === "phone") return "";
    if (index === 0 && this.showPreacherName !== false) return this.preacherName || "";
    return "";
  }

  setShowPreacherName(on) {
    this.showPreacherName = on !== false;
    if (this.channelSessions) {
      this.channelSessions.forEach((session, index) => {
        const row = this.channelRows && this.channelRows[index];
        if (!session || !row || row.source === "phone") return;
        const name = this.deviceSpeaker(row, index);
        session.name = name;
        if (session.pipeline) session.pipeline.speaker = name;
      });
    }
    return { showPreacherName: this.showPreacherName };
  }

  broadcastLive() {
    if (!this.running || !this.channelSessions || !this.channelSessions.size) return false;
    for (const session of this.channelSessions.values()) {
      if (session && session.speech) return true;
    }
    return false;
  }

  currentSession(extra) {
    return {
      already: !!(extra && extra.already),
      church: this.church,
      folderName: this.folderName,
      dir: this.sessionDir,
      targets: this.targets || [],
      channels: this.publicChannels(),
    };
  }

  async start(opts) {
    if (this.startTask) {
      try { await this.startTask; } catch (_) { /* 먼저 시작한 쪽의 오류는 그 호출이 보여 줍니다 */ }
      if (this.broadcastLive()) return this.currentSession({ already: true });
    }
    if (this.running) {
      if (this.broadcastLive()) return this.currentSession({ already: true });
      if (!this.channelSessions) this.channelSessions = new Map();
      try { await this.stop(); } catch (_) { this.running = false; }
    }
    const task = this._beginStart(opts);
    this.startTask = task;
    try {
      return await task;
    } finally {
      if (this.startTask === task) this.startTask = null;
    }
  }

  async _beginStart(opts) {
    if (this.running) {
      if (this.broadcastLive()) return this.currentSession({ already: true });
      if (!this.channelSessions) this.channelSessions = new Map();
      try { await this.stop(); } catch (_) { this.running = false; }
    }
    const apiKey = opts.apiKey || "";
    if (!apiKey) {
      throw new Error("관리 페이지에서 OpenAI 키를 먼저 저장해 주세요.");
    }
    if (!opts.folder) throw new Error("저장 폴더를 선택해 주세요.");
    if (!isChurchId(opts.churchId)) throw new Error("계정을 선택해 주세요.");
    if (!isPreacherId(opts.preacherId)) throw new Error("강연자를 등록하고 선택해 주세요.");
    if (!["설교", "강의", "연설", "행사"].includes(opts.sessionKind)) throw new Error("내용을 선택해 주세요.");
    const outputCodes = cleanTargets(opts.targets);
    if (!outputCodes.length) throw new Error("번역할 언어를 하나 이상 선택해 주세요.");
    if (!this.capture.opened) {
      if (!opts.deviceKey) throw new Error("입력 장치를 먼저 선택해 주세요.");
      this.monitor(opts.deviceKey, opts.channel || 0);
    }
    const channelCount = this.device && this.device.inputChannels ? this.device.inputChannels : 1;
    const keptPhones = (this.channelRows || []).filter((row) => row && row.source === "phone" && row.connected !== false && row.name && row.phoneId);
    this.channelRows = normalizeChannelRows(opts.channels, channelCount, opts.spoken);
    keptPhones.forEach((phone) => {
      const found = this.channelRows.find((row) => row && row.source === "phone" && (row.phoneId === phone.phoneId || (phone.connectionId && row.connectionId === phone.connectionId)));
      if (!found) {
        this.channelRows.push({ ...phone, on: true });
        return;
      }
      found.name = phone.name;
      found.showName = phone.showName !== false;
      found.phoneId = phone.phoneId || found.phoneId;
      found.connectionId = phone.connectionId || found.connectionId;
      found.connected = phone.connected !== false;
    });
    this.channelRows.forEach((row) => {
      if (row && row.source === "phone" && row.connected !== false && row.name) row.on = true;
    });
    this.paidChannels = new Set();
    this.channelSessions = new Map();
    this.sharedTexts = { texts: {}, chain: Promise.resolve() };
    const spoken = this.channelRows[0].spoken;
    const targets = translationTargets(outputCodes, this.channelRows.filter((row) => row.on).map((row) => row.spoken));
    const church = await firebase.getChurch(opts.churchId);
    if (!church) throw new Error("계정을 찾지 못했습니다. 관리 페이지에서 계정을 먼저 추가해 주세요.");
    if (!church.active) throw new Error("이 계정은 비활성 상태입니다. 관리 페이지에서 활성화해 주세요.");
    const glossary = church.glossary && church.glossary.trim()
      ? church.glossary
      : defaultGlossary(church.name);
    const model = isModelId(church.model) ? church.model : defaultModel;
    const preachers = await firebase.listPreachers(church.id);
    let selected = preachers.find((item) => item.id === opts.preacherId) || null;
    if (!selected) throw new Error("이 계정에 등록된 강연자를 선택해 주세요.");

    try {
      this.writer = createSessionWriter(opts.folder, church.name, opts.now || new Date());
    } catch (err) {
      const code = err && err.code;
      if (code === "EPERM" || code === "EACCES") {
        throw new Error("저장 폴더에 기록을 만들지 못했습니다. 설정에서 폴더를 다시 선택해 주세요.");
      }
      throw err;
    }
    this.sessionDir = this.writer.dir;
    this.folderName = this.writer.folderName;
    this.church = church;
    this.spoken = spoken;
    this.outputs = outputCodes;
    this.targets = targets;
    this.sessionApiKey = apiKey;
    this.sessionModel = model;
    this.preacherId = selected.id;
    this.preacherName = selected.name || "";
    this.showPreacherName = opts.showPreacherName !== false;

    let extracted = null;
    if (opts.bulletinPath) {
      const stored = bulletin.persistBulletinImage(this.writer.dir, opts.bulletinPath);
      const staged = opts.bulletinExtracted && typeof opts.bulletinExtracted === "object"
        ? bulletin.normalizeBulletin(opts.bulletinExtracted)
        : null;
      extracted = staged && (staged.songTitles.length || staged.hymnNumbers.length || staged.scripture || staged.sermonTitle || staged.extractedText)
        ? staged
        : await bulletin.analyzeBulletinImage({
          apiKey,
          model,
          imagePath: stored.absolutePath,
          fetchImpl: opts.fetchImpl,
        });
      const record = bulletin.bulletinRecord(stored.imageRef, extracted);
      bulletin.writeExtractionFile(this.writer.dir, stored.imageRef, extracted);
      await firebase.saveBulletin(church.id, this.folderName, record);
      extracted = record;
      if (!opts.preacherId) {
        /* 선택한 설교자가 항상 우선입니다 */
      }
      const named = preacherLib.matchPreacher(preachers, extracted.preacherName);
      if (named && named.id === selected.id) {
        this.emit({ type: "log", level: "info", text: `진행자료의 강연자 ${named.name} 과 선택한 강연자가 같습니다.` });
      }
    }

    const speechStyle = this.cleanSourceStyle(opts.speechStyle || { sensitivity: opts.sensitivity || "normal" });
    if (opts.speechStyle) {
      selected = {
        ...selected,
        traits: speechStyle.traits,
        corrections: speechStyle.corrections,
        terms: speechStyle.terms,
      };
    }
    const sessionContext = sessionContextText({ bulletin: extracted, preacher: selected });
    const extraKeywords = contextKeywords(extracted, selected);
    this.sessionGlossary = glossary;
    this.sessionContext = sessionContext;
    this.sessionKeywords = extraKeywords;
    this.sessionPauseTails = preacherLib.pauseTails(selected);
    this.sourceStyles = {};
    const incoming = opts.sourceStyles && typeof opts.sourceStyles === "object" ? opts.sourceStyles : {};
    Object.keys(incoming).slice(0, 24).forEach((key) => {
      if (!/^(device:\d+|phone:[A-Za-z0-9_-]{6,64})$/.test(key)) return;
      this.sourceStyles[key] = this.cleanSourceStyle(incoming[key]);
    });
    this.sourceStyles["device:0"] = speechStyle;
    this.sessionSensitivity = speechStyle.sensitivity || opts.sensitivity || "normal";
    await this.syncSettings(church.id, outputCodes);
    await firebase.setSessionMeta(church.id, this.folderName, {
      churchName: church.name,
      startedAt: Date.now(),
      folderName: this.folderName,
      languages: [spoken, ...targets],
      preacherId: selected.id,
      preacherName: selected.name,
      sessionKind: opts.sessionKind,
      endedAt: null,
    });

    this.usage = new UsageMeter();
    this.usage.start(targets);
    this.usageChain = Promise.resolve();
    this.lastUsageWrite = 0;
    this.sessionCharge = null;
    this.subtitleBoard = createSubtitleBoard();
    this.sessionCloud = {
      updateSubtitles: (payload) => firebase.update(
        `churches/${church.id}/live/subtitles`,
        this.subtitleBoard.merge(payload),
      ),
      setText: (lang, text) => firebase.setSessionText(church.id, this.folderName, lang, text),
      appendSentence: (lang, id, text) => firebase.appendSessionSentence(church.id, this.folderName, lang, id, text),
      recordUsage: (record) => this.flushUsage(true, record),
    };
    this.pipeline = null;
    this.speech = null;
    try {
      await this.chargeOpening();
      const requested = this.channelRows.map((row, index) => (row.on ? index : -1)).filter((index) => index >= 0);
      const fees = await this.chargeChannelFees(requested.filter((index) => index > 0));
      const active = new Set(fees.started);
      if (requested.includes(0) || fees.blocked.length) active.add(0);
      if (!active.size) active.add(0);
      fees.blocked.forEach((index) => {
        this.channelRows[index].on = false;
        this.emit({
          type: "log",
          level: "error",
          text: `${this.channelFeeLabel(index)}은 충전금이 부족해 시작하지 못했습니다.`,
        });
      });
      for (const index of [...active].sort((a, b) => a - b)) {
        this.channelRows[index].on = true;
        await this.openChannel(index);
      }
      await this.syncSettings(church.id, outputCodes);
    } catch (err) {
      try { await this.closeAllChannels(); } catch (_) { /* 이미 끊긴 인식은 무시합니다 */ }
      this.speech = null;
      this.pipeline = null;
      this.running = false;
      if (this.church && this.folderName) {
        try {
          await firebase.update(`churches/${this.church.id}/sessionIndex/${this.folderName}`, { endedAt: Date.now() });
        } catch (_) { /* 시작 전 실패의 마감 기록은 다음 방송에서 덮습니다 */ }
      }
      throw err;
    }
    this.running = true;
    this.startPrepaidTimer();
    this.emitPrepaid();
    const opening = this.flushUsage(true);
    this.emit({
      type: "session",
      running: true,
      churchName: church.name,
      churchId: church.id,
      folderName: this.folderName,
      dir: this.sessionDir,
      targets,
      churchKrw: this.sessionCharge ? this.sessionCharge.charged : (opening ? opening.churchKrw : 0),
      chargedKrw: this.sessionCharge ? this.sessionCharge.charged : 0,
      balanceKrw: this.sessionCharge ? this.sessionCharge.balance : 0,
      short: !!(this.sessionCharge && this.sessionCharge.short),
      remainingSeconds: this.remainingNow(),
      prepaidLabel: cost.prepaidLabel(this.remainingNow()),
    });
    return {
      church,
      folderName: this.folderName,
      dir: this.sessionDir,
      targets,
      channels: this.publicChannels(),
    };
  }

  flushUsage(force, preset) {
    if (!this.usage || !this.church) return null;
    const record = preset || this.usage.record(this.sessionModel);
    const now = Date.now();
    if (!force && now - this.lastUsageWrite < 1000) {
      if (!this.usageTimer) {
        this.usageTimer = setTimeout(() => {
          this.usageTimer = null;
          this.flushUsage(true);
        }, 1000);
      }
      return record;
    }
    if (this.usageTimer) {
      clearTimeout(this.usageTimer);
      this.usageTimer = null;
    }
    this.lastUsageWrite = now;
    const churchId = this.church.id;
    this.usageChain = this.usageChain
      .then(async () => {
        const priced = this.pricedUsage(preset);
        this.emitCharge(priced);
        await firebase.set(`churches/${churchId}/live/usage`, priced);
      })
      .catch((err) => this.emit({ type: "log", level: "error", text: `요금 기록 실패: ${err.message || err}` }));
    return this.pricedUsage(preset);
  }

  async finishUsage() {
    if (this.usageTimer) {
      clearTimeout(this.usageTimer);
      this.usageTimer = null;
    }
    if (!this.usage || !this.church || !this.folderName) return null;
    const churchId = this.church.id;
    const folder = this.folderName;
    try {
      await this.usageChain;
      const record = this.pricedUsage();
      this.emitCharge(record);
      await firebase.set(`churches/${churchId}/live/usage`, record);
      await firebase.set(`churches/${churchId}/sessions/${folder}/usage`, record);
      return record;
    } catch (err) {
      this.emit({ type: "log", level: "error", text: `요금 마감 실패: ${err.message || err}` });
      return null;
    }
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this._stop().finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  async _stop() {
    if (!this.running) return { stopped: true };
    this.running = false;
    this.pendingStopReason = "";
    this.stopPrepaidTimer();
    if (!this.inPrepaidTick) {
      try { await this.prepaidChain; } catch (_) { /* 남은 시간 저장이 이미 실패해도 종료는 계속합니다 */ }
    }
    try { await this.freezePrepaid(); } catch (err) {
      this.emit({ type: "log", level: "error", text: `남은 시간 저장 실패: ${err.message || err}` });
    }
    const pipelines = [...this.channelSessions.values()].map((row) => row.pipeline).filter(Boolean);
    if (!pipelines.length && this.pipeline) pipelines.push(this.pipeline);
    await this.closeAllChannels();
    this.speech = null;
    const pipeline = pipelines[0] || null;
    pipelines.slice(1).forEach((item) => {
      if (!pipeline) return;
      pipeline.lessons.push(...(item.lessons || []));
      pipeline.samples.push(...(item.samples || []));
      pipeline.pauses.push(...(item.pauses || []));
    });
    const usageRecord = await this.finishUsage();
    if (this.church && this.preacherId && pipeline) {
      try {
        const lesson = preacherLib.lessonFromLines(pipeline.lessons || [], {
          pauses: pipeline.pauses,
          samples: pipeline.samples,
        });
        const current = (await firebase.listPreachers(this.church.id)).find((item) => item.id === this.preacherId);
        if (current) {
          let next;
          try {
            next = await preacherLib.refineProfile({
              apiKey: this.sessionApiKey,
              model: this.sessionModel,
              profile: current,
              lesson,
            });
          } catch (_) {
            const { samples, ...raw } = lesson;
            next = preacherLib.mergeProfile(current, raw);
          }
          await firebase.savePreacher(this.church.id, this.preacherId, next);
          this.emit({ type: "log", level: "info", text: `${current.name} 강연자 프로필에 오늘 배운 표현을 반영했습니다.` });
        }
      } catch (err) {
        this.emit({ type: "log", level: "error", text: `강연자 프로필 갱신 실패: ${err.message || err}` });
      }
    }
    this.sessionApiKey = "";
    this.pipeline = null;
    if (this.church && this.folderName) {
      try {
        await firebase.update(`churches/${this.church.id}/sessionIndex/${this.folderName}`, {
          endedAt: Date.now(),
          churchKrw: usageRecord ? usageRecord.churchKrw : 0,
          apiKrw: usageRecord ? usageRecord.apiKrw : 0,
        });
      } catch (err) {
        this.emit({ type: "log", level: "error", text: `세션 종료 기록 실패: ${err.message}` });
      }
      try {
        await firebase.set(`churches/${this.church.id}/live/subtitles`, { _timestamp: Date.now() });
      } catch (_) {
        /* 실시간 자막 지우기 실패는 다음 방송에서 덮어씁니다 */
      }
    }
    this.emit({
      type: "session",
      running: false,
      dir: this.sessionDir,
      folderName: this.folderName,
      churchKrw: this.sessionCharge ? this.sessionCharge.charged : (usageRecord ? usageRecord.churchKrw : undefined),
      chargedKrw: this.sessionCharge ? this.sessionCharge.charged : undefined,
      balanceKrw: this.sessionCharge ? this.sessionCharge.balance : undefined,
      short: !!(this.sessionCharge && this.sessionCharge.short),
      remainingSeconds: this.prepaid ? this.prepaid.remainingSeconds : 0,
      prepaidLabel: this.prepaid && this.prepaid.remainingSeconds > 0 ? cost.prepaidLabel(this.prepaid.remainingSeconds) : "남은 시간 없음",
    });
    this.pendingStopReason = "";
    this.emit({ type: "log", level: "info", text: "방송을 종료했습니다. 언어별 텍스트만 저장했습니다." });
    return { stopped: true, dir: this.sessionDir };
  }
}

module.exports = { Engine, cleanTargets, normalizeChannelRows, targetsForChannel, channelRecognition };
