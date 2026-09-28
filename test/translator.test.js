const test = require("node:test");
const assert = require("node:assert/strict");
const { translate, buildPrompt } = require("../broadcast/lib/translator");
const { defaultGlossary } = require("../broadcast/lib/catalog");

function jsonResponse(obj, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { choices: [{ message: { content: JSON.stringify(obj) } }] } : { error: { message: "fail" } }),
  };
}

test("prompt carries the church glossary and correction rules", () => {
  const glossary = defaultGlossary("테스트교회");
  const prompt = buildPrompt("수여 기도회", ["en"], { glossary, previousContext: "이전 문장", koFixed: false });
  assert.match(prompt, /테스트교회/);
  assert.match(prompt, /항존직/);
  assert.match(prompt, /요약·삭제·임의 첨삭하지 마라/);
  assert.match(prompt, /이전 문장/);
  assert.match(prompt, /"en":/);
  const fixed = buildPrompt("교정문", ["ja"], { glossary, koFixed: true });
  assert.match(fixed, /이미 교정된 문장/);
});

test("translation batches languages and retries a bad JSON response", async () => {
  const calls = [];
  const targets = ["en", "zh-CN", "ja", "vi", "th", "id"];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const prompt = body.messages[0].content;
    calls.push({ prompt, temperature: body.temperature, model: body.model });
    if (calls.length === 1) return jsonResponse(null, true) && {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    };
    const payload = { ko: "수요 기도회입니다" };
    targets.forEach((code) => {
      if (prompt.includes(`"${code}"`)) payload[code] = code;
    });
    return jsonResponse(payload);
  };

  const result = await translate("수여 기도회입니다", {
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    targetCodes: targets,
    glossary: defaultGlossary("테스트교회"),
    fetchImpl,
    retryDelayMs: 0,
  });

  assert.equal(result.ko, "수요 기도회입니다");
  assert.equal(result.en, "en");
  assert.equal(result.id, "id");
  assert.ok(calls.length >= 3);
  assert.equal(calls[0].temperature, 0.15);
  assert.equal(calls[0].model, "gpt-4o-mini");
  assert.match(calls.at(-1).prompt, /이미 교정된 문장/);
  assert.match(calls[2].prompt, /테스트교회/);
});
