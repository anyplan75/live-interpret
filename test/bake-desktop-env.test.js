const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const bake = require("../scripts/bake-desktop-env");

const root = path.join(__dirname, "..");

test("desktop package receives only the firebase web key", async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.build.afterPack, "scripts/bake-desktop-env.js");
  const secret = "web-key-for-package-only";
  const other = "do-not-ship-this-secret";
  const appOut = fs.mkdtempSync(path.join(os.tmpdir(), "li-bake-"));
  fs.mkdirSync(path.join(appOut, "실시간 통역시스템.app", "Contents"), { recursive: true });
  const logs = [];
  try {
    const dest = await bake({
      appOutDir: appOut,
      electronPlatformName: "darwin",
    }, {
      envText: `DEPOSIT_HMAC_SECRET=${other}\nFIREBASE_API_KEY=${secret}\nLIVE_INTERPRET_FIREBASE_REFRESH_TOKEN=${other}\n`,
      log: (message) => logs.push(message),
    });
    const text = fs.readFileSync(dest, "utf8");
    assert.equal(text, `FIREBASE_API_KEY=${secret}\n`);
    assert.equal(text.includes(other), false);
    assert.equal(logs.join("\n").includes(secret), false);
    assert.match(logs.join("\n"), /길이 24/);
  } finally {
    fs.rmSync(appOut, { recursive: true, force: true });
  }
});

test("packaged env text keeps a single key line", () => {
  assert.equal(bake.packagedEnvText("abc"), "FIREBASE_API_KEY=abc\n");
  assert.equal(bake.parseEnvValue('FIREBASE_API_KEY="quoted"\n', "FIREBASE_API_KEY"), "quoted");
  assert.throws(() => bake.packagedEnvText(""));
});
