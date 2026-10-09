const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cost = require("../broadcast/lib/cost");
const { UsageMeter, persistUsage } = require("../broadcast/lib/usage");
const { Pipeline } = require("../broadcast/lib/pipeline");
const { SpeechSession } = require("../broadcast/lib/stt");

test("40-minute sermon price shares recognition and bills translation per language", () => {
  assert.equal(cost.USD_KRW, 1342.8);
  assert.equal(cost.CAPTION_USD_PER_MIN, 39 / 360);
  assert.equal(cost.TRANSLATION_USD_PER_MIN, 79 / 180);
  const one = cost.estimateSermon({ minutes: 40, languages: 1 });
  const two = cost.estimateSermon({ minutes: 40, languages: 2 });
  assert.equal(one.audioSeconds, 2400);
  assert.equal(one.charsPerLanguage, 30000);
  assert.equal(one.chars.en, 30000);
  assert.equal(two.chars.en, 30000);
  assert.equal(two.chars.ja, 30000);
  assert.ok(Math.abs(one.churchUsd - (40 * 79 / 180)) < 1e-9);
  assert.ok(Math.abs(one.recognitionUsd - (40 * 39 / 360)) < 1e-9);
  assert.equal(one.recognitionUsd, two.recognitionUsd);
  assert.ok(Math.abs(two.translationUsd - one.translationUsd * 2) < 1e-9);
  assert.equal(one.churchKrw, 23574);
  assert.equal(two.churchKrw, 41328);
  assert.equal(two.churchKrw - one.churchKrw, 17754);
  assert.equal(one.api.model, "gpt-4o-mini");
  assert.ok(one.apiKrw > 0);
  assert.ok(one.apiKrw < one.churchKrw);
  const high = cost.estimateSermon({ minutes: 40, languages: 1, model: "gpt-4o" });
  assert.ok(high.apiKrw > one.apiKrw);
  assert.equal(high.churchKrw, one.churchKrw);
  assert.match(cost.rateCardText(), /1달러 = 1342\.8원/);
  assert.match(cost.rateCardText(), /23,574원/);
  assert.match(cost.rateCardText(), /41,328원/);
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
  assert.match(renderer, /churchKrw/);
  assert.doesNotMatch(broadcast, /apiKrw|API 원가|id="apiKey"|요금 단가/);
  assert.doesNotMatch(renderer, /apiKrw|apiKey/);
  assert.match(usage[".write"], /account\/uid/);
  assert.match(usage[".validate"], /churchKrw/);
  assert.match(usage.chars.$lang[".validate"], /isNumber/);
  assert.notEqual(usage[".read"], true);
  assert.doesNotMatch(JSON.stringify(rules), /cheil|jifc/);
});
