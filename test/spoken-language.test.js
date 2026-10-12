const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const catalog = require("../docs/js/catalog");
const cost = require("../broadcast/lib/cost");
const { buildPrompt } = require("../broadcast/lib/translator");
const { SpeechSession } = require("../broadcast/lib/stt");
const { Engine } = require("../broadcast/lib/engine");
const { Pipeline } = require("../broadcast/lib/pipeline");

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
  assert.match(renderer, /setSpoken/);
  assert.doesNotMatch(renderer, /spokenEl\.disabled = running/);
  assert.match(read("broadcast/lib/stt.js"), /languages: \[this\.language\]/);
});

class FakeSocket {
  static sockets = [];
  static failUpdates = 0;

  constructor() {
    this.sent = [];
    this.handlers = {};
    this.readyState = 0;
    FakeSocket.sockets.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      if (this.handlers.open) this.handlers.open();
    });
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  send(raw) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    if (msg.type !== "session.update") return;
    if (FakeSocket.failUpdates > 0) {
      FakeSocket.failUpdates -= 1;
      queueMicrotask(() => {
        if (this.handlers.message) {
          this.handlers.message(JSON.stringify({ type: "error", error: { message: "language locked" } }));
        }
      });
      return;
    }
    queueMicrotask(() => {
      if (this.handlers.message) this.handlers.message(JSON.stringify({ type: "session.updated" }));
    });
  }

  close() {
    this.readyState = 3;
    this.closed = true;
  }
}

test("a live language change updates recognition without ending the broadcast", async () => {
  FakeSocket.sockets = [];
  FakeSocket.failUpdates = 0;
  const session = new SpeechSession({
    apiKey: "sk-test",
    language: "ko",
    churchName: "은혜교회",
    WebSocketImpl: FakeSocket,
  });
  await session.start();
  assert.equal(session.closed, false);
  assert.equal(FakeSocket.sockets.length, 1);
  await session.setLanguage("en");
  assert.equal(session.closed, false);
  assert.equal(session.mode, "realtime");
  assert.equal(session.spoken, "en");
  assert.equal(session.language, "en");
  assert.equal(FakeSocket.sockets.length, 1);
  const updates = FakeSocket.sockets[0].sent.filter((msg) => msg.type === "session.update");
  assert.deepEqual(updates.at(-1).session.audio.input.transcription.languages, ["en"]);

  FakeSocket.failUpdates = 1;
  await session.setLanguage("ja");
  assert.equal(session.closed, false);
  assert.equal(session.mode, "realtime");
  assert.equal(FakeSocket.sockets.length, 2);
  assert.equal(FakeSocket.sockets[0].closed, true);
  const reopened = FakeSocket.sockets[1].sent.find((msg) => msg.type === "session.update");
  assert.deepEqual(reopened.session.audio.input.transcription.languages, ["ja"]);
  assert.equal(session.language, "ja");

  const fileSession = new SpeechSession({ apiKey: "sk-test", language: "ko", WebSocketImpl: FakeSocket });
  fileSession.mode = "file";
  const before = FakeSocket.sockets.length;
  await fileSession.setLanguage("vi");
  assert.equal(fileSession.language, "vi");
  assert.equal(FakeSocket.sockets.length, before);
});

test("switching spoken language during a broadcast does not change the hour price", async () => {
  const logs = [];
  const engine = new Engine((payload) => logs.push(payload));
  engine.running = true;
  engine.spoken = "ko";
  engine.outputs = ["en", "ja"];
  engine.targets = ["en", "ja"];
  engine.prepaid = { languages: ["en", "ja"], amountKrw: 20000, remainingSeconds: 1800 };
  engine.sessionCharge = { charged: 20000 };
  const usage = {
    languages: ["en", "ja"],
    setLanguages(langs) { this.languages = langs.slice(); },
  };
  engine.usage = usage;
  const switched = [];
  engine.speech = {
    async setLanguage(code) {
      switched.push(code);
      return code;
    },
  };
  engine.pipeline = new Pipeline({
    targets: ["en", "ja"],
    sourceLang: "ko",
    onLive: () => {},
  });
  const spoken = await engine.setSpoken("", "ja");
  assert.equal(spoken, "ja");
  assert.equal(engine.running, true);
  assert.equal(engine.pipeline.sourceLang, "ja");
  assert.deepEqual(engine.pipeline.targets, ["en"]);
  assert.deepEqual(usage.languages, ["en", "ja"]);
  assert.equal(engine.sessionCharge.charged, 20000);
  assert.equal(engine.prepaid.amountKrw, 20000);
  assert.deepEqual(engine.prepaid.languages, ["en", "ja"]);
  assert.deepEqual(switched, ["ja"]);
  assert.equal(logs.some((row) => row.text && row.text.includes("일본어")), true);
});
