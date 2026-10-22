const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const consent = require("../broadcast/lib/consent");
const { startAutoUpdate, masBuildActive, silentUpdateAllowed, isQuietUpdateFailure } = require("../broadcast/lib/updater");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("consent dialog explains text-only storage and quits on decline", async () => {
  const opts = consent.consentDialogOptions();
  const all = `${opts.title}\n${opts.message}\n${opts.detail}`;
  assert.match(all, /음성을 저장하지 않습니다/);
  assert.match(all, /텍스트/);
  assert.match(all, /자연스럽/);
  assert.match(all, /정확/);
  assert.match(all, /강연자/);
  assert.match(all, /플랫폼 관리자/);
  assert.match(all, /이 계정/);
  assert.doesNotMatch(all, /교회/);
  assert.match(all, /종료/);
  assert.match(all, /켤 때마다/);
  assert.deepEqual(opts.buttons, ["동의하고 계속", "동의하지 않음 (종료)"]);
  assert.equal(opts.cancelId, consent.DECLINE);

  const answers = [];
  const dialog = (response) => ({ showMessageBox: async (box) => { answers.push(box); return { response }; } });
  assert.equal(await consent.askConsent(dialog(consent.AGREE)), true);
  assert.equal(await consent.askConsent(dialog(consent.DECLINE)), false);
  assert.equal(answers.length, 2, "asks every time");

  const source = read("broadcast/lib/consent.js");
  assert.doesNotMatch(source, /require\(["']fs["']\)|writeFile|settings/);
  const main = read("broadcast/main.js");
  const ready = main.slice(main.indexOf("app.whenReady()"));
  assert.ok(ready.indexOf("askConsent") < ready.indexOf("registerIpc()"));
  assert.ok(ready.indexOf("askConsent") < ready.indexOf("createWindow()"));
  assert.match(ready, /if \(!agreed\) \{[\s\S]*app\.quit\(\)/);
  assert.doesNotMatch(main, /consent[A-Za-z]*\s*:\s*true|writeSettings\(\{\s*consent/);
});

function fakeUpdater() {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.checkForUpdates = async () => { updater.checks += 1; return null; };
  return updater;
}

test("auto-update checks GitHub releases and installs on next launch", async () => {
  assert.equal(masBuildActive({ mas: true }), true);
  assert.equal(startAutoUpdate({ mas: true, app: { isPackaged: true }, updater: fakeUpdater() }), null);

  assert.equal(startAutoUpdate({ app: { isPackaged: false }, updater: fakeUpdater() }), null);

  const logs = [];
  const win = startAutoUpdate({
    app: { isPackaged: true },
    platform: "win32",
    updater: fakeUpdater(),
    log: (level, text) => logs.push([level, text]),
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(win.checks, 1);
  assert.equal(win.autoDownload, true);
  assert.equal(win.autoInstallOnAppQuit, true);
  win.emit("update-downloaded", { version: "0.2.0" });
  assert.match(logs.at(-1)[1], /다음 실행/);
  win.emit("error", new Error(`bad sk-${"a".repeat(20)}`));
  assert.equal(logs.at(-1)[0], "error");
  assert.doesNotMatch(logs.at(-1)[1], /sk-a{20}/);

  const mac = startAutoUpdate({ app: { isPackaged: true }, platform: "darwin", updater: fakeUpdater(), config: { macSilentUpdate: false } });
  assert.equal(mac.autoDownload, false, "unsigned Mac builds only announce new versions");
  assert.equal(silentUpdateAllowed("darwin", { macSilentUpdate: true }), true);
  assert.equal(silentUpdateAllowed("win32", {}), true);
});

test("missing app-update.yml and update-check failures are logged and ignored", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "li-update-"));
  const withFile = fs.mkdtempSync(path.join(os.tmpdir(), "li-update-"));
  fs.writeFileSync(path.join(withFile, "app-update.yml"), "provider: github\n");
  const rejections = [];
  const onRejection = (err) => rejections.push(err);
  process.on("unhandledRejection", onRejection);
  try {
    const skippedLogs = [];
    const skipped = fakeUpdater();
    const skippedResult = startAutoUpdate({
      app: { isPackaged: true, resourcesPath: empty },
      platform: "darwin",
      updater: skipped,
      log: (level, text) => skippedLogs.push([level, text]),
    });
    assert.equal(skippedResult, null);
    assert.equal(skipped.checks, 0);
    assert.equal(skippedLogs[0][0], "error");
    assert.match(skippedLogs[0][1], /app-update\.yml/);

    const ready = fakeUpdater();
    const started = startAutoUpdate({
      app: { isPackaged: true, resourcesPath: withFile },
      platform: "darwin",
      updater: ready,
      log: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(started, ready);
    assert.equal(ready.checks, 1);

    const logs = [];
    const failing = fakeUpdater();
    failing.checkForUpdates = () => Promise.reject(new Error("ENOENT: no such file or directory, open '/tmp/app-update.yml'"));
    const failed = startAutoUpdate({
      app: { isPackaged: true, resourcesPath: withFile },
      platform: "darwin",
      updater: failing,
      log: (level, text) => logs.push([level, text]),
    });
    assert.equal(failed, failing);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejections.length, 0);
    assert.ok(logs.some(([level, text]) => level === "error" && /업데이트 확인 실패/.test(text) && /app-update\.yml/.test(text)));

    const echoed = [];
    const echoing = fakeUpdater();
    echoing.checkForUpdates = () => {
      const err = new Error("network down");
      echoing.emit("error", err);
      return Promise.reject(err);
    };
    startAutoUpdate({
      app: { isPackaged: true, resourcesPath: withFile },
      platform: "darwin",
      updater: echoing,
      log: (level, text) => echoed.push([level, text]),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejections.length, 0);
    assert.equal(echoed.filter(([level]) => level === "error").length, 1);

    const syncLogs = [];
    const syncFail = fakeUpdater();
    syncFail.checkForUpdates = () => { throw new Error(`sync sk-${"b".repeat(20)}`); };
    assert.doesNotThrow(() => startAutoUpdate({
      app: { isPackaged: true, resourcesPath: withFile },
      platform: "darwin",
      updater: syncFail,
      log: (level, text) => syncLogs.push([level, text]),
    }));
    assert.equal(syncLogs.at(-1)[0], "error");
    assert.match(syncLogs.at(-1)[1], /업데이트 확인 실패/);
    assert.doesNotMatch(syncLogs.at(-1)[1], /sk-b{20}/);

    const quietLogs = [];
    const quietErr = new Error(
      "Cannot parse releases feed: Error: Unable to find latest version on GitHub "
      + "(https://github.com/anyplan75/live-interpret/releases/latest)\n<!DOCTYPE html><html>"
    );
    assert.equal(isQuietUpdateFailure(quietErr), true);
    const quietUpdater = fakeUpdater();
    quietUpdater.checkForUpdates = () => Promise.reject(quietErr);
    startAutoUpdate({
      app: { isPackaged: true, resourcesPath: withFile },
      platform: "darwin",
      updater: quietUpdater,
      log: (level, text) => quietLogs.push([level, text]),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(quietLogs.length, 0);
  } finally {
    process.off("unhandledRejection", onRejection);
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(withFile, { recursive: true, force: true });
  }
});

test("installers build per OS and publish draft releases", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["electron-updater"]);
  assert.equal(pkg.liveInterpret.macSilentUpdate, false);
  const build = pkg.build;
  assert.deepEqual(build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.ok(build.mac.target.some((row) => row.target === "zip" && row.arch.includes("arm64")));
  assert.deepEqual(build.publish, [{ provider: "github", owner: "anyplan75", repo: "live-interpret", releaseType: "draft" }]);
  assert.equal(build.mac.identity, "ZJYZ656BL8");
  assert.equal(build.mac.minimumSystemVersion, "12.0");
  assert.doesNotMatch(build.mac.identity, /Developer ID Application|:/);
  assert.equal(build.mac.hardenedRuntime, false);
  assert.equal(build.win.certificateFile, undefined);
  assert.match(pkg.scripts["dist:win"], /--win --x64/);
  assert.equal(pkg.scripts["pack:mac"], "node scripts/pack-mac.js");
  assert.equal(pkg.scripts["dist:mac"], "node scripts/pack-mac.js --dist");
  assert.equal(pkg.scripts["dist:mas"], "node scripts/pack-mas.js");
  assert.ok(pkg.build.mas);
  assert.equal(pkg.build.mas.entitlements, "build/entitlements.mas.plist");
  assert.equal(pkg.build.mas.entitlementsInherit, "build/entitlements.mas.inherit.plist");
  assert.match(read("build/entitlements.mas.plist"), /com\.apple\.security\.app-sandbox/);
  assert.match(read("build/entitlements.mas.plist"), /files\.user-selected\.read-write/);
  assert.match(read("build/entitlements.mas.plist"), /application-groups/);
  assert.match(read("build/entitlements.mas.plist"), /ZJYZ656BL8\.com\.anyplan\.live-interpret/);
  assert.doesNotMatch(read("build/entitlements.mas.plist"), /group\.com\.anyplan\.live-interpret/);
  assert.match(read("build/entitlements.mas.plist"), /allow-jit/);
  assert.match(read("build/entitlements.mas.plist"), /allow-unsigned-executable-memory/);
  assert.doesNotMatch(read("build/entitlements.mas.plist"), /disable-library-validation/);
  assert.equal(pkg.build.mas.extendInfo.ElectronTeamID, "ZJYZ656BL8");
  assert.match(pkg.build.mac.icon, /icon-1024\.png$/);
  assert.match(pkg.build.mas.icon, /icon-1024\.png$/);
  assert.match(read("build/entitlements.mas.inherit.plist"), /com\.apple\.security\.inherit/);
  assert.match(read("build/entitlements.mas.inherit.plist"), /allow-jit/);
  assert.doesNotMatch(read("build/entitlements.mas.inherit.plist"), /disable-library-validation/);
  assert.doesNotMatch(read("build/entitlements.mas.inherit.plist"), /application-groups/);
  assert.doesNotMatch(read("build/entitlements.mas.inherit.plist"), /network\.client/);
  assert.match(read("scripts/mas-signing.js"), /Live Interpret Mac App Store Exact/);
  assert.match(read("scripts/pack-mas.js"), /--mac",\s*"mas"/);
  assert.match(read("scripts/pack-mas.js"), /MAS_BUILD_VERSION/);

  const packMac = read("scripts/pack-mac.js");
  assert.match(packMac, /--mac", "dir", "--arm64/);
  assert.match(packMac, /codesign --sign -/);
  assert.match(packMac, /임시 서명으로 대체합니다/);
  assert.match(packMac, /APPLE_TEAM_ID/);
  assert.match(packMac, /-c\.mac\.identity=-/);
  assert.match(packMac, /-c\.mac\.hardenedRuntime=true/);
  assert.doesNotMatch(packMac, /\.p12|CSC_LINK|CSC_KEY_PASSWORD|APPLE_APP_SPECIFIC_PASSWORD\s*[:=]\s*["'][^"']|BEGIN CERTIFICATE/);

  const workflow = read(".github/workflows/desktop.yml");
  assert.match(workflow, /os: macos-14[\s\S]*platform: mac[\s\S]*arch: arm64/);
  assert.match(workflow, /os: windows-latest[\s\S]*platform: win[\s\S]*arch: x64/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/);
  assert.match(workflow, /--publish always/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /-c\.mac\.identity=-/);
  assert.doesNotMatch(workflow, /CSC_LINK|APPLE_APP_SPECIFIC_PASSWORD|CSC_KEY_PASSWORD|\.p12/);
  assert.match(read("README.md"), /ZJYZ656BL8/);
});

test("Mac signing selects a Developer ID cert by team id and falls back only when it is absent", () => {
  const { findDeveloperIdLine, notarizationCredentials, TEAM_ID } = require("../scripts/pack-mac.js");
  assert.equal(TEAM_ID, "ZJYZ656BL8");
  const output = [
    '  1) AAAA "Developer ID Installer: Example (ZJYZ656BL8)"',
    '  2) BBBB "Apple Development: Example (ZJYZ656BL8)"',
    '  3) CCCC "Developer ID Application: Other (AAAAAAAAAA)"',
    '  4) DDDD "Developer ID Application: Example (ZJYZ656BL8)"',
  ].join("\n");
  assert.equal(findDeveloperIdLine(output, TEAM_ID), '4) DDDD "Developer ID Application: Example (ZJYZ656BL8)"');
  assert.equal(findDeveloperIdLine(output, "BBBBBBBBBB"), "");
  assert.equal(findDeveloperIdLine("", TEAM_ID), "");
  assert.equal(notarizationCredentials({}), "");
  assert.equal(notarizationCredentials({ APPLE_ID: "a", APPLE_APP_SPECIFIC_PASSWORD: "b" }), "apple-id");
  assert.equal(notarizationCredentials({ APPLE_API_KEY: "k", APPLE_API_KEY_ID: "i", APPLE_API_ISSUER: "u" }), "api-key");
  assert.equal(notarizationCredentials({ APPLE_KEYCHAIN_PROFILE: "profile" }), "keychain-profile");
  assert.equal(notarizationCredentials({ APPLE_TEAM_ID: TEAM_ID }), "");
});

test("admin reads every preacher dataset, church accounts write only their own", () => {
  const rules = JSON.parse(read("firebase/live-interpret.rules.json"));
  const preachers = rules["live-interpret"].churches.$churchId.preachers;
  assert.match(preachers[".read"], /admin\/uid/);
  assert.match(preachers[".read"], /child\(\$churchId\)\.child\('account\/uid'\)/);
  assert.match(preachers[".write"], /child\(\$churchId\)\.child\('account\/uid'\)/);
  assert.doesNotMatch(preachers[".write"], /admin\/uid|accounts/);
  const adminJs = read("docs/js/admin.js");
  ["pausePoints", "accuracy", "naturalness", "말 끊는 위치", "정확도 교정", "자연스러움 교정"].forEach((word) => {
    assert.ok(adminJs.includes(word), word);
  });
  const firebase = read("broadcast/lib/firebase.js");
  ["pausePoints", "accuracy", "naturalness"].forEach((field) => {
    assert.equal(firebase.split(field).length - 1 >= 2, true, `${field} is read and saved`);
  });
});
