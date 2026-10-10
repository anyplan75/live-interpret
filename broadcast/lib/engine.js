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
} = require("./catalog");
const bulletin = require("./bulletin");
const preacherLib = require("./preacher");
const { listInputDevices, InputCapture } = require("./audio");
const { channelPeaks, resampleInt16, selectedChannelPcm } = require("./audio-util");
const { SpeechSession } = require("./stt");
const { Pipeline } = require("./pipeline");
const { UsageMeter } = require("./usage");
const cost = require("./cost");
const { createSessionWriter } = require("./files");
const firebase = require("./firebase");

function cleanTargets(targets) {
  return [...new Set((targets || []).filter((code) => code !== "ko" && langByCode[code]))];
}

class Engine {
  constructor(emit) {
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
  }

  async readBalance(churchId) {
    const raw = await firebase.get(`churches/${churchId}/billing/balance`);
    return Math.round(Number(raw) || 0);
  }

  async previewCharge(churchId, targets) {
    const languages = cleanTargets(targets);
    const balance = await this.readBalance(churchId);
    const firstHourKrw = cost.packageKrw({ minutes: 60, languages });
    return {
      balance,
      balanceKrw: balance,
      firstHourKrw,
      halfKrw: cost.halfBlockKrw(languages),
      overtimeText: cost.overtimeText(),
      short: balance < firstHourKrw,
      languages,
    };
  }

  async writeBilling(churchId, balance, entry) {
    const row = { ...entry };
    delete row.id;
    await firebase.update(`churches/${churchId}/billing`, {
      balance,
      lastEntryId: entry.id,
      [`ledger/${entry.id}`]: row,
    });
  }

  async chargeOpening() {
    const languages = this.targets;
    const balance = await this.readBalance(this.church.id);
    const opened = cost.openBroadcast({ balance, languages });
    if (!opened.ok) {
      const err = new Error(`충전금이 부족합니다. 첫 시간에 ${cost.formatKrw(opened.firstHourKrw)}이 필요하지만 남은 충전금은 ${cost.formatKrw(opened.balance)}입니다.`);
      err.short = true;
      throw err;
    }
    const entry = cost.ledgerEntry({
      id: cost.ledgerId(),
      type: "charge",
      deltaKrw: -opened.charged,
      balanceAfter: opened.balance,
      at: Date.now(),
      who: this.church.accountUid || "",
      note: "첫 시간",
      churchId: this.church.id,
    });
    await this.writeBilling(this.church.id, opened.balance, entry);
    this.sessionCharge = { ...opened, shortLogged: false };
    return this.sessionCharge;
  }

