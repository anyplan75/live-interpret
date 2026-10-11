const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const find = require("../docs/js/church-find");

function syllable(choIndex) {
  return String.fromCharCode(0xac00 + choIndex * 21 * 28);
}

test("leading consonants fold double initials and ignore a leading space", () => {
  const expected = {
    0: "ㄱ", 1: "ㄱ", 2: "ㄴ", 3: "ㄷ", 4: "ㄷ", 5: "ㄹ", 6: "ㅁ", 7: "ㅂ", 8: "ㅂ",
    9: "ㅅ", 10: "ㅅ", 11: "ㅇ", 12: "ㅈ", 13: "ㅈ", 14: "ㅊ", 15: "ㅋ", 16: "ㅌ", 17: "ㅍ", 18: "ㅎ",
  };
  Object.entries(expected).forEach(([index, tab]) => {
    const name = syllable(Number(index)) + "교회";
    assert.equal(find.leadingConsonant(name), tab, name);
    assert.equal(find.leadingConsonant("  " + name), tab, name);
  });
  assert.equal(find.leadingConsonant("Grace"), "기타");
  assert.equal(find.leadingConsonant(" 123교회"), "기타");
  assert.equal(find.leadingConsonant(""), "기타");
  assert.equal(find.leadingConsonant("   "), "기타");
  assert.equal(find.leadingConsonant("ㄲ시작"), "ㄱ");
  assert.equal(find.leadingConsonant("\u1101시작"), "ㄱ");
  assert.equal(find.CONSONANT_TABS.includes("ㄲ"), false);
  assert.deepEqual(find.CONSONANT_TABS, ["전체", "ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ", "기타"]);
});

test("region comes only from the saved field and filters combine", () => {
  assert.deepEqual(find.REGIONS, [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  ]);
  assert.equal(find.normalizeRegion("경기"), "경기");
  assert.equal(find.normalizeRegion("지역 없음"), "");
  assert.equal(find.normalizeRegion("전체"), "");
  assert.equal(find.normalizeRegion(""), "");
  const rows = [
    { id: "a", name: "새로운교회", region: "경기" },
    { id: "b", name: "서울사랑", region: "" },
    { id: "c", name: "은혜", region: "경기" },
    { id: "d", name: "싸울교회", region: "서울" },
    { id: "e", name: "Grace", region: "제주" },
  ];
  assert.equal(find.matches(rows[1], "서울", "ㅅ"), false);
  assert.equal(find.matches(rows[1], "지역 없음", "ㅅ"), true);
  assert.equal(find.matches(rows[0], "경기", "ㅅ"), true);
  assert.equal(find.matches(rows[2], "경기", "ㅅ"), false);
  assert.equal(find.matches(rows[3], "서울", "ㅅ"), true);
  const view = find.finderView(rows, "경기", "ㅅ");
  assert.deepEqual(view.churches.map((row) => row.id), ["a"]);
  assert.equal(view.empty, "");
  assert.equal(view.regionTabs.length, find.REGION_TABS.length);
  assert.equal(view.consonantTabs.length, find.CONSONANT_TABS.length);
  assert.equal(view.regionTabs.find((tab) => tab.id === "부산").count, 0);
  assert.equal(view.regionTabs.find((tab) => tab.id === "경기").count, 1);
  assert.equal(view.regionTabs.find((tab) => tab.id === "전체").count, 3);
  assert.equal(view.consonantTabs.find((tab) => tab.id === "ㅇ").count, 1);
  assert.equal(view.consonantTabs.find((tab) => tab.id === "ㅅ").count, 1);
  const none = find.finderView(rows, "강원", "ㅎ");
  assert.equal(none.churches.length, 0);
  assert.equal(none.empty, "해당하는 교회가 없습니다.");
  assert.equal(none.regionTabs.find((tab) => tab.id === "강원").count, 0);
  const open = find.finderView(rows, "전체", "전체");
  assert.equal(open.churches.length, rows.length);
  assert.equal(find.finderView([], "전체", "전체").empty, "아직 교회가 없습니다.");
  assert.equal(find.finderView(rows, "없는지역", "ㄲ").regionTab, "전체");
  assert.equal(find.finderView(rows, "없는지역", "ㄲ").consonantTab, "전체");
});

test("admin page keeps both tab rows and an explicit region choice", () => {
  const root = path.join(__dirname, "..");
  const admin = fs.readFileSync(path.join(root, "docs/admin.html"), "utf8");
  const adminJs = fs.readFileSync(path.join(root, "docs/js/admin.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "docs/css/main.css"), "utf8");
  const rules = JSON.parse(fs.readFileSync(path.join(root, "firebase/live-interpret.rules.json"), "utf8"));
  assert.match(admin, /id="regionTabs"/);
  assert.match(admin, /id="consonantTabs"/);
  assert.match(admin, /id="churchRegion"/);
  assert.match(admin, /js\/church-find\.js/);
  assert.match(css, /\.region-tabs\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /\.region-tabs\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.consonant-tabs\s*\{[^}]*flex-direction:\s*column/);
  assert.match(adminJs, /finderView/);
  assert.match(adminJs, /view\.regionTabs/);
  assert.match(adminJs, /view\.consonantTabs/);
  assert.match(adminJs, /normalizeRegion\(row\.region\)/);
  assert.match(adminJs, /churches\/\$\{id\}\/region/);
  assert.doesNotMatch(adminJs, /name\.includes\(["']서울|regionFromName|inferRegion/);
  const church = rules["live-interpret"].churches.$churchId;
  assert.equal(church.region[".write"], church.name[".write"]);
  assert.match(church.region[".write"], /admin\/uid/);
  assert.doesNotMatch(church.region[".write"], /account\/uid/);
  assert.equal(church.region[".read"], church.createdAt[".read"]);
  find.REGIONS.forEach((label) => {
    assert.match(church.region[".validate"], new RegExp(`'${label}'`));
  });
  assert.doesNotMatch(church.region[".validate"], /지역 없음|전체/);
  const usage = church.live.usage[".validate"];
  assert.match(usage, /!newData\.child\('chars'\)\.exists\(\) \|\| newData\.child\('chars'\)\.hasChildren\(\)/);
  assert.match(church.billing.prepaid[".write"], /account\/uid/);
  assert.match(church.billing.prepaid[".validate"], /remainingSeconds/);
});
