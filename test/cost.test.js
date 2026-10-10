const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cost = require("../broadcast/lib/cost");
const browserCost = require("../docs/js/cost");
const ledger = require("../functions/ledger");
const { UsageMeter, persistUsage } = require("../broadcast/lib/usage");
const { Pipeline } = require("../broadcast/lib/pipeline");
const { SpeechSession } = require("../broadcast/lib/stt");

test("hourly package bills Korean and English as the base", () => {
  assert.equal(cost.HOUR_BASE_KRW, 15000);
  assert.equal(cost.EXTRA_LANG_HOUR_KRW, 5000);
  assert.equal(cost.packageKrw({ minutes: 50, languages: ["en"] }), 15000);
  assert.equal(cost.packageKrw({ minutes: 60, languages: ["en", "zh-CN"] }), 20000);
  assert.equal(cost.packageKrw({ minutes: 90, languages: ["en"] }), 22500);
  assert.equal(browserCost.packageKrw({ minutes: 50, languages: ["en"] }), 15000);
  assert.equal(browserCost.packageKrw({ minutes: 60, languages: ["en", "zh-CN"] }), 20000);
  assert.equal(browserCost.packageKrw({ minutes: 90, languages: ["en"] }), 22500);
  assert.equal(cost.packageKrw({ minutes: 60, languages: ["en"] }), 15000);
  assert.equal(cost.packageKrw({ minutes: 61, languages: ["en"] }), 22500);
  assert.equal(cost.packageKrw({ minutes: 50, languages: ["ja"] }), 20000);
  assert.equal(cost.packageKrw({ minutes: 50, languages: ["en", "ja"] }), 20000);
  assert.equal(cost.extraLanguageCount(["en", "ko", "zh-CN", "ja"]), 2);

  const english = new UsageMeter();
  english.start(["en"], 0);
  const fifty = english.record("gpt-4o-mini", 50 * 60 * 1000);
  assert.equal(fifty.churchKrw, 15000);
  assert.equal(fifty.chars, undefined);
  assert.deepEqual(Object.keys(fifty).sort(), ["apiKrw", "audioSeconds", "churchKrw", "updatedAt"]);

  const chinese = new UsageMeter();
  chinese.start(["en", "zh-CN"], 0);
  assert.equal(chinese.record("gpt-4o-mini", 60 * 60 * 1000).churchKrw, 20000);

  const longer = new UsageMeter();
  longer.start(["en"], 0);
  assert.equal(longer.record("gpt-4o-mini", 90 * 60 * 1000).churchKrw, 22500);

  const first = cost.openBroadcast({ balance: 100000, languages: ["en"] });
  assert.equal(first.ok, true);
  assert.equal(first.charged, 15000);
  assert.equal(first.balance, 85000);
  const second = cost.openBroadcast({ balance: first.balance, languages: ["en", "zh-CN"] });
  assert.equal(second.ok, true);
  assert.equal(second.charged, 20000);
  assert.equal(second.balance, 65000);
  assert.notEqual(second.balance, 100000);
  assert.equal(browserCost.openBroadcast({ balance: first.balance, languages: ["en", "zh-CN"] }).balance, 65000);

  const ninety = cost.accrue(cost.openBroadcast({ balance: 100000, languages: ["en"] }), 90);
  assert.equal(ninety.charged, 22500);
  assert.equal(ninety.balance, 77500);
  assert.equal(ninety.running, true);

  const shortLater = cost.accrue(cost.openBroadcast({ balance: 15000, languages: ["en"] }), 90);
  assert.equal(shortLater.charged, 15000);
  assert.equal(shortLater.balance, 0);
  assert.equal(shortLater.short, true);
  assert.equal(shortLater.running, true);

  const blocked = cost.openBroadcast({ balance: 10000, languages: ["en"] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.running, false);
  assert.equal(blocked.charged, 0);
  assert.equal(blocked.balance, 10000);

  const fresh = cost.planBroadcastStart({ balance: 100000, languages: ["en"] });
  assert.equal(fresh.mode, "hour");
  assert.equal(fresh.charged, 15000);
  assert.equal(fresh.balance, 85000);
  assert.equal(fresh.prepaid.remainingSeconds, 3600);
  assert.equal(fresh.prepaid.kind, "hour");
  assert.equal(fresh.prepaid.amountKrw, 15000);
  assert.equal(fresh.prepaid.languageKey, "en");
  assert.equal(cost.prepaidLabel(2530), "남은 시간 42:10");

  const paused = cost.consumePrepaid(fresh.prepaid, 20 * 60);
  assert.equal(paused.expired, false);
  assert.equal(paused.remainingSeconds, 2400);
  const resume = cost.planBroadcastStart({
    balance: paused.prepaid ? 85000 : 0,
    languages: ["en"],
    prepaid: { ...paused.prepaid, updatedAt: 10 },
  });
  assert.equal(resume.mode, "resume");
  assert.equal(resume.charged, 0);
  assert.equal(resume.balance, 85000);
  assert.equal(resume.noExtraCharge, true);
  assert.equal(resume.remainingSeconds, 2400);
  assert.deepEqual(resume.paidLanguages, ["en"]);

  const subset = cost.planBroadcastStart({
    balance: 85000,
    languages: ["en"],
    prepaid: { remainingSeconds: 900, languageKey: "en,zh-CN", kind: "hour", amountKrw: 20000, updatedAt: 3 },
  });
  assert.equal(subset.charged, 0);
  assert.equal(subset.remainingSeconds, 900);
  assert.deepEqual(subset.paidLanguages, ["en", "zh-CN"]);

  const extra = cost.planBroadcastStart({
    balance: 85000,
    languages: ["en", "ja"],
    prepaid: { remainingSeconds: 900, languageKey: "en,zh-CN", kind: "half", amountKrw: 10000, updatedAt: 4 },
  });
  assert.equal(extra.mode, "extra");
  assert.equal(extra.ok, true);
  assert.equal(extra.charged, 5000);
  assert.equal(extra.balance, 80000);
  assert.equal(extra.remainingSeconds, 900);
  assert.equal(extra.kind, "half");
  assert.deepEqual(extra.addedLanguages, ["ja"]);
  assert.equal(extra.prepaid.amountKrw, 15000);
  assert.equal(extra.prepaid.extraCount, 2);

  const englishOnJapanese = cost.planBroadcastStart({
    balance: 1000,
    languages: ["en", "ja"],
    prepaid: { remainingSeconds: 600, languageKey: "ja", kind: "hour", amountKrw: 20000, updatedAt: 5 },
  });
  assert.equal(englishOnJapanese.charged, 0);
  assert.equal(englishOnJapanese.balance, 1000);
  assert.equal(englishOnJapanese.noExtraCharge, true);

  const shortExtra = cost.planBroadcastStart({
    balance: 4000,
    languages: ["ja"],
    prepaid: { remainingSeconds: 600, languageKey: "en", kind: "hour", amountKrw: 15000, updatedAt: 6 },
  });
  assert.equal(shortExtra.ok, false);
  assert.equal(shortExtra.short, true);
  assert.equal(shortExtra.charged, 0);
  assert.equal(shortExtra.balance, 4000);
  assert.equal(shortExtra.chargeKrw, 5000);

  const spent = cost.consumePrepaid({ remainingSeconds: 30, languageKey: "en", kind: "hour", amountKrw: 15000 }, 30);
  assert.equal(spent.expired, true);
  assert.equal(spent.prepaid, null);
  const afterZero = cost.planBroadcastStart({
    balance: 50000,
    languages: ["en"],
    prepaid: { remainingSeconds: 0, languageKey: "en", kind: "hour", amountKrw: 15000 },
  });
  assert.equal(afterZero.mode, "hour");
  assert.equal(afterZero.charged, 15000);

  const half = cost.openHalfBlock({ balance: 50000, languages: ["en", "zh-CN"] });
  assert.equal(half.ok, true);
  assert.equal(half.charged, 10000);
  assert.equal(half.balance, 40000);
  assert.equal(half.prepaid.remainingSeconds, 1800);
  assert.equal(half.prepaid.kind, "half");
  assert.equal(half.prepaid.extraCount, 1);
  const halfShort = cost.openHalfBlock({ balance: 7000, languages: ["en"] });
  assert.equal(halfShort.ok, false);
  assert.equal(halfShort.charged, 0);
  assert.equal(halfShort.balance, 7000);
  assert.equal(halfShort.prepaid, null);

  const newerLocal = cost.choosePrepaid(
    { remainingSeconds: 100, languageKey: "en", kind: "hour", amountKrw: 15000, updatedAt: 10 },
    { remainingSeconds: 80, languageKey: "en", kind: "hour", amountKrw: 15000, updatedAt: 20 },
  );
  assert.equal(newerLocal.remainingSeconds, 80);
  assert.equal(cost.choosePrepaid(null, newerLocal).remainingSeconds, 80);
  assert.equal(cost.choosePrepaid(
    { remainingSeconds: 0, languageKey: "en", kind: "hour", amountKrw: 15000, updatedAt: 50 },
    newerLocal,
  ).remainingSeconds, 80);

  const depositBody = { churchId: "alpha", amountKrw: 30000, depositId: "dep-1", paidAt: 1 };
  const credited = cost.prepareDeposit({ balances: {}, deposits: {}, ledger: [] }, depositBody);
  assert.equal(credited.duplicate, false);
  assert.equal(credited.balance, 30000);
  assert.equal(credited.entry.deltaKrw, credited.entry.amountKrw);
  const repeated = cost.prepareDeposit(credited.state, depositBody);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.balance, 30000);
  assert.equal(repeated.state.balances.alpha, 30000);
  assert.equal(repeated.state.ledger.length, 1);

  const webhook = ledger.prepareDeposit({ balances: {}, deposits: {}, ledger: [] }, depositBody);
  const webhookAgain = ledger.prepareDeposit(webhook.state, depositBody);
  assert.equal(webhook.duplicate, false);
  assert.equal(webhook.balance, 30000);
  assert.equal(webhook.entry.type, "deposit");
  assert.equal(webhookAgain.duplicate, true);
  assert.equal(webhookAgain.balance, 30000);
  assert.equal(webhookAgain.state.ledger.length, 1);
  const raw = JSON.stringify(depositBody);
  const signature = ledger.signBody("platform-secret", raw);
  assert.equal(ledger.verifySignature("platform-secret", raw, signature), true);
  assert.equal(ledger.verifySignature("platform-secret", raw, "nope"), false);
  assert.equal(ledger.verifySignature("", raw, signature), false);

  const priced = cost.estimateSermon({ minutes: 50, languages: ["en"] });
  assert.equal(priced.churchKrw, 15000);
  assert.equal(priced.api.model, "gpt-4o-mini");
  assert.ok(priced.apiKrw > 0);
  assert.ok(priced.apiKrw < priced.churchKrw);
  const high = cost.estimateSermon({ minutes: 50, languages: ["en"], model: "gpt-4o" });
  assert.ok(high.apiKrw > priced.apiKrw);
  assert.equal(high.churchKrw, priced.churchKrw);
  assert.match(cost.rateCardText(), /15,000원/);
  assert.match(cost.rateCardText(), /5,000원/);
  assert.match(cost.rateCardText(), /20,000원/);
  assert.match(cost.rateCardText(), /22,500원/);
  assert.doesNotMatch(cost.rateCardText(), /23,574원/);
});

