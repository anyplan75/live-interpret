/**
 * 화면에 보여주는 오류 문장.
 * 개발자용 영어 포장과 호출 스택은 빼고, 사람이 읽을 문장만 남긴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.UserText = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function userText(value) {
    let text = "";
    if (value && typeof value === "object") text = value.message ? String(value.message) : String(value);
    else text = value == null ? "" : String(value);
    const pieces = [];
    text.replace(/\r/g, "\n").split("\n").forEach((raw) => {
      const line = raw.trim();
      if (!line || /^at\s+\S/.test(line)) return;
      pieces.push(line);
    });
    let body = pieces.join(" ").trim();
    for (let i = 0; i < 6 && body; i += 1) {
      const next = body
        .replace(/^Uncaught \(in promise\)\s+/i, "")
        .replace(/^Error:\s+/i, "")
        .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
        .replace(/^Error occurred in handler for ['"][^'"]+['"]:\s*/i, "")
        .trim();
      if (next === body) break;
      body = next;
    }
    if (/Error invoking remote method|Error occurred in handler/i.test(body)) {
      const korean = body.match(/[가-힣].*/);
      body = korean ? korean[0].trim() : "";
    }
    if (!body) return "다시 시도해 주세요.";
    return body;
  }

  return { userText };
});
