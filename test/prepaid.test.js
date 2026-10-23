const test = require("node:test");
const assert = require("node:assert/strict");
const cost = require("../broadcast/lib/cost");
const firebase = require("../broadcast/lib/firebase");
const { Engine } = require("../broadcast/lib/engine");

test("broadcast time pauses on stop and the next block is charged only while live", async () => {
  const original = { get: firebase.get, set: firebase.set, update: firebase.update };
  const sets = [];
  const updates = [];
  const local = {};
  let balance = 100000;
  let remotePrepaid = null;
  firebase.get = async (rel) => {
    if (String(rel).endsWith("/billing/balance")) return balance;
    if (String(rel).endsWith("/billing/prepaid")) return remotePrepaid;
    return null;
  };
  firebase.set = async (rel, value) => {
    sets.push([rel, value]);
    if (String(rel).endsWith("/billing/prepaid")) remotePrepaid = value;
  };
  firebase.update = async (rel, value) => {
    updates.push([rel, value]);
    if (value && Object.prototype.hasOwnProperty.call(value, "balance")) balance = value.balance;
    if (value && Object.prototype.hasOwnProperty.call(value, "prepaid/remainingSeconds")) {
      remotePrepaid = {
        remainingSeconds: value["prepaid/remainingSeconds"],
        languageKey: value["prepaid/languageKey"],
        kind: value["prepaid/kind"],
        amountKrw: value["prepaid/amountKrw"],
        extraCount: value["prepaid/extraCount"],
        updatedAt: value["prepaid/updatedAt"],
      };
    }
  };
  const engine = new Engine(() => {}, {
    readLocalPrepaid(id) { return local[id] || null; },
    writeLocalPrepaid(id, block) { local[id] = block; },
  });
  engine.church = { id: "grace-ab", accountUid: "operator" };
  try {
    engine.targets = ["en"];
    const opened = await engine.chargeOpening();
    assert.equal(opened.mode, "half");
    assert.equal(opened.charged, 5000);
    assert.equal(balance, 95000);
    const first = updates[0][1];
    assert.equal(first["prepaid/remainingSeconds"], 1800);
    assert.equal(first["prepaid/kind"], "half");
    assert.equal(first["prepaid/amountKrw"], 5000);
    assert.equal(first["ledger/" + first.lastEntryId].deltaKrw, -5000);
    assert.equal(local["grace-ab"].remainingSeconds, 1800);

    engine.targets = ["en"];
    remotePrepaid = {
      remainingSeconds: 900,
      languageKey: "en",
      kind: "half",
      amountKrw: 5000,
      extraCount: 0,
      updatedAt: Date.now(),
    };
    const again = await engine.chargeOpening();
    assert.equal(again.mode, "half");
    assert.equal(again.refundKrw, 2500);
    assert.equal(again.charged, 5000);
    assert.equal(balance, 92500);
    assert.equal(again.remainingSeconds, 1800);

    engine.running = true;
    engine.prepaid = cost.normalizePrepaid({
      remainingSeconds: 1800,
      languageKey: "en",
      kind: "half",
      amountKrw: 5000,
      extraCount: 0,
      updatedAt: Date.now(),
    });
    engine.prepaidBudget = 1800;
    engine.prepaidAnchor = Date.now() - 600000;
    engine.sessionCharge = { charged: 5000, balance, halfKrw: 5000, languages: ["en"] };
    await engine.stop();
    assert.equal(engine.prepaid.remainingSeconds, 0);
    assert.equal(balance, 92500 + 3333);
    assert.equal(engine.sessionCharge.charged, 5000 - 3333);

    const blocked = updates.length;
    await engine.chargeNextBlock();
    assert.equal(engine.running, false);
    assert.equal(updates.length, blocked);

    balance = 1000;
    remotePrepaid = null;
    delete local["grace-ab"];
    engine.church = { id: "grace-ab", accountUid: "operator" };
    engine.targets = ["en"];
    engine.prepaid = null;
    engine.channelRows = [];
    await assert.rejects(() => engine.chargeOpening(), /다음 30분/);
    assert.equal(balance, 1000);

    balance = 20000;
    engine.running = true;
    engine.pendingStopReason = "";
    engine.prepaid = cost.normalizePrepaid({
      remainingSeconds: 20,
      languageKey: "en,zh-CN",
      kind: "half",
      amountKrw: 6000,
      updatedAt: 1,
    });
    engine.prepaidBudget = 0;
    engine.prepaidAnchor = Date.now();
    engine.sessionCharge = { charged: 0, balance, halfKrw: 6000, languages: ["en", "zh-CN"] };
    engine.channelRows = [{ on: true, spoken: "ko" }];
    await engine.chargeNextBlock();
    assert.equal(balance, 14000);
    assert.equal(engine.prepaid.remainingSeconds, 1800);
    assert.equal(engine.prepaid.kind, "half");
    assert.equal(engine.sessionCharge.charged, 6000);
    assert.equal(engine.pendingStopReason, "");

    balance = 1000;
    engine.running = true;
    engine.prepaid = cost.normalizePrepaid({
      remainingSeconds: 10,
      languageKey: "en",
      kind: "half",
      amountKrw: 5000,
      updatedAt: 2,
    });
    engine.prepaidBudget = 0;
    engine.prepaidAnchor = Date.now();
    const beforeShort = updates.length;
    await engine.chargeNextBlock();
    assert.equal(updates.length, beforeShort);
    assert.equal(balance, 1000);
    assert.equal(engine.prepaid.remainingSeconds, 0);
    assert.match(engine.pendingStopReason, /다음 30분/);
    assert.match(engine.pendingStopReason, /방송을 종료합니다/);

    engine.running = true;
    engine.pendingStopReason = "";
    engine.prepaid = cost.normalizePrepaid({
      remainingSeconds: 400,
      languageKey: "en",
      kind: "hour",
      amountKrw: 15000,
      updatedAt: 3,
    });
    await assert.rejects(
      () => engine.setTargets("grace-ab", ["en", "ja"]),
      /방송 중에는 아직 포함되지 않은 언어를 더할 수 없습니다/,
    );
    assert.deepEqual(engine.targets, ["en"]);
  } finally {
    firebase.get = original.get;
    firebase.set = original.set;
    firebase.update = original.update;
  }
});