test("usage counter stores numbers and does not keep the transcript", async () => {
  const sentence = "오늘 하나님은 우리를 사랑하십니다.";
  const next = "다음 문장입니다";
  const meter = new UsageMeter();
  meter.addPcm16(24000 * 2, 24000);
  meter.addTranslation(sentence, ["en", "ja"]);
  meter.addTranslation(next, ["en"]);
  const record = meter.record("gpt-4o-mini", 1000);
  const packed = JSON.stringify(record);
  assert.equal(packed.includes(sentence), false);
  assert.equal(packed.includes(next), false);
  assert.equal(record.audioSeconds, 1);
  assert.equal(record.chars.en, sentence.length + next.length);
  assert.equal(record.chars.ja, sentence.length);
  assert.equal(record.text, undefined);
  assert.equal(record.transcript, undefined);
  assert.equal(meter.text, undefined);
  assert.equal(meter.transcript, undefined);
  assert.equal(meter.lines, undefined);

  const ops = [];
  await persistUsage({
    async set(rel, value) { ops.push(["set", rel, value]); },
    async remove() { throw new Error("usage must not delete the session"); },
  }, "alpha-ab", "2026-10-09_10-00-00", record);
  assert.deepEqual(ops.map((op) => op[1]), [
    "churches/alpha-ab/live/usage",
    "churches/alpha-ab/sessions/2026-10-09_10-00-00/usage",
  ]);
  assert.equal(JSON.stringify(ops).includes(sentence), false);
  assert.equal(ops[0][2].churchKrw, ops[1][2].churchKrw);

  const usageWrites = [];
  const textWrites = [];
  const pipeline = new Pipeline({
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    targets: ["en", "ja"],
    usage: new UsageMeter(),
    cloud: {
      async recordUsage(usage) { usageWrites.push(JSON.parse(JSON.stringify(usage))); },
      async setText(lang, text) { textWrites.push([lang, text]); },
      async updateSubtitles() {},
    },
    translateImpl: async (text) => ({ ko: text, en: `EN ${text}`, ja: `JA ${text}` }),
  });
  pipeline.onFinalChunk(sentence);
  await pipeline.chain;
  assert.equal(usageWrites.length, 1);
  assert.deepEqual(Object.keys(usageWrites[0]).sort(), ["apiKrw", "audioSeconds", "chars", "churchKrw", "updatedAt"]);
  assert.equal(usageWrites[0].chars.en, sentence.length);
  assert.equal(usageWrites[0].chars.ja, sentence.length);
  assert.equal(typeof usageWrites[0].chars.en, "number");
  assert.equal(JSON.stringify(usageWrites).includes(sentence), false);
  await pipeline.stop();
  const transcript = textWrites.map((row) => row[1]).join("\n");
  assert.ok(transcript.includes(sentence));
  assert.equal(usageWrites.every((usage) => !JSON.stringify(usage).includes(sentence)), true);
  assert.equal(usageWrites.every((usage) => JSON.stringify(usage) !== transcript), true);
});

