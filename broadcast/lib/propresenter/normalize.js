/**
 * ProPresenter 슬라이드 글자를 자막 입력용으로 다듬습니다.
 * 줄바꿈·공백을 정리하고, 선택으로 [Verse]/[Chorus] 같은 구역 라벨을 뺍니다.
 */

const SECTION_LABEL = /^\s*\[(?:Verse|Chorus|Bridge|Intro|Outro|Tag|Pre-?Chorus|Instrumental|Ending|Interlude|V\d+|C\d+)(?:\s*\d+)?\]\s*/i;

function collapseSpace(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function stripSectionLabels(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.replace(SECTION_LABEL, "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {string} raw
 * @param {{ stripLabels?: boolean }} [opts]
 * @returns {string} 한 줄로 이어 붙인 본문(자막·번역용). 빈 문자열이면 버림.
 */
function normalizeSlideText(raw, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  let body = collapseSpace(raw);
  if (options.stripLabels !== false) body = stripSectionLabels(body);
  return body.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 비교·중복 판별용. 구두점·대소문자 차이를 줄입니다.
 */
function fingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/["""''`]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 짧은 문장 유사도(0~1). 포함 관계·공통 토큰 비율을 봅니다.
 */
function similarity(a, b) {
  const left = fingerprint(a);
  const right = fingerprint(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    const short = Math.min(left.length, right.length);
    const long = Math.max(left.length, right.length);
    return short / long;
  }
  const leftWords = new Set(left.split(" ").filter(Boolean));
  const rightWords = new Set(right.split(" ").filter(Boolean));
  if (!leftWords.size || !rightWords.size) return 0;
  let hit = 0;
  leftWords.forEach((word) => {
    if (rightWords.has(word)) hit += 1;
  });
  return (2 * hit) / (leftWords.size + rightWords.size);
}

module.exports = {
  normalizeSlideText,
  collapseSpace,
  stripSectionLabels,
  fingerprint,
  similarity,
};
