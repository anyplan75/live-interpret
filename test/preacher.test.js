const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeProfile, lessonFromLines, matchPreacher, refineProfile } = require("../broadcast/lib/preacher");

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
