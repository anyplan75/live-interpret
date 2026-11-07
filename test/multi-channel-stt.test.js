const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { readSource } = require("./read-source");
const path = require("path");
const { InputCapture } = require("../broadcast/lib/audio");
const { Engine, normalizeChannelRows } = require("../broadcast/lib/engine");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("audio plans keep enough channels for the selected mic indexes", () => {
  const capture = new InputCapture();
  const device = { inputChannels: 8 };
  const plans = capture._plans(device, { mode: "all", nChannels: 8, minChannels: 3 });
  assert.equal(plans[0].mode, "all");
  assert.equal(plans[0].nChannels, 8);
  assert.ok(plans.some((plan) => plan.mode === "all" && plan.nChannels === 3));
  assert.equal(plans.some((plan) => plan.mode === "all" && plan.nChannels === 2), false);
  assert.equal(plans.some((plan) => plan.mode === "single"), false);
});

test("normalize keeps every selected mic on so start opens those sessions", () => {
  const rows = normalizeChannelRows([
    { spoken: "ko", on: true, name: "강연", showName: true },
    { spoken: "en", on: true, name: "통역", showName: false },
    { spoken: "ko", on: false },
  ], 3, "ko");
  assert.equal(rows[0].on, true);
  assert.equal(rows[1].on, true);
  assert.equal(rows[1].showName, false);
  assert.equal(rows[2].on, false);
});

test("device pcm feeds every open mic session when capture is multi-channel", () => {
  const engine = Object.create(Engine.prototype);
  const fed = new Map();
  engine.channelSessions = new Map([
    [0, { source: "device", captionLive: true, speech: { push(buf) { fed.set(0, (fed.get(0) || 0) + buf.length); } } }],
    [1, { source: "device", captionLive: true, speech: { push(buf) { fed.set(1, (fed.get(1) || 0) + buf.length); } } }],
    [2, { source: "phone", captionLive: true, speech: { push() { throw new Error("phone should not take device pcm"); } } }],
  ]);
  engine.speech = null;
  engine.lastLevelAt = Date.now();
  engine.emit = () => {};

  const interleaved = Buffer.alloc(6 * 2);
  interleaved.writeInt16LE(100, 0);
  interleaved.writeInt16LE(200, 2);
  interleaved.writeInt16LE(300, 4);
  interleaved.writeInt16LE(400, 6);
  interleaved.writeInt16LE(500, 8);
  interleaved.writeInt16LE(600, 10);
  engine._onPcm(interleaved, {
    sampleRate: 24000,
    nChannels: 3,
    mode: "all",
    selected: 0,
    deviceChannel: 0,
    deviceChannels: 3,
  });
  assert.ok(fed.get(0) > 0);
  assert.ok(fed.get(1) > 0);
  assert.equal(fed.has(2), false);
});

test("ensureCaptureForIndex reopens when only channel 1 was open", () => {
  const engine = Object.create(Engine.prototype);
  const calls = [];
  engine.device = { inputChannels: 4, key: "dev", name: "인터페이스" };
  engine.capture = {
    snapshot() { return { mode: "single", openedChannels: 1 }; },
    ensureChannels(count, hooks) {
      calls.push({ count, hasPcm: !!(hooks && hooks.onPcm) });
      return { mode: "all", openedChannels: count, deviceChannels: 4 };
    },
  };
  const events = [];
  engine.emit = (event) => events.push(event);
  engine._onPcm = () => {};
  engine._onAudioStreamError = () => {};

  const snap = Engine.prototype.ensureCaptureForIndex.call(engine, 1);
  assert.deepEqual(calls, [{ count: 2, hasPcm: true }]);
  assert.equal(snap.mode, "all");
  assert.equal(snap.openedChannels, 2);
  assert.equal(events.some((event) => event.type === "audio"), true);
});

test("name display off clears the device speaker for that channel", () => {
  const engine = Object.create(Engine.prototype);
  engine.showPreacherName = true;
  engine.preacherName = "강연자";
  assert.equal(Engine.prototype.deviceSpeaker.call(engine, { source: "device", name: "사회", showName: true }, 1), "사회");
  assert.equal(Engine.prototype.deviceSpeaker.call(engine, { source: "device", name: "사회", showName: false }, 1), "");
  assert.equal(Engine.prototype.deviceSpeaker.call(engine, { source: "device", name: "", showName: true }, 0), "강연자");
  assert.equal(Engine.prototype.deviceSpeaker.call(engine, { source: "device", name: "", showName: false }, 0), "");
});

test("desk desired live turns mic channels on for recognition", () => {
  const main = readSource("broadcast/main.js");
  assert.match(main, /wantOn = action\.live !== false/);
  assert.match(main, /setChannelOn\(roomChurchId, index, wantOn\)/);
  assert.match(main, /channelRows\[index\]\.on = wantOn/);
  assert.match(main, /live: !!row\.on && row\.captionLive !== false/);
  assert.match(readSource("broadcast/lib/engine.js"), /ensureCaptureForIndex/);
  assert.match(read("broadcast/lib/audio.js"), /ensureChannels/);
});
