const sentence = require("./sentence");
const { translate } = require("./translator");
const { timing, langByCode, isGuidanceEcho, stripGuidance } = require("./catalog");

function joinSpace(left, right) {
  return `${left || ""} ${right || ""}`.replace(/\s+/g, " ").trim();
}

/**
 * 문장 절단 → 교정/번역 → 언어별 텍스트 저장 → 실시간 자막.
 * 음성 파일은 만들지 않습니다.
 */
class Pipeline {
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.targets = (opts.targets || []).filter((code) => code !== "ko" && langByCode[code]);
    this.glossary = opts.glossary || "";
    this.sessionContext = opts.sessionContext || "";
    this.lessons = [];
    this.pauses = [];
    this.samples = [];
    this.pauseTails = [...new Set((opts.pauseTails || []).map((tail) => String(tail || "").trim()).filter(Boolean))];
    this.openChunk = "";
    this.files = opts.files;
    this.cloud = opts.cloud;
    this.onLive = opts.onLive || (() => {});
    this.onLine = opts.onLine || (() => {});
    this.onLog = opts.onLog || (() => {});
    this.translateImpl = opts.translateImpl || translate;
    this.liveOn = opts.liveOn !== false;
    this.unprocessed = "";
    this.holdFragment = "";
    this.interim = "";
    this.recentContext = [];
    this.sessionTexts = {};
    this.sentenceId = Date.now();
    this.lastSpeechTime = Date.now();
    this.lastLivePush = 0;
    this.chain = Promise.resolve();
    this.timer = null;
    this.stopped = false;
  }

  startTicker() {
    this.timer = setInterval(() => this.tick(), 500);
  }

  noteSpeech() {
    this.lastSpeechTime = Date.now();
  }

  onInterim(text) {
    if (this.stopped) return;
    const value = stripGuidance(text);
    if (!value) {
      this.interim = "";
      this.pushLive(true);
      return;
    }
    this.noteSpeech();
    this.interim = value;
    this.pushLive(false);
  }

  onFinalChunk(text) {
    if (this.stopped) return;
    this.noteSpeech();
    this.interim = "";
    const chunk = stripGuidance(text);
    if (!chunk) {
      this.pushLive(true);
      return;
    }
    if (!chunk || sentence.isNoise(chunk)) return;
    this.notePause(chunk);
    this.unprocessed = joinSpace(this.unprocessed, chunk);
    this.cut();
    this.pushLive(false);
  }

  /** 인식 조각 하나는 침묵으로 끝난 발화입니다. 앞 조각이 문장 중간에서 끝났으면 그 자리가 이 설교자가 말을 끊는 위치입니다. */
  notePause(chunk) {
    const previous = this.openChunk;
    this.openChunk = sentence.endsSentence(chunk) ? "" : chunk;
    if (!previous) return;
    const tail = sentence.pauseTail(previous);
    if (!tail) return;
    this.pauses.push({ tail, before: sentence.lastWord(previous), after: sentence.firstWord(chunk) });
    if (this.pauses.length > 400) this.pauses.shift();
  }

  endsWithPauseTail(text) {
    if (!this.pauseTails.length) return false;
    const t = sentence.stripTrailing(text);
    if (!t || sentence.endsSentence(t)) return false;
    return this.pauseTails.some((tail) => t.endsWith(tail));
  }

  tick() {
    if (this.stopped) return;
    const pending = this.unprocessed.trim();
    if (!pending) return;
    const silence = Date.now() - this.lastSpeechTime;
    if (!sentence.canSilenceFlush(pending, silence, timing)) return;
    const force = silence >= timing.silenceForceFlushMs;
    if (!force && this.endsWithPauseTail(pending)) return;
    this.unprocessed = "";
    this.enqueuePiece(pending, force);
    this.pushLive(false);
  }

  cut() {
    let guard = 0;
    let match = sentence.findCutMatch(this.unprocessed);
    while (match && guard++ < 40) {
      const cutIndex = match.index + match[0].length;
      const piece = this.unprocessed.slice(0, cutIndex).trim();
      this.unprocessed = this.unprocessed.slice(cutIndex);
      if (piece) this.enqueuePiece(piece, false);
      match = sentence.findCutMatch(this.unprocessed);
    }
  }

  takeHold(text) {
    const current = String(text || "").trim();
    if (!this.holdFragment) return current;
    const merged = joinSpace(this.holdFragment, current);
    this.holdFragment = "";
    return merged;
  }

  enqueuePiece(raw, force) {
    let text = this.takeHold(raw);
    if (!text || sentence.isNoise(text)) return;
    if (!force && text.length < 80 && (sentence.isHangingTail(text) || this.endsWithPauseTail(text))) {
      this.holdFragment = this.holdFragment ? joinSpace(this.holdFragment, text) : text;
      return;
    }
    const id = this.sentenceId;
    this.sentenceId = Date.now() + Math.floor(Math.random() * 10);
    if (this.liveOn) this.pushKorean(text, id, false);
    this.chain = this.chain
      .then(() => this.publish(text, id))
      .catch((err) => this.onLog(`번역 대기 오류: ${err.message || err}`));
  }

  async publish(koreanText, id) {
    koreanText = stripGuidance(koreanText);
    if (!koreanText || sentence.isNoise(koreanText) || isGuidanceEcho(koreanText)) return;
    try {
      const result = await this.translateImpl(koreanText, {
        apiKey: this.apiKey,
        model: this.model,
        targetCodes: this.targets,
        previousContext: this.recentContext.join("\n"),
        sessionContext: this.sessionContext,
        glossary: this.glossary,
      });
      if (result.ko != null && String(result.ko).trim() && String(result.ko).trim() !== koreanText) {
        this.lessons.push({ heard: koreanText, corrected: String(result.ko).trim() });
        if (this.lessons.length > 40) this.lessons.shift();
      }
      if (result.ko != null && !String(result.ko).trim()) {
        this.onLine({ lang: "ko", text: "", raw: koreanText, isFinal: true, id, skipped: true });
        return;
      }
      result._raw = koreanText;
      this.remember(result.ko);
      this.noteSample(result);
      await this.writeLanguages(result, id, ["ko", ...this.targets]);
    } catch (err) {
      this.onLog(`번역 실패, 한국어 원문을 남깁니다: ${err.message || err}`);
      await this.writeLanguages({ ko: koreanText, _raw: koreanText }, id, ["ko"]);
    }
  }

  noteSample(result) {
    const lang = this.targets.includes("en") ? "en" : this.targets[0];
    const ko = String(result.ko || "").trim();
    const text = lang && result[lang] ? String(result[lang]).trim() : "";
    if (!ko || !text) return;
    this.samples.push({ ko, lang, text });
    if (this.samples.length > 30) this.samples.shift();
  }

  remember(corrected) {
    const text = String(corrected || "").trim();
    if (!text) return;
    this.recentContext.push(text);
    if (this.recentContext.length > 2) this.recentContext.shift();
  }

  async writeLanguages(result, id, codes) {
    const payload = { _timestamp: Date.now() };
    for (const lang of codes) {
      if (!result[lang]) continue;
      const out = String(result[lang]).trim();
      if (!out) continue;
      if (!this.sessionTexts[lang]) this.sessionTexts[lang] = [];
      this.sessionTexts[lang].push(out);
      const full = this.sessionTexts[lang].join("\n");
      try {
        if (this.files) this.files.write(lang, full);
      } catch (err) {
        this.onLog(`${lang}.txt 저장 실패: ${err.message || err}`);
      }
      try {
        if (this.cloud && this.cloud.appendSentence) await this.cloud.appendSentence(lang, id, out);
      } catch (err) {
        this.onLog(`클라우드 ${lang} 문장 추가 실패: ${err.message || err}`);
      }
      payload[lang] = { text: out, id, isFinal: true };
      this.onLine({ lang, text: out, raw: lang === "ko" ? result._raw : "", isFinal: true, id });
    }
    if (payload.ko && this.cloud) {
      try {
        await this.cloud.updateSubtitles(payload);
      } catch (err) {
        this.onLog(`실시간 자막 전송 실패: ${err.message || err}`);
      }
    }
  }

  liveTail() {
    return joinSpace(joinSpace(this.holdFragment, this.unprocessed), this.interim);
  }

  pushLive(force) {
    const text = this.liveTail();
    this.onLive(text);
    if (!this.liveOn || !this.cloud) return;
    const now = Date.now();
    if (!force && now - this.lastLivePush < timing.livePushMinInterval) return;
    if (!text) return;
    this.lastLivePush = now;
    this.cloud.updateSubtitles({
      _timestamp: now,
      ko: { text, id: this.sentenceId, isFinal: false },
    }).catch(() => {});
  }

  pushKorean(text, id, isFinal) {
    this.onLive(text);
    if (!this.cloud) return;
    this.lastLivePush = Date.now();
    this.cloud.updateSubtitles({
      _timestamp: this.lastLivePush,
      ko: { text, id, isFinal: !!isFinal },
    }).catch(() => {});
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    let leftover = this.unprocessed.trim();
    this.unprocessed = "";
    this.interim = "";
    if (this.holdFragment) {
      leftover = leftover ? joinSpace(this.holdFragment, leftover) : this.holdFragment;
      this.holdFragment = "";
    }
    if (leftover && !sentence.isNoise(leftover)) {
      const id = this.sentenceId;
      this.chain = this.chain.then(() => this.publish(leftover, id));
    }
    await this.chain;
    
    if (this.cloud && this.cloud.setText) {
      for (const [lang, lines] of Object.entries(this.sessionTexts)) {
        try {
          await this.cloud.setText(lang, lines.join("\n"));
        } catch (err) {
          this.onLog(`클라우드 ${lang} 전체 텍스트 저장 실패: ${err.message || err}`);
        }
      }
    }
  }
}

module.exports = { Pipeline };
