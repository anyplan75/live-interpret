const sentence = require("./sentence");
const { translate } = require("./translator");
const { timing, langByCode, isGuidanceEcho, stripGuidance } = require("./catalog");

function joinSpace(left, right) {
  return `${left || ""} ${right || ""}`.replace(/\s+/g, " ").trim();
}

/**
 * 인식은 발화 처음부터 누적된 글을 보냅니다. 이미 내려 보낸 앞부분이 어디서 끝나는지 찾습니다.
 * 공백 차이만 있으면 그 뒤를 반환하고, 앞부분이 바뀌었으면 공통 부분의 단어 경계까지 넘깁니다.
 */
function spokenEnd(value, spoken) {
  if (!spoken) return 0;
  if (value.startsWith(spoken)) return spoken.length;
  const space = (ch) => /\s/.test(ch);
  let i = 0;
  let j = 0;
  while (i < value.length && j < spoken.length) {
    const valueSpace = space(value[i]);
    const spokenSpace = space(spoken[j]);
    if (valueSpace || spokenSpace) {
      if (valueSpace) i += 1;
      if (spokenSpace) j += 1;
      continue;
    }
    if (value[i] !== spoken[j]) break;
    i += 1;
    j += 1;
  }
  while (j < spoken.length && space(spoken[j])) j += 1;
  if (j >= spoken.length) return i;
  if (i >= value.length) return value.length;
  const back = value.lastIndexOf(" ", i);
  return back > 0 ? back : 0;
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
    this.usage = opts.usage || null;
    this.onLive = opts.onLive || (() => {});
    this.onHeard = opts.onHeard || (() => {});
    this.onLine = opts.onLine || (() => {});
    this.onLog = opts.onLog || (() => {});
    this.translateImpl = opts.translateImpl || translate;
    this.liveOn = opts.liveOn !== false;
    this.unprocessed = "";
    this.holdFragment = "";
    this.holdHeard = 0;
    this.heardSeq = 0;
    this.heardMarks = [];
    this.spoken = "";
    this.utterance = "";
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

  /**
   * 인식은 발화 처음부터 누적된 글을 보냅니다. 노란 칸에는 문장이 여러 개 쌓여도 그대로 둡니다.
   * 번역을 기다리는 말이 140자를 넘으면, 그 근처의 문장·어미·쉼표·띄어쓰기에서 끊어 번역합니다.
   * 빈 값으로는 지우지 않습니다.
   */
  onInterim(text) {
    if (this.stopped) return;
    if (!String(text || "").trim()) return;
    const value = stripGuidance(text);
    if (!value) {
      this.interim = "";
      this.onLive("");
      this.pushLive(true);
      return;
    }
    this.noteSpeech();
    const start = this.spoken ? spokenEnd(value, this.spoken) : 0;
    let tail = value.slice(start);
    let consumed = start;
    let guard = 0;
    let cutAt = sentence.translateBreak(tail);
    while (cutAt > 0 && guard++ < 40) {
      this.releaseChunk(tail.slice(0, cutAt).trim());
      consumed += cutAt;
      tail = tail.slice(cutAt);
      cutAt = sentence.translateBreak(tail);
    }
    this.spoken = value.slice(0, consumed);
    this.interim = tail.trim();
    this.onLive(this.interim);
    this.pushLive(false);
  }

  /** 발화가 끝났습니다. 140자를 넘긴 앞부분은 근처 경계에서 번역하고, 나머지는 듣는 말로 내립니다. 인식 결과가 비면 보여 주던 말을 그대로 남깁니다. */
  onFinalChunk(text) {
    if (this.stopped) return;
    this.noteSpeech();
    const raw = String(text || "").trim();
    let rest = this.interim;
    if (raw) {
      const full = stripGuidance(raw);
      rest = this.spoken ? full.slice(spokenEnd(full, this.spoken)) : full;
    }
    let guard = 0;
    let cutAt = sentence.translateBreak(rest);
    while (cutAt > 0 && guard++ < 40) {
      this.releaseChunk(rest.slice(0, cutAt).trim());
      rest = rest.slice(cutAt);
      cutAt = sentence.translateBreak(rest);
    }
    this.commitHeard(rest.trim());
    const utterance = this.utterance;
    this.spoken = "";
    this.utterance = "";
    this.interim = "";
    this.onLive("");
    if (utterance && !sentence.isNoise(utterance)) this.notePause(utterance);
    this.pushLive(true);
  }

  /** 목표 길이 근처에서 끊긴 덩어리를 듣는 말로 남기고, 그 인식 원문 그대로 번역합니다. */
  releaseChunk(text) {
    if (!text) return;
    const heardId = this.addHeard(text);
    this.utterance = joinSpace(this.utterance, text);
    if (sentence.isNoise(text)) return;
    this.enqueuePiece(text, true, heardId);
  }

  /** 듣는 말 한 줄을 내리고 번역 대기열에 붙입니다. */
  commitHeard(text) {
    if (!text) return;
    const heardId = this.addHeard(text);
    this.utterance = joinSpace(this.utterance, text);
    if (sentence.isNoise(text)) return;
    this.appendUnprocessed(text, heardId);
    this.cut();
  }

  addHeard(text) {
    this.heardSeq += 1;
    this.onHeard({ id: this.heardSeq, text });
    return this.heardSeq;
  }

  /** 문장은 발화를 넘나들며 잘립니다. 각 발화가 unprocessed 어디서 끝나는지 기억해 교정을 그 듣는 말 아래에 붙입니다. */
  appendUnprocessed(chunk, heardId) {
    const lead = this.unprocessed.length - this.unprocessed.trimStart().length;
    this.unprocessed = joinSpace(this.unprocessed, chunk);
    this.heardMarks = this.heardMarks.map((mark) => ({ id: mark.id, end: mark.end - lead }));
    this.heardMarks.push({ id: heardId, end: this.unprocessed.length });
  }

  heardAt(end) {
    const mark = this.heardMarks.find((item) => item.end >= end);
    return mark ? mark.id : this.lastHeard();
  }

  lastHeard() {
    const mark = this.heardMarks[this.heardMarks.length - 1];
    return mark ? mark.id : this.heardSeq;
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
    const heardId = this.lastHeard();
    this.unprocessed = "";
    this.heardMarks = [];
    this.enqueuePiece(pending, force, heardId);
    this.pushLive(false);
  }

  cut() {
    let guard = 0;
    let match = sentence.findCutMatch(this.unprocessed);
    while (match && guard++ < 40) {
      const cutIndex = match.index + match[0].length;
      const head = this.unprocessed.slice(0, cutIndex);
      const piece = head.trim();
      const heardId = this.heardAt(head.trimEnd().length);
      this.unprocessed = this.unprocessed.slice(cutIndex);
      this.heardMarks = this.heardMarks
        .filter((mark) => mark.end > cutIndex)
        .map((mark) => ({ id: mark.id, end: mark.end - cutIndex }));
      if (piece) this.enqueuePiece(piece, false, heardId);
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

  enqueuePiece(raw, force, heardId) {
    const owner = heardId || this.holdHeard || this.heardSeq;
    let text = this.takeHold(raw);
    if (!text || sentence.isNoise(text)) return;
    if (!force && text.length < 80 && (sentence.isHangingTail(text) || this.endsWithPauseTail(text))) {
      this.holdFragment = this.holdFragment ? joinSpace(this.holdFragment, text) : text;
      this.holdHeard = owner;
      return;
    }
    this.holdHeard = 0;
    const id = this.sentenceId;
    this.sentenceId = Date.now() + Math.floor(Math.random() * 10);
    if (this.liveOn) this.pushKorean(text, id, false);
    this.chain = this.chain
      .then(() => this.publish(text, id, owner))
      .catch((err) => this.onLog(`번역 대기 오류: ${err.message || err}`));
  }

  /** 번역으로 넘긴 글자 수만 더합니다. 문장 전체는 요금 기록에 다시 쓰지 않습니다. */
  meterTranslation(text) {
    if (!this.usage) return;
    this.usage.addTranslation(text, this.targets);
    const record = this.usage.record(this.model);
    if (this.cloud && this.cloud.recordUsage) {
      Promise.resolve(this.cloud.recordUsage(record)).catch((err) => {
        this.onLog(`요금 기록 실패: ${err.message || err}`);
      });
    }
  }

  async publish(koreanText, id, heardId) {
    koreanText = stripGuidance(koreanText);
    if (!koreanText || sentence.isNoise(koreanText) || isGuidanceEcho(koreanText)) return;
    this.meterTranslation(koreanText);
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
        this.onLine({ lang: "ko", text: "", raw: koreanText, isFinal: true, id, heardId, skipped: true });
        return;
      }
      result._raw = koreanText;
      this.remember(result.ko);
      this.noteSample(result);
      await this.writeLanguages(result, id, ["ko", ...this.targets], heardId);
    } catch (err) {
      this.onLog(`번역 실패, 한국어 원문을 남깁니다: ${err.message || err}`);
      await this.writeLanguages({ ko: koreanText, _raw: koreanText }, id, ["ko"], heardId);
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

  async writeLanguages(result, id, codes, heardId) {
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
      if (lang === "ko") this.onLine({ lang, text: out, raw: result._raw, isFinal: true, id, heardId });
      else this.onLine({ lang, text: out, raw: "", isFinal: true, id });
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
    if (this.interim) {
      this.appendUnprocessed(this.interim, this.addHeard(this.interim));
      this.interim = "";
      this.onLive("");
    }
    let leftover = this.unprocessed.trim();
    const heardId = this.heardMarks.length ? this.lastHeard() : this.holdHeard || this.heardSeq;
    this.unprocessed = "";
    this.heardMarks = [];
    if (this.holdFragment) {
      leftover = leftover ? joinSpace(this.holdFragment, leftover) : this.holdFragment;
      this.holdFragment = "";
    }
    if (leftover && !sentence.isNoise(leftover)) {
      const id = this.sentenceId;
      this.chain = this.chain.then(() => this.publish(leftover, id, heardId));
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
