const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeProfile, lessonFromLines, matchPreacher, refineProfile, pauseTails, wordFix, normalizeProfile } = require("../broadcast/lib/preacher");
const { Pipeline } = require("../broadcast/lib/pipeline");
const catalog = require("../broadcast/lib/catalog");

test("preacher profile grows and feeds the next sermon", async () => {
  const first = mergeProfile(null, {
    name: "김목사",
    traits: "문장 끝을 늘입니다",
    corrections: "수여 기도회 → 수요 기도회",
    terms: "이른비",
    countSession: true,
  });
  const lesson = lessonFromLines([
    { heard: "열반을 축복합니다", corrected: "열방을 축복합니다" },
    { heard: "열방을 축복합니다", corrected: "열방을 축복합니다" },
  ]);
  const grown = mergeProfile(first, lesson);
  assert.equal(grown.sermonCount, 2);
  assert.match(grown.corrections, /수여 기도회/);
  assert.match(grown.corrections, /열방/);
  assert.equal(grown.corrections.split("\n").length, 2);
  assert.equal(matchPreacher([grown], "김 목사").name, "김목사");

  const refined = await refineProfile({
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    profile: grown,
    lesson,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ traits: "천천히 말합니다", corrections: "", terms: "늦은비" }) } }],
      }),
    }),
  });
  assert.match(refined.traits, /천천히 말합니다/);
  assert.match(refined.terms, /이른비/);
  assert.match(refined.terms, /늦은비/);
  assert.match(refined.corrections, /열방/);
});

function sermon(pipeline, chunks) {
  chunks.forEach((chunk) => pipeline.onFinalChunk(chunk));
}

test("pause points come from mid-sentence pauses and add up across sermons", async () => {
  const pipeline = new Pipeline({
    apiKey: "sk-test",
    targets: ["en"],
    translateImpl: async (text) => ({ ko: text, en: `EN ${text}` }),
  });
  sermon(pipeline, [
    "하나님께서",
    "우리를 사랑하십니다.",
    "그래서",
    "우리는 감사합니다.",
    "하나님께서",
    "오늘도 일하십니다.",
    "그래서",
    "기도합시다.",
    "아멘입니다.",
  ]);
  await pipeline.stop();
  const tails = pipeline.pauses.map((row) => row.tail);
  assert.deepEqual(tails, ["께서", "그래서", "께서", "그래서"]);
  assert.deepEqual(pipeline.pauses[0], { tail: "께서", before: "하나님께서", after: "우리를" });

  const lesson = lessonFromLines([], { pauses: pipeline.pauses, samples: pipeline.samples });
  assert.match(lesson.pausePoints, /^"께서" 뒤 쉼 2회 — 하나님께서 \/ /m);
  assert.match(lesson.pausePoints, /"그래서" 뒤 쉼 2회/);
  assert.ok(lesson.samples.length > 0);

  const once = lessonFromLines([], { pauses: [{ tail: "하는", before: "사랑하는", after: "여러분" }] });
  assert.equal(once.pausePoints, "", "a single pause in one sermon is noise");
  const ended = lessonFromLines([], { pauses: [{ tail: "니다", before: "입니다" }, { tail: "니다", before: "입니다" }] });
  assert.equal(ended.pausePoints, "", "sentence endings are not pause points");

  const first = mergeProfile({ name: "김목사", sermonCount: 0 }, lesson);
  const second = mergeProfile(first, { ...lesson, pausePoints: '"께서" 뒤 쉼 3회 — 주님께서 / 말씀하십니다\n"는데" 뒤 쉼 2회' });
  assert.equal(second.sermonCount, 2);
  const lines = second.pausePoints.split("\n");
  assert.equal(lines[0], '"께서" 뒤 쉼 5회 — 주님께서 / 말씀하십니다');
  assert.equal(lines.filter((line) => line.startsWith('"께서"')).length, 1, "deduped by tail");
  assert.ok(lines.some((line) => line.startsWith('"그래서" 뒤 쉼 2회')));
  assert.deepEqual(pauseTails(second).sort(), ["는데", "께서", "그래서"].sort());

  let many = "";
  for (let i = 0; i < 60; i++) many += `"꼬리${i}" 뒤 쉼 ${i + 1}회\n`;
  const capped = mergeProfile(second, { pausePoints: many });
  assert.ok(capped.pausePoints.split("\n").length <= 24);
  assert.ok(capped.pausePoints.length <= 1200);
  assert.match(capped.pausePoints.split("\n")[0], /꼬리59/, "most frequent first");
});

