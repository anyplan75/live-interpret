const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cost = require("../broadcast/lib/cost");
const catalog = require("../docs/js/catalog");
const { Engine } = require("../broadcast/lib/engine");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("an extra input is 3000 won per hour and does not charge on connect", () => {
  assert.equal(cost.HOUR_BASE_KRW, 10000);
  assert.equal(cost.EXTRA_LANG_HOUR_KRW, 2000);
  assert.equal(cost.EXTRA_INPUT_HOUR_KRW, 3000);
  assert.equal(cost.halfBlockKrw(["en"]), 5000);
  assert.equal(cost.halfBlockKrw(["en", "zh-CN"], 1), 7500);
  assert.equal(cost.packageKrw({ minutes: 60, languages: ["en"] }), 10000);
  assert.equal(cost.packageKrw({ minutes: 90, languages: ["en"] }), 15000);
  assert.deepEqual(cost.extraChannelIndexes([0, 1, 1, -1, 2]), [1, 2]);

  const none = cost.channelFeePlan({ balance: 50000, channels: [0], paid: [] });
  assert.equal(none.charged, 0);
  assert.deepEqual(none.started, []);

  const one = cost.channelFeePlan({ balance: 25000, channels: [1], paid: [] });
  assert.equal(one.charged, 0);
  assert.deepEqual(one.started, [1]);
  assert.equal(one.balance, 25000);

  const half = cost.openHalfBlock({ balance: 100000, languages: ["en"], extraInputs: 1 });
  assert.equal(half.charged, 6500);
  assert.equal(half.halfKrw, 6500);
  assert.equal(half.balance, 93500);
});

test("a channel spoken language is not billed again as an output", () => {
  assert.deepEqual(catalog.translationTargets(["en", "ja", "zh-CN"], ["ko", "ja"]), ["en", "zh-CN"]);
  assert.equal(cost.packageKrw({
    minutes: 60,
    languages: catalog.translationTargets(["en", "ja", "zh-CN"], ["ko", "ja"]),
  }), 12000);
});

test("channel pickers follow the device input count", () => {
  const audio = read("broadcast/lib/audio.js");
  const renderer = read("broadcast/renderer/renderer.js");
  assert.match(audio, /deviceChannels: this\.device\.inputChannels/);
  assert.match(renderer, /renderChannels\(state\.audio\.deviceChannels\)/);
  assert.match(renderer, /channel-spoken/);
  assert.match(renderer, /setChannelSpoken/);
  assert.match(renderer, /setChannelOn/);
});

test("turning a channel on does not take 10000, and a short balance blocks that channel", async () => {
  const engine = new Engine(() => {});
  engine.running = true;
  engine.church = { id: "grace-ab", accountUid: "user" };
  engine.sessionCharge = { charged: 5000, balance: 0 };
  engine.outputs = ["en"];
  engine.targets = ["en"];
  engine.channelRows = [
    { spoken: "ko", on: true },
    { spoken: "en", on: false },
    { spoken: "ja", on: false },
  ];
  engine.prepaid = cost.normalizePrepaid({
    remainingSeconds: 1800,
    languageKey: "en",
    kind: "half",
    amountKrw: 5000,
    extraCount: 0,
    updatedAt: 1,
  });
  const opened = [];
  engine.openChannel = async (index) => { opened.push(index); };
  engine.closeChannel = async (index) => { opened.push(["off", index]); };
  engine.writeBilling = async (_id, balance) => {
    engine.sessionCharge.balance = balance;
    return null;
  };

  const blocked = await engine.setChannelOn("", 1, true);
  assert.equal(blocked.on, false);
  assert.equal(blocked.blocked, true);
  assert.match(blocked.message, /채널 2/);
  assert.equal(engine.sessionCharge.charged, 5000);
  assert.equal(engine.sessionCharge.balance, 0);
  assert.deepEqual(opened, []);

  engine.sessionCharge.balance = 2000;
  const started = await engine.setChannelOn("", 1, true);
  assert.equal(started.on, true);
  assert.equal(started.blocked, undefined);
  assert.equal(engine.sessionCharge.balance, 500);
  assert.equal(engine.sessionCharge.charged, 6500);
  assert.deepEqual(opened, [1]);

  await engine.setChannelOn("", 1, false);
  assert.equal(engine.sessionCharge.charged, 6500);
  assert.equal(engine.sessionCharge.balance, 500);

  const calls = [];
  engine.speech = { async setLanguage(code) { calls.push(code); } };
  engine.pipeline = { setSourceLang(code) { calls.push(["src", code]); } };
  await engine.setChannelSpoken("", 0, "ja");
  assert.equal(engine.sessionCharge.charged, 6500);
  assert.ok(calls.includes("ja"));
});
