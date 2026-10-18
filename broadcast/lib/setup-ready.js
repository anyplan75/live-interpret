/**
 * 시작 전에 운영자가 맞춰야 하는 항목.
 * 비어 있는 것을 한 목록으로 돌려주고, 설교자가 한 명이면 그 사람을 고른다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SetupReady = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function missingSetup(input) {
    const source = input && typeof input === "object" ? input : {};
    const gaps = [];
    if (!String(source.folder || "").trim()) gaps.push("저장 폴더");
    if (!String(source.preacherId || "").trim()) gaps.push("설교자");
    const targets = Array.isArray(source.targets) ? source.targets.filter(Boolean) : [];
    if (!targets.length) gaps.push("번역할 언어");
    if (!String(source.deviceKey || "").trim()) gaps.push("입력 장치");
    return gaps;
  }

  function preacherToSelect(preachers, savedId) {
    const list = Array.isArray(preachers) ? preachers.filter((item) => item && item.id) : [];
    const saved = String(savedId || "");
    if (saved && list.some((item) => item.id === saved)) return saved;
    if (list.length === 1) return String(list[0].id);
    return "";
  }

  return { missingSetup, preacherToSelect };
});
