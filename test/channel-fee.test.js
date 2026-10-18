const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cost = require("../broadcast/lib/cost");
const catalog = require("../docs/js/catalog");
const { Engine, normalizeChannelRows } = require("../broadcast/lib/engine");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("same-language extra channels cost 5000 and a new input language costs 10000 once", () => {
  assert.equal(cost.HOUR_BASE_KRW, 15000);
  assert.equal(cost.EXTRA_LANG_HOUR_KRW, 5000);
  assert.equal(cost.EXTRA_CHANNEL_KRW, 10000);
  assert.equal(cost.SAME_LANGUAGE_CHANNEL_KRW, 5000);
  assert.equal(cost.halfBlockKrw(["en"]), 7500);
  assert.equal(cost.packageKrw({ minutes: 60, languages: ["en"] }), 15000);
  assert.equal(cost.packageKrw({ minutes: 90, languages: ["en"] }), 22500);
  assert.deepEqual(cost.extraChannelIndexes([0, 1, 1, -1, 2]), [1, 2]);

  const none = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [{ index: 0, spoken: "ko" }],
  });
  assert.equal(none.charged, 0);
  assert.deepEqual(none.started, []);

  const twoKorean = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [{ index: 1, spoken: "ko" }],
  });
  assert.equal(twoKorean.charged, 5000);
  assert.deepEqual(twoKorean.started, [1]);
  assert.equal(twoKorean.balance, 45000);

  const koreanEnglish = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [{ index: 1, spoken: "en" }],
  });
  assert.equal(koreanEnglish.charged, 10000);
  assert.equal(koreanEnglish.balance, 40000);

  const threeKorean = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [
      { index: 1, spoken: "ko" },
      { index: 2, spoken: "ko" },
    ],
  });
  assert.equal(threeKorean.charged, 10000);
  assert.deepEqual(threeKorean.started, [1, 2]);

  const englishThenKorean = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [
      { index: 1, spoken: "en" },
      { index: 2, spoken: "ko" },
    ],
  });
  assert.equal(englishThenKorean.charged, 15000);

  const twoNewEnglish = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [
      { index: 1, spoken: "en" },
      { index: 2, spoken: "en" },
    ],
  });
  assert.equal(twoNewEnglish.charged, 15000);

  const alreadyPaid = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [{ index: 1, spoken: "en" }],
    paidRows: [{ index: 1, spoken: "en" }],
  });
  assert.equal(alreadyPaid.charged, 0);
  assert.deepEqual(alreadyPaid.started, [1]);

  const paidLanguageThenSame = cost.channelFeePlan({
    balance: 50000,
    baseSpoken: "ko",
    rows: [
      { index: 1, spoken: "en" },
      { index: 2, spoken: "en" },
    ],
    paidRows: [{ index: 1, spoken: "en" }],
  });
  assert.equal(paidLanguageThenSame.charged, 5000);
  assert.deepEqual(paidLanguageThenSame.started, [1, 2]);

  const partial = cost.channelFeePlan({
    balance: 15000,
    baseSpoken: "ko",
    rows: [
      { index: 1, spoken: "en" },
      { index: 2, spoken: "ja" },
    ],
  });
  assert.equal(partial.charged, 10000);
  assert.deepEqual(partial.started, [1]);
  assert.deepEqual(partial.blocked, [2]);

  const half = cost.openHalfBlock({ balance: 100000, languages: ["en"] });
  assert.equal(half.charged, 7500);
  assert.equal(half.halfKrw, 7500);
});

test("a channel spoken language is not billed again as an output", () => {
  assert.deepEqual(catalog.translationTargets(["en", "ja", "zh-CN"], ["ko", "ja"]), ["en", "zh-CN"]);
  assert.equal(cost.packageKrw({
    minutes: 60,
    languages: catalog.translationTargets(["en", "ja", "zh-CN"], ["ko", "ja"]),
  }), 20000);
});

test("channel pickers follow the device input count", () => {
  const audio = read("broadcast/lib/audio.js");
  const renderer = read("broadcast/renderer/renderer.js");
  const html = read("broadcast/renderer/index.html");
  assert.match(audio, /deviceChannels: this\.device\.inputChannels/);
  assert.match(renderer, /renderChannels\(state\.audio\.deviceChannels\)/);
  assert.match(renderer, /channel-spoken/);
  assert.match(renderer, /channel-name/);
  assert.match(renderer, /setChannelSpoken/);
  assert.match(renderer, /setChannelOn/);
  assert.match(renderer, /setChannelName/);
  assert.match(renderer, /setShowChannelNames/);
  assert.match(renderer, /name: cleanChannelName\(row\.name\)/);
  assert.match(html, /자막에 입력 채널 이름 표시/);
  assert.match(html, /id="showChannelNames"[^>]*checked/);
  const prefix = renderer.slice(renderer.indexOf("function channelPrefix"), renderer.indexOf("function channelPrefix") + 700);
  assert.match(prefix, /showChannelNames === false/);
  assert.doesNotMatch(prefix, /채널 \$\{index \+ 1\}/);
});

