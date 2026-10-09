const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Pipeline } = require("../broadcast/lib/pipeline");
const { createHearing, IDLE } = require("../broadcast/renderer/hearing");
const sentence = require("../broadcast/lib/sentence");

const SPOKEN = "이 사안 말씀대로 한 일주일쯤에 미디어오늘에서 이걸 처음 보 안 됐어.";

function recorder(translate) {
  const events = [];
  const pipeline = new Pipeline({
    apiKey: "sk-test",
    targets: ["en"],
    onLive: (text) => events.push({ type: "live", text }),
    onHeard: (heard) => events.push({ type: "heard", ...heard }),
    onLine: (line) => events.push({ type: "line", ...line }),
    translateImpl: translate || (async (text) => ({ ko: `${text} (교정)`, en: `EN ${text}` })),
  });
  return { pipeline, events };
}

function heardOf(events) {
  return events.filter((event) => event.type === "heard");
}

function koLines(events) {
  return events.filter((event) => event.type === "line" && event.lang === "ko" && event.text);
}

test("the utterance in the yellow box moves down unchanged as a heard line", async () => {
  const { pipeline, events } = recorder();
  pipeline.onInterim("이 사안 말씀대로");
  pipeline.onInterim("이 사안 말씀대로 한 일주일쯤에 미디어오늘에서");
  pipeline.onFinalChunk(SPOKEN);
  pipeline.onInterim("그래서 저는");
  assert.deepEqual(events.filter((event) => event.type === "live").map((event) => event.text), [
    "이 사안 말씀대로",
    "이 사안 말씀대로 한 일주일쯤에 미디어오늘에서",
    "",
    "그래서 저는",
  ], "the yellow box only ever holds the utterance being heard");
  assert.deepEqual(heardOf(events).map((event) => event.text), [SPOKEN]);
  pipeline.lastSpeechTime = Date.now() - 7000;
  pipeline.tick();
  await pipeline.stop();
  assert.deepEqual(heardOf(events).map((event) => event.text), [SPOKEN, "그래서 저는"]);
  assert.deepEqual(koLines(events).map((line) => [line.raw, line.heardId]), [[SPOKEN, 1], ["그래서 저는", 2]]);
});

test("several sentences stay in the yellow box until the translation cap", () => {
  const live = "오늘 친구를 만났어요. 그리고 밥을 먹었어요. 날씨가 참 좋았어요. 내일은 또 만나요.";
  assert.ok(live.length < sentence.TRANSLATE_MAX);
  assert.ok(live.split(".").length > 3);
  const { pipeline, events } = recorder();
  pipeline.onInterim(live);
  pipeline.onInterim(`${live} 그래서 기대돼요.`);
  assert.equal(events.filter((event) => event.type === "live").at(-1).text, `${live} 그래서 기대돼요.`);
  assert.equal(heardOf(events).length, 0);
  assert.equal(koLines(events).length, 0);
});

test("a long stretch with no sentence ending is translated once it passes the cap", async () => {
  const { pipeline, events } = recorder(async (text) => ({ ko: `${text} (교정)`, en: `EN ${text}` }));
  const stretch = Array.from({ length: 90 }, () => "그냥").join(" ");
  assert.ok(stretch.length > sentence.TRANSLATE_MAX);
  pipeline.onInterim(stretch);
  await pipeline.chain;
  const heard = heardOf(events);
  const lines = koLines(events);
  assert.ok(heard.length >= 1);
  assert.ok(pipeline.interim.length <= sentence.TRANSLATE_MAX);
  assert.ok(pipeline.interim.split(/\s+/).every((word) => word === "그냥"));
  heard.forEach((item) => {
    assert.ok(item.text.length <= sentence.TRANSLATE_MAX + sentence.TRANSLATE_WINDOW);
    assert.ok(item.text.split(/\s+/).every((word) => word === "그냥"));
  });
  assert.equal(lines.length, heard.length);
  lines.forEach((line, index) => {
    assert.equal(line.raw, heard[index].text);
    assert.equal(line.heardId, heard[index].id);
    assert.ok(line.text.includes("(교정)"));
  });
  const again = recorder();
  const unit = "오늘은 친구를 만났어요. ";
  let several = "";
  while (several.length <= sentence.TRANSLATE_MAX) several += unit;
  again.pipeline.onInterim(several);
  const chunk = heardOf(again.events)[0];
  assert.ok(chunk);
  assert.ok((chunk.text.match(/\./g) || []).length >= 2, "more than one sentence stays together");
  assert.ok(chunk.text.endsWith("."));
  assert.notEqual(chunk.text.length, sentence.TRANSLATE_MAX);
  assert.ok(Math.abs(chunk.text.length - sentence.TRANSLATE_MAX) <= sentence.TRANSLATE_WINDOW);
  assert.ok(again.pipeline.interim.length > 0);
  assert.ok(again.pipeline.interim.length <= sentence.TRANSLATE_MAX);
  const clause = recorder(async (text) => ({ ko: `${text} (교정)`, en: `EN ${text}` }));
  const spoken = `${"그냥 ".repeat(46)}말은 했는데 ${"그냥 ".repeat(25)}`;
  clause.pipeline.onInterim(spoken);
  await clause.pipeline.chain;
  const cut = heardOf(clause.events)[0];
  assert.ok(cut.text.endsWith("했는데"));
  assert.notEqual(cut.text.length, sentence.TRANSLATE_MAX);
  const line = koLines(clause.events)[0];
  assert.equal(line.raw, cut.text);
  assert.equal(line.heardId, cut.id);
});

