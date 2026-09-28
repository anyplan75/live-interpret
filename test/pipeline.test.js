const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pipeline } = require("../broadcast/lib/pipeline");
const { createSessionWriter } = require("../broadcast/lib/files");

test("pipeline saves per-language text and never audio", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-interpret-pipe-"));
  const writer = createSessionWriter(root, "은혜교회", new Date(2026, 8, 28, 9, 30, 0));
  const cloud = [];
  const translated = [];
  const pipeline = new Pipeline({
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    targets: ["en", "ja"],
    glossary: "용어",
    files: writer,
    cloud: {
      async updateSubtitles(payload) { cloud.push(["live", payload]); },
      async setText(lang, text) { cloud.push(["text", lang, text]); },
    },
    translateImpl: async (text, opts) => {
      translated.push({ text, glossary: opts.glossary, targets: opts.targetCodes });
      return { ko: `교정 ${text}`, en: `EN ${text}`, ja: `JA ${text}` };
    },
  });

  pipeline.onFinalChunk("네네네");
  pipeline.onFinalChunk("오늘 하나님은 우리를 사랑하십니다.");
  pipeline.onFinalChunk("주님께서");
  await pipeline.chain;
  assert.equal(translated.length, 1);

  pipeline.lastSpeechTime = Date.now() - 7000;
  pipeline.tick();
  await pipeline.stop();

  const names = fs.readdirSync(writer.dir).sort();
  assert.deepEqual(names, ["en.txt", "ja.txt", "ko.txt"]);
  const ko = fs.readFileSync(path.join(writer.dir, "ko.txt"), "utf8");
  assert.match(ko, /사랑하십니다/);
  assert.match(ko, /주님께서/);
  assert.equal(ko.includes("네네네"), false);
  const stored = cloud.filter((row) => row[0] === "text" && row[1] === "ko").at(-1);
  assert.equal(stored[2], ko.trim());
  assert.equal(translated[0].glossary, "용어");
  assert.equal(path.basename(path.dirname(writer.dir)), "은혜교회");
  assert.equal(path.basename(writer.dir), "2026-09-28_09-30-00");
  fs.rmSync(root, { recursive: true, force: true });
});
