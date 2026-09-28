const { rmsInt16 } = require("./audio-util");

function concat(chunks) {
  if (!chunks.length) return Buffer.alloc(0);
  if (chunks.length === 1) return Buffer.from(chunks[0]);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function trimTail(buffer, maxSamples) {
  const maxBytes = Math.max(0, maxSamples) * 2;
  if (buffer.length <= maxBytes) return Buffer.from(buffer);
  return Buffer.from(buffer.subarray(buffer.length - maxBytes));
}

/**
 * 에너지 기반 발화 검출.
 * 말이 끝난 뒤 silenceMs 만큼 조용하면 그 구간 PCM을 돌려줍니다.
 */
class UtteranceVad {
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate || 24000;
    this.threshold = opts.threshold == null ? 0.016 : opts.threshold;
    this.silenceLimit = Math.round((this.sampleRate * (opts.silenceMs == null ? 700 : opts.silenceMs)) / 1000);
    this.preRollSamples = Math.round((this.sampleRate * (opts.preRollMs == null ? 300 : opts.preRollMs)) / 1000);
    this.minSpeechSamples = Math.round((this.sampleRate * (opts.minSpeechMs == null ? 250 : opts.minSpeechMs)) / 1000);
    this.reset();
  }

  setThreshold(threshold) {
    if (typeof threshold === "number" && threshold > 0) this.threshold = threshold;
  }

  reset() {
    this.preRoll = Buffer.alloc(0);
    this.chunks = [];
    this.collecting = false;
    this.speechSamples = 0;
    this.silenceRun = 0;
  }

  push(pcm) {
    const buffer = Buffer.from(pcm);
    const samples = buffer.length >> 1;
    if (!samples) return { speaking: this.collecting, append: null, finished: false, utterance: null };
    const loud = rmsInt16(buffer) >= this.threshold;

    if (!this.collecting) {
      if (!loud) {
        this.preRoll = trimTail(Buffer.concat([this.preRoll, buffer]), this.preRollSamples);
        return { speaking: false, append: null, finished: false, utterance: null, started: false };
      }
      this.collecting = true;
      this.chunks = [];
      if (this.preRoll.length) this.chunks.push(this.preRoll);
      this.chunks.push(buffer);
      this.speechSamples = samples;
      this.silenceRun = 0;
      const append = concat(this.chunks);
      this.preRoll = Buffer.alloc(0);
      return {
        speaking: true,
        started: true,
        append,
        finished: false,
        utterance: null,
        current: concat(this.chunks),
      };
    }

    this.chunks.push(buffer);
    if (loud) {
      this.speechSamples += samples;
      this.silenceRun = 0;
    } else {
      this.silenceRun += samples;
    }

    if (this.silenceRun >= this.silenceLimit) {
      const enough = this.speechSamples >= this.minSpeechSamples;
      const utterance = enough ? concat(this.chunks) : null;
      this.reset();
      return {
        speaking: false,
        started: false,
        append: enough ? buffer : null,
        finished: enough,
        utterance,
        current: null,
      };
    }

    return {
      speaking: true,
      started: false,
      append: buffer,
      finished: false,
      utterance: null,
      current: concat(this.chunks),
    };
  }

  flush() {
    if (!this.collecting || this.speechSamples < this.minSpeechSamples) {
      this.reset();
      return null;
    }
    const utterance = concat(this.chunks);
    this.reset();
    return utterance;
  }
}

module.exports = { UtteranceVad };
