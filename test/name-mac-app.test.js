const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { alignMacAppNames, alignMasBundleName, PRODUCT_NAME } = require("../scripts/name-mac-app");

function writePlist(file, values) {
  const body = Object.entries(values)
    .map(([key, value]) => `<key>${key}</key><string>${value}</string>`)
    .join("");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>
`);
}

function readPlist(file, key) {
  const { spawnSync } = require("child_process");
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return String(result.stdout || "").trim();
}

test("mas helpers keep an ascii name the sandbox can resolve", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "li-names-"));
  const app = path.join(dir, "live-interpret.app");
  const helperName = "실시간 통역시스템 Helper (GPU)";
  const helper = path.join(app, "Contents", "Frameworks", `${helperName}.app`);
  fs.mkdirSync(path.join(helper, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(helper, "Contents", "MacOS", helperName), "");
  fs.writeFileSync(path.join(app, "Contents", "MacOS", "실시간 통역시스템"), "");
  writePlist(path.join(helper, "Contents", "Info.plist"), {
    CFBundleName: "Electron Helper (GPU)",
    CFBundleExecutable: helperName,
    CFBundleDisplayName: helperName,
  });
  writePlist(path.join(app, "Contents", "Info.plist"), {
    CFBundleName: "실시간 통역시스템",
    CFBundleExecutable: "실시간 통역시스템",
    CFBundleDisplayName: "실시간 통역시스템",
  });

  const kept = alignMacAppNames(dir, { keepBundleName: true });
  const renamed = path.join(app, "Contents", "Frameworks", "live-interpret Helper (GPU).app");
  assert.equal(kept, app);
  assert.equal(fs.existsSync(app), true);
  assert.equal(fs.existsSync(renamed), true);
  assert.equal(readPlist(path.join(renamed, "Contents", "Info.plist"), "CFBundleName"), "live-interpret Helper (GPU)");
  assert.equal(readPlist(path.join(renamed, "Contents", "Info.plist"), "CFBundleExecutable"), "live-interpret Helper (GPU)");
  assert.equal(fs.existsSync(path.join(renamed, "Contents", "MacOS", "live-interpret Helper (GPU)")), true);
  assert.equal(readPlist(path.join(app, "Contents", "Info.plist"), "CFBundleName"), "live-interpret");
  assert.equal(readPlist(path.join(app, "Contents", "Info.plist"), "CFBundleExecutable"), "live-interpret");
  assert.equal(readPlist(path.join(app, "Contents", "Info.plist"), "CFBundleDisplayName"), "실시간 통역시스템");
});

test("mas bundle name uses the same decomposed hangul as the helper folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "li-nfd-"));
  const app = path.join(dir, "live-interpret.app");
  const helperName = `${PRODUCT_NAME.normalize("NFD")} Helper (GPU)`;
  const helper = path.join(app, "Contents", "Frameworks", `${helperName}.app`);
  fs.mkdirSync(path.join(helper, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(app, "Contents", "MacOS", "live-interpret"), "");
  writePlist(path.join(app, "Contents", "Info.plist"), {
    CFBundleName: PRODUCT_NAME.normalize("NFC"),
    CFBundleExecutable: "live-interpret",
    CFBundleDisplayName: PRODUCT_NAME.normalize("NFC"),
  });

  alignMasBundleName(dir);
  const bundleName = readPlist(path.join(app, "Contents", "Info.plist"), "CFBundleName");
  assert.equal(bundleName, PRODUCT_NAME.normalize("NFD"));
  assert.notEqual(bundleName, PRODUCT_NAME.normalize("NFC"));
  assert.equal(readPlist(path.join(app, "Contents", "Info.plist"), "CFBundleDisplayName"), PRODUCT_NAME.normalize("NFC"));
  assert.equal(readPlist(path.join(app, "Contents", "Info.plist"), "CFBundleExecutable"), "live-interpret");
  assert.equal(fs.existsSync(helper), true);
});
