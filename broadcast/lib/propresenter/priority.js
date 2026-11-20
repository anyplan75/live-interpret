/**
 * STT와 ProPresenter 슬라이드 자막의 우선순위·중복·시퀀스 가드.
 *
 * 모드 키(내부):
 * - pp_priority: 슬라이드 직후 holdMs 동안 유사 STT 무시
 * - mic_priority: 진행 중 발화가 있으면 슬라이드가 끊지 않음
 * - hybrid_pp_priority (기본, hybrid_auto 동의어): 새 슬라이드 후 graceMs 동안 PP 우선 → 이후 STT가 이어지면 STT로 이양
 */

const { fingerprint, similarity } = require("./normalize");

const MODES = ["pp_priority", "mic_priority", "hybrid_pp_priority"];
const DEFAULT_MODE = "hybrid_pp_priority";
const DEFAULT_HOLD_MS = 4000;
const DEFAULT_GRACE_MS = 5000;
const DEFAULT_DEDUP_MS = 3500;
const DEFAULT_SIMILAR = 0.82;
const MIC_ACTIVE_MS = 2200;

function cleanMode(value) {
  const raw = String(value || "").trim();
  if (raw === "hybrid_auto") return "hybrid_pp_priority";
  return MODES.includes(raw) ? raw : DEFAULT_MODE;
}

function cleanMs(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function CaptionSourceGate(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  this.mode = cleanMode(options.mode);
  this.holdMs = cleanMs(options.holdMs, DEFAULT_HOLD_MS, 500, 30000);
  this.graceMs = cleanMs(options.graceMs, DEFAULT_GRACE_MS, 500, 60000);
  this.dedupMs = cleanMs(options.dedupMs, DEFAULT_DEDUP_MS, 200, 20000);
  this.similar = Number.isFinite(Number(options.similar))
    ? Math.min(1, Math.max(0.5, Number(options.similar)))
    : DEFAULT_SIMILAR;
  this.stripLabels = options.stripLabels !== false;
  this.now = typeof options.now === "function" ? options.now : () => Date.now();

  this.lead = "stt";
  this.lastPp = { text: "", at: 0, fp: "" };
  this.lastStt = { text: "", at: 0, fp: "", speaking: false };
  this.seq = 0;
  this.appliedSeq = 0;
}

CaptionSourceGate.prototype.setMode = function setMode(mode) {
  this.mode = cleanMode(mode);
  return this.mode;
};

CaptionSourceGate.prototype.setOptions = function setOptions(patch) {
  const src = patch && typeof patch === "object" ? patch : {};
  if (Object.prototype.hasOwnProperty.call(src, "mode")) this.setMode(src.mode);
  if (Object.prototype.hasOwnProperty.call(src, "holdMs")) {
    this.holdMs = cleanMs(src.holdMs, this.holdMs, 500, 30000);
  }
  if (Object.prototype.hasOwnProperty.call(src, "graceMs")) {
    this.graceMs = cleanMs(src.graceMs, this.graceMs, 500, 60000);
  }
  if (Object.prototype.hasOwnProperty.call(src, "dedupMs")) {
    this.dedupMs = cleanMs(src.dedupMs, this.dedupMs, 200, 20000);
  }
  if (Object.prototype.hasOwnProperty.call(src, "stripLabels")) {
    this.stripLabels = src.stripLabels !== false;
  }
  return this.snapshot();
};

CaptionSourceGate.prototype.snapshot = function snapshot() {
  return {
    mode: this.mode,
    holdMs: this.holdMs,
    graceMs: this.graceMs,
    dedupMs: this.dedupMs,
    stripLabels: this.stripLabels,
    lead: this.lead,
    seq: this.seq,
    appliedSeq: this.appliedSeq,
  };
};

CaptionSourceGate.prototype.nextSeq = function nextSeq() {
  this.seq += 1;
  return this.seq;
};

/** 번역·자막 반영 전에 호출. 더 새 시퀀스가 이미 반영됐으면 false. */
CaptionSourceGate.prototype.shouldApply = function shouldApply(seq) {
  const id = Math.round(Number(seq) || 0);
  if (!id) return true;
  return id >= this.appliedSeq;
};

CaptionSourceGate.prototype.markApplied = function markApplied(seq) {
  const id = Math.round(Number(seq) || 0);
  if (id > this.appliedSeq) this.appliedSeq = id;
};

CaptionSourceGate.prototype._nearDup = function nearDup(text, against, windowMs, at) {
  if (!against || !against.fp || !against.at) return false;
  if (at - against.at > windowMs) return false;
  const score = similarity(text, against.text);
  if (score >= this.similar) return true;
  const fp = fingerprint(text);
  return !!fp && fp === against.fp;
};

CaptionSourceGate.prototype._micActive = function micActive(at) {
  if (!this.lastStt.speaking) return false;
  return at - this.lastStt.at <= MIC_ACTIVE_MS;
};

/**
 * STT 조각 수락 여부.
 * @returns {{ accept: boolean, reason: string, seq?: number }}
 */
CaptionSourceGate.prototype.admitStt = function admitStt(text, meta) {
  const body = String(text || "").trim();
  const info = meta && typeof meta === "object" ? meta : {};
  const at = Number(info.at) || this.now();
  const isFinal = info.isFinal !== false;

  if (!body) return { accept: false, reason: "empty" };

  if (this._nearDup(body, this.lastPp, this.dedupMs, at)) {
    return { accept: false, reason: "dedup_pp" };
  }

  if (this.mode === "pp_priority") {
    if (this.lastPp.at && at - this.lastPp.at <= this.holdMs) {
      if (similarity(body, this.lastPp.text) >= this.similar * 0.9) {
        return { accept: false, reason: "pp_hold" };
      }
    }
  }

  if (this.mode === "hybrid_pp_priority") {
    if (this.lead === "pp" && this.lastPp.at && at - this.lastPp.at <= this.graceMs) {
      if (similarity(body, this.lastPp.text) >= this.similar * 0.85) {
        return { accept: false, reason: "hybrid_grace" };
      }
    }
    if (this.lead === "pp" && this.lastPp.at && at - this.lastPp.at > this.graceMs) {
      this.lead = "stt";
    }
  }

  this.lastStt = {
    text: body,
    at,
    fp: fingerprint(body),
    speaking: !isFinal,
  };
  if (isFinal) this.lead = "stt";
  const seq = this.nextSeq();
  return { accept: true, reason: "ok", seq };
};

/**
 * ProPresenter 슬라이드 수락 여부.
 * @returns {{ accept: boolean, reason: string, seq?: number }}
 */
CaptionSourceGate.prototype.admitPp = function admitPp(text, meta) {
  const body = String(text || "").trim();
  const info = meta && typeof meta === "object" ? meta : {};
  const at = Number(info.at) || this.now();

  if (!body) return { accept: false, reason: "empty" };

  if (this._nearDup(body, this.lastPp, this.dedupMs, at)) {
    return { accept: false, reason: "dedup_self" };
  }
  if (this._nearDup(body, this.lastStt, this.dedupMs, at)) {
    return { accept: false, reason: "dedup_stt" };
  }

  if (this.mode === "mic_priority" && this._micActive(at)) {
    return { accept: false, reason: "mic_busy" };
  }

  this.lastPp = { text: body, at, fp: fingerprint(body) };
  this.lead = "pp";
  const seq = this.nextSeq();
  return { accept: true, reason: "ok", seq };
};

module.exports = {
  CaptionSourceGate,
  cleanMode,
  MODES,
  DEFAULT_MODE,
  DEFAULT_HOLD_MS,
  DEFAULT_GRACE_MS,
};