  async collectOvertime(minutes) {
    if (!this.sessionCharge || !this.sessionCharge.running || !this.church) return this.sessionCharge;
    const beforeDone = this.sessionCharge.overtimeDone;
    const beforeCharged = this.sessionCharge.charged;
    const next = cost.accrue(this.sessionCharge, minutes);
    const added = next.overtimeDone - beforeDone;
    if (added > 0) {
      const deducted = next.charged - beforeCharged;
      const entry = cost.ledgerEntry({
        id: cost.ledgerId(),
        type: "charge",
        deltaKrw: -deducted,
        balanceAfter: next.balance,
        at: Date.now(),
        who: this.church.accountUid || "",
        note: "추가 30분",
        churchId: this.church.id,
      });
      await this.writeBilling(this.church.id, next.balance, entry);
    }
    if (next.short && !this.sessionCharge.shortLogged) {
      this.emit({
        type: "log",
        level: "error",
        text: `충전금이 부족합니다. ${cost.formatKrw(next.halfKrw)}을 빼지 못했습니다. 방송은 계속됩니다.`,
      });
      next.shortLogged = true;
    } else {
      next.shortLogged = !!this.sessionCharge.shortLogged;
    }
    this.sessionCharge = next;
    return next;
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

  monitor(deviceKey, channel) {
    const device = this.devices.find((item) => item.key === deviceKey) || this.listDevices().devices.find((item) => item.key === deviceKey);
    if (!device) throw new Error("입력 장치를 찾지 못했습니다. 목록을 새로고침해 주세요.");
    const snap = this.capture.start(device, {
      onPcm: (buffer, info) => this._onPcm(buffer, info),
      onError: (message) => this.emit({ type: "log", level: "error", text: message }),
    });
    this.device = device;
    const selected = Number.isInteger(channel) ? channel : 0;
    const applied = this.capture.selectChannel(Math.min(selected, device.inputChannels - 1));
    this.emit({ type: "audio", audio: applied });
    return applied;
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
    if (!this.speech) return;
    try {
      const mono = selectedChannelPcm(buffer, info);
      const pcm24 = resampleInt16(mono, info.sampleRate || 48000, 24000);
      this.speech.push(pcm24);
    } catch (err) {
      this.emit({ type: "log", level: "error", text: err.message || String(err) });
    }
  }

  async syncSettings(churchId, targets) {
    const selected = cleanTargets(targets);
    const existing = (await firebase.get(`churches/${churchId}/live/settings`)) || {};
    const active = ["ko", ...selected];
    const next = {
      _timestamp: Date.now(),
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
      };
    });
    await firebase.set(`churches/${churchId}/live/settings`, next);
    return next;
  }

  async saveStyle(churchId, style) {
    if (!isChurchId(churchId)) throw new Error("교회가 올바르지 않습니다.");
    const existing = (await firebase.get(`churches/${churchId}/live/settings`)) || {};
    const next = applyStyleToSettings(existing, style);
    await firebase.set(`churches/${churchId}/live/settings`, next);
    return styleFromSettings(next);
  }

  async setTargets(churchId, targets) {
    this.targets = cleanTargets(targets);
    if (this.pipeline) this.pipeline.targets = this.targets;
    if (this.usage) this.usage.setLanguages(this.targets);
    if (churchId) await this.syncSettings(churchId, this.targets);
    if (this.running) this.flushUsage(true);
    return this.targets;
  }

  async start(opts) {
    if (this.running) throw new Error("이미 방송 중입니다.");
    const apiKey = opts.apiKey || "";
    if (!apiKey) {
      throw new Error("관리 페이지에서 OpenAI 키를 먼저 저장해 주세요.");
    }
    if (!opts.folder) throw new Error("저장 폴더를 선택해 주세요.");
    if (!isChurchId(opts.churchId)) throw new Error("교회를 선택해 주세요.");
    if (!isPreacherId(opts.preacherId)) throw new Error("설교자를 등록하고 선택해 주세요.");
    const targets = cleanTargets(opts.targets);
    if (!targets.length) throw new Error("번역할 언어를 하나 이상 선택해 주세요. 한국어는 항상 포함됩니다.");
    if (!this.capture.opened) {
      if (!opts.deviceKey) throw new Error("입력 장치를 먼저 선택해 주세요.");
      this.monitor(opts.deviceKey, opts.channel || 0);
    }
    const church = await firebase.getChurch(opts.churchId);
    if (!church) throw new Error("교회를 찾지 못했습니다. 관리 페이지에서 교회를 먼저 추가해 주세요.");
    if (!church.active) throw new Error("이 교회는 비활성 상태입니다. 관리 페이지에서 활성화해 주세요.");
    const glossary = church.glossary && church.glossary.trim()
      ? church.glossary
      : defaultGlossary(church.name);
    const model = isModelId(church.model) ? church.model : defaultModel;
    const preachers = await firebase.listPreachers(church.id);
    let selected = preachers.find((item) => item.id === opts.preacherId) || null;
    if (!selected) throw new Error("이 교회에 등록된 설교자를 선택해 주세요.");

    this.writer = createSessionWriter(opts.folder, church.name, opts.now || new Date());
    this.sessionDir = this.writer.dir;
    this.folderName = this.writer.folderName;
    this.church = church;
    this.targets = targets;
    this.sessionApiKey = apiKey;
    this.sessionModel = model;
    this.preacherId = selected.id;

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
        this.emit({ type: "log", level: "info", text: `주보의 설교자 ${named.name} 과 선택한 설교자가 같습니다.` });
      }
    }

    const sessionContext = sessionContextText({ bulletin: extracted, preacher: selected });
    const extraKeywords = contextKeywords(extracted, selected);
    await this.syncSettings(church.id, targets);
    await firebase.setSessionMeta(church.id, this.folderName, {
      churchName: church.name,
      startedAt: Date.now(),
      folderName: this.folderName,
      languages: ["ko", ...targets],
      preacherId: selected.id,
      preacherName: selected.name,
      endedAt: null,
    });

    this.usage = new UsageMeter();
    this.usage.start(targets);
    this.usageChain = Promise.resolve();
    this.lastUsageWrite = 0;
    this.sessionCharge = null;
    const cloud = {
      updateSubtitles: (payload) => firebase.update(`churches/${church.id}/live/subtitles`, payload),
      setText: (lang, text) => firebase.setSessionText(church.id, this.folderName, lang, text),
      appendSentence: (lang, id, text) => firebase.appendSessionSentence(church.id, this.folderName, lang, id, text),
      recordUsage: (record) => this.flushUsage(true, record),
    };
    this.pipeline = new Pipeline({
      apiKey,
      model,
      targets,
      glossary,
      sessionContext,
      pauseTails: preacherLib.pauseTails(selected),
      files: this.writer,
      usage: this.usage,
      cloud,
      onLive: (text) => this.emit({ type: "live", text }),
      onHeard: (heard) => this.emit({ type: "heard", ...heard }),
      onLine: (line) => this.emit({ type: "line", ...line }),
      onLog: (text) => this.emit({ type: "log", level: "info", text }),
    });
    this.pipeline.startTicker();
    this.speech = new SpeechSession({
      apiKey,
      churchName: church.name,
      glossary,
      sessionContext,
      extraKeywords,
      sensitivity: opts.sensitivity || "normal",
      onInterim: (text) => this.pipeline && this.pipeline.onInterim(text),
      onFinal: (text) => this.pipeline && this.pipeline.onFinalChunk(text),
      onStatus: (text) => this.emit({ type: "log", level: "info", text }),
      onError: (text) => this.emit({ type: "log", level: "error", text }),
      onAudio: (pcm) => {
        if (!this.usage || !pcm) return;
        this.usage.addPcm16(pcm.length, 24000);
        this.flushUsage(false);
      },
    });
    await this.speech.start();
    try {
      await this.chargeOpening();
    } catch (err) {
      try { await this.speech.stop(); } catch (_) { /* 이미 끊긴 인식은 무시합니다 */ }
      this.speech = null;
      if (this.pipeline) {
        try { await this.pipeline.stop(); } catch (_) { /* 아직 문장이 없으면 무시합니다 */ }
      }
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
    });
    return {
      church,
      folderName: this.folderName,
      dir: this.sessionDir,
      targets,
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
        const at = Date.now();
        const minutes = this.usage && this.usage.minutesAt ? this.usage.minutesAt(at) : 0;
        await this.collectOvertime(minutes);
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
      const at = Date.now();
      const minutes = this.usage.minutesAt ? this.usage.minutesAt(at) : 0;
      await this.collectOvertime(minutes);
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
    if (!this.running) return { stopped: true };
    this.running = false;
    const speech = this.speech;
    const pipeline = this.pipeline;
    this.speech = null;
    if (speech) await speech.stop();
    if (pipeline) await pipeline.stop();
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
          this.emit({ type: "log", level: "info", text: `${current.name} 설교자 프로필에 오늘 배운 표현을 반영했습니다.` });
        }
      } catch (err) {
        this.emit({ type: "log", level: "error", text: `설교자 프로필 갱신 실패: ${err.message || err}` });
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
    });
    this.emit({ type: "log", level: "info", text: "방송을 종료했습니다. 언어별 텍스트만 저장했습니다." });
    return { stopped: true, dir: this.sessionDir };
  }
}

module.exports = { Engine, cleanTargets };