test("recognition time is the captured pcm already sent", async () => {
  const seen = [];
  const session = new SpeechSession({
    apiKey: "sk-test",
    onAudio: (pcm) => seen.push(pcm.length),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: "안녕" }),
    }),
  });
  session.ws = { readyState: 1, send() {} };
  const second = Buffer.alloc(24000 * 2);
  session.sendAppend(second);
  assert.deepEqual(seen, [second.length]);
  const meter = new UsageMeter();
  meter.addPcm16(seen[0], 24000);
  assert.equal(meter.record("gpt-4o-mini", 1).audioSeconds, 1);
  assert.equal(JSON.stringify(meter.record("gpt-4o-mini", 1)).includes("base64"), false);

  const fileSession = new SpeechSession({
    apiKey: "sk-test",
    onAudio: (pcm) => seen.push(pcm.length),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: "안녕" }),
    }),
  });
  fileSession.mode = "file";
  const utterance = Buffer.alloc(9600);
  await fileSession.postFile(utterance, false);
  assert.equal(seen.length, 1);
  await fileSession.recognize(utterance, false);
  assert.equal(seen.length, 2);
  assert.equal(seen[1], utterance.length);
});

test("admin shows both prices and the church app shows only the church price", () => {
  const root = path.join(__dirname, "..");
  const admin = fs.readFileSync(path.join(root, "docs/admin.html"), "utf8");
  const adminJs = fs.readFileSync(path.join(root, "docs/js/admin.js"), "utf8");
  const broadcast = fs.readFileSync(path.join(root, "broadcast/renderer/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "broadcast/renderer/renderer.js"), "utf8");
  const rules = JSON.parse(fs.readFileSync(path.join(root, "firebase/live-interpret.rules.json"), "utf8"));
  const usage = rules["live-interpret"].churches.$churchId.live.usage;
  assert.match(admin, /id="costList"/);
  assert.match(admin, /id="detailApiCost"/);
  assert.match(adminJs, /live\/usage/);
  assert.match(adminJs, /API 원가/);
  assert.match(broadcast, /id="churchCost"/);
  assert.match(broadcast, /id="balanceCost"/);
  assert.match(broadcast, /남은 충전금/);
  assert.match(broadcast, /이번 방송 차감/);
  assert.match(broadcast, /id="startConfirm"/);
  assert.match(broadcast, /id="confirmStart"/);
  assert.match(broadcast, /id="confirmCancel"/);
  assert.match(admin, /id="ops"/);
  assert.match(admin, /id="topupAmount"/);
  assert.match(admin, /id="topupChurch"/);
  assert.match(admin, /id="chargeLog"/);
  assert.match(admin, /이번 시간 요금/);
  assert.match(renderer, /churchKrw/);
  assert.match(renderer, /balanceKrw/);
  assert.match(renderer, /previewBilling/);
  assert.match(adminJs, /applyCredit/);
  assert.doesNotMatch(renderer, /monthKrw/);
  assert.doesNotMatch(broadcast, /id="monthCost"/);
  assert.doesNotMatch(renderer, /showChurchCost\(0\)/);
  assert.doesNotMatch(broadcast, /apiKrw|API 원가|id="apiKey"|요금 단가|id="topupAdd"|충전금 추가|DEPOSIT_HMAC/);
  assert.doesNotMatch(renderer, /apiKrw|apiKey|DEPOSIT_HMAC|topupAdd/);
  assert.match(usage[".write"], /account\/uid/);
  assert.match(usage[".validate"], /churchKrw/);
  assert.match(usage[".validate"], /hasChildren\(\['audioSeconds', 'churchKrw', 'apiKrw', 'updatedAt'\]\)/);
  assert.match(usage[".validate"], /!newData\.child\('chars'\)\.exists\(\) \|\| newData\.child\('chars'\)\.hasChildren\(\)/);
  assert.match(broadcast, /id="prepaidTime"/);
  assert.match(broadcast, /남은 시간/);
  assert.match(broadcast, /이 시간이 끝날 때까지 추가 요금은 없습니다/);
  assert.match(renderer, /이번 시작은 추가 요금이 없습니다/);
  assert.match(renderer, /showPrepaid/);
  assert.doesNotMatch(usage[".validate"], /hasChildren\(\['audioSeconds', 'chars'/);
  assert.match(usage.chars.$lang[".validate"], /isNumber/);
  const billing = rules["live-interpret"].churches.$churchId.billing;
  const prepaid = billing.prepaid;
  assert.match(prepaid[".write"], /account\/uid/);
  assert.match(prepaid[".validate"], /remainingSeconds/);
  assert.match(prepaid[".validate"], /languageKey/);
  assert.match(prepaid[".validate"], /'hour'/);
  assert.match(prepaid[".validate"], /'half'/);
  assert.match(billing.balance[".validate"], /newData\.val\(\) < data\.val\(\)/);
  assert.match(billing.balance[".validate"], /deltaKrw/);
  assert.match(billing.balance[".validate"], /admin\/uid/);
  assert.match(billing.ledger.$entryId[".validate"], /amountKrw/);
  assert.equal(rules["live-interpret"].deposits.$depositId[".write"], false);
  assert.notEqual(usage[".read"], true);
  assert.doesNotMatch(JSON.stringify(rules), /cheil|jifc/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "broadcast/lib/cost.js"), "utf8"), /DEPOSIT_HMAC|monthTotal/);
  assert.equal(
    fs.readFileSync(path.join(root, "broadcast/lib/cost.js"), "utf8"),
    fs.readFileSync(path.join(root, "docs/js/cost.js"), "utf8"),
  );
});