test("an empty final keeps what was shown, and noise or skipped speech stays heard", async () => {
  const { pipeline, events } = recorder(async (text) => ({ ko: text.includes("광고") ? "" : text, en: `EN ${text}` }));
  pipeline.onInterim("주님께 감사드립니다");
  pipeline.onFinalChunk("");
  pipeline.onFinalChunk("네네네");
  pipeline.onFinalChunk("광고 시간입니다.");
  await pipeline.chain;
  await pipeline.stop();
  const heard = heardOf(events);
  assert.deepEqual(heard.map((event) => event.text), ["주님께 감사드립니다", "네네네", "광고 시간입니다."]);
  assert.equal(koLines(events).length, 0);
  const skipped = events.find((event) => event.type === "line" && event.skipped);
  assert.equal(skipped.heardId, heard[2].id);
});

test("every correction names a heard line that was emitted before it", async () => {
  const { pipeline, events } = recorder(async (text) => ({ ko: text, en: `EN ${text}` }));
  pipeline.onFinalChunk("오늘 우리는 함께");
  pipeline.onFinalChunk("기도합니다. 하나님은 우리를 사랑하십니다.");
  pipeline.onFinalChunk("감사합니다.");
  await pipeline.chain;
  await pipeline.stop();
  const heard = heardOf(events);
  const lines = koLines(events);
  assert.equal(lines.length, 3);
  lines.forEach((line) => {
    const owner = events.findIndex((event) => event.type === "heard" && event.id === line.heardId);
    assert.ok(owner >= 0 && owner < events.indexOf(line), `${line.text} has its heard line first`);
  });
  assert.deepEqual(lines.map((line) => line.heardId), [heard[1].id, heard[1].id, heard[2].id]);
  assert.equal(lines[0].text, "오늘 우리는 함께 기도합니다.", "an identical correction still attaches to its heard line");
});

test("a correction cut from an earlier utterance stays under that utterance", async () => {
  const { pipeline, events } = recorder(async (text) => ({ ko: text, en: `EN ${text}` }));
  const longer = "사랑하는 형제자매 여러분 우리가 오늘 이 자리에 함께 모인 것은 하나님께서 우리 모두를 이 작은 교회로 부르셨기 때문이고 그 부르심 앞에서 우리는 모두 같은 마음으로 서 있습니다 여러분";
  pipeline.onFinalChunk(longer);
  await pipeline.chain;
  assert.equal(koLines(events).length, 0, "the sentence waits for more speech");
  pipeline.onFinalChunk("그리고 다음 주에도 우리는 함께");
  await pipeline.chain;
  const heard = heardOf(events);
  const lines = koLines(events);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text.endsWith("서 있습니다"), true);
  assert.equal(lines[0].heardId, heard[0].id);
  await pipeline.stop();
  assert.equal(koLines(events)[1].heardId, heard[1].id);
});

function fakeDocument() {
  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.className = "";
      this.dataset = {};
      this.scrollTop = 0;
      this.clientHeight = 100;
    }
    get scrollHeight() { return this.children.length * 40; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    get textContent() { return this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this.children = [{ textContent: String(value) }]; }
  }
  return {
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => ({ textContent: String(text) }),
    Node,
  };
}

function view() {
  const doc = fakeDocument();
  const liveEl = doc.createElement("div");
  const stackEl = doc.createElement("div");
  return { liveEl, stackEl, hearing: createHearing(doc, liveEl, stackEl) };
}

