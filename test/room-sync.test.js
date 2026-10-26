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
      { key: "c:0", live: false, name: "사회자" },
      { key: "p:AB23CD", live: true, name: "손님" },
      { key: "bad", live: true, name: "버림" },
    ],
  });
  assert.equal(desired.rev, 1);
  assert.deepEqual(desired.targets, ["en"]);
  const plan = room.actionsFor(0, desired);
  assert.equal(plan.rev, 1);
  assert.deepEqual(plan.actions.map((item) => item.type), ["showName", "languages", "running", "input", "input"]);
  assert.equal(plan.actions[0].on, false);
  assert.equal(plan.actions[2].on, true);
  assert.deepEqual(room.actionsFor(1, desired).actions, []);
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
  assert.equal(board.board.heard[0].body, "듣는 말");
  assert.equal(JSON.stringify(board).includes("자막 원문"), false);
  assert.equal(board.phaseLabel, "대기");
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
  assert.match(roomHtml, /id="device"/);
  assert.match(roomHtml, /id="phoneDesks"/);
  assert.match(roomHtml, /연결 번호/);
  assert.match(settingsHtml, /id="start"/);
  assert.match(settingsHtml, /id="stop"/);
  assert.match(settingsHtml, /id="langs"/);
  assert.match(settingsHtml, /id="showName"/);
  assert.match(settingsHtml, /남은 충전금/);
  assert.match(settingsHtml, /id="operator"/);
  assert.match(settingsHtml, /id="testPeriod"/);
  assert.doesNotMatch(settingsHtml, /id="device"|설교|교회/);
});