test("a device channel keeps its name and the subtitle toggle can hide it", () => {
  const rows = normalizeChannelRows([
    { spoken: "ko", on: true, name: "  강단  " },
    { spoken: "ko", on: true, name: "성가대" },
  ], 2, "ko");
  assert.equal(rows[0].source, "device");
  assert.equal(rows[0].name, "강단");
  assert.equal(rows[1].name, "성가대");

  const engine = new Engine(() => {});
  engine.channelRows = rows;
  engine.channelSessions = new Map([[0, { pipeline: { speaker: "이전" }, name: "이전" }]]);
  assert.equal(engine.subtitleName(rows[0]), "강단");
  assert.equal(engine.setShowChannelNames(false), false);
  assert.equal(engine.subtitleName(rows[0]), "");
  assert.equal(engine.channelSessions.get(0).pipeline.speaker, "");
  assert.equal(engine.setChannelName(1, "  옆 마이크  "), "옆 마이크");
  assert.equal(engine.setShowChannelNames(true), true);
  assert.equal(engine.subtitleName(rows[1]), "옆 마이크");
  assert.equal(engine.subtitleName({ name: "" }), "");
});

test("a second Korean channel charges 5000 once for that broadcast", async () => {
  const engine = new Engine(() => {});
  engine.running = true;
  engine.church = { id: "grace-ab", accountUid: "user" };
  engine.sessionCharge = { charged: 15000, balance: 20000 };
  engine.outputs = ["en"];
  engine.channelRows = [
    { spoken: "ko", on: true, name: "강단" },
    { spoken: "ko", on: false, name: "성가대" },
  ];
  engine.paidChannels = new Set();
  engine.openChannel = async () => {};
  engine.writeBilling = async (_id, balance) => {
    engine.sessionCharge.balance = balance;
  };
  const started = await engine.setChannelOn("", 1, true);
  assert.equal(started.on, true);
  assert.equal(engine.sessionCharge.charged, 20000);
  assert.equal(engine.sessionCharge.balance, 15000);
  await engine.setChannelOn("", 1, false);
  await engine.setChannelOn("", 1, true);
  assert.equal(engine.sessionCharge.charged, 20000);
});

test("turning a channel on charges once, off does not refund, and a short balance blocks that channel", async () => {
  const engine = new Engine(() => {});
  engine.running = true;
  engine.church = { id: "grace-ab", accountUid: "user" };
  engine.sessionCharge = { charged: 15000, balance: 15000 };
  engine.outputs = ["en"];
  engine.channelRows = [
    { spoken: "ko", on: true },
    { spoken: "en", on: false },
    { spoken: "ja", on: false },
  ];
  engine.paidChannels = new Set();
  const opened = [];
  engine.openChannel = async (index) => { opened.push(index); };
  engine.closeChannel = async (index) => { opened.push(["off", index]); };
  engine.writeBilling = async (_id, balance) => {
    engine.sessionCharge.balance = balance;
    return null;
  };

  const started = await engine.setChannelOn("", 1, true);
  assert.equal(started.on, true);
  assert.equal(started.blocked, undefined);
  assert.equal(engine.sessionCharge.charged, 25000);
  assert.equal(engine.sessionCharge.balance, 5000);
  assert.deepEqual(opened, [1]);

  await engine.setChannelOn("", 1, false);
  assert.equal(engine.sessionCharge.charged, 25000);
  assert.equal(engine.sessionCharge.balance, 5000);

  await engine.setChannelOn("", 1, true);
  assert.equal(engine.sessionCharge.charged, 25000);
  assert.deepEqual(opened.filter((item) => item === 1).length, 2);

  const blocked = await engine.setChannelOn("", 2, true);
  assert.equal(blocked.on, false);
  assert.equal(blocked.blocked, true);
  assert.match(blocked.message, /채널 3/);
  assert.equal(engine.channelRows[0].on, true);
  assert.equal(engine.sessionCharge.charged, 25000);

  const before = engine.sessionCharge.charged;
  const calls = [];
  engine.speech = { async setLanguage(code) { calls.push(code); } };
  engine.pipeline = { setSourceLang(code) { calls.push(["src", code]); } };
  await engine.setChannelSpoken("", 0, "ja");
  assert.equal(engine.sessionCharge.charged, before);
  assert.equal(engine.prepaid, null);
  assert.ok(calls.includes("ja"));
});
