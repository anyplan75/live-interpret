const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Electron looks up helpers by the main app's ASCII CFBundleName.
// Finder shows 실시간 통역시스템.app. The executable stays live-interpret.
const DISPLAY_APP = "실시간 통역시스템.app";
const BUNDLE_NAME = "live-interpret";
const dir = path.join(__dirname, "..", "dist", "mac-arm64");

function plistGet(file, key) {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", file], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function plistSet(file, key, value) {
  let result = spawnSync("plutil", ["-replace", key, "-string", value, file], { encoding: "utf8" });
  if (result.status !== 0) {
    result = spawnSync("plutil", ["-insert", key, "-string", value, file], { encoding: "utf8" });
  }
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${key} 를 바꾸지 못했습니다.`));
  }
}

function helperBase(appFileName) {
  const base = appFileName.replace(/\.app$/, "");
  const match = base.match(/ Helper( \(GPU\)| \(Plugin\)| \(Renderer\))?$/);
  if (!match) return "";
  return `${BUNDLE_NAME} Helper${match[1] || ""}`;
}

function renameExecutable(macOsDir, fromName, toName) {
  if (!fromName || fromName === toName) return;
  const src = path.join(macOsDir, fromName);
  const dst = path.join(macOsDir, toName);
  if (!fs.existsSync(src) || fs.existsSync(dst)) return;
  fs.renameSync(src, dst);
}

function fixHelper(frameworks, entry) {
  const targetBase = helperBase(entry);
  if (!targetBase) return;
  let appPath = path.join(frameworks, entry);
  const targetApp = `${targetBase}.app`;
  if (entry !== targetApp) {
    const dest = path.join(frameworks, targetApp);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(appPath, dest);
    appPath = dest;
  }
  const plist = path.join(appPath, "Contents", "Info.plist");
  const macOs = path.join(appPath, "Contents", "MacOS");
  renameExecutable(macOs, plistGet(plist, "CFBundleExecutable"), targetBase);
  plistSet(plist, "CFBundleExecutable", targetBase);
  plistSet(plist, "CFBundleName", targetBase);
  plistSet(plist, "CFBundleDisplayName", targetBase);
}

function mainApp() {
  const fresh = path.join(dir, `${BUNDLE_NAME}.app`);
  if (fs.existsSync(fresh)) return fresh;
  const wanted = path.join(dir, DISPLAY_APP);
  if (fs.existsSync(wanted)) return wanted;
  const apps = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => entry.name);
  if (!apps.length) throw new Error(`dist/mac-arm64 에 .app 이 없습니다. (${DISPLAY_APP})`);
  return path.join(dir, apps[0]);
}

const appPath = mainApp();
const frameworks = path.join(appPath, "Contents", "Frameworks");
if (fs.existsSync(frameworks)) {
  fs.readdirSync(frameworks).forEach((entry) => {
    if (entry.endsWith(".app")) fixHelper(frameworks, entry);
  });
}
const plist = path.join(appPath, "Contents", "Info.plist");
const macOs = path.join(appPath, "Contents", "MacOS");
renameExecutable(macOs, plistGet(plist, "CFBundleExecutable"), BUNDLE_NAME);
plistSet(plist, "CFBundleExecutable", BUNDLE_NAME);
plistSet(plist, "CFBundleName", BUNDLE_NAME);
plistSet(plist, "CFBundleDisplayName", "실시간 통역시스템");

const finalPath = path.join(dir, DISPLAY_APP);
if (appPath !== finalPath) {
  if (fs.existsSync(finalPath)) fs.rmSync(finalPath, { recursive: true, force: true });
  fs.renameSync(appPath, finalPath);
}
console.log(finalPath);
