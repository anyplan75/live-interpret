const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  normalizeSlideText,
  similarity,
  CaptionSourceGate,
  cleanMode,
  createLocalBridge,
  createMockSlideGenerator,
  createProPresenterClient,
  DEFAULT_MODE,
} = require("../broadcast/lib/propresenter");
const { createSubtitleBoard } = require("../broadcast/lib/subtitle-board");
const room = require("../broadcast/lib/room-sync");

test("normalize strips section labels and collapses space", () => {
  const raw = "[Verse 1]\n  주님을   찬양합니다  \n\n[Chorus]\n할렐루야";
  assert.equal(normalizeSlideText(raw), "주님을 찬양합니다 할렐루야");
  assert.equal(normalizeSlideText(raw, { stripLabels: false }).includes("[Verse"), true);
});

test("similarity treats near-duplicate PP and STT as same", () => {
  assert.ok(similarity("주님을 찬양합니다", "주님을 찬양합니다.") >= 0.9);
  assert.ok(similarity("완전 다른 문장", "주님을 찬양합니다") < 0.5);
});

test("cleanMode maps hybrid_auto to hybrid_pp_priority", () => {
  assert.equal(cleanMode("hybrid_auto"), "hybrid_pp_priority");
  assert.equal(cleanMode("nope"), DEFAULT_MODE);
});

test("pp_priority holds similar STT after a slide", () => {
  let now = 1000;
  const gate = new CaptionSourceGate({ mode: "pp_priority", holdMs: 4000, now: () => now });
  assert.equal(gate.admitPp("주님을 찬양합니다", { at: now }).accept, true);
  now = 2000;
  assert.equal(gate.admitStt("주님을 찬양합니다", { isFinal: true, at: now }).accept, false);
  now = 6000;
  assert.equal(gate.admitStt("다음 설교 말씀입니다", { isFinal: true, at: now }).accept, true);
});

test("mic_priority blocks PP while mic is speaking", () => {
  let now = 1000;
  const gate = new CaptionSourceGate({ mode: "mic_priority", now: () => now });
  assert.equal(gate.admitStt("말씀 드리면", { isFinal: false, at: now }).accept, true);
  now = 1500;
  assert.equal(gate.admitPp("슬라이드 글", { at: now }).accept, false);
  now = 5000;
  assert.equal(gate.admitPp("슬라이드 글", { at: now }).accept, true);
});

test("hybrid_pp_priority hands off to STT after grace", () => {
  let now = 1000;
  const gate = new CaptionSourceGate({ mode: "hybrid_pp_priority", graceMs: 5000, now: () => now });
  assert.equal(gate.admitPp("첫 슬라이드 본문입니다", { at: now }).accept, true);
  now = 2000;
  // 유예 안에서는 같은·유사 STT를 막습니다(중복 또는 hybrid_grace).
  const blocked = gate.admitStt("첫 슬라이드 본문입니다", { isFinal: true, at: now });
  assert.equal(blocked.accept, false);
  assert.ok(["hybrid_grace", "dedup_pp"].includes(blocked.reason));
  now = 7000;
  assert.equal(gate.admitStt("이어서 말씀드립니다", { isFinal: true, at: now }).accept, true);
  assert.equal(gate.lead, "stt");
});

test("dedup skips PP that matches recent STT", () => {
  let now = 1000;
  const gate = new CaptionSourceGate({ mode: "hybrid_pp_priority", dedupMs: 3000, now: () => now });
  assert.equal(gate.admitStt("동일한 문장입니다", { isFinal: true, at: now }).accept, true);
  now = 1500;
  assert.equal(gate.admitPp("동일한 문장입니다", { at: now }).reason, "dedup_stt");
});

test("sequence guard rejects older applied ids", () => {
  const gate = new CaptionSourceGate({});
  const first = gate.nextSeq();
  const second = gate.nextSeq();
  gate.markApplied(second);
  assert.equal(gate.shouldApply(first), false);
  assert.equal(gate.shouldApply(second), true);
});

test("subtitle board keeps newer final over older final", () => {
  const board = createSubtitleBoard();
  board.merge({ ko: { text: "새 자막", id: 2, isFinal: true, at: 2000 } });
  const out = board.merge({ ko: { text: "늦은 자막", id: 1, isFinal: true, at: 1000 } });
  assert.equal(out.ko.text, "새 자막");
});

test("desired carries captionSourceMode into engine actions", () => {
  const desired = room.withRev(null, {
    running: false,
    spoken: "ko",
    targets: ["en"],
    captionSourceMode: "hybrid_auto",
    ppHoldSec: 4,
    ppHybridGraceSec: 5,
    ppStripLabels: true,
  });
  assert.equal(desired.captionSourceMode, "hybrid_pp_priority");
  const plan = room.actionsFor(0, desired);
  const caption = plan.actions.find((item) => item.type === "captionSource");
  assert.ok(caption);
  assert.equal(caption.captionSourceMode, "hybrid_pp_priority");
  assert.equal(caption.ppHoldSec, 4);
});

test("ProPresenter native client stays todo without guessing endpoints", async () => {
  const client = createProPresenterClient({
    httpUrl: "http://127.0.0.1:9",
    wsUrl: "ws://127.0.0.1:9",
  });
  const snap = await client.start();
  assert.equal(snap.status, "todo");
  assert.equal(snap.nativeApi, "todo");
  await client.stop();
});

test("local bridge accepts slide POST and mock emits events", async () => {
  const received = [];
  const bridge = createLocalBridge({
    port: 0,
    onSlide: (slide) => received.push(slide),
  });
  // port 0 → disabled; inject still works for unit path
  assert.equal(bridge.snapshot().enabled, false);
  bridge.inject({ text: "브릿지 주입", at: 1 });
  assert.equal(received[0].text, "브릿지 주입");

  const mockSlides = [];
  const mock = createMockSlideGenerator({
    slides: ["[Verse]\n목업 한 줄"],
    intervalMs: 10000,
    onSlide: (slide) => mockSlides.push(slide),
  });
  mock.once("[Chorus]\n목업 코러스");
  assert.equal(mockSlides.length, 1);
  assert.match(mockSlides[0].text, /목업 코러스/);
  mock.stop();
});

test("local bridge HTTP /slide round-trip", async () => {
  const received = [];
  // 고정 포트 대신 빈 포트 찾기
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const bridge = createLocalBridge({
    port,
    onSlide: (slide) => received.push(slide),
  });
  await bridge.start();
  try {
    const body = JSON.stringify({ type: "slide", text: "HTTP 슬라이드", at: 42 });
    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/slide",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
    assert.equal(result.status, 200);
    assert.equal(received[0].text, "HTTP 슬라이드");
  } finally {
    await bridge.stop();
  }
});
