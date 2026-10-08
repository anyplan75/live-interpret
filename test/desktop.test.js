const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const consent = require("../broadcast/lib/consent");
const { startAutoUpdate, silentUpdateAllowed } = require("../broadcast/lib/updater");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("consent dialog explains text-only storage and quits on decline", async () => {
  const opts = consent.consentDialogOptions();
  const all = `${opts.title}\n${opts.message}\n${opts.detail}`;
  assert.match(all, /음성을 저장하지 않습니다/);
  assert.match(all, /텍스트/);
  assert.match(all, /자연스럽/);
  assert.match(all, /정확/);
  assert.match(all, /설교자/);
  assert.match(all, /플랫폼 관리자/);
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

test("installers build per OS and publish draft releases", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["electron-updater"]);
  assert.equal(pkg.liveInterpret.macSilentUpdate, false);
  const build = pkg.build;
  assert.deepEqual(build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.ok(build.mac.target.some((row) => row.target === "zip" && row.arch.includes("arm64")));
  assert.deepEqual(build.publish, [{ provider: "github", owner: "anyplan75", repo: "live-interpret", releaseType: "draft" }]);
  assert.equal(build.mac.identity, "-");
  assert.equal(build.win.certificateFile, undefined);
  assert.match(pkg.scripts["dist:win"], /--win --x64/);
  assert.match(pkg.scripts["pack:mac"], /--mac dir --arm64/);

  const workflow = read(".github/workflows/desktop.yml");
  assert.match(workflow, /os: macos-14[\s\S]*platform: mac[\s\S]*arch: arm64/);
  assert.match(workflow, /os: windows-latest[\s\S]*platform: win[\s\S]*arch: x64/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/);
  assert.match(workflow, /--publish always/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /CSC_LINK|APPLE_ID|CSC_KEY_PASSWORD/);
  assert.match(read("README.md"), /Apple Developer ID/);
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
