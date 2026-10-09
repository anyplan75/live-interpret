const WebSocket = require("ws");
const { UtteranceVad } = require("./vad");
const { wavFromPcm16 } = require("./audio-util");
const { keywordsFromGlossary, sttPrompt } = require("./catalog");

const REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

function sensitivityThreshold(level) {
  if (level === "high") return 0.008;
  if (level === "low") return 0.04;
  return 0.016;
}

/**
 * 선택한 채널의 24kHz PCM만 받아 한국어 텍스트로 바꿉니다.
 * 실시간 세션이 안 되면 발화 단위 파일 인식으로 넘깁니다.
 */
class SpeechSession {
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.churchName = opts.churchName || "";
    this.glossary = opts.glossary || "";
    this.sessionContext = opts.sessionContext || "";
    this.extraKeywords = Array.isArray(opts.extraKeywords) ? opts.extraKeywords : [];
    this.onInterim = opts.onInterim || (() => {});
    this.onFinal = opts.onFinal || (() => {});
    this.onAudio = opts.onAudio || null;
    this.onStatus = opts.onStatus || (() => {});
    this.onError = opts.onError || (() => {});
    this.fetchImpl = opts.fetchImpl || fetch;
    this.WebSocketImpl = opts.WebSocketImpl || WebSocket;
    this.vad = new UtteranceVad({
      sampleRate: 24000,
      threshold: sensitivityThreshold(opts.sensitivity),
    });
    this.mode = "realtime";
    this.ws = null;
    this.ready = false;
    this.partial = "";
    this.partialItem = null;
    this.pendingItem = null;
    this.abandoned = new Set();
    this.backlog = [];
    this.paused = false;
    this.streamed = false;
    this.startedAt = 0;
    this.closed = false;
    this.uttGen = 0;
    this.interimTimer = null;
    this.inflight = null;
  }

  setSensitivity(level) {
    this.vad.setThreshold(sensitivityThreshold(level));
  }

  start() {
    this.closed = false;
    this.mode = "realtime";
    return this.connect().catch((err) => {
      this.switchToFile(err.message || String(err));
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("세션이 닫혔습니다."));
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error("실시간 인식 연결 시간 초과")), 6000);
      try {
        this.ws = new this.WebSocketImpl(REALTIME_URL, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
      } catch (err) {
        finish(err);
        return;
      }
      this.ws.on("open", () => this.sendSession());
      this.ws.on("message", (data) => {
        this.handleMessage(data, finish);
      });
      this.ws.on("error", (err) => {
        if (!this.ready) finish(err);
        else this.onError(err.message || "음성 인식 연결 오류");
      });
      this.ws.on("close", () => {
        this.ready = false;
        if (!settled) finish(new Error("음성 인식 연결이 닫혔습니다."));
      });
    });
  }

  sendSession() {
    const keywords = keywordsFromGlossary(this.glossary, this.churchName, this.extraKeywords);
    this.send({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: "gpt-live-transcribe",
              prompt: sttPrompt(this.churchName, this.sessionContext),
              keywords,
              languages: ["ko"],
              delay: "low",
            },
            turn_detection: null,
          },
        },
      },
    });
  }

  handleMessage(data, onReady) {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch (_) {
      return;
    }
    if (event.type === "session.updated" || event.type === "transcription_session.updated") {
      this.ready = true;
      this.startedAt = Date.now();
      this.onStatus("실시간 음성 인식에 연결되었습니다.");
      if (onReady) onReady();
      return;
    }
    if (event.type === "session.created" || event.type === "transcription_session.created") {
      return;
    }
    if (event.type === "input_audio_buffer.committed") {
      if (this.pendingResolve && !this.pendingItem && event.item_id) this.pendingItem = event.item_id;
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const item = event.item_id || null;
      if (item && this.abandoned.has(item)) return;
      if (item && item !== this.partialItem) {
        this.partial = "";
        this.partialItem = item;
      }
      this.partial += event.delta || "";
      if (this.partial.trim()) this.onInterim(this.partial.trim());
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const item = event.item_id || null;
      if (item && this.abandoned.has(item)) {
        this.abandoned.delete(item);
        return;
      }
      const sameItem = !item || !this.partialItem || item === this.partialItem;
      const text = String(event.transcript || "").trim() || (sameItem ? this.partial.trim() : "");
      if (sameItem) {
        this.partial = "";
        this.partialItem = null;
      }
      if (this.pendingResolve && (!item || !this.pendingItem || item === this.pendingItem)) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingItem = null;
        clearTimeout(this.pendingTimer);
        resolve(text);
      } else if (text) {
        this.onFinal(text);
      }
      return;
    }
    if (event.type === "error") {
      const message = (event.error && (event.error.message || event.error.code)) || "음성 인식 오류";
      if (!this.ready && onReady) onReady(new Error(message));
      else this.onError(message);
    }
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  sendAppend(pcm) {
    if (!pcm || !pcm.length) return;
    if (this.onAudio) this.onAudio(pcm);
    this.send({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
  }

  canStream() {
    return this.mode === "realtime" && this.ready && !this.paused;
  }

  push(pcm24) {
    if (this.closed) return;
    if (this.paused) {
      this.backlog.push(Buffer.from(pcm24));
      return;
    }
    this.feed(Buffer.from(pcm24));
  }

  feed(pcm) {
    const evt = this.vad.push(pcm);
    if (evt.started) {
      this.streamed = false;
      this.uttGen += 1;
      this.partial = "";
    }
    if (evt.append && this.canStream()) {
      this.sendAppend(evt.append);
      this.streamed = true;
    }
    if (this.mode === "file" && evt.speaking && evt.current) this.scheduleFileInterim(evt.current, this.uttGen);
    if (!evt.finished) return;
    this.uttGen += 1;
    if (this.interimTimer) clearTimeout(this.interimTimer);
    this.interimTimer = null;
    const audio = evt.utterance;
    const streamed = this.streamed;
    this.streamed = false;
    this.paused = true;
    const run = this.consume(audio, streamed)
      .catch((err) => this.onError(err.message || String(err)))
      .finally(() => {
        if (this.inflight === run) this.inflight = null;
        this.release();
      });
    this.inflight = run;
  }

  async consume(audio, streamed) {
    let text = "";
    try {
      text = await this.recognize(audio, streamed);
    } finally {
      this.onFinal(String(text || "").trim());
    }
  }

  async recognize(audio, streamed) {
    let metered = !!streamed;
    if (this.mode === "realtime" && this.ready) {
      try {
        if (!streamed && audio && audio.length) {
          this.sendAppend(audio);
          metered = true;
        }
        const text = await this.commitAndWait(8000);
        if (text && text.trim()) return text.trim();
      } catch (err) {
        this.switchToFile(err.message || String(err));
      }
    }
    return this.postFile(audio, !metered);
  }

  commitAndWait(ms) {
    return new Promise((resolve, reject) => {
      if (!this.send({ type: "input_audio_buffer.commit" })) {
        reject(new Error("음성 인식 소켓이 열려 있지 않습니다."));
        return;
      }
      this.pendingItem = null;
      this.pendingResolve = resolve;
      this.pendingTimer = setTimeout(() => {
        this.pendingResolve = null;
        if (this.pendingItem) this.abandoned.add(this.pendingItem);
        if (this.partialItem) this.abandoned.add(this.partialItem);
        this.pendingItem = null;
        this.partial = "";
        this.partialItem = null;
        resolve("");
      }, ms);
    });
  }

  scheduleFileInterim(buffer, gen) {
    if (this.interimTimer || buffer.length < 24000 * 2) return;
    this.interimTimer = setTimeout(() => {
      this.interimTimer = null;
      if (this.closed || this.uttGen !== gen) return;
      this.postFile(buffer)
        .then((text) => {
          if (!this.closed && this.uttGen === gen && text) this.onInterim(text);
        })
        .catch(() => {});
    }, 2000);
  }

  async postFile(pcm, meter) {
    if (!pcm || pcm.length < 4800) return "";
    if (meter && this.onAudio) this.onAudio(pcm);
    const wav = wavFromPcm16(pcm, 24000);
    const prompt = sttPrompt(this.churchName, this.sessionContext);
    const models = ["gpt-4o-mini-transcribe", "whisper-1"];
    let lastError = null;
    for (const model of models) {
      try {
        const form = new FormData();
        form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
        form.append("model", model);
        form.append("language", "ko");
        form.append("prompt", prompt.slice(0, model === "whisper-1" ? 220 : 800));
        const res = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json();
        if (!res.ok) {
          lastError = new Error((data.error && data.error.message) || `음성 인식 ${res.status}`);
          if (res.status === 404 || /model/i.test(lastError.message)) continue;
          throw lastError;
        }
        if (this.mode !== "file" && model) {
          /* 실시간 결과가 비었을 때의 보조 경로 */
        }
        return String(data.text || "").trim();
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("음성 인식 실패");
  }

  switchToFile(reason) {
    if (this.mode === "file") return;
    this.mode = "file";
    this.ready = false;
    this.closeSocket();
    this.onStatus(`발화 단위 인식으로 전환했습니다. ${reason || ""}`.trim());
  }

  release() {
    const queued = this.backlog.splice(0);
    this.paused = false;
    if (this.startedAt && Date.now() - this.startedAt > 45 * 60 * 1000 && this.mode === "realtime") {
      this.closeSocket();
      this.ready = false;
      this.connect().catch((err) => this.switchToFile(err.message || String(err)));
    }
    for (const chunk of queued) {
      if (this.paused) this.backlog.push(chunk);
      else this.feed(chunk);
    }
  }

  async stop() {
    this.closed = true;
    if (this.interimTimer) clearTimeout(this.interimTimer);
    for (let guard = 0; this.inflight && guard < 8; guard++) await this.inflight;
    const tail = this.vad.flush();
    const streamed = this.streamed;
    if (tail) {
      try {
        await this.consume(tail, streamed);
      } catch (err) {
        this.onError(err.message || String(err));
      }
    }
    this.closeSocket();
  }

  closeSocket() {
    try {
      if (this.ws) this.ws.close();
    } catch (_) {
      /* 이미 닫힌 소켓 */
    }
    this.ws = null;
    this.ready = false;
  }
}

module.exports = { SpeechSession, sensitivityThreshold };