test("known pause points keep the next sermon from cutting mid-sentence", async () => {
  const seen = [];
  const make = (tails) => new Pipeline({
    apiKey: "sk-test",
    targets: ["en"],
    pauseTails: tails,
    translateImpl: async (text) => {
      seen.push(text);
      return { ko: text, en: `EN ${text}` };
    },
  });
  const plain = make([]);
  plain.onFinalChunk("우리가 함께 기도하면");
  plain.lastSpeechTime = Date.now() - 4000;
  plain.tick();
  await plain.chain;
  assert.deepEqual(seen, ["우리가 함께 기도하면"]);
  plain.stopped = true;

  seen.length = 0;
  const learned = make(pauseTails({ pausePoints: '"하면" 뒤 쉼 4회 — 기도하면 / 우리는' }));
  learned.onFinalChunk("우리가 함께 기도하면");
  learned.lastSpeechTime = Date.now() - 4000;
  learned.tick();
  await learned.chain;
  assert.deepEqual(seen, [], "waits for the rest of the sentence");
  learned.onFinalChunk("우리는 승리합니다.");
  await learned.chain;
  assert.deepEqual(seen, ["우리가 함께 기도하면 우리는 승리합니다."]);
  await learned.stop();
});

test("accuracy and naturalness corrections merge, dedupe and cap", async () => {
  assert.equal(wordFix("열반을 축복합니다", "열방을 축복합니다"), "열반을 → 열방을");
  assert.equal(wordFix("수요기도회 입니다", "수요 기도회입니다"), "");
  const lesson = lessonFromLines([
    { heard: "오늘 열반을 축복합니다", corrected: "오늘 열방을 축복합니다" },
    { heard: "이른 비를 주십니다", corrected: "이른비를 주십니다" },
  ], { samples: [{ ko: "열방을 축복합니다", lang: "en", text: "We bless nirvana" }] });
  assert.equal(lesson.accuracy, "열반을 → 열방을");
  assert.equal(lesson.naturalness, "");

  const seenPrompts = [];
  const refined = await refineProfile({
    apiKey: "sk-test",
    profile: {
      name: "김목사",
      sermonCount: 3,
      accuracy: "열방 → nirvana (en)\n항존직 → permanent office (en)",
      naturalness: "I bless you that → I pray that you (en)",
    },
    lesson,
    fetchImpl: async (_url, init) => {
      seenPrompts.push(JSON.parse(init.body).messages[0].content);
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                accuracy: "열방 → the nations (en)",
                naturalness: "Let us do prayer → Let us pray (en)\nI bless you that → May you (en)",
              }),
            },
          }],
        }),
      };
    },
  });
  assert.match(seenPrompts[0], /\[오늘 번역 예시\]\nko: 열방을 축복합니다\nen: We bless nirvana/);
  assert.match(seenPrompts[0], /\[기존 정확도 교정\]/);
  assert.equal(refined.sermonCount, 4, "sermon count increments once");
  const accuracy = refined.accuracy.split("\n");
  assert.ok(accuracy.includes("열방 → the nations (en)"));
  assert.ok(!accuracy.includes("열방 → nirvana (en)"), "newer correction replaces the older one");
  assert.ok(accuracy.includes("항존직 → permanent office (en)"));
  assert.ok(accuracy.includes("열반을 → 열방을"));
  const natural = refined.naturalness.split("\n");
  assert.deepEqual(natural, ["Let us do prayer → Let us pray (en)", "I bless you that → May you (en)"]);
  assert.equal(refined.samples, undefined, "translation samples are not stored in the profile");

  let long = "";
  for (let i = 0; i < 80; i++) long += `표현${i} → phrase ${i} (en)\n`;
  const capped = mergeProfile(refined, { accuracy: long, naturalness: long });
  assert.ok(capped.accuracy.split("\n").length <= 40);
  assert.ok(capped.naturalness.length <= 2000);
  assert.match(capped.accuracy, /표현79/, "keeps the newest");
});

