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

test("translation keeps several sentences, then cuts near the target", () => {
  const several = "오늘 친구를 만났어요. 그리고 밥을 먹었어요. 날씨가 참 좋았어요.";
  assert.ok(several.length < sentence.TRANSLATE_MAX);
  assert.equal(sentence.translateBreak(several), 0);
  assert.equal(sentence.TRANSLATE_MAX, 140);
  assert.equal(sentence.TRANSLATE_WINDOW, 40);
  const unit = "오늘은 친구를 만났어요. ";
  let text = "";
  while (text.length <= sentence.TRANSLATE_MAX) text += unit;
  const at = sentence.translateBreak(text);
  const piece = text.slice(0, at).trim();
  assert.notEqual(at, sentence.TRANSLATE_MAX);
  assert.ok(Math.abs(at - sentence.TRANSLATE_MAX) <= sentence.TRANSLATE_WINDOW);
  assert.ok(piece.endsWith("."));
  assert.ok((piece.match(/\./g) || []).length >= 2);
  const clause = `${"그냥 ".repeat(46)}말은 했는데 ${"그냥 ".repeat(25)}`;
  const clauseAt = sentence.translateBreak(clause);
  assert.notEqual(clauseAt, sentence.TRANSLATE_MAX);
  assert.ok(clause.slice(0, clauseAt).trim().endsWith("했는데"));
  assert.ok(Math.abs(clauseAt - sentence.TRANSLATE_MAX) <= sentence.TRANSLATE_WINDOW);
  const early = `말은 했는데 ${"그냥 ".repeat(60)}`;
  const earlyAt = sentence.translateBreak(early);
  assert.equal(early[earlyAt], " ");
  assert.ok(!early.slice(0, earlyAt).trim().endsWith("했는데"));
  const paused = `${"그냥 ".repeat(40)}쉬고, ${"그냥 ".repeat(40)}`;
  const pauseAt = sentence.translateBreak(paused);
  assert.ok(paused.slice(0, pauseAt).trim().endsWith("쉬고,"));
  const stretch = Array.from({ length: 80 }, () => "그냥").join(" ");
  const spaceAt = sentence.translateBreak(stretch);
  assert.equal(stretch[spaceAt], " ");
  assert.ok(Math.abs(spaceAt - sentence.TRANSLATE_MAX) <= sentence.TRANSLATE_WINDOW);
  const word = `${"가".repeat(sentence.TRANSLATE_MAX + 20)} 다음`;
  assert.equal(word.slice(0, sentence.translateBreak(word), "가".repeat(sentence.TRANSLATE_MAX + 20));
  assert.notEqual(sentence.translateBreak(word), sentence.TRANSLATE_MAX);
  assert.equal(sentence.translateBreak("가".repeat(sentence.TRANSLATE_MAX + 20)), 0);
  const verse = `${"그냥 ".repeat(20)}3.16${" 그냥 ".repeat(40)}`;
  assert.ok(verse.slice(0, sentence.translateBreak(verse)).includes("3.16"));
});

test("silence flush waits on a hanging tail until the hard limit", () => {
  assert.equal(sentence.canSilenceFlush("주님께서", 1000, timing), false);
  assert.equal(sentence.canSilenceFlush("주님께서", timing.silenceFlushMs + 10, timing), false);
  assert.equal(sentence.canSilenceFlush("주님께서", timing.silenceForceFlushMs, timing), true);
  assert.equal(sentence.canSilenceFlush("하나님은 사랑이십니다", timing.silenceFlushMs + 10, timing), true);
});
