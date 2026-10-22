const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { useFolder, releaseFolder } = require("../broadcast/lib/folder-access");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "live-interpret-folder-"));
}

test("a store build cannot write until the chosen folder bookmark opens", () => {
  releaseFolder();
  const root = tempDir();
  let opened = 0;
  assert.equal(useFolder({ folder: root, mas: true, startAccess() { opened += 1; return () => {}; } }), false);
  assert.equal(opened, 0);
  let stopped = 0;
  assert.equal(useFolder({
    folder: root,
    bookmark: "bookmark-1",
    mas: true,
    startAccess() {
      opened += 1;
      return () => { stopped += 1; };
    },
  }), true);
  assert.equal(opened, 1);
  assert.equal(stopped, 0);
  assert.equal(useFolder({
    folder: root,
    bookmark: "bookmark-1",
    mas: true,
    startAccess() {
      opened += 1;
      return () => { stopped += 1; };
    },
  }), true);
  assert.equal(opened, 1);
  releaseFolder();
  assert.equal(stopped, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a missing or read-only folder is not ready", () => {
  releaseFolder();
  const root = tempDir();
  const missing = path.join(root, "gone");
  let stopped = 0;
  assert.equal(useFolder({
    folder: missing,
    bookmark: "bookmark-2",
    mas: true,
    startAccess() {
      return () => { stopped += 1; };
    },
  }), false);
  assert.equal(stopped, 1);
  assert.equal(useFolder({ folder: root, mas: false }), true);
  const blocked = path.join(root, "blocked");
  fs.mkdirSync(blocked);
  fs.chmodSync(blocked, 0o500);
  releaseFolder();
  assert.equal(useFolder({ folder: blocked, mas: false }), false);
  fs.chmodSync(blocked, 0o700);
  fs.rmSync(root, { recursive: true, force: true });
});

test("an unusable bookmark is closed and not kept", () => {
  releaseFolder();
  const root = tempDir();
  assert.equal(useFolder({
    folder: root,
    bookmark: "bookmark-3",
    mas: true,
    startAccess() { return "not-a-stop-function"; },
  }), false);
  assert.equal(fs.existsSync(path.join(root, `.live-interpret-write-test-${process.pid}`)), false);
  fs.rmSync(root, { recursive: true, force: true });
});
