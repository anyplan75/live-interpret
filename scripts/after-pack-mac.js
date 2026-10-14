"use strict";

const fs = require("fs");
const path = require("path");

const DISPLAY_APP = "실시간 통역시스템.app";

/**
 * Rename the .app bundle before codesign so Finder shows 실시간 통역시스템.app.
 * The Mach-O binary inside stays live-interpret (ASCII).
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const dir = context.appOutDir;
  const dst = path.join(dir, DISPLAY_APP);
  if (fs.existsSync(dst)) return;
  const apps = fs.readdirSync(dir).filter((name) => name.endsWith(".app") && name !== DISPLAY_APP);
  if (!apps.length) return;
  fs.renameSync(path.join(dir, apps[0]), dst);
};
