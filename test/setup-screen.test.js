const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { missingSetup, preacherToSelect, SESSION_KINDS } = require("../broadcast/lib/setup-ready");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("a single registered speaker is selected and a saved choice stays", () => {
  assert.equal(preacherToSelect([{ id: "kim" }], ""), "kim");
  assert.equal(preacherToSelect([{ id: "kim" }, { id: "lee" }], ""), "");
  assert.equal(preacherToSelect([{ id: "kim" }, { id: "lee" }], "lee"), "lee");
  assert.equal(preacherToSelect([{ id: "kim" }], "missing"), "kim");
  assert.equal(preacherToSelect([], "kim"), "");
  assert.deepEqual(SESSION_KINDS, ["설교", "강의", "연설", "행사"]);
});

test("incomplete setup lists every missing choice at once", () => {
  assert.deepEqual(missingSetup({}), ["저장 폴더", "강연자", "내용", "번역할 언어", "입력 장치"]);
  assert.deepEqual(missingSetup({
    folder: "/tmp/talks",
    preacherId: "kim",
    sessionKind: "강의",
    targets: ["en"],
    deviceKey: "core:0",
  }), []);
  assert.deepEqual(missingSetup({
    folder: "  ",
    preacherId: "kim",
    sessionKind: "예배",
    targets: [],
    deviceKey: "core:0",
  }), ["저장 폴더", "내용", "번역할 언어"]);
});

test("the top of the app is settings, start, and stop, and start opens settings until setup is done", () => {
  const html = read("broadcast/renderer/index.html");
  const renderer = read("broadcast/renderer/renderer.js");
  const actions = html.slice(html.indexOf('id="broadcastActions"'), html.indexOf('id="costCard"'));
  assert.match(actions, /id="openSettings">설정</);
  assert.match(actions, /id="start">시작</);
  assert.match(actions, /id="stop"[^>]*>종료</);
  assert.doesNotMatch(actions, /방송 시작|방송 종료|폴더 선택|설교자|입력 장치/);
  assert.match(html, /id="settingsPanel"/);
  assert.match(html, /id="setupGaps"/);
  assert.match(html, /id="sessionKind"/);
  assert.match(html, /진행자료/);
  assert.match(html, /큐시트/);
  assert.match(html, /순서지/);
  assert.match(html, /강연자/);
  assert.match(html, /id="phoneCount"/);
  assert.doesNotMatch(html, /id="phoneQr"|id="addPhoneChannel"|id="phoneJoinUrl"|주보|설교자/);
  assert.match(html, /id="pickFolder"/);
  assert.match(html, /id="preacher"/);
  assert.match(html, /id="langs"/);
  assert.match(html, /id="device"/);
  const settingsAt = html.indexOf('id="settingsPanel"');
  const folderAt = html.indexOf('id="pickFolder"');
  const preacherAt = html.indexOf('id="preacher"');
  const deviceAt = html.indexOf('id="device"');
  const langsAt = html.indexOf('id="langs"');
  assert.ok(settingsAt < folderAt && settingsAt < preacherAt && settingsAt < deviceAt && settingsAt < langsAt);
  assert.match(html, /id="prepaidTime"/);
  assert.match(html, /id="balanceCost"/);
  assert.match(html, /id="churchCost"/);
  assert.match(html, /id="live"/);
  assert.match(renderer, /linkRow\("자막"/);
  assert.doesNotMatch(renderer, /linkRow\("성도"/);
  assert.match(renderer, /missingSetup/);
  assert.match(renderer, /preacherToSelect/);
  const startHandler = renderer.slice(renderer.indexOf('getElementById("start").addEventListener'), renderer.indexOf('getElementById("confirmCancel")'));
  const gapBranch = startHandler.slice(0, startHandler.indexOf("previewBilling"));
  assert.match(gapBranch, /missingSetup/);
  assert.match(gapBranch, /openSettings/);
  assert.match(gapBranch, /return/);
  assert.doesNotMatch(gapBranch, /시작 실패/);
  const settingsBlock = html.slice(settingsAt, html.indexOf('id="heardTitle"'));
  assert.match(settingsBlock, /id="sensitivity"/);
  assert.match(settingsBlock, /id="channels"/);
  assert.match(settingsBlock, /id="pickBulletin"/);
  assert.match(settingsBlock, /id="subtitleStyleCard"/);
  assert.match(settingsBlock, /value="설교"/);
  assert.match(settingsBlock, /value="강의"/);
  assert.match(settingsBlock, /value="연설"/);
  assert.match(settingsBlock, /value="행사"/);
});
