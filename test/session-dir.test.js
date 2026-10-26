const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pickSessionDir } = require("../settings/session-dir");

test("a settings window opened from the broadcast app reuses that login folder", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "li-home-"));
  const dir = path.join(home, "Library", "Application Support", "live-interpret");
  fs.mkdirSync(dir, { recursive: true });
  const picked = pickSessionDir({
    argv: ["app", "--settings", `--session-dir=${dir}`],
    env: {},
    appData: path.join(home, "Library", "Application Support"),
    home,
  });
  assert.equal(picked, dir);
  fs.rmSync(home, { recursive: true, force: true });
});

test("a settings window opened alone does not borrow another folder", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "li-home-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "li-other-"));
  assert.equal(pickSessionDir({
    argv: ["app", "--settings"],
    env: {},
    appData: path.join(home, "Library", "Application Support"),
    home,
  }), "");
  assert.equal(pickSessionDir({
    argv: ["app", `--session-dir=${outside}`],
    env: {},
    appData: path.join(home, "Library", "Application Support"),
    home,
  }), "");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("the room draws mic samples and the settings launch passes the login folder", () => {
  const root = path.join(__dirname, "..");
  const room = fs.readFileSync(path.join(root, "broadcast/renderer/room.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "broadcast/main.js"), "utf8");
  const settings = fs.readFileSync(path.join(root, "settings/main.js"), "utf8");
  assert.match(room, /event\.type === "levels"/);
  assert.match(room, /\* 140/);
  assert.match(main, /--session-dir=/);
  assert.match(main, /payload\.type === "levels"/);
  assert.match(settings, /pickSessionDir/);
  assert.match(settings, /setPath\("userData"/);
});
