"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { formatVersionLine, readAppVersionInfo } = require("../broadcast/lib/app-version");

test("version line names app version and build separately", () => {
  assert.equal(formatVersionLine("0.1.0", "0.1.51", { packaged: true }), "앱 버전 0.1.0 · 빌드 0.1.51");
  assert.equal(formatVersionLine("1.0", "21", { packaged: true }), "앱 버전 1.0 · 빌드 21");
  assert.equal(formatVersionLine("0.1.0", "개발", { packaged: false }), "앱 버전 0.1.0 · 빌드 개발");
});

test("unpackaged electron reports a development build label", () => {
  const info = readAppVersionInfo({
    isPackaged: false,
    getVersion: () => "0.1.0",
  });
  assert.equal(info.version, "0.1.0");
  assert.equal(info.build, "개발");
  assert.equal(info.line, "앱 버전 0.1.0 · 빌드 개발");
});

test("broadcast room shows the version line and preload exposes it", () => {
  const root = path.join(__dirname, "..");
  const room = fs.readFileSync(path.join(root, "broadcast/renderer/room.html"), "utf8");
  const roomJs = fs.readFileSync(path.join(root, "broadcast/renderer/room.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "broadcast/preload.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "broadcast/main.js"), "utf8");
  assert.match(room, /id="versionLine"/);
  assert.match(roomJs, /appVersion/);
  assert.match(preload, /appVersion:\s*\(\)\s*=>\s*ask\("app:version"\)/);
  assert.match(main, /app:version/);
  assert.match(main, /readAppVersionInfo/);
});

test("mac pack scripts accept one shared BUILD_VERSION", () => {
  const root = path.join(__dirname, "..");
  const packMac = fs.readFileSync(path.join(root, "scripts/pack-mac.js"), "utf8");
  const packMas = fs.readFileSync(path.join(root, "scripts/pack-mas.js"), "utf8");
  assert.match(packMac, /BUILD_VERSION/);
  assert.match(packMac, /--options", "runtime"/);
  assert.match(packMac, /live-interpret-\$\{pkg\.version\}-mac-arm64\.dmg/);
  assert.match(packMas, /BUILD_VERSION \|\| process\.env\.MAS_BUILD_VERSION/);
});
