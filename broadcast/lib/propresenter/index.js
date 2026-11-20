/**
 * ProPresenter 자막 입력 허브.
 * 정규화 → 우선순위 게이트 → (선택) 로컬 브릿지 / 네이티브 클라이언트(TODO).
 */

const { normalizeSlideText } = require("./normalize");
const {
  CaptionSourceGate,
  cleanMode,
  DEFAULT_MODE,
  DEFAULT_HOLD_MS,
  DEFAULT_GRACE_MS,
} = require("./priority");
const { createProPresenterClient } = require("./client");
const { createLocalBridge } = require("./bridge");
const { createMockSlideGenerator } = require("./mock");

function createProPresenterHub(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const onCaption = typeof options.onCaption === "function" ? options.onCaption : () => {};
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  const gate = new CaptionSourceGate({
    mode: options.mode || DEFAULT_MODE,
    holdMs: options.holdMs,
    graceMs: options.graceMs,
    stripLabels: options.stripLabels,
  });
  const client = createProPresenterClient(options.client || {});
  let bridge = null;
  let mock = null;
  let started = false;

  function applySlide(raw) {
    const src = raw && typeof raw === "object" ? raw : { text: raw };
    const text = normalizeSlideText(src.text, { stripLabels: gate.stripLabels });
    if (!text) return { accept: false, reason: "empty" };
    const decision = gate.admitPp(text, { at: src.at });
    if (!decision.accept) {
      onLog(`PP 슬라이드 건너뜀(${decision.reason})`);
      return decision;
    }
    onCaption({
      text,
      at: Number(src.at) || Date.now(),
      seq: decision.seq,
      source: "pp",
      raw: String(src.text || ""),
    });
    return decision;
  }

  async function start() {
    if (started) return status();
    started = true;
    const native = await client.start();
    onLog(native.detail || `PP 네이티브: ${native.status}`);
    bridge = createLocalBridge({
      port: options.bridgePort,
      onSlide: (slide) => applySlide(slide),
      onLog,
    });
    await bridge.start();
    if (options.mock === true) {
      mock = createMockSlideGenerator({
        intervalMs: options.mockIntervalMs,
        slides: options.mockSlides,
        onSlide: (slide) => applySlide(slide),
      });
      mock.start();
      onLog("PP 목업 슬라이드 시작");
    }
    return status();
  }

  async function stop() {
    if (mock) mock.stop();
    mock = null;
    if (bridge) await bridge.stop();
    bridge = null;
    await client.stop();
    started = false;
    return status();
  }

  function setMode(mode) {
    return gate.setMode(mode);
  }

  function setOptions(patch) {
    return gate.setOptions(patch);
  }

  function admitStt(text, meta) {
    return gate.admitStt(text, meta);
  }

  function shouldApply(seq) {
    return gate.shouldApply(seq);
  }

  function markApplied(seq) {
    gate.markApplied(seq);
  }

  function injectSlide(payload) {
    if (bridge && typeof bridge.inject === "function") return applySlide(payload);
    return applySlide(payload);
  }

  function status() {
    return {
      started,
      mode: gate.mode,
      holdMs: gate.holdMs,
      graceMs: gate.graceMs,
      stripLabels: gate.stripLabels,
      lead: gate.lead,
      client: client.snapshot(),
      bridge: bridge ? bridge.snapshot() : { enabled: false, listening: false, port: 0 },
      mock: !!mock,
      gate: gate.snapshot(),
    };
  }

  return {
    start,
    stop,
    setMode,
    setOptions,
    admitStt,
    shouldApply,
    markApplied,
    injectSlide,
    applySlide,
    status,
    gate,
  };
}

module.exports = {
  createProPresenterHub,
  normalizeSlideText: require("./normalize").normalizeSlideText,
  similarity: require("./normalize").similarity,
  CaptionSourceGate,
  cleanMode,
  DEFAULT_MODE,
  DEFAULT_HOLD_MS,
  DEFAULT_GRACE_MS,
  createProPresenterClient,
  createLocalBridge,
  createMockSlideGenerator,
};
