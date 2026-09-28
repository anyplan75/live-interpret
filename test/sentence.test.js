const test = require("node:test");
const assert = require("node:assert/strict");
const sentence = require("../broadcast/lib/sentence");
const { timing } = require("../broadcast/lib/catalog");

test("cuts a finished sermon sentence and ignores noise", () => {
  const match = sentence.findCutMatch("오늘 하나님은 우리를 사랑하십니다.");
  assert.ok(match);
  assert.match("오늘 하나님은 우리를 사랑하십니다.".slice(0, match.index + match[0].length), /하십니다/);
  assert.equal(sentence.isNoise("네네네"), true);
  assert.equal(sentence.isNoise("아"), true);
  assert.equal(sentence.isHangingTail("주님께서"), true);
});

test("silence flush waits on a hanging tail until the hard limit", () => {
  assert.equal(sentence.canSilenceFlush("주님께서", 1000, timing), false);
  assert.equal(sentence.canSilenceFlush("주님께서", timing.silenceFlushMs + 10, timing), false);
  assert.equal(sentence.canSilenceFlush("주님께서", timing.silenceForceFlushMs, timing), true);
  assert.equal(sentence.canSilenceFlush("하나님은 사랑이십니다", timing.silenceFlushMs + 10, timing), true);
});
