/**
 * 채널 이름을 그 채널 자막과 함께 보여 줍니다.
 * 브라우저 스크립트와 Node require 둘 다 동작합니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.speakerLines = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function speakerCaption(name, text) {
    const body = String(text || "").trim();
    const who = String(name || "").trim();
    if (!body) return "";
    if (!who) return body;
    return `${who}: ${body}`;
  }

  function present(line) {
    const row = line && typeof line === "object" ? line : { text: line };
    const text = String(row.text || "").trim();
    const name = String(row.name || "").trim();
    return {
      id: row.id,
      text,
      name,
      isFinal: row.isFinal !== false,
      caption: speakerCaption(name, text),
    };
  }

  function entries(row) {
    if (row && row.lines && typeof row.lines === "object") {
      const list = Object.values(row.lines).map(present).filter((line) => line.text);
      if (list.length) return list;
    }
    if (row == null || row === "") return [];
    const one = present(typeof row === "object" ? row : { text: row });
    return one.text ? [one] : [];
  }

  return { speakerCaption, entries };
});
