const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const room = require("../broadcast/lib/room-sync");

const root = path.join(__dirname, "..");

test("a newer settings revision becomes engine actions in a fixed order", () => {
  const desired = room.withRev(null, {
    running: true,
    spoken: "ko",
    targets: ["en", "ko", "nope", "en"],
    showName: false,
    inputs: [
      { key: "c:0", live: false, name: "사회자", spoken: "en" },
      { key: "p:AB23CD", live: true, name: "손님", spoken: "ja" },
      { key: "bad", live: true, name: "버림" },
    ],
  });
  assert.equal(desired.rev, 1);
  assert.deepEqual(desired.targets, ["en"]);
  assert.equal(desired.inputs[0].spoken, "en");
  assert.equal(desired.inputs[1].spoken, "ja");
  const plan = room.actionsFor(0, desired);
  assert.equal(plan.rev, 1);
  assert.deepEqual(plan.actions.map((item) => item.type), ["showName", "languages", "running", "input", "input"]);
  assert.equal(plan.actions[0].on, false);
  assert.equal(plan.actions[2].on, true);
  assert.equal(plan.actions[3].spoken, "en");
  assert.deepEqual(room.actionsFor(1, desired).actions, []);
});

test("desired keeps 설교 and runs start before phones or sheet", () => {
  const sheetImage = "A".repeat(80);
  const desired = room.withRev(null, {
    running: true,
    spoken: "ko",
    targets: ["en"],
    sessionKind: "설교",
    phoneCount: 1,
    preacherName: "준",
    sheet: { name: "순서.jpg", image: sheetImage },
  });
  assert.equal(desired.sessionKind, "설교");
  const types = room.actionsFor(0, desired).actions.map((item) => item.type);
  assert.ok(types.indexOf("running") < types.indexOf("phones"));
  assert.ok(types.indexOf("running") < types.indexOf("sheet"));
  assert.equal(types.includes("kind"), true);
  const kind = room.actionsFor(0, desired).actions.find((item) => item.type === "kind");
  assert.equal(kind.sessionKind, "설교");
});

test("status and desired keep every mic channel of a 32-input device", () => {
  const many = [];
  for (let i = 0; i < 32; i += 1) many.push({ key: `c:${i}`, live: i === 0, name: `마이크${i + 1}`, spoken: "ko" });
  many.push({ key: "p:AB23CD", live: true, name: "손님", spoken: "ja" });
  const desired = room.withRev(null, { running: false, spoken: "ko", targets: ["en"], inputs: many });
  assert.equal(desired.inputs.length, 33);
  assert.equal(desired.inputs[31].key, "c:31");
  assert.equal(desired.inputs[32].key, "p:AB23CD");
  const status = room.publicStatus({
    updatedAt: 1,
    online: true,
    running: false,
    spoken: "ko",
    targets: ["en"],
    inputs: many.map((row, index) => ({
      ...row,
      kind: row.key.startsWith("p:") ? "phone" : "mic",
      title: row.key.startsWith("p:") ? "휴대폰" : `채널 ${index + 1}`,
      level: 0.2,
      connected: true,
    })),
  });
  assert.equal(status.inputs.length, 33);
  assert.equal(status.inputs[31].key, "c:31");
  assert.equal(status.inputs[15].key, "c:15");
  const rejected = room.withRev(null, {
    spoken: "ko",
    targets: ["en"],
    inputs: [{ key: "c:64", live: true, name: "밖" }, { key: "c:0", live: true, name: "첫" }],
  });
  assert.deepEqual(rejected.inputs.map((row) => row.key), ["c:0"]);
});

test("status keeps connection facts and drops secrets", () => {
  const status = room.publicStatus({
    updatedAt: 10,
    online: true,
    running: true,
    balanceLabel: "50,000원",
    remainingLabel: "남은 시간 53:22",
    sessionLabel: "이번 0원",
    notice: "충전금이 부족합니다",
    spoken: "ko",
    targets: ["ja"],
    showName: true,
    inputs: [{
      key: "p:A9MVHT",
      kind: "phone",
      title: "휴대폰 1",
      name: "준",
      level: 1.4,
      live: true,
      connected: true,
      joinUrl: "https://anyplan75.github.io/live-interpret/lecture/?c=A9MVHT&s=abc",
      password: "nope",
    }],
    password: "secret",
  });
  assert.equal(status.inputs[0].level, 1);
  assert.equal(status.inputs[0].code, "A9MVHT");
  assert.equal(JSON.stringify(status).includes("secret"), false);
  assert.equal(JSON.stringify(status).includes("password"), false);
  const board = room.publicStatus({
    updatedAt: 1,
    online: true,
    running: false,
    sessionKind: "설교",
    board: { live: "지금", heard: [{ id: "1", body: "듣는 말", fixes: ["교정"], text: "숨김" }] },
    text: "자막 원문",
    logs: [{ level: "info", body: "방송을 기다리는 중입니다." }],
  });
  assert.equal(board.sessionKind, "");
  // 대기일 때는 이전 방송의 듣는 말·교정이 모니터에 남지 않습니다.
  assert.deepEqual(board.board, { live: "", heard: [], cards: [] });
  assert.equal(JSON.stringify(board).includes("자막 원문"), false);
  assert.equal(JSON.stringify(board).includes("듣는 말"), false);
  assert.equal(board.phaseLabel, "대기");
  const liveBoard = room.publicStatus({
    running: true,
    board: { live: "지금", heard: [{ id: "1", body: "듣는 말", fixes: ["교정"], text: "숨김" }] },
  });
  assert.equal(liveBoard.board.heard[0].body, "듣는 말");
  assert.equal(liveBoard.board.live, "지금");
  assert.equal(liveBoard.phaseLabel, "방송 중");
});