test("model failure still saves the raw lesson once", async () => {
  const lesson = lessonFromLines(
    [{ heard: "열반을 축복합니다", corrected: "열방을 축복합니다" }],
    { pauses: [{ tail: "께서", before: "하나님께서", after: "우리를" }, { tail: "께서", before: "주님께서", after: "오늘" }] },
  );
  const profile = { name: "김목사", sermonCount: 1, traits: "천천히", terms: "이른비" };
  for (const fetchImpl of [
    async () => { throw new Error("network down"); },
    async () => ({ ok: false, json: async () => ({ error: { message: "quota" } }) }),
    async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }),
  ]) {
    const saved = await refineProfile({ apiKey: "sk-test", profile, lesson, fetchImpl });
    assert.equal(saved.sermonCount, 2);
    assert.equal(saved.traits, "천천히");
    assert.equal(saved.terms, "이른비");
    assert.match(saved.corrections, /열방을 축복합니다/);
    assert.equal(saved.accuracy, "열반을 → 열방을");
    assert.match(saved.pausePoints, /"께서" 뒤 쉼 2회/);
  }
  const offline = await refineProfile({ apiKey: "", profile, lesson });
  assert.equal(offline.sermonCount, 2);
  assert.equal(normalizeProfile({ name: "새" }).pausePoints, "");
});

test("engine stop saves the dataset even when the model call fails", async () => {
  const firebase = require("../broadcast/lib/firebase");
  const { Engine } = require("../broadcast/lib/engine");
  const original = { ...firebase };
  const originalFetch = globalThis.fetch;
  const saved = [];
  firebase.listPreachers = async () => [{ id: "kim-abcd", name: "김목사", sermonCount: 4, traits: "천천히", corrections: "", terms: "", pausePoints: '"께서" 뒤 쉼 1회', accuracy: "", naturalness: "" }];
  firebase.savePreacher = async (churchId, id, profile) => { saved.push({ churchId, id, profile }); return profile; };
  firebase.update = async () => null;
  firebase.set = async () => null;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const engine = new Engine(() => {});
    engine.running = true;
    engine.church = { id: "grace-ab", name: "은혜교회" };
    engine.preacherId = "kim-abcd";
    engine.folderName = "2026-10-04_11-00-00";
    engine.sessionApiKey = "sk-test";
    engine.pipeline = {
      stop: async () => {},
      lessons: [{ heard: "열반을 축복합니다", corrected: "열방을 축복합니다" }],
      pauses: [{ tail: "께서", before: "하나님께서", after: "우리를" }, { tail: "께서", before: "주님께서", after: "오늘" }],
      samples: [{ ko: "열방을 축복합니다", lang: "en", text: "We bless the nations" }],
    };
    await engine.stop();
  } finally {
    Object.assign(firebase, original);
    globalThis.fetch = originalFetch;
  }
  assert.equal(saved.length, 1);
  assert.equal(saved[0].churchId, "grace-ab");
  assert.equal(saved[0].profile.sermonCount, 5);
  assert.match(saved[0].profile.pausePoints, /"께서" 뒤 쉼 3회/);
  assert.equal(saved[0].profile.accuracy, "열반을 → 열방을");
});

test("next broadcast feeds the dataset into recognition and translation", () => {
  const preacher = {
    name: "김목사",
    traits: "천천히",
    pausePoints: '"께서" 뒤 쉼 5회 — 하나님께서 / 우리를',
    accuracy: "열반을 → 열방을\n항존직 → permanent office (en)",
    naturalness: "Let us do prayer → Let us pray (en)",
  };
  const context = catalog.sessionContextText({ preacher });
  assert.match(context, /말 끊는 위치\(문장이 이어짐\): "께서" 뒤 쉼 5회/);
  assert.match(context, /정확도 교정: 열반을 → 열방을/);
  assert.match(context, /자연스러움 교정: Let us do prayer → Let us pray/);
  assert.match(catalog.sttPrompt("은혜교회", context), /정확도 교정/);
  const words = catalog.contextKeywords(null, preacher);
  assert.ok(words.includes("열방을"));
  assert.ok(!words.includes("permanent office"));
  const { buildPrompt } = require("../broadcast/lib/translator");
  const prompt = buildPrompt("하나님께서", ["en"], { sessionContext: context });
  assert.match(prompt, /자연스러움 교정이 있으면 그 표현을 우선하라/);
  assert.match(prompt, /Let us pray/);
});
