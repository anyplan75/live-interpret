const fs = require("fs");
const path = require("path");

// Electron crashes on launch if the Mac executable name is not ASCII.
// The binary stays live-interpret; Finder shows 실시간 통역.app.
const dir = path.join(__dirname, "..", "dist", "mac-arm64");
const src = path.join(dir, "live-interpret.app");
const dst = path.join(dir, "실시간 통역.app");

if (!fs.existsSync(src)) {
  if (fs.existsSync(dst)) process.exit(0);
  throw new Error("dist/mac-arm64/live-interpret.app 이 없습니다.");
}

fs.rmSync(dst, { recursive: true, force: true });
fs.renameSync(src, dst);
console.log(dst);
