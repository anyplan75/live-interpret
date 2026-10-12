const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const catalog = require("../docs/js/catalog");
const cost = require("../broadcast/lib/cost");
const { buildPrompt } = require("../broadcast/lib/translator");
const { SpeechSession } = require("../broadcast/lib/stt");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("a missing spoken language stays Korean", () => {
  assert.equal(catalog.spokenLanguage(undefined), "ko");
  assert.equal(catalog.spokenLanguage(""), "ko");
  assert.equal(catalog.spokenLanguage("nope"), "ko");
  assert.equal(catalog.spokenLanguage("en"), "en");
  assert.equal(catalog.spokenLanguage("zh-TW"), "zh-TW");
  assert.equal(catalog.transcriptionLanguage("ko"), "ko");
  assert.equal(catalog.transcriptionLanguage("zh-CN"), "zh");
  assert.equal(catalog.transcriptionLanguage("zh-TW"), "zh");
  assert.equal(catalog.transcriptionLanguage(undefined), "ko");
});

test("spoken language is not translated or billed again", () => {
  assert.deepEqual(catalog.translationTargets(["en", "ja", "zh-CN"], "ko"), ["en", "ja", "zh-CN"]);
  assert.deepEqual(catalog.translationTargets(["en", "ja"], "en"), ["ja"]);
  assert.deepEqual(catalog.translationTargets(["en", "ja", "zh-CN"], "ja"), ["en", "zh-CN"]);
  assert.equal(cost.HOUR_BASE_KRW, 15000);
  assert.equal(cost.EXTRA_LANG_HOUR_KRW, 5000);
  const koreanSpoken = cost.packageKrw({ minutes: 60, languages: catalog.translationTargets(["en", "ja"], "ko") });
  const englishSpoken = cost.packageKrw({ minutes: 60, languages: catalog.translationTargets(["en", "ja"], "en") });
  const japaneseSpoken = cost.packageKrw({ minutes: 60, languages: catalog.translationTargets(["en", "ja", "zh-CN"], "ja") });
  assert.equal(koreanSpoken, 20000);
  assert.equal(englishSpoken, 20000);
  assert.equal(japaneseSpoken, 20000);
  assert.equal(cost.packageKrw({ minutes: 60, languages: catalog.translationTargets(["en"], "ja") }), 15000);
});

test("recognition follows the spoken language and does not translate it into itself", () => {
  const sent = [];
  const session = new SpeechSession({
    apiKey: "sk-test",
    language: "en",
    churchName: "은혜교회",
    WebSocketImpl: class {},
  });
  session.ws = { readyState: 1, send(raw) { sent.push(JSON.parse(raw)); } };
  session.sendSession();
  const transcription = sent[0].session.audio.input.transcription;
  assert.deepEqual(transcription.languages, ["en"]);
  assert.match(transcription.prompt, /영어/);
  assert.equal(catalog.isGuidanceEcho(transcription.prompt), true);

  const chinese = new SpeechSession({ apiKey: "sk-test", language: "zh-TW", WebSocketImpl: class {} });
  chinese.ws = { readyState: 1, send(raw) { sent.push(JSON.parse(raw)); } };
  chinese.sendSession();
  assert.deepEqual(sent[1].session.audio.input.transcription.languages, ["zh"]);

  const korean = buildPrompt("아멘", ["en"], {});
  assert.match(korean, /교정된 한국어/);
  assert.match(korean, /"ko":/);
  const english = buildPrompt("Amen", ["en", "ja"], { sourceLang: "en" });
  assert.match(english, /영어\(en\)/);
  assert.match(english, /다시 번역하지 마라/);
  assert.match(english, /"ja":/);
  assert.doesNotMatch(english, /"en":/);
});

test("the broadcast window labels the heard language", () => {
  const html = read("broadcast/renderer/index.html");
  const renderer = read("broadcast/renderer/renderer.js");
  assert.match(html, /id="spoken"/);
  assert.match(html, /말하는 언어/);
  assert.match(html, /id="heardTitle"/);
  assert.match(renderer, /지금 듣는 \$\{spokenName/);
  assert.match(read("broadcast/lib/stt.js"), /languages: \[this\.language\]/);
});
