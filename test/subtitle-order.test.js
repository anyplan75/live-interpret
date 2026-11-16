const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleBoard, createSubtitleSender } = require("../broadcast/lib/subtitle-board");
const { mixChannels } = require("../broadcast/lib/audio-util");
const { entries } = require("../docs/js/speaker-lines");
const roomSync = require("../docs/js/room-sync");
const { Engine } = require("../broadcast/lib/engine");

test("a late live caption does not replace the final line of the same sentence", () => {
  const board = createSubtitleBoard();
  board.merge({ ko: { text: "확정 문장", id: 7, isFinal: true, at: 100, channelKey: "d0" } });
  const out = board.merge({ ko: { text: "확정 문", id: 7, isFinal: false, at: 100, channelKey: "d0" } });
  assert.equal(out.ko.text, "확정 문장");
  assert.equal(out.ko.isFinal, true);
});

test("multi-mic lines carry when each sentence started and list in spoken order", () => {
  const board = createSubtitleBoard();
  board.merge({ ko: { text: "둘째", id: 2, isFinal: true, at: 200, channelKey: "d1", name: "B" } });
  const out = board.merge({ ko: { text: "첫째", id: 1, isFinal: true, at: 100, channelKey: "d0", name: "A" } });
  assert.equal(out.ko.lines.d0.at, 100);
  assert.equal(out.ko.text, "둘째");
  assert.deepEqual(entries(out.ko).map((line) => line.text), ["첫째", "둘째"]);
});

test("subtitle writes go out one at a time and merge while one is in flight", async () => {
  const writes = [];
  let release;
  const sender = createSubtitleSender((body) => {
    writes.push(body);
    if (writes.length === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve();
  });
  const first = sender({ _timestamp: 1, ko: { text: "a" } });
  const second = sender({ _timestamp: 2, ko: { text: "b" } });
  const third = sender({ _timestamp: 3, en: { text: "c" } });
  assert.equal(writes.length, 1);
  release();
  await Promise.all([first, second, third]);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], { _timestamp: 3, ko: { text: "b" }, en: { text: "c" } });
});

test("a failed subtitle write rejects only the callers in that write", async () => {
  let calls = 0;
  const sender = createSubtitleSender(() => (++calls === 1 ? Promise.reject(new Error("net")) : Promise.resolve()));
  await assert.rejects(sender({ ko: { text: "a" } }), /net/);
  await sender({ ko: { text: "b" } });
  assert.equal(calls, 2);
});

test("two stereo channels mix into one averaged channel", () => {
  const buf = Buffer.alloc(8);
  buf.writeInt16LE(1000, 0);
  buf.writeInt16LE(3000, 2);
  buf.writeInt16LE(32767, 4);
  buf.writeInt16LE(32767, 6);
  const out = mixChannels(buf, 2, 0, 1);
  assert.equal(out.length, 4);
  assert.equal(out.readInt16LE(0), 2000);
  assert.equal(out.readInt16LE(2), 32767);
});

test("desk input keeps the stereo mix choice only on mic rows", () => {
  const actions = roomSync.actionsFor(0, {
    rev: 1,
    inputs: [{ key: "c:0", live: true, mix: true }, { key: "p:ABCDEF", live: true, mix: true }],
  }).actions.filter((action) => action.type === "input");
  const mic = actions.find((action) => action.key === "c:0");
  const phone = actions.find((action) => action.key === "p:ABCDEF");
  assert.equal(mic.mix, true);
  assert.equal(Object.prototype.hasOwnProperty.call(phone, "mix"), false);
});

test("mixing a channel turns the next channel off so speech is not recognized twice", async () => {
  const engine = new Engine();
  engine.channelRows = [
    { spoken: "ko", on: true, source: "device" },
    { spoken: "ko", on: true, source: "device" },
  ];
  engine.emitPhones = () => {};
  const result = await engine.setChannelMix(null, 0, true);
  assert.deepEqual(result, { index: 0, mix: true });
  assert.equal(engine.channelRows[1].on, false);
  assert.equal(engine.publicChannels()[0].mix, true);
  const off = await engine.setChannelMix(null, 0, false);
  assert.equal(off.mix, false);
});
