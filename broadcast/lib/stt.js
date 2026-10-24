const WebSocket = require("ws");
const { UtteranceVad } = require("./vad");
const { wavFromPcm16 } = require("./audio-util");
const { keywordsFromGlossary, sttPrompt, spokenLanguage, transcriptionLanguage } = require("./catalog");

const REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

function sensitivityThreshold(level) {
  if (level === "high") return 0.008;
  if (level === "low") return 0.04;
  return 0.016;
}

/**
 * 선택한 채널의 24kHz PCM만 받아 그 채널의 말하는 언어로 바꿉니다.
 * 실시간 세션이 안 되면 발화 단위 파일 인식으로 넘깁니다.
 */
class SpeechSession {
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.spoken = spokenLanguage(opts.language);
    this.language = transcriptionLanguage(this.spoken);
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
    this.sinceCommit = Buffer.alloc(0);
    this.uttSent = 0;
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
      let socket;
      try {
        socket = new this.WebSocketImpl(REALTIME_URL, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
      } catch (err) {
        finish(err);
        return;
      }
      this.ws = socket;
      const current = () => this.ws === socket;
      socket.on("open", () => {
        if (current()) this.sendSession();
      });
      socket.on("message", (data) => {
        if (current()) this.handleMessage(data, finish);
      });
      socket.on("error", (err) => {
        if (!current()) return;
        if (this.languageWait) {
          const wait = this.languageWait;
          this.languageWait = null;
          wait(err);
          return;
        }
        if (!this.ready) finish(err);
        else this.onError(err.message || "음성 인식 연결 오류");
      });
      socket.on("close", () => {
        if (!current()) return;
        this.ready = false;
        if (!settled) finish(new Error("음성 인식 연결이 닫혔습니다."));
      });
    });
  }

  /**
   * 방송은 그대로 두고 인식 언어만 바꿉니다.
   * 열린 소켓이 세션 갱신을 받아들이면 그 자리에서 바꾸고, 아니면 인식 소켓만 다시 연결합니다.
   */
  async setLanguage(code) {
    const spoken = spokenLanguage(code);
    const language = transcriptionLanguage(spoken);
    if (this.closed) {
      this.spoken = spoken;
      this.language = language;
      return spoken;
    }
    if (spoken === this.spoken && language === this.language) return spoken;
    this.switching = true;
    this.paused = true;
    this.partial = "";
    this.partialItem = null;
    this.uttGen += 1;
    if (this.inflight) {
      try { await this.inflight; } catch (_) { /* 직전 발화의 실패는 언어 변경을 막지 않습니다 */ }
    }
    this.spoken = spoken;
    this.language = language;
    try {
      if (this.mode === "realtime") {
        const updated = await this.updateLiveLanguage();
        if (!updated && !this.closed) await this.reconnectRecognition();
      }
    } finally {
      this.switching = false;
      if (!this.closed) this.release();
    }
    return spoken;
  }

  updateLiveLanguage() {
    return new Promise((resolve) => {
      if (this.languageWait) {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.languageWait === finish) this.languageWait = null;
        resolve(!err);
      };
      const timer = setTimeout(() => finish(new Error("인식 언어 변경 시간 초과")), 2500);
      this.languageWait = finish;
      if (!this.sendSession()) finish(new Error("음성 인식 소켓이 열려 있지 않습니다."));
    });
  }

  async reconnectRecognition() {
    this.ready = false;
    this.mode = "realtime";
    const old = this.ws;
    this.ws = null;
    try {
      if (old) old.close();
    } catch (_) {
      /* 이미 닫힌 소켓 */
    }
    try {
      await this.connect();
      this.onStatus("인식 언어를 바꿨습니다.");
    } catch (err) {
      if (!this.closed) this.switchToFile(err.message || String(err));
    }
  }

  sendSession() {
    const keywords = keywordsFromGlossary(this.glossary, this.churchName, this.extraKeywords);
    return this.send({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: "gpt-live-transcribe",
              prompt: sttPrompt(this.churchName, this.sessionContext, this.spoken),
              keywords,
              languages: [this.language],
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
      if (this.languageWait) {
        const wait = this.languageWait;
        this.languageWait = null;
        wait();
        return;
      }
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
      if (this.languageWait) {
        const wait = this.languageWait;
        this.languageWait = null;
        wait(new Error(message));
        return;
      }
      if (!this.ready && onReady) onReady(new Error(message));
      else this.onError(message);
    }
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  /** 24kHz 16비트 소리 0.1초. 이보다 짧은 버퍼를 확정하면 인식기가 빈 버퍼 오류를 냅니다. */
  minCommitBytes() {
    return Math.round(this.vad.sampleRate * 0.1) * 2;
  }

  sendAppend(pcm) {
    if (!pcm || !pcm.length) return false;
    if (this.onAudio) this.onAudio(pcm);
    const sent = this.send({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
    if (!sent) return false;
    const chunk = Buffer.from(pcm);
    this.sinceCommit = this.sinceCommit && this.sinceCommit.length
      ? Buffer.concat([this.sinceCommit, chunk])
      : chunk;
    return true;
  }

  /**
   * 이번 발화에서 아직 인식기로 안 간 앞부분을 순서대로 붙입니다.
   * 이미 붙인 소리를 다시 붙이지 않습니다.
   */
  appendUnsent(snapshot) {
    if (!snapshot || !snapshot.length || !this.canStream()) return false;
    const sent = this.uttSent || 0;
    if (sent >= snapshot.length) return sent > 0;
    const rest = snapshot.subarray(sent);
    if (!this.sendAppend(rest)) return false;
    this.uttSent = sent + rest.length;
    return true;
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
      this.uttSent = 0;
    }
    const snapshot = evt.current || (evt.finished ? evt.utterance : null);
    if (snapshot && this.appendUnsent(snapshot)) this.streamed = true;
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
        if (audio && audio.length && this.appendUnsent(audio)) metered = true;
        if ((this.sinceCommit ? this.sinceCommit.length : 0) >= this.minCommitBytes()) {
          const text = await this.commitAndWait(8000);
          if (text && text.trim()) return text.trim();
        }
      } catch (err) {
        this.switchToFile(err.message || String(err));
      }
    }
    return this.postFile(audio, !metered);
  }

  commitAndWait(ms) {
    return new Promise((resolve, reject) => {
      if (!this.sinceCommit || this.sinceCommit.length < this.minCommitBytes()) {
        resolve("");
        return;
      }
      if (!this.send({ type: "input_audio_buffer.commit" })) {
        reject(new Error("음성 인식 소켓이 열려 있지 않습니다."));
        return;
      }
      this.sinceCommit = Buffer.alloc(0);
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
        const prompt = sttPrompt(this.churchName, this.sessionContext, this.spoken);
    const models = ["gpt-4o-mini-transcribe", "whisper-1"];
    let lastError = null;
    for (const model of models) {
      try {
        const form = new FormData();
        form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
        form.append("model", model);
        form.append("language", this.language);
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
    if (this.switching) {
      this.paused = true;
      return;
    }
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
