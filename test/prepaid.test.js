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
    assert.equal(opened.mode, "hour");
    assert.equal(opened.charged, 15000);
    assert.equal(balance, 85000);
    const first = updates[0][1];
    assert.equal(first["prepaid/remainingSeconds"], 3600);
    assert.equal(first["prepaid/kind"], "hour");
    assert.equal(first["prepaid/amountKrw"], 15000);
    assert.equal(first["ledger/" + first.lastEntryId].deltaKrw, -15000);
    assert.equal(local["grace-ab"].remainingSeconds, 3600);

    engine.targets = ["en"];
    remotePrepaid = {
      remainingSeconds: 2530,
      languageKey: "en",
      kind: "hour",
      amountKrw: 15000,
      extraCount: 0,
      updatedAt: Date.now(),
    };
    const resumed = await engine.chargeOpening();
    assert.equal(resumed.mode, "resume");
    assert.equal(resumed.charged, 0);
    assert.equal(resumed.noExtraCharge, true);
    assert.equal(balance, 85000);
    assert.equal(updates.length, 1);

    engine.targets = ["en", "zh-CN"];
    const added = await engine.chargeOpening();
    assert.equal(added.mode, "extra");
    assert.equal(added.charged, 5000);
    assert.equal(added.remainingSeconds, 2530);
    assert.equal(balance, 80000);
    const extra = updates.at(-1)[1];
    assert.equal(extra["prepaid/remainingSeconds"], 2530);
    assert.equal(extra["prepaid/kind"], "hour");
    assert.equal(extra["prepaid/extraCount"], 1);
    assert.match(extra["prepaid/languageKey"], /zh-CN/);

    engine.running = true;
    engine.prepaid = cost.normalizePrepaid(remotePrepaid);
    engine.prepaidBudget = 2530;
    engine.prepaidAnchor = Date.now() - 15000;
    const updatesBeforeStop = updates.length;
    await engine.stop();
    assert.equal(updates.length, updatesBeforeStop);
    assert.equal(engine.prepaid.kind, "hour");
    assert.ok(engine.prepaid.remainingSeconds < 2530);
    assert.ok(engine.prepaid.remainingSeconds > 2500);
    assert.equal(local["grace-ab"].remainingSeconds, engine.prepaid.remainingSeconds);
    assert.equal(sets.at(-1)[1].remainingSeconds, engine.prepaid.remainingSeconds);
    assert.match(sets.at(-1)[0], /billing\/prepaid$/);

    const blocked = updates.length;
    await engine.chargeNextBlock();
    assert.equal(engine.running, false);
    assert.equal(updates.length, blocked);

    balance = 1000;
    remotePrepaid = null;
    delete local["grace-ab"];
    engine.church = { id: "grace-ab", accountUid: "operator" };
    engine.targets = ["en"];
    await assert.rejects(() => engine.chargeOpening(), /충전금이 부족합니다/);
    assert.equal(balance, 1000);

    balance = 20000;
    engine.running = true;
    engine.pendingStopReason = "";
    engine.prepaid = cost.normalizePrepaid({
      remainingSeconds: 20,
      languageKey: "en,zh-CN",
      kind: "hour",
      amountKrw: 20000,
      updatedAt: 1,
    });
    engine.prepaidBudget = 0;
    engine.prepaidAnchor = Date.now();
    engine.sessionCharge = { charged: 0, balance, halfKrw: 10000, languages: ["en", "zh-CN"] };
    await engine.chargeNextBlock();
    assert.equal(balance, 10000);
    assert.equal(engine.prepaid.remainingSeconds, 1800);
    assert.equal(engine.prepaid.kind, "half");
    assert.equal(engine.sessionCharge.charged, 10000);
    assert.equal(engine.pendingStopReason, "");

    balance = 1000;
    engine.running = true;
    engine.prepaid = cost.normalizePrepaid({
      remainingSeconds: 10,
      languageKey: "en",
      kind: "half",
      amountKrw: 7500,
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
