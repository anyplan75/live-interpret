/**
 * 전체 관리자 교회의 초성·지역 찾기.
 * 지역은 저장된 region 만 본다. 이름에서 지역을 추정하지 않습니다.
 * 브라우저 스크립트와 Node require 둘 다 동작합니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.churchFind = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const REGIONS = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  ];
  const REGION_TABS = ["전체"].concat(REGIONS, ["지역 없음"]);
  const CONSONANT_TABS = ["전체", "ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ", "기타"];
  const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const FOLD = { "ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ" };
  const COMPAT = {
    "ㄱ": "ㄱ", "ㄲ": "ㄱ", "ㄴ": "ㄴ", "ㄷ": "ㄷ", "ㄸ": "ㄷ",
    "ㄹ": "ㄹ", "ㅁ": "ㅁ", "ㅂ": "ㅂ", "ㅃ": "ㅂ", "ㅅ": "ㅅ",
    "ㅆ": "ㅅ", "ㅇ": "ㅇ", "ㅈ": "ㅈ", "ㅉ": "ㅈ", "ㅊ": "ㅊ",
    "ㅋ": "ㅋ", "ㅌ": "ㅌ", "ㅍ": "ㅍ", "ㅎ": "ㅎ",
  };

  function normalizeRegion(value) {
    const text = typeof value === "string" ? value.trim() : "";
    return REGIONS.indexOf(text) >= 0 ? text : "";
  }

  function foldCho(cho) {
    if (!cho) return "기타";
    return FOLD[cho] || cho;
  }

  function leadingConsonant(name) {
    const text = String(name == null ? "" : name).replace(/^\s+/, "");
    if (!text) return "기타";
    const code = text.codePointAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      return foldCho(CHO[Math.floor((code - 0xac00) / 588)]);
    }
    const ch = String.fromCodePoint(code);
    if (COMPAT[ch]) return COMPAT[ch];
    if (code >= 0x1100 && code <= 0x1112) return foldCho(CHO[code - 0x1100]);
    return "기타";
  }

  function regionMatches(church, tab) {
    if (!tab || tab === "전체") return true;
    const region = normalizeRegion(church && church.region);
    if (tab === "지역 없음") return region === "";
    return region === tab;
  }

  function consonantMatches(church, tab) {
    if (!tab || tab === "전체") return true;
    return leadingConsonant(church && church.name) === tab;
  }

  function matches(church, regionTab, consonantTab) {
    return regionMatches(church, regionTab) && consonantMatches(church, consonantTab);
  }

  function count(rows, regionTab, consonantTab) {
    const list = Array.isArray(rows) ? rows : [];
    let total = 0;
    list.forEach((church) => {
      if (matches(church, regionTab, consonantTab)) total += 1;
    });
    return total;
  }

  function finderView(rows, regionTab, consonantTab) {
    const list = Array.isArray(rows) ? rows : [];
    const region = REGION_TABS.indexOf(regionTab) >= 0 ? regionTab : "전체";
    const consonant = CONSONANT_TABS.indexOf(consonantTab) >= 0 ? consonantTab : "전체";
    const shown = list.filter((church) => matches(church, region, consonant));
    let empty = "";
    if (!list.length) empty = "아직 교회가 없습니다.";
    else if (!shown.length) empty = "해당하는 교회가 없습니다.";
    return {
      regionTab: region,
      consonantTab: consonant,
      regionTabs: REGION_TABS.map((id) => ({ id, count: count(list, id, consonant) })),
      consonantTabs: CONSONANT_TABS.map((id) => ({ id, count: count(list, region, id) })),
      churches: shown,
      empty,
    };
  }

  return {
    REGIONS,
    REGION_TABS,
    CONSONANT_TABS,
    normalizeRegion,
    leadingConsonant,
    matches,
    count,
    finderView,
  };
});
