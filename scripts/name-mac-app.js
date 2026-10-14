const fs = require("fs");
const path = require("path");

// Electron crashes on launch if the Mac executable name is not ASCII.
// The binary stays live-interpret; Finder shows 실시간 통역시스템.app.
const DISPLAY_APP = "실시간 통역시스템.app";
const dir = path.join(__dirname, "..", "dist", "mac-arm64");
const dst = path.join(dir, DISPLAY_APP);

if (fs.existsSync(dst)) process.exit(0);

const apps = fs.readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app") && entry.name !== DISPLAY_APP)
  .map((entry) => entry.name);
if (!apps.length) {
  throw new Error(`dist/mac-arm64 에 .app 이 없습니다. (${DISPLAY_APP} 또는 live-interpret.app)`);
}

const src = path.join(dir, apps[0]);
fs.renameSync(src, dst);
console.log(dst);