function rows(stackEl) {
  return stackEl.children.map((block) => block.children.map((p) => [p.className, p.children[1].textContent]));
}

test("the stack keeps heard lines oldest first and puts each correction under its heard line", () => {
  const { liveEl, stackEl, hearing } = view();
  hearing.live("이 사안 말씀대로");
  assert.equal(liveEl.textContent, "이 사안 말씀대로");
  hearing.heard(1, SPOKEN);
  hearing.live("");
  assert.equal(liveEl.textContent, IDLE);
  hearing.live("그래서 저는");
  hearing.heard(2, "그래서 저는");
  hearing.corrected(1, SPOKEN, "이 사안은 말씀대로 일주일쯤 전에 미디어오늘에서 처음 봤어요.");
  hearing.live("다음 말");
  hearing.corrected(2, "그래서 저는", "그래서 저는");
  assert.equal(liveEl.textContent, "다음 말", "a correction never clears the yellow box");
  hearing.heard(2, "다른 글");
  assert.deepEqual(rows(stackEl), [
    [["heard", SPOKEN], ["corrected", "이 사안은 말씀대로 일주일쯤 전에 미디어오늘에서 처음 봤어요."]],
    [["heard", "그래서 저는"], ["corrected", "그래서 저는"]],
  ]);
  assert.equal(stackEl.children[0].children[0].children[0].textContent, "듣는 말");
  assert.equal(stackEl.children[0].children[1].children[0].textContent, "교정");
});

test("a correction without its heard line falls back to the raw text or is not shown", () => {
  const { stackEl, hearing } = view();
  assert.equal(hearing.corrected(9, "", "교정만 있는 줄"), null);
  assert.equal(stackEl.children.length, 0);
  hearing.corrected(undefined, "원래 들은 말", "고친 말");
  assert.deepEqual(rows(stackEl), [[["heard", "원래 들은 말"], ["corrected", "고친 말"]]]);
  hearing.reset();
  assert.equal(stackEl.children.length, 0);
});

test("the broadcast window loads the hearing stack and wires heard events", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "broadcast/renderer/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "broadcast/renderer/renderer.js"), "utf8");
  const engine = fs.readFileSync(path.join(root, "broadcast/lib/engine.js"), "utf8");
  assert.ok(html.indexOf('src="hearing.js"') >= 0 && html.indexOf('src="hearing.js"') < html.indexOf('src="renderer.js"'));
  assert.match(renderer, /event\.type === "heard"/);
  assert.match(renderer, /hearing\.corrected\(event\.heardId/);
  assert.match(engine, /onHeard:.*type: "heard"/);
});

test("speech session keeps deltas when the transcript is empty and ignores a late transcript", async () => {
  const { SpeechSession } = require("../broadcast/lib/stt");
  const finals = [];
  const sent = [];
  const session = new SpeechSession({
    apiKey: "sk-test",
    onFinal: (text) => finals.push(text),
    fetchImpl: async () => ({ ok: true, json: async () => ({ text: "파일로 받은 말" }) }),
  });
  session.ready = true;
  session.ws = { readyState: 1, send: (data) => sent.push(JSON.parse(data)), close() {} };
  const say = (event) => session.handleMessage(JSON.stringify(event));
  const audio = Buffer.alloc(24000);

  const first = session.consume(audio, true);
  say({ type: "input_audio_buffer.committed", item_id: "a" });
  say({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "주님께 " });
  say({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "감사드립니다" });
  say({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "" });
  await first;
  assert.deepEqual(finals, ["주님께 감사드립니다"]);

  const realCommit = session.commitAndWait.bind(session);
  session.commitAndWait = () => realCommit(5);
  const second = session.consume(audio, true);
  say({ type: "input_audio_buffer.committed", item_id: "b" });
  await second;
  session.commitAndWait = realCommit;
  assert.deepEqual(finals, ["주님께 감사드립니다", "파일로 받은 말"]);

  const third = session.consume(audio, true);
  say({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "늦게 온 말" });
  say({ type: "input_audio_buffer.committed", item_id: "c" });
  say({ type: "conversation.item.input_audio_transcription.completed", item_id: "c", transcript: "셋째 말" });
  await third;
  assert.deepEqual(finals, ["주님께 감사드립니다", "파일로 받은 말", "셋째 말"]);
  assert.equal(sent.filter((event) => event.type === "input_audio_buffer.commit").length, 3);
});