test("a stream patch updates one field and a put replaces the record", () => {
  const first = room.applyStreamEvent(null, "put", JSON.stringify({
    path: "/",
    data: { rev: 1, running: false, spoken: "ko" },
  }));
  const next = room.applyStreamEvent(first, "patch", JSON.stringify({
    path: "/",
    data: { running: true },
  }));
  assert.equal(next.running, true);
  assert.equal(next.rev, 1);
  const replaced = room.applyStreamEvent(next, "put", JSON.stringify({ path: "/", data: { rev: 2 } }));
  assert.equal(replaced.running, undefined);
  assert.equal(replaced.rev, 2);
});

test("the broadcast window is hardware only and the settings window owns start", () => {
  const main = fs.readFileSync(path.join(root, "broadcast/main.js"), "utf8");
  const roomHtml = fs.readFileSync(path.join(root, "broadcast/renderer/room.html"), "utf8");
  const settingsHtml = fs.readFileSync(path.join(root, "settings/renderer/index.html"), "utf8");
  assert.match(main, /renderer", "room\.html"/);
  const entry = fs.readFileSync(path.join(root, "desktop.js"), "utf8");
  assert.match(entry, /--settings/);
  assert.match(entry, /broadcast\/main\.js/);
  const openSettings = main.slice(main.indexOf("function openSettingsApp"), main.indexOf("function send"));
  assert.match(openSettings, /https:\/\/anyplan75\.github\.io\/live-interpret\/desk\//);
  assert.match(openSettings, /shell\.openExternal/);
  assert.doesNotMatch(openSettings, /spawn\(/);
  assert.doesNotMatch(roomHtml, /id="start"|id="operator"|설교|교회/);
  assert.doesNotMatch(roomHtml, /id="langs"|id="pickBulletin"|진행자료|감도/);
  assert.match(roomHtml, /id="device"/);
  assert.match(roomHtml, /id="phoneDesks"/);
  assert.match(roomHtml, /id="phoneCountBox"/);
  assert.match(roomHtml, /id="captionLinks"/);
  assert.match(roomHtml, /id="overlayLinks"/);
  assert.match(roomHtml, /자막링크/);
  assert.match(roomHtml, /OBS 오버레이/);
  assert.doesNotMatch(roomHtml, /성도/);
  assert.match(roomHtml, /연결 번호/);
  assert.match(roomHtml, /설정 사이트/);
  assert.match(roomHtml, /모든 설정을 보고 「시작」을 누르세요/);
  assert.match(roomHtml, /id="waitStartHint"/);
  const roomJs = fs.readFileSync(path.join(root, "broadcast/renderer/room.js"), "utf8");
  assert.match(roomJs, /paintOverlays|overlayQr|OBS-\$\{item\.code\}/);
  assert.match(roomJs, /자막링크/);
  assert.match(roomJs, /device\.inputChannels \|\| device\.channels/);
  assert.doesNotMatch(roomJs, /item\.listen/);
  const engineSrc = fs.readFileSync(path.join(root, "broadcast/lib/engine.js"), "utf8");
  assert.match(engineSrc, /this\.ensureDeviceSlots\(\);\s*if \(picked\.switched\)/s);
  const syncSrc = fs.readFileSync(path.join(root, "docs/js/room-sync.js"), "utf8");
  assert.match(syncSrc, /MAX_MIC_CHANNELS = 64/);
  assert.doesNotMatch(syncSrc, /1\[0-5\]/);
  assert.match(main, /width:\s*520/);
  assert.match(main, /height:\s*760/);
  assert.match(main, /save-image|caption-links|mirrorDesiredPhoneCount/);
  assert.match(main, /fromDesired:\s*true/);
  assert.match(main, /clearDesiredRunning/);
  assert.match(main, /ignoreStaleDesiredStart/);
  assert.match(main, /shutdownBroadcast/);
  assert.match(main, /preachers\.some\(\(row\) => row && row\.id === preacherId\)/);
  assert.match(main, /before-quit[\s\S]*shutdownBroadcast/s);
  assert.match(settingsHtml, /id="start"/);
  assert.match(settingsHtml, /id="stop"/);
  assert.match(settingsHtml, /id="langs"/);
  assert.match(settingsHtml, /id="showName"/);
  assert.match(settingsHtml, /남은 충전금/);
  assert.match(settingsHtml, /id="operator"/);
  assert.match(settingsHtml, /id="testPeriod"/);
  assert.doesNotMatch(settingsHtml, /id="device"|설교|교회/);
});
