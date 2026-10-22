const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const catalog = require("../docs/js/catalog");
const cost = require("../broadcast/lib/cost");
const { buildPrompt } = require("../broadcast/lib/translator");
const { SpeechSession } = require("../broadcast/lib/stt");
const { Engine, channelRecognition } = require("../broadcast/lib/engine");
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
  assert.match(html, /id="heardTitle"/);
  assert.match(renderer, /channel-spoken/);
  assert.match(renderer, /deviceChannels/);
  assert.match(renderer, /지금 듣는 \$\{spokenTitle/);
  assert.match(renderer, /return "중국어"/);
  assert.match(renderer, /function heardKey/);
  assert.match(renderer, /setChannelSpoken/);
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
  assert.deepEqual(engine.pipeline.targets, ["en", "ko"]);
  assert.deepEqual(usage.languages, ["en", "ja"]);
  assert.equal(engine.sessionCharge.charged, 20000);
  assert.equal(engine.prepaid.amountKrw, 20000);
  assert.deepEqual(engine.prepaid.languages, ["en", "ja"]);
  assert.deepEqual(switched, ["ja"]);
  assert.equal(logs.some((row) => row.text && row.text.includes("일본어")), true);
});

test("every spoken language is heard on its own channel, including Chinese beside Korean", async () => {
  const outputs = catalog.languages.map((lang) => lang.code).filter((code) => code !== "ko");
  catalog.languages.forEach((lang) => {
    const plan = channelRecognition({ spoken: lang.code, source: "phone", name: "말하는 사람" }, outputs);
    assert.equal(plan.spoken, lang.code);
    assert.equal(plan.targets.includes(lang.code), false);
    assert.equal(plan.speaker, "말하는 사람");
    if (lang.code === "ko") {
      assert.equal(plan.transcription, "ko");
      assert.equal(plan.targets.includes("ko"), false);
    } else {
      assert.notEqual(plan.transcription, "ko");
      assert.equal(plan.targets.includes("ko"), true);
    }
  });
  const chinese = channelRecognition({ spoken: "zh-CN", source: "phone", name: "왕웨이" }, ["en", "ja", "zh-CN"]);
  assert.equal(chinese.transcription, "zh");
  assert.deepEqual(chinese.targets, ["en", "ja", "ko"]);
  const korean = channelRecognition({ spoken: "ko", source: "device" }, ["en", "ja", "zh-CN"], "김목사");
  assert.equal(korean.speaker, "김목사");
  assert.deepEqual(korean.targets, ["en", "ja", "zh-CN"]);

  const lines = [];
  const heard = [];
  const translated = [];
  function make(plan) {
    return new Pipeline({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      sourceLang: plan.spoken,
      targets: plan.targets,
      speaker: plan.speaker,
      onHeard: (row) => heard.push(row.text),
      onLine: (line) => lines.push(line),
      onLive: () => {},
      translateImpl: async (text, opts) => {
        translated.push({ text, source: opts.sourceLang, targets: opts.targetCodes.slice() });
        if (opts.sourceLang === "zh-CN") return { ko: "하나님은 사랑입니다", en: "God is love", ja: "神は愛です" };
        return { ko: `교정 ${text}`, en: `EN ${text}`, ja: `JA ${text}`, "zh-CN": `中文 ${text}` };
      },
    });
  }
  const koPlan = channelRecognition({ source: "phone", spoken: "ko", name: "김영희" }, ["en", "ja", "zh-CN"]);
  const zhPlan = channelRecognition({ source: "phone", spoken: "zh-CN", name: "왕웨이" }, ["en", "ja", "zh-CN"]);
  const koreanPipe = make(koPlan);
  const chinesePipe = make(zhPlan);
  koreanPipe.onFinalChunk("오늘 하나님은 우리를 사랑하십니다.");
  chinesePipe.onFinalChunk("神爱我们。");
  await koreanPipe.chain;
  await chinesePipe.chain;
  assert.ok(heard.some((text) => text.startsWith("김영희:") && text.includes("사랑하십니다")));
  assert.ok(heard.some((text) => text.startsWith("왕웨이:") && text.includes("神爱我们")));
  const zhEn = lines.find((line) => line.lang === "en" && line.text.startsWith("왕웨이:"));
  const zhKo = lines.find((line) => line.lang === "ko" && line.text.startsWith("왕웨이:"));
  const koZh = lines.find((line) => line.lang === "zh-CN" && line.text.startsWith("김영희:"));
  assert.ok(zhEn && zhEn.text.includes("God is love"));
  assert.ok(zhKo && zhKo.text.includes("하나님은 사랑입니다"));
  assert.ok(koZh && koZh.text.includes("中文"));
  assert.equal(zhEn.text.startsWith("왕웨이: 왕웨이:"), false);
  assert.ok(translated.some((row) => row.source === "zh-CN" && row.targets.includes("ko") && !row.targets.includes("zh-CN")));
  assert.ok(translated.some((row) => row.source === "ko" && row.targets.includes("zh-CN") && !row.targets.includes("ko")));

  const engine = new Engine(() => {});
  const koFed = [];
  const deviceZh = [];
  const phoneFed = [];
  engine.channelRows = [
    { spoken: "ko", on: true, source: "device" },
    { spoken: "zh-CN", on: true, source: "device" },
    { spoken: "zh-CN", on: true, source: "phone", name: "왕웨이", phoneId: "phone0009" },
  ];
  engine.channelSessions = new Map([
    [0, { source: "device", spoken: "ko", speech: { push(buf) { koFed.push(buf); } } }],
    [1, { source: "device", spoken: "zh-CN", speech: { push(buf) { deviceZh.push(buf); } } }],
    [2, { source: "phone", spoken: "zh-CN", speech: { push(buf) { phoneFed.push(buf); } } }],
  ]);
  engine._onPcm(Buffer.alloc(8), {
    mode: "all",
    nChannels: 2,
    sampleRate: 24000,
    deviceChannels: 2,
    deviceChannel: 0,
    selected: 0,
  });
  assert.equal(koFed.length, 1);
  assert.equal(deviceZh.length, 1);
  assert.equal(phoneFed.length, 0);
  engine.pushPhonePcm("phone0009", Buffer.alloc(4));
  assert.equal(phoneFed.length, 1);
  assert.equal(koFed.length, 1);
});
