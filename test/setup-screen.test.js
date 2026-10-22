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
  assert.deepEqual(missingSetup({
    folder: "/tmp/talks",
    folderReady: false,
    preacherId: "kim",
    sessionKind: "강의",
    targets: ["en"],
    deviceKey: "core:0",
  }), ["저장 폴더"]);
});

test("the top of the app is settings, start, and stop, and start opens settings until setup is done", () => {
  const html = read("broadcast/renderer/index.html");
  const renderer = read("broadcast/renderer/renderer.js");
  const actions = html.slice(html.indexOf('id="broadcastActions"'), html.indexOf('id="costCard"'));
  assert.match(actions, /id="openSettings">설정</);
  assert.match(actions, /id="start">시작</);
  assert.match(html, /id="confirmStart">시작확인</);
  assert.doesNotMatch(actions, /id="start">시작확인</);
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
  const phoneAt = html.indexOf('id="phoneJoinCard"');
  const inputAt = html.indexOf('id="inputCard"');
  assert.ok(settingsAt < folderAt && settingsAt < preacherAt && settingsAt < deviceAt && settingsAt < langsAt);
  assert.ok(langsAt < phoneAt && phoneAt < inputAt && inputAt < deviceAt, "languages stay above phones, and the input card sits below the phone card");
  const preacherCard = html.slice(html.indexOf('id="preacherGlance"'), html.indexOf('id="langGlance"'));
  assert.match(preacherCard, /id="showPreacherName"/);
  assert.match(preacherCard, /강연자 이름을 자막에 표시/);
  assert.ok(preacherCard.indexOf('id="showPreacherName"') < preacherCard.indexOf("말투와 교정"));
  assert.ok(preacherCard.indexOf('id="terms"') < preacherCard.indexOf('id="addPreacher"'));
  assert.match(preacherCard, /id="sensitivity"/);
  assert.match(html, /id="kindGlance"/);
  assert.match(html, /id="langGlance"/);
  assert.match(html, /id="phoneGlance"/);
  assert.match(html, /id="inputGlance"/);
  assert.match(html, /id="folderGlance"/);
  assert.match(html, /id="styleGlance"/);
  assert.doesNotMatch(html.slice(html.indexOf('id="settingsPanel"'), html.indexOf('id="operator"')), /<details class="card fold"[^>]*open/);
  const phoneCard = html.slice(phoneAt, html.indexOf('<details class="card fold" id="inputCard">'));
  assert.match(phoneCard, /id="phoneGlance"/);
  assert.ok(phoneCard.indexOf('id="phoneGlance"') < phoneCard.indexOf("<details"));
  assert.doesNotMatch(phoneCard, /<details class="card fold"/);
  const desks = renderer.slice(renderer.indexOf("function renderPhoneDesks"), renderer.indexOf("function showPhoneJoin"));
  const mountOrder = [
    "appendPhoneLive(wrap",
    "appendSpokenControl(wrap",
    "appendPhoneNameEditor(wrap",
    "appendPhoneNameSwitch(wrap",
    "wrap.append(qr, qrHint)",
    'appendSpeechStyle(wrap, { ...view, source: "phone" }',
  ];
  let cursor = -1;
  mountOrder.forEach((piece) => {
    const found = desks.indexOf(piece, cursor + 1);
    assert.ok(found > cursor, piece);
    cursor = found;
  });
  assert.match(desks, /appendPhoneNameEditor\(wrap/);
  assert.match(desks, /phone-qr/);
  assert.match(desks, /말하는 언어|appendSpokenControl/);
  assert.match(desks, /spoken-full/);
  const channels = renderer.slice(renderer.indexOf("function renderChannels"), renderer.indexOf("function deskChannelIndex"));
  assert.match(channels, /if \(row && row\.source === "phone"\) return/);
  assert.match(channels, /appendSpokenControl/);
  assert.match(channels, /appendCaptionNameField/);
  assert.ok(channels.indexOf("appendCaptionNameField") < channels.indexOf("appendCaptionNameSwitch"));
  assert.match(channels, /appendCaptionNameSwitch/);
  assert.match(renderer.slice(renderer.indexOf("function appendCaptionNameSwitch"), renderer.indexOf("function renderChannels")), /이 이름을 자막에 표시/);
  assert.match(channels, /appendSpeechStyle/);
  assert.match(channels, /spoken-full/);
  assert.match(channels, /말하는 언어/);
  const css = read("broadcast/renderer/styles.css");
  assert.match(css, /select\.spoken-full \{\s*display: block;\s*width: 100%;/);
  assert.match(css, /\.spoken-face \{[^}]*width: 100%;/);
  assert.match(css, /details\.fold\.card:not\(\[open\]\) > :not\(summary\)/);
  assert.match(renderer, /spoken-face/);
  assert.match(renderer, /function paintSpokenFace/);
  assert.match(renderer.slice(renderer.indexOf("function appendSpokenControl"), renderer.indexOf("function appendCaptionNameSwitch")), /spokenTitle/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf("function appendPhoneNameEditor"), renderer.indexOf("function applyPhoneDisplay")), /if \(!phoneJoined\(view\)\) return/);
  const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
  assert.match(header, /class="header-status"[\s\S]*id="prepaidTime"[\s\S]*id="status"/);
  assert.doesNotMatch(header.slice(header.indexOf('class="title-block"'), header.indexOf('class="header-status"')), /id="prepaidTime"/);
  const costCard = html.slice(html.indexOf('id="costCard"'), html.indexOf('id="startConfirm"'));
  assert.doesNotMatch(costCard, /id="prepaidTime"|<h2>남은 시간<\/h2>/);
  assert.match(html, /id="prepaidTime"/);
  assert.match(html, /id="balanceCost"/);
  assert.match(html, /id="churchCost"/);
  assert.match(html, /id="live"/);
  assert.match(renderer, /getElementById\("churchLine"\)\.textContent = "이 계정으로 로그인했습니다\."/);
  assert.doesNotMatch(renderer, /\$\{[^}]+\} 계정으로 로그인했습니다/);
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
  assert.match(html, /id="closeSettings"/);
  assert.match(renderer, /준비완료/);
  assert.match(renderer, /folderReady/);
  assert.match(renderer, /setupClosed/);
  const closeFn = renderer.slice(renderer.indexOf("function closeSettings"), renderer.indexOf("function paintFolderHint"));
  assert.match(closeFn, /missingSetup/);
  assert.match(closeFn, /return/);
  assert.match(closeFn, /setupClosed:\s*true/);
  const bootFn = renderer.slice(renderer.indexOf("async function boot"), renderer.indexOf("window.broadcast.onEvent"));
  assert.match(bootFn, /!\(state\.settings && state\.settings\.setupClosed\)\) openSettings\(\)/);
  const main = read("broadcast/main.js");
  assert.match(main, /securityScopedBookmarks:\s*true/);
  assert.match(main, /startAccessingSecurityScopedResource/);
  assert.match(main, /delete copy\.folderBookmark/);
  const startMain = main.slice(main.indexOf('ipcMain.handle("broadcast:start"'), main.indexOf('ipcMain.handle("broadcast:stop"'));
  assert.ok(startMain.indexOf("openSavedFolder") < startMain.indexOf("engine.start"));
  assert.match(startMain, /고른 폴더에 기록을 만들 수 없습니다/);
  const settingsBlock = html.slice(settingsAt, html.indexOf('id="heardTitle"'));
  assert.doesNotMatch(settingsBlock, /id="start"|id="stop"/);
  assert.match(settingsBlock, /id="sensitivity"/);
  assert.match(settingsBlock, /id="channels"/);
  assert.match(settingsBlock, /id="pickBulletin"/);
  assert.match(settingsBlock, /id="subtitleStyleCard"/);
  assert.match(settingsBlock, /value="설교"/);
  assert.match(settingsBlock, /value="강의"/);
  assert.match(settingsBlock, /value="연설"/);
  assert.match(settingsBlock, /value="행사"/);
});
